import * as THREE from 'three';
import gsap from 'gsap';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

export function createMenuUI(deps) {
    const { scene, camera, renderer, containerGroup, containerConfig, CONTAINER_HALF, BOTTOM_CIRCLE_Y } = deps;
let sliderOne = null;
let sliderTwo = null;

// ==========================================
// MENU (button + panel placeholder + close)
// ==========================================

const MENU_ORBIT_OUTSET = 0.16;
const MENU_ORBIT_RADIUS = CONTAINER_HALF + MENU_ORBIT_OUTSET;
const MENU_LOCAL_Y = BOTTOM_CIRCLE_Y - 0.08;
const MENU_PLANE_SIZE = 0.04;
const MENU_TILT_UP_RAD = THREE.MathUtils.degToRad(20);

const menuPlaceholderGroup = new THREE.Group();
containerGroup.add(menuPlaceholderGroup);

const menuUiTextureLoader = new THREE.TextureLoader();

const menuButtonTexture = menuUiTextureLoader.load('./static/ui-button-menu.png');
menuButtonTexture.colorSpace = THREE.SRGBColorSpace;

const menuButtonPivot = new THREE.Object3D();
menuButtonPivot.rotation.x = -MENU_TILT_UP_RAD;
menuButtonPivot.position.z = -0.001;
menuPlaceholderGroup.add(menuButtonPivot);

const menuButton = new THREE.Mesh(
    new THREE.PlaneGeometry(MENU_PLANE_SIZE, MENU_PLANE_SIZE),
    new THREE.MeshBasicMaterial({
        map: menuButtonTexture,
        opacity: 1.0,
        transparent: true,
        side: THREE.FrontSide
    })
);
menuButton.frustumCulled = false;
menuButtonPivot.add(menuButton);

const MENU_PANEL_W = 0.3;
const MENU_PANEL_H = MENU_PANEL_W * (393 / 638);
const menuPanelTexture = menuUiTextureLoader.load('./static/ui-menu-placeholder.png');
menuPanelTexture.colorSpace = THREE.SRGBColorSpace;
const menuPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(MENU_PANEL_W, MENU_PANEL_H),
    new THREE.MeshBasicMaterial({
        map: menuPanelTexture,
        side: THREE.FrontSide,
        transparent: true
    })
);
menuPanel.rotation.x = -MENU_TILT_UP_RAD;
menuPanel.scale.set(0, 0, 0);
menuPanel.visible = false;
menuPanel.frustumCulled = false;
menuPlaceholderGroup.add(menuPanel);

const MENU_TOGGLE_Z = 0.01;
const MENU_TOGGLE_LEFT_X = -0.064;
const MENU_TOGGLE_RIGHT_X = 0.066;
const MENU_TOGGLE_Y = -0.023 + MENU_PANEL_W * (4 / 638) + MENU_PANEL_W * (3 / 638);

const MENU_TOGGLE_HIGHLIGHT_TEX_W = 280;
const MENU_TOGGLE_HIGHLIGHT_TEX_H = 46;
const MENU_TOGGLE_HIGHLIGHT_W = MENU_PANEL_W * (MENU_TOGGLE_HIGHLIGHT_TEX_W / 638);
const MENU_TOGGLE_HIGHLIGHT_H = MENU_TOGGLE_HIGHLIGHT_W * (MENU_TOGGLE_HIGHLIGHT_TEX_H / MENU_TOGGLE_HIGHLIGHT_TEX_W);
const menuToggleHighlightTexture = menuUiTextureLoader.load('./static/ui-toggle-active.png');
menuToggleHighlightTexture.colorSpace = THREE.SRGBColorSpace;
const menuToggleHighlight = new THREE.Mesh(
    new THREE.PlaneGeometry(MENU_TOGGLE_HIGHLIGHT_W, MENU_TOGGLE_HIGHLIGHT_H),
    new THREE.MeshBasicMaterial({
        map: menuToggleHighlightTexture,
        side: THREE.FrontSide,
        transparent: true,
        depthTest: false
    })
);
menuToggleHighlight.position.set(MENU_TOGGLE_LEFT_X, MENU_TOGGLE_Y, MENU_TOGGLE_Z);
menuToggleHighlight.frustumCulled = false;
menuPanel.add(menuToggleHighlight);

const MENU_CLOSE_SIZE = 0.03;
const MENU_NAV_BUTTON_SCALE = 0.7;
const MENU_NAV_BUTTON_SIZE = MENU_CLOSE_SIZE * MENU_NAV_BUTTON_SCALE;
const MENU_NAV_BUTTON_GAP = 0.008;
const MENU_PANEL_BUTTON_Y = 0.063;
const MENU_STEPPER_Y = MENU_PANEL_BUTTON_Y + MENU_PANEL_W * (4 / 638);
const MENU_CLOSE_BUTTON_Y = MENU_PANEL_BUTTON_Y + MENU_PANEL_W * (4 / 638);
const MENU_CLOSE_BUTTON_X = 0.122;
const MENU_NEXT_BUTTON_X = 0.082;
const MENU_PREV_BUTTON_X = -0.075;

function createMenuPanelButton(texturePath, x, size, y) {
    const texture = menuUiTextureLoader.load(texturePath);
    texture.colorSpace = THREE.SRGBColorSpace;
    const button = new THREE.Mesh(
        new THREE.PlaneGeometry(size, size),
        new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.FrontSide,
            transparent: true,
            depthTest: false
        })
    );
    button.position.set(x, y, 0.01);
    button.frustumCulled = false;
    menuPanel.add(button);
    return button;
}

const menuCloseButton = createMenuPanelButton(
    './static/ui-button-close.png',
    MENU_CLOSE_BUTTON_X,
    MENU_CLOSE_SIZE,
    MENU_CLOSE_BUTTON_Y
);
const menuNextButton = createMenuPanelButton(
    './static/ui-button-next.png',
    MENU_NEXT_BUTTON_X,
    MENU_NAV_BUTTON_SIZE,
    MENU_STEPPER_Y
);
const menuPrevButton = createMenuPanelButton(
    './static/ui-button-prev.png',
    MENU_PREV_BUTTON_X,
    MENU_NAV_BUTTON_SIZE,
    MENU_STEPPER_Y
);

const MENU_PRESET_LABEL_X = (MENU_PREV_BUTTON_X + MENU_NEXT_BUTTON_X) * 0.5;
const MENU_PRESET_LABEL_Y = MENU_STEPPER_Y;
const MENU_PRESET_LABEL_Z = 0.001;
const MENU_PRESET_LABEL_SIZE = 0.012 * 0.7;

let menuPresetLabelMesh = null;
let menuPresetLabelFont = null;

function updateMenuPresetLabel(text) {
    if (!menuPresetLabelFont) return;

    const geometry = new TextGeometry(text, {
        font: menuPresetLabelFont,
        size: MENU_PRESET_LABEL_SIZE,
        height: 0,
        curveSegments: 4,
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const centerX = (box.max.x + box.min.x) * 0.5;
    // Ignore descenders (g, y, etc.) so vertical position stays stable across labels.
    const visualMinY = Math.max(0, box.min.y);
    const visualCenterY = (box.max.y + visualMinY) * 0.5;
    geometry.translate(-centerX, -visualCenterY, 0);

    if (menuPresetLabelMesh) {
        menuPresetLabelMesh.geometry.dispose();
        menuPresetLabelMesh.geometry = geometry;
        return;
    }

    menuPresetLabelMesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            depthTest: false,
        })
    );
    menuPresetLabelMesh.position.set(
        MENU_PRESET_LABEL_X,
        MENU_PRESET_LABEL_Y,
        MENU_PRESET_LABEL_Z
    );
    menuPresetLabelMesh.frustumCulled = false;
    menuPanel.add(menuPresetLabelMesh);
}

const menuPresetLabelLoader = new FontLoader();
menuPresetLabelLoader.load('./static/fonts/helvetiker_bold.typeface.json', (font) => {
    menuPresetLabelFont = font;
    updateMenuPresetLabel(deps.getProfileStepperLabel());
});

// ==========================================
// MENU SLIDERS (XR pinch + pull)
// ==========================================

const MENU_SLIDER_TRACK_WIDTH = 0.175;
const MENU_SLIDER_TRACK_HEIGHT = 0.0025;

const MENU_SLIDER_TEXT_SCALE = 0.8;
const MENU_SLIDER_TEXT_HEIGHT = 0.025 * MENU_SLIDER_TEXT_SCALE;
const MENU_SLIDER_VALUE_TEXT_WIDTH = 0.05 * MENU_SLIDER_TEXT_SCALE;
const MENU_SLIDER_VALUE_TEXT_X = 0.115;
const MENU_SLIDER_LABEL_TEXT_LEFT_X = -0.142;
const MENU_SLIDER_TEXT_FONT = `bold ${Math.round(34 * MENU_SLIDER_TEXT_SCALE)}px Helvetica`;
const MENU_SLIDER_VERTICAL_GAP = 0.082;
const MENU_SLIDER_INACTIVE_TEXT_OPACITY = 0.8;
const MENU_SLIDER_INACTIVE_CONTROL_OPACITY = 0.5;
const MENU_SLIDER_ACTIVE_GRAB_COLOR = 0xffff00;
const MENU_SLIDER_INACTIVE_GRAB_COLOR = 0xffffff;

const menuSliderGeometries = {
    track: new THREE.PlaneGeometry(MENU_SLIDER_TRACK_WIDTH, MENU_SLIDER_TRACK_HEIGHT),
    trackDot: new THREE.SphereGeometry(0.0045, 16, 16),
    grabDot: new THREE.SphereGeometry(deps.INTERACTION_KNOB_RADIUS, 16, 16),
    connector: new THREE.BoxGeometry(1, 1, 1),
    valueText: new THREE.PlaneGeometry(MENU_SLIDER_VALUE_TEXT_WIDTH, MENU_SLIDER_TEXT_HEIGHT)
};

const _menuSliderGrabDotWorldPos = new THREE.Vector3();
const _menuSliderTrackWorldPos = new THREE.Vector3();
const _menuSliderTrackWorldDir = new THREE.Vector3();
const _menuSliderTrackWorldXEnd = new THREE.Vector3();
const _menuSliderPinchWorldPos = new THREE.Vector3();
const _menuSliderConnectorTrackDotPos = new THREE.Vector3();
const _menuSliderConnectorGrabDotPos = new THREE.Vector3();
const _menuSliderConnectorMidpoint = new THREE.Vector3();

let activeMenuSlider = null;

function createMenuSliderLabelText(text, leftX) {
    const canvasHeight = Math.round(64 * MENU_SLIDER_TEXT_SCALE);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = MENU_SLIDER_TEXT_FONT;
    const textWidth = ctx.measureText(text).width;
    const padding = 12 * MENU_SLIDER_TEXT_SCALE;
    canvas.width = Math.ceil(textWidth + padding * 2);
    canvas.height = canvasHeight;

    ctx.fillStyle = '#ffffff';
    ctx.font = MENU_SLIDER_TEXT_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, padding, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const planeWidth = MENU_SLIDER_TEXT_HEIGHT * (canvas.width / canvas.height);
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(planeWidth, MENU_SLIDER_TEXT_HEIGHT),
        new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: false
        })
    );
    mesh.position.set(leftX + planeWidth * 0.5, 0, 0);
    mesh.frustumCulled = false;
    return mesh;
}

function createMenuSliderCenteredText(text, opacity = 1) {
    const canvasHeight = Math.round(64 * MENU_SLIDER_TEXT_SCALE);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    ctx.font = MENU_SLIDER_TEXT_FONT;
    const textWidth = ctx.measureText(text).width;
    const padding = 12 * MENU_SLIDER_TEXT_SCALE;
    canvas.width = Math.ceil(textWidth + padding * 2);
    canvas.height = canvasHeight;

    ctx.fillStyle = '#ffffff';
    ctx.font = MENU_SLIDER_TEXT_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;

    const planeWidth = MENU_SLIDER_TEXT_HEIGHT * (canvas.width / canvas.height);
    const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(planeWidth, MENU_SLIDER_TEXT_HEIGHT),
        new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: true,
            opacity,
            depthTest: false
        })
    );
    mesh.frustumCulled = false;
    return mesh;
}

const MENU_TOGGLE_ACTIVE_COLOR = '#ffff00';
const MENU_TOGGLE_INACTIVE_COLOR = '#ffffff';
const MENU_TOGGLE_INACTIVE_OPACITY = 1.0;
const MENU_TOGGLE_PRESS_SCALE = 1.2;
const MENU_TOGGLE_HIGHLIGHT_MOVE_DURATION = 0.25;

function setMenuToggleLabelColor(labelMesh, color) {
    const canvas = labelMesh.material.map.image;
    const ctx = canvas.getContext('2d');
    const text = labelMesh.userData.toggleLabelText;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = color;
    ctx.font = MENU_SLIDER_TEXT_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
    labelMesh.material.map.needsUpdate = true;
}

function applyMenuToggleVisuals(animateHighlight = false) {
    const isSurface = deps.menuToggleActiveOption === 'surface';
    setMenuToggleLabelColor(
        menuToggleLeftLabel,
        isSurface ? MENU_TOGGLE_ACTIVE_COLOR : MENU_TOGGLE_INACTIVE_COLOR
    );
    menuToggleLeftLabel.material.opacity = isSurface ? 1 : MENU_TOGGLE_INACTIVE_OPACITY;
    setMenuToggleLabelColor(
        menuToggleRightLabel,
        isSurface ? MENU_TOGGLE_INACTIVE_COLOR : MENU_TOGGLE_ACTIVE_COLOR
    );
    menuToggleRightLabel.material.opacity = isSurface ? MENU_TOGGLE_INACTIVE_OPACITY : 1;

    const targetX = isSurface ? MENU_TOGGLE_LEFT_X : MENU_TOGGLE_RIGHT_X;
    if (animateHighlight) {
        gsap.killTweensOf(menuToggleHighlight.position);
        gsap.to(menuToggleHighlight.position, {
            x: targetX,
            duration: MENU_TOGGLE_HIGHLIGHT_MOVE_DURATION,
            ease: 'power2.inOut'
        });
    } else {
        menuToggleHighlight.position.x = targetX;
    }
}

function setMenuToggleActiveOption(option) {
    const normalized = option === 'disk' ? 'disk' : 'surface';
    deps.menuToggleActiveOption = normalized;
    applyMenuToggleVisuals(true);
    deps.setRevolutionMode(normalized, { syncToggle: false });
}

const menuToggleLeftLabel = createMenuSliderCenteredText('Surface View');
menuToggleLeftLabel.userData.toggleLabelText = 'Surface View';
menuToggleLeftLabel.position.set(MENU_TOGGLE_LEFT_X, MENU_TOGGLE_Y - 0.0006, MENU_TOGGLE_Z);
menuPanel.add(menuToggleLeftLabel);

const menuToggleRightLabel = createMenuSliderCenteredText('Disk View');
menuToggleRightLabel.userData.toggleLabelText = 'Disk View';
menuToggleRightLabel.position.set(MENU_TOGGLE_RIGHT_X, MENU_TOGGLE_Y - 0.0006, MENU_TOGGLE_Z);
menuPanel.add(menuToggleRightLabel);

applyMenuToggleVisuals();
deps.menuToggleUiReady = true;

function applyMenuSliderActiveState(slider, active) {
    if (!slider) return;

    const textOpacity = active ? 1 : MENU_SLIDER_INACTIVE_TEXT_OPACITY;
    const controlOpacity = active ? 1 : MENU_SLIDER_INACTIVE_CONTROL_OPACITY;
    const { track, trackDot, grabDot } = slider.elements;

    track.material.transparent = controlOpacity < 1;
    track.material.opacity = controlOpacity;

    trackDot.visible = active;
    if (active) {
        trackDot.material.transparent = false;
        trackDot.material.opacity = 1;
    }

    grabDot.material.transparent = true;
    grabDot.material.color.setHex(
        active ? MENU_SLIDER_ACTIVE_GRAB_COLOR : MENU_SLIDER_INACTIVE_GRAB_COLOR
    );
    grabDot.material.opacity = controlOpacity;

    if (slider.text.label) {
        slider.text.label.material.opacity = textOpacity;
    }

    slider.text.value.material.opacity = textOpacity;
    slider.interaction.enabled = active;

    if (!active && activeMenuSlider === slider) {
        releaseActiveMenuSlider();
    }
}

function setMenuSliderLabelText(slider, text) {
    const track = slider.elements.track;
    if (slider.text.label) {
        track.remove(slider.text.label);
        slider.text.label.geometry.dispose();
        slider.text.label.material.map.dispose();
        slider.text.label.material.dispose();
    }
    slider.text.label = createMenuSliderLabelText(text, MENU_SLIDER_LABEL_TEXT_LEFT_X);
    track.add(slider.text.label);
}

function createMenuSlider(config) {
    const valueTextCanvas = document.createElement('canvas');
    valueTextCanvas.width = Math.round(128 * MENU_SLIDER_TEXT_SCALE);
    valueTextCanvas.height = Math.round(64 * MENU_SLIDER_TEXT_SCALE);
    const valueTextCtx = valueTextCanvas.getContext('2d');
    const valueTextTexture = new THREE.CanvasTexture(valueTextCanvas);
    valueTextTexture.colorSpace = THREE.SRGBColorSpace;

    const valueTextMaterial = new THREE.MeshBasicMaterial({
        map: valueTextTexture,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false
    });
    const valueText = new THREE.Mesh(menuSliderGeometries.valueText, valueTextMaterial);
    valueText.position.set(MENU_SLIDER_VALUE_TEXT_X, 0, 0);
    valueText.frustumCulled = false;

    const track = new THREE.Mesh(
        menuSliderGeometries.track,
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
    );
    track.position.copy(config.position);
    track.frustumCulled = false;
    menuPanel.add(track);
    track.add(valueText);

    let labelText = null;
    if (config.label) {
        labelText = createMenuSliderLabelText(config.label, MENU_SLIDER_LABEL_TEXT_LEFT_X);
        track.add(labelText);
    }

    const trackDot = new THREE.Mesh(
        menuSliderGeometries.trackDot,
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
    );
    trackDot.position.set(0, 0, 0.001);
    trackDot.frustumCulled = false;
    track.add(trackDot);

    const grabDot = new THREE.Mesh(
        menuSliderGeometries.grabDot,
        new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: true })
    );
    grabDot.position.set(0, 0, 0.002);
    grabDot.frustumCulled = false;
    track.add(grabDot);

    const connector = new THREE.Mesh(
        menuSliderGeometries.connector,
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            depthTest: true,
            transparent: true,
            opacity: 0.6
        })
    );
    connector.visible = false;
    connector.frustumCulled = false;
    scene.add(connector);

    return {
        value: {
            normalized: config.defaultValue,
            min: config.minValue,
            max: config.maxValue,
            decimals: config.valueDecimals,
            integerValues: config.integerValues || false
        },
        elements: {
            track,
            trackDot,
            grabDot,
            connector
        },
        text: {
            label: labelText,
            value: valueText,
            valueCanvas: valueTextCanvas,
            valueCtx: valueTextCtx,
            valueTexture: valueTextTexture
        },
        interaction: {
            enabled: true,
            isGrabbed: false,
            grabbingHand: null,
            grabDistance: 0.025,
            trackHalfWidth: MENU_SLIDER_TRACK_WIDTH * 0.5,
            initialGrabX: 0
        },
        onUpdate: config.onUpdate || null
    };
}

const MENU_SLIDER_ONE_Y = 0.0205 + MENU_PANEL_W * (2 / 638);
const MENU_SLIDER_TWO_Y = 0.0205 - MENU_SLIDER_VERTICAL_GAP - MENU_PANEL_W * (5 / 638);
const SLIDER_ONE_POSITION = new THREE.Vector3(0.005, MENU_SLIDER_ONE_Y, 0.001);
const SLIDER_TWO_POSITION = new THREE.Vector3(
    SLIDER_ONE_POSITION.x,
    MENU_SLIDER_TWO_Y,
    SLIDER_ONE_POSITION.z
);

const FREEFORM_CURVE_HINT_TEXT = 'Drag or add points to shape the curve';
const FREEFORM_CURVE_HINT_OPACITY = 0.8;

let freeformCurveHint = null;

function updateMenuSliderValueTextCanvas(slider, displayValue) {
    const { valueCanvas, valueCtx, valueTexture } = slider.text;
    valueCtx.clearRect(0, 0, valueCanvas.width, valueCanvas.height);
    valueCtx.fillStyle = '#ffffff';
    valueCtx.font = MENU_SLIDER_TEXT_FONT;
    valueCtx.textAlign = 'center';
    valueCtx.textBaseline = 'middle';
    valueCtx.fillText(String(displayValue), valueCanvas.width / 2, valueCanvas.height / 2);
    valueTexture.needsUpdate = true;
}

function getMenuSliderActualValue(slider) {
    const { normalized, min, max } = slider.value;
    return min + normalized * (max - min);
}

function updateMenuSliderValueText(slider) {
    const actual = getMenuSliderActualValue(slider);
    let text;
    if (slider.value.integerValues) {
        text = String(Math.round(actual));
    } else if (slider.value.decimals !== undefined) {
        text = actual.toFixed(slider.value.decimals);
    } else {
        text = actual.toFixed(1);
    }
    updateMenuSliderValueTextCanvas(slider, text);
}

function updateMenuSliderTrackDotFromValue(slider) {
    const trackX = (slider.value.normalized - 0.5) * 2 * slider.interaction.trackHalfWidth;
    slider.elements.trackDot.position.x = trackX;
}

function updateMenuSliderGrabDotPosition(slider) {
    if (!slider || slider.interaction.isGrabbed) return;
    slider.elements.grabDot.position.x = slider.elements.trackDot.position.x;
}

function updateAllMenuSliderGrabDots() {
    updateMenuSliderGrabDotPosition(sliderOne);
    updateMenuSliderGrabDotPosition(sliderTwo);
}

function applyMenuSliderNormalizedValue(slider) {
    if (slider.onUpdate) {
        slider.onUpdate(getMenuSliderActualValue(slider));
    }
}

function getMenuSliderTrackWorldDir(slider) {
    slider.elements.track.getWorldPosition(_menuSliderTrackWorldPos);
    _menuSliderTrackWorldXEnd.set(1, 0, 0);
    slider.elements.track.localToWorld(_menuSliderTrackWorldXEnd);
    _menuSliderTrackWorldDir.copy(_menuSliderTrackWorldXEnd).sub(_menuSliderTrackWorldPos).normalize();
}

function checkMenuSlidersGrab() {
    if (!menuButtonState.xrReady) return;
    if (!menuPanelOpen || !menuPanel.visible) return;

    const leftPinching = deps.pinchState.left;
    const rightPinching = deps.pinchState.right;

    if (activeMenuSlider) {
        const stillPinching =
            (activeMenuSlider.interaction.grabbingHand === 'left' && leftPinching) ||
            (activeMenuSlider.interaction.grabbingHand === 'right' && rightPinching);

        if (!stillPinching) {
            onMenuSliderRelease(activeMenuSlider);
        } else {
            onMenuSliderDrag(activeMenuSlider);
        }
        return;
    }

    for (const slider of [sliderOne, sliderTwo]) {
        if (!slider || !slider.elements.track.visible || slider.interaction.enabled === false) continue;

        slider.elements.grabDot.getWorldPosition(_menuSliderGrabDotWorldPos);

        if (leftPinching) {
            _menuSliderPinchWorldPos.addVectors(deps.lThumbObj.position, deps.lIndexObj.position).multiplyScalar(0.5);
            if (_menuSliderPinchWorldPos.distanceTo(_menuSliderGrabDotWorldPos) < slider.interaction.grabDistance) {
                onMenuSliderGrab(slider, 'left');
                return;
            }
        }

        if (rightPinching) {
            _menuSliderPinchWorldPos.addVectors(deps.rThumbObj.position, deps.rIndexObj.position).multiplyScalar(0.5);
            if (_menuSliderPinchWorldPos.distanceTo(_menuSliderGrabDotWorldPos) < slider.interaction.grabDistance) {
                onMenuSliderGrab(slider, 'right');
                return;
            }
        }
    }
}

function onMenuSliderGrab(slider, hand) {
    if (slider === sliderTwo && deps.isDiskMode() && deps.isRevolutionSweepHidden()) {
        deps.beginSweepRevealAnimation();
    }

    activeMenuSlider = slider;
    slider.interaction.isGrabbed = true;
    slider.interaction.grabbingHand = hand;

    if (hand === 'left') {
        _menuSliderPinchWorldPos.addVectors(deps.lThumbObj.position, deps.lIndexObj.position).multiplyScalar(0.5);
    } else {
        _menuSliderPinchWorldPos.addVectors(deps.rThumbObj.position, deps.rIndexObj.position).multiplyScalar(0.5);
    }

    getMenuSliderTrackWorldDir(slider);
    slider.interaction.initialGrabX = _menuSliderPinchWorldPos.clone().sub(_menuSliderTrackWorldPos).dot(_menuSliderTrackWorldDir);

    slider.elements.grabDot.getWorldPosition(_menuSliderGrabDotWorldPos);
    slider.elements.track.remove(slider.elements.grabDot);
    scene.add(slider.elements.grabDot);
    slider.elements.grabDot.position.copy(_menuSliderGrabDotWorldPos);
    slider.elements.grabDot.scale.setScalar(1.2);

    slider.elements.connector.visible = true;
    updateMenuSliderConnector(slider);
}

function onMenuSliderDrag(slider) {
    if (slider.interaction.grabbingHand === 'left') {
        _menuSliderPinchWorldPos.addVectors(deps.lThumbObj.position, deps.lIndexObj.position).multiplyScalar(0.5);
    } else {
        _menuSliderPinchWorldPos.addVectors(deps.rThumbObj.position, deps.rIndexObj.position).multiplyScalar(0.5);
    }

    slider.elements.grabDot.position.copy(_menuSliderPinchWorldPos);

    getMenuSliderTrackWorldDir(slider);

    const currentProjectedX = _menuSliderPinchWorldPos.clone().sub(_menuSliderTrackWorldPos).dot(_menuSliderTrackWorldDir);
    const deltaX = currentProjectedX - slider.interaction.initialGrabX;
    const currentTrackX = (slider.value.normalized - 0.5) * 2 * slider.interaction.trackHalfWidth;
    let newTrackX = currentTrackX + deltaX;
    newTrackX = Math.max(-slider.interaction.trackHalfWidth, Math.min(slider.interaction.trackHalfWidth, newTrackX));

    slider.value.normalized = (newTrackX / slider.interaction.trackHalfWidth + 1) * 0.5;
    slider.interaction.initialGrabX = currentProjectedX;

    updateMenuSliderTrackDotFromValue(slider);
    updateMenuSliderValueText(slider);
    applyMenuSliderNormalizedValue(slider);
    updateMenuSliderConnector(slider);
}

function updateMenuSliderConnector(slider) {
    slider.elements.trackDot.getWorldPosition(_menuSliderConnectorTrackDotPos);
    slider.elements.grabDot.getWorldPosition(_menuSliderConnectorGrabDotPos);

    const distance = _menuSliderConnectorTrackDotPos.distanceTo(_menuSliderConnectorGrabDotPos);
    _menuSliderConnectorMidpoint.addVectors(_menuSliderConnectorTrackDotPos, _menuSliderConnectorGrabDotPos).multiplyScalar(0.5);
    slider.elements.connector.position.copy(_menuSliderConnectorMidpoint);

    const thickness = 0.002;
    slider.elements.connector.scale.set(thickness, thickness, distance);
    slider.elements.connector.lookAt(_menuSliderConnectorGrabDotPos);
}

function onMenuSliderRelease(slider) {
    slider.interaction.isGrabbed = false;
    slider.interaction.grabbingHand = null;
    activeMenuSlider = null;

    slider.elements.connector.visible = false;
    slider.elements.grabDot.scale.setScalar(1);

    slider.elements.grabDot.getWorldPosition(_menuSliderGrabDotWorldPos);
    scene.remove(slider.elements.grabDot);
    slider.elements.track.add(slider.elements.grabDot);
    slider.elements.track.worldToLocal(_menuSliderGrabDotWorldPos);
    slider.elements.grabDot.position.copy(_menuSliderGrabDotWorldPos);

    gsap.to(slider.elements.grabDot.position, {
        x: slider.elements.trackDot.position.x,
        y: slider.elements.trackDot.position.y,
        z: 0.002,
        duration: 0.1,
        ease: 'power2.out'
    });
}

function releaseActiveMenuSlider() {
    if (activeMenuSlider) {
        onMenuSliderRelease(activeMenuSlider);
    }
}

// --- SliderOne: profile radius (analytic mode) ---

function getSliderOneSizeLabel() {
    switch (deps.profileState.activePreset) {
        case 'r = sqrt(a² + b²*(y-c)²)':
            return 'Size (a)';
        case 'r = c*sqrt(y - y0)':
            return 'Size (c)';
        default:
            return 'Size (R)';
    }
}

function profileSizeToSliderOneValue(size, minValue, maxValue) {
    if (maxValue <= minValue) return 0;
    return (size - minValue) / (maxValue - minValue);
}

function getSliderOneValueRange() {
    const minValue = deps.PROFILE_SIZE_MIN;
    const maxValue = deps.profileState.mode === 'analytic'
        ? deps.getMaxAnalyticProfileSize(deps.profileState.activePreset)
        : deps.getGlobalMaxAnalyticProfileSize();
    return { minValue, maxValue };
}

function applySliderOneValue(rawValue) {
    if (!sliderOne) return;
    const { minValue, maxValue } = getSliderOneValueRange();
    const stepped = THREE.MathUtils.clamp(
        Math.round(rawValue / deps.PROFILE_SIZE_STEP) * deps.PROFILE_SIZE_STEP,
        minValue,
        maxValue
    );

    deps.profileParams.size = deps.clampAnalyticProfileSize(stepped);
    sliderOne.value.min = minValue;
    sliderOne.value.max = maxValue;
    sliderOne.value.normalized = profileSizeToSliderOneValue(
        deps.profileParams.size,
        minValue,
        maxValue
    );
    updateMenuSliderTrackDotFromValue(sliderOne);
    updateMenuSliderValueText(sliderOne);
    deps.updateProfileCurve();
}

function syncSliderOne() {
    if (!sliderOne) return;

    const isAnalytic = deps.profileState.mode === 'analytic';
    sliderOne.elements.track.visible = isAnalytic;
    if (freeformCurveHint) {
        freeformCurveHint.visible = !isAnalytic;
    }

    if (!isAnalytic) {
        if (activeMenuSlider === sliderOne) {
            releaseActiveMenuSlider();
        }
        return;
    }

    const { minValue, maxValue } = getSliderOneValueRange();
    deps.profileParams.size = deps.clampAnalyticProfileSize(deps.profileParams.size);

    sliderOne.value.min = minValue;
    sliderOne.value.max = maxValue;
    sliderOne.value.normalized = profileSizeToSliderOneValue(
        deps.profileParams.size,
        minValue,
        maxValue
    );
    setMenuSliderLabelText(sliderOne, getSliderOneSizeLabel());
    updateMenuSliderTrackDotFromValue(sliderOne);
    updateMenuSliderGrabDotPosition(sliderOne);
    updateMenuSliderValueText(sliderOne);
}

sliderOne = createMenuSlider({
    position: SLIDER_ONE_POSITION,
    label: getSliderOneSizeLabel(),
    defaultValue: 0,
    minValue: deps.PROFILE_SIZE_MIN,
    maxValue: deps.PROFILE_RADIUS_LIMIT,
    valueDecimals: 2,
    onUpdate: applySliderOneValue
});

freeformCurveHint = new THREE.Group();
freeformCurveHint.position.copy(SLIDER_ONE_POSITION);
freeformCurveHint.add(createMenuSliderCenteredText(FREEFORM_CURVE_HINT_TEXT, FREEFORM_CURVE_HINT_OPACITY));
freeformCurveHint.visible = false;
freeformCurveHint.frustumCulled = false;
menuPanel.add(freeformCurveHint);

// --- SliderTwo: disk slice count (disk mode) ---

function diskCountToSliderTwoValue(count, minValue, maxValue) {
    if (maxValue <= minValue) return 0;
    return (count - minValue) / (maxValue - minValue);
}

function applySliderTwoValue(rawValue) {
    if (!sliderTwo) return;
    const minValue = 1;
    const maxValue = deps.DISK_METHOD_MAX_DISKS;
    const count = THREE.MathUtils.clamp(Math.round(rawValue), minValue, maxValue);

    deps.diskMethod.diskCount = count;
    sliderTwo.value.min = minValue;
    sliderTwo.value.max = maxValue;
    sliderTwo.value.normalized = diskCountToSliderTwoValue(count, minValue, maxValue);
    updateMenuSliderTrackDotFromValue(sliderTwo);
    updateMenuSliderValueText(sliderTwo);

    if (deps.diskMethod.lastSamples) {
        deps.updateDiskMethod(deps.diskMethod.lastSamples);
    }
}

function syncSliderTwo() {
    if (!sliderTwo) return;

    sliderTwo.elements.track.visible = true;
    applyMenuSliderActiveState(sliderTwo, deps.isDiskMode());

    const minValue = 1;
    const maxValue = deps.DISK_METHOD_MAX_DISKS;
    const count = THREE.MathUtils.clamp(Math.round(deps.diskMethod.diskCount), minValue, maxValue);
    deps.diskMethod.diskCount = count;

    sliderTwo.value.min = minValue;
    sliderTwo.value.max = maxValue;
    sliderTwo.value.normalized = diskCountToSliderTwoValue(count, minValue, maxValue);
    updateMenuSliderTrackDotFromValue(sliderTwo);
    updateMenuSliderGrabDotPosition(sliderTwo);
    updateMenuSliderValueText(sliderTwo);
}

sliderTwo = createMenuSlider({
    position: SLIDER_TWO_POSITION,
    label: 'Slices',
    defaultValue: diskCountToSliderTwoValue(deps.diskMethod.diskCount, 1, deps.DISK_METHOD_MAX_DISKS),
    minValue: 1,
    maxValue: deps.DISK_METHOD_MAX_DISKS,
    integerValues: true,
    onUpdate: applySliderTwoValue
});

updateMenuSliderTrackDotFromValue(sliderOne);
updateMenuSliderGrabDotPosition(sliderOne);
updateMenuSliderValueText(sliderOne);
syncSliderOne();

updateMenuSliderTrackDotFromValue(sliderTwo);
updateMenuSliderGrabDotPosition(sliderTwo);
updateMenuSliderValueText(sliderTwo);
syncSliderTwo();

const menuButtonState = {
    isPressed: false,
    cooldown: 0,
    cooldownDuration: 0.5,
    pressDistance: 0.025,
    xrReady: false,
    xrStartupDelay: 1.0
};

renderer.xr.addEventListener('sessionstart', () => {
    setTimeout(() => {
        menuButtonState.xrReady = true;
    }, menuButtonState.xrStartupDelay * 1000);
});
renderer.xr.addEventListener('sessionend', () => {
    menuButtonState.xrReady = false;
});

let menuPanelOpen = false;

const menuUiAnimConfig = {
    buttonHideDelay: 0.1,
    panelShowDelay: 0.0,
    panelScaleDuration: 0.3,
    panelHideDuration: 0.3,
    buttonScaleDuration: 0.3,
    panelEase: 'power2.out',
    buttonEase: 'power2.inOut'
};

const _menuButtonWorldPos = new THREE.Vector3();
const _menuPanelButtonWorldPos = new THREE.Vector3();
const _camWorldPos = new THREE.Vector3();
const _camContainerLocal = new THREE.Vector3();
const _containerWorldScale = new THREE.Vector3();

function updateMenuPlaceholder() {
    renderer.xr.getCamera().getWorldPosition(_camWorldPos);
    _camContainerLocal.copy(_camWorldPos);
    containerGroup.worldToLocal(_camContainerLocal);

    const dx = _camContainerLocal.x;
    const dz = _camContainerLocal.z;
    const horizLenSq = dx * dx + dz * dz;
    const yaw = horizLenSq > 1e-8 ? Math.atan2(dx, dz) : 0;

    menuPlaceholderGroup.position.set(
        Math.sin(yaw) * MENU_ORBIT_RADIUS,
        MENU_LOCAL_Y,
        Math.cos(yaw) * MENU_ORBIT_RADIUS
    );
    menuPlaceholderGroup.rotation.set(0, yaw, 0);

    containerGroup.getWorldScale(_containerWorldScale);
    menuPlaceholderGroup.scale.set(
        _containerWorldScale.x > 1e-8 ? 1 / _containerWorldScale.x : 1,
        _containerWorldScale.y > 1e-8 ? 1 / _containerWorldScale.y : 1,
        _containerWorldScale.z > 1e-8 ? 1 / _containerWorldScale.z : 1
    );
}

function updatePlaneUiHeaderOrientation() {
    renderer.xr.getCamera().getWorldPosition(_camWorldPos);
    _camContainerLocal.copy(_camWorldPos);
    containerGroup.worldToLocal(_camContainerLocal);

    const dx = _camContainerLocal.x - deps.planeUiRefSphere.position.x;
    const dz = _camContainerLocal.z - deps.planeUiRefSphere.position.z;
    const horizLenSq = dx * dx + dz * dz;
    if (horizLenSq > 1e-8) {
        deps.planeUiHeaderPivot.rotation.y = Math.atan2(dx, dz);
    }
}

function animateMenuButtonPress(buttonMesh, scaleUp = 1.3) {
    gsap.killTweensOf(buttonMesh.position);
    gsap.killTweensOf(buttonMesh.scale);

    const originalZ = buttonMesh.position.z;
    const pressDepth = -0.02;
    const pressDuration = 0.15;
    const returnDuration = 0.15;
    const delayBeforeReturn = 0.075;

    const tl = gsap.timeline();
    tl.to(buttonMesh.position, { z: originalZ + pressDepth, duration: pressDuration, ease: 'power2.out' }, 0);
    tl.to(buttonMesh.scale, { x: scaleUp, y: scaleUp, duration: pressDuration, ease: 'power2.out' }, 0);
    tl.to(buttonMesh.position, { z: originalZ, duration: returnDuration, ease: 'power2.out' }, pressDuration + delayBeforeReturn);
    tl.to(buttonMesh.scale, { x: 1, y: 1, duration: returnDuration, ease: 'power2.out' }, pressDuration + delayBeforeReturn);
}

function checkMenuButtonPress(delta) {
    if (!menuButtonState.xrReady) return;

    if (menuButtonState.cooldown > 0) {
        menuButtonState.cooldown -= delta;
        return;
    }

    if (deps.pinchState.left || deps.pinchState.right) return;
    if (!menuButton.visible) return;

    menuButton.getWorldPosition(_menuButtonWorldPos);

    if (deps.lIndexObj.position.distanceTo(_menuButtonWorldPos) < menuButtonState.pressDistance) {
        onMenuButtonPressed();
        return;
    }
    if (deps.rIndexObj.position.distanceTo(_menuButtonWorldPos) < menuButtonState.pressDistance) {
        onMenuButtonPressed();
    }
}

function onMenuButtonPressed() {
    menuButtonState.isPressed = true;
    menuButtonState.cooldown = menuButtonState.cooldownDuration;

    animateMenuButtonPress(menuButton);

    if (!menuPanelOpen) {
        showMenuPanel();
    }
}

function checkMenuPanelButtonPress(buttonMesh, onPressed) {
    buttonMesh.getWorldPosition(_menuPanelButtonWorldPos);

    if (deps.lIndexObj.position.distanceTo(_menuPanelButtonWorldPos) < menuButtonState.pressDistance) {
        onPressed();
        return true;
    }
    if (deps.rIndexObj.position.distanceTo(_menuPanelButtonWorldPos) < menuButtonState.pressDistance) {
        onPressed();
        return true;
    }
    return false;
}

function checkMenuPanelButtonsPress() {
    if (!menuButtonState.xrReady) return;
    if (menuButtonState.cooldown > 0) return;
    if (!menuPanelOpen || !menuPanel.visible) return;
    if (deps.pinchState.left || deps.pinchState.right) return;

    if (checkMenuPanelButtonPress(menuCloseButton, onMenuCloseButtonPressed)) return;
    if (checkMenuPanelButtonPress(menuPrevButton, onMenuPrevButtonPressed)) return;
    if (checkMenuPanelButtonPress(menuNextButton, onMenuNextButtonPressed)) return;
    if (checkMenuPanelButtonPress(menuToggleLeftLabel, onMenuToggleLeftLabelPressed)) return;
    checkMenuPanelButtonPress(menuToggleRightLabel, onMenuToggleRightLabelPressed);
}

function pressMenuToggleOption(option, labelMesh) {
    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(labelMesh, MENU_TOGGLE_PRESS_SCALE);
    const nextOption = deps.menuToggleActiveOption === option
        ? (option === 'surface' ? 'disk' : 'surface')
        : option;
    setMenuToggleActiveOption(nextOption);
}

function onMenuToggleLeftLabelPressed() {
    pressMenuToggleOption('surface', menuToggleLeftLabel);
}

function onMenuToggleRightLabelPressed() {
    pressMenuToggleOption('disk', menuToggleRightLabel);
}

function onMenuCloseButtonPressed() {
    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(menuCloseButton);
    setTimeout(() => { hideMenuPanel(); }, 150);
}

function onMenuPrevButtonPressed() {
    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(menuPrevButton);
    deps.stepProfileMode(-1);
}

function onMenuNextButtonPressed() {
    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(menuNextButton);
    deps.stepProfileMode(1);
}

function showMenuPanel() {
    menuPanelOpen = true;

    const tl = gsap.timeline();

    tl.to({}, { duration: menuUiAnimConfig.buttonHideDelay });
    tl.to(menuButton.scale, {
        x: 0,
        y: 0,
        duration: menuUiAnimConfig.buttonScaleDuration,
        ease: menuUiAnimConfig.buttonEase,
        onComplete: () => { menuButton.visible = false; }
    });
    tl.to({}, { duration: menuUiAnimConfig.panelShowDelay });
    tl.call(() => { menuPanel.visible = true; });
    tl.to(menuPanel.scale, {
        x: 1,
        y: 1,
        z: 1,
        duration: menuUiAnimConfig.panelScaleDuration,
        ease: menuUiAnimConfig.panelEase
    });
}

function hideMenuPanel() {
    menuPanelOpen = false;
    releaseActiveMenuSlider();
    menuButton.position.z = 0;

    const tl = gsap.timeline();

    tl.to(menuPanel.scale, {
        x: 0,
        y: 0,
        z: 0,
        duration: menuUiAnimConfig.panelHideDuration,
        ease: 'power2.in',
        onComplete: () => { menuPanel.visible = false; }
    });
    tl.call(() => { menuButton.visible = true; }, [], `-=${menuUiAnimConfig.panelHideDuration * 0.3}`);
    tl.to(menuButton.scale, {
        x: 1,
        y: 1,
        duration: menuUiAnimConfig.buttonScaleDuration,
        ease: menuUiAnimConfig.panelEase
    }, `-=${menuUiAnimConfig.panelScaleDuration * 0.3}`);
}

deps.menuToggleUiReady = true;


    const api = {
        menuButtonState,
        menuPanelOpen,
        activeMenuSlider,
        sliderOne,
        sliderTwo,
        applyMenuToggleVisuals,
        updateMenuPresetLabel,
        syncSliderOne,
        syncSliderTwo,
        updateMenuPlaceholder,
        checkMenuButtonPress,
        checkMenuPanelButtonsPress,
        checkMenuSlidersGrab,
        updateAllMenuSliderGrabDots,
        showMenuPanel,
        hideMenuPanel
    };
    Object.assign(deps, api);
    Object.defineProperty(deps, 'activeMenuSlider', {
        configurable: true,
        enumerable: true,
        get: () => activeMenuSlider,
        set: (v) => { activeMenuSlider = v; },
    });
    Object.defineProperty(deps, 'menuPanelOpen', {
        configurable: true,
        enumerable: true,
        get: () => menuPanelOpen,
        set: (v) => { menuPanelOpen = v; },
    });
    return api;
}
