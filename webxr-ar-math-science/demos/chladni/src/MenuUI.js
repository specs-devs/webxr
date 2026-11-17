import * as THREE from 'three';
import gsap from 'gsap';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json';

export function createMenuUI(deps) {
    const {
        scene, camera, renderer,
        containerGroup, halfSize,
        VIEW_MODES, guiParams, chladni, resonance, contourUniforms,
        MODE_INDEX_MIN, MODE_INDEX_MAX, FREQUENCY_MAX_HZ,
        setViewMode, setCustomResonanceMode, applyFrequencyKnobHz, applyModeValues,
        pinchState, lIndexObj, rIndexObj, lThumbObj, rThumbObj,
    } = deps;

    // Local up vector for billboards (TwoHandedManip has its own).
    const _upVector = new THREE.Vector3(0, 1, 0);

    // Live refs that Chladni may mutate after MenuUI boots (meshUniforms, etc.)
    const getMeshUniforms = () => deps.meshUniforms;
    const getCurrentViewMode = () => deps.currentViewMode;

// UI vertical height from comp center (plate at y=0; container top ≈ 0.225).
const HEADER_UI_Y = 0.56;
const KNOB_UI_Y = 0.35;

const referenceAnchor = new THREE.Object3D();
referenceAnchor.position.set(0, 0, 0);
containerGroup.add(referenceAnchor);

const referenceSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x9933ff })
);
referenceSphere.visible = false;
referenceAnchor.add(referenceSphere);

const HEADER_PLANE_SCALE = 1.32;
const HEADER_PLANE_W = 0.3 * HEADER_PLANE_SCALE;
const HEADER_PLANE_H = HEADER_PLANE_W * (230 / 634);

const headerPlanePivot = new THREE.Object3D();
headerPlanePivot.position.set(0, HEADER_UI_Y, 0.001);
referenceAnchor.add(headerPlanePivot);

const REFERENCE_SECONDARY_ORBIT_RADIUS = 0.18;
const REFERENCE_SECONDARY_RIGHT_OFFSET = 0.2;
const FREQ_PLACEHOLDER_YAW_OFFSET_RAD = THREE.MathUtils.degToRad(10);

const referenceSecondaryOrbitPivot = new THREE.Object3D();
referenceAnchor.add(referenceSecondaryOrbitPivot);

const referenceSecondarySphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x9933ff })
);
referenceSecondarySphere.visible = false;
referenceSecondaryOrbitPivot.add(referenceSecondarySphere);

const frequencyPlanePivot = new THREE.Object3D();
frequencyPlanePivot.position.z = -0.001;
referenceSecondaryOrbitPivot.add(frequencyPlanePivot);

const referenceUiTextureLoader = new THREE.TextureLoader();
const headerPlaneTexture = referenceUiTextureLoader.load('./static/ui-header.png');
headerPlaneTexture.colorSpace = THREE.SRGBColorSpace;

const headerPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(HEADER_PLANE_W, HEADER_PLANE_H),
    new THREE.MeshBasicMaterial({
        map: headerPlaneTexture,
        transparent: true,
        side: THREE.FrontSide,
    })
);
headerPlane.name = 'Header Plane';
headerPlane.frustumCulled = false;
headerPlanePivot.add(headerPlane);

/** Header checkbox: off = audio muted, on = plate audio while interacting (ui-checkbox / ui-checkbox-in). */
// Checkbox circle (headerPlanePivot local space)
const AUDIO_CHECKBOX_SIZE = 0.0216;
const AUDIO_CHECKBOX_X = -0.147;
const AUDIO_CHECKBOX_Y = -0.085;
const AUDIO_CHECKBOX_Z = 0.001;

// SOUND label (headerPlanePivot local space)
const AUDIO_CHECKBOX_LABEL_WIDTH = 0.092;
const AUDIO_CHECKBOX_LABEL_HEIGHT = 0.023;
const AUDIO_CHECKBOX_LABEL_X = -0.1018;
const AUDIO_CHECKBOX_LABEL_Y = -0.0861;
const AUDIO_CHECKBOX_LABEL_Z = 0.001;
const AUDIO_CHECKBOX_LABEL_FONT_PX = 49;

const audioCheckboxTexture = referenceUiTextureLoader.load('./static/ui-checkbox.png');
audioCheckboxTexture.colorSpace = THREE.SRGBColorSpace;
const audioCheckbox = new THREE.Mesh(
    new THREE.PlaneGeometry(AUDIO_CHECKBOX_SIZE, AUDIO_CHECKBOX_SIZE),
    new THREE.MeshBasicMaterial({
        map: audioCheckboxTexture,
        transparent: true,
        side: THREE.FrontSide,
        depthTest: false,
    })
);
audioCheckbox.position.set(AUDIO_CHECKBOX_X, AUDIO_CHECKBOX_Y, AUDIO_CHECKBOX_Z);
audioCheckbox.frustumCulled = false;
audioCheckbox.renderOrder = 5;
headerPlanePivot.add(audioCheckbox);

const audioCheckboxInSize = AUDIO_CHECKBOX_SIZE * 0.5;
const audioCheckboxInTexture = referenceUiTextureLoader.load('./static/ui-checkbox-in.png');
audioCheckboxInTexture.colorSpace = THREE.SRGBColorSpace;
const audioCheckboxIn = new THREE.Mesh(
    new THREE.PlaneGeometry(audioCheckboxInSize, audioCheckboxInSize),
    new THREE.MeshBasicMaterial({
        map: audioCheckboxInTexture,
        transparent: true,
        side: THREE.FrontSide,
        depthTest: false,
    })
);
audioCheckboxIn.position.set(0, 0, 0.001);
audioCheckboxIn.visible = false;
audioCheckboxIn.frustumCulled = false;
audioCheckboxIn.renderOrder = 6;
audioCheckbox.add(audioCheckboxIn);

const audioCheckboxLabelCanvas = document.createElement('canvas');
audioCheckboxLabelCanvas.width = 256;
audioCheckboxLabelCanvas.height = 64;
const audioCheckboxLabelCtx = audioCheckboxLabelCanvas.getContext('2d');
audioCheckboxLabelCtx.fillStyle = '#ffffff';
audioCheckboxLabelCtx.font = `bold ${AUDIO_CHECKBOX_LABEL_FONT_PX}px Helvetica, Arial, sans-serif`;
audioCheckboxLabelCtx.textAlign = 'center';
audioCheckboxLabelCtx.textBaseline = 'middle';
audioCheckboxLabelCtx.fillText(
    'SOUND',
    audioCheckboxLabelCanvas.width / 2,
    audioCheckboxLabelCanvas.height / 2
);
const audioCheckboxLabelTexture = new THREE.CanvasTexture(audioCheckboxLabelCanvas);
audioCheckboxLabelTexture.colorSpace = THREE.SRGBColorSpace;
const audioCheckboxLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(AUDIO_CHECKBOX_LABEL_WIDTH, AUDIO_CHECKBOX_LABEL_HEIGHT),
    new THREE.MeshBasicMaterial({
        map: audioCheckboxLabelTexture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false,
    })
);
audioCheckboxLabel.position.set(
    AUDIO_CHECKBOX_LABEL_X,
    AUDIO_CHECKBOX_LABEL_Y,
    AUDIO_CHECKBOX_LABEL_Z
);
audioCheckboxLabel.frustumCulled = false;
audioCheckboxLabel.renderOrder = 5;
headerPlanePivot.add(audioCheckboxLabel);

let plateAudioEnabled = false;

function setPlateAudioEnabled(enabled) {
    plateAudioEnabled = enabled;
    audioCheckboxIn.visible = enabled;
}

const FREQUENCY_KNOB_X = 0.058;
const FREQUENCY_KNOB_ANCHOR_RADIUS = 0.00225;
const FREQUENCY_KNOB_GRAB_Z = 0.002;
const INTERACTION_KNOB_RADIUS = 0.008;

const frequencyKnobRoot = new THREE.Group();
frequencyKnobRoot.position.set(FREQUENCY_KNOB_X, 0, 0);
frequencyKnobRoot.frustumCulled = false;
frequencyPlanePivot.add(frequencyKnobRoot);

const frequencyKnobSphereGeometry = new THREE.SphereGeometry(FREQUENCY_KNOB_ANCHOR_RADIUS, 16, 16);
const frequencyKnobSphereMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: true,
    depthWrite: true,
});

const frequencyKnobAnchor = new THREE.Mesh(frequencyKnobSphereGeometry, frequencyKnobSphereMaterial);
frequencyKnobAnchor.name = 'Frequency Knob Anchor';
frequencyKnobAnchor.frustumCulled = false;
frequencyKnobRoot.add(frequencyKnobAnchor);

const frequencyKnobGrabGeometry = new THREE.SphereGeometry(INTERACTION_KNOB_RADIUS, 16, 16);
const frequencyKnobGrabMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    depthTest: true,
    depthWrite: true,
});
const frequencyKnobGrab = new THREE.Mesh(frequencyKnobGrabGeometry, frequencyKnobGrabMaterial);
frequencyKnobGrab.name = 'Frequency Knob Grab';
frequencyKnobGrab.position.z = FREQUENCY_KNOB_GRAB_Z;
frequencyKnobGrab.frustumCulled = false;
frequencyKnobGrab.renderOrder = 2;
frequencyKnobRoot.add(frequencyKnobGrab);

// ==========================================
// MENU (orbiting button + panel + close)
// ==========================================

const BOTTOM_CIRCLE_Y = -halfSize;
const MENU_ORBIT_OUTSET = 0.16;
const MENU_ORBIT_RADIUS = halfSize + MENU_ORBIT_OUTSET;
const MENU_LOCAL_Y = BOTTOM_CIRCLE_Y + 0.14;
const MENU_PLANE_SIZE = 0.04;
const MENU_TILT_UP_RAD = THREE.MathUtils.degToRad(30);

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
const MENU_PANEL_H = MENU_PANEL_W * (368 / 638);
const menuPanelTexture = menuUiTextureLoader.load('./static/ui-menu.png');
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

const MENU_CLOSE_SIZE = 0.03;
const MENU_PANEL_BUTTON_Y = 0.063;
const MENU_CLOSE_BUTTON_Y = 0.06;
const MENU_CLOSE_BUTTON_X = 0.122;

// MENU VIEW TOGGLE (3-button: Particles | Contour | 3D Mesh)
const MENU_VIEW_TOGGLE_TEXT_SIZE = 0.0084 * 0.9;
const MENU_VIEW_TOGGLE_LEFT_X = -0.095;
const MENU_VIEW_TOGGLE_CENTER_X = -0.02;
const MENU_VIEW_TOGGLE_RIGHT_X = 0.053;
const MENU_VIEW_TOGGLE_Y = 0.06;
const MENU_VIEW_TOGGLE_Z = 0.01;

const MENU_VIEW_TOGGLE_LABELS = Object.freeze({
    left: 'Particles',
    center: 'Contour',
    right: '3D Mesh',
});

const MENU_VIEW_TOGGLE_MODES = Object.freeze({
    left: VIEW_MODES.PARTICLES,
    center: VIEW_MODES.CONTOUR,
    right: VIEW_MODES.MESH,
});

const MENU_VIEW_TOGGLE_SLOT_BY_MODE = Object.freeze({
    [VIEW_MODES.PARTICLES]: 'left',
    [VIEW_MODES.CONTOUR]: 'center',
    [VIEW_MODES.MESH]: 'right',
});

const MENU_VIEW_TOGGLE_PRESS_SCALE = 1.2;
const MENU_VIEW_TOGGLE_ACTIVE_COLOR = 0xffff00;
const MENU_VIEW_TOGGLE_INACTIVE_COLOR = 0xffffff;
const MENU_VIEW_TOGGLE_HIGHLIGHT_MOVE_DURATION = 0.25;

const MENU_VIEW_TOGGLE_X_BY_SLOT = Object.freeze({
    left: MENU_VIEW_TOGGLE_LEFT_X,
    center: MENU_VIEW_TOGGLE_CENTER_X,
    right: MENU_VIEW_TOGGLE_RIGHT_X,
});

let menuViewToggleActiveSlot = 'center';

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

// Toggle Highlight
const MENU_VIEW_TOGGLE_HIGHLIGHT_TEX_W = 158;
const MENU_VIEW_TOGGLE_HIGHLIGHT_TEX_H = 46;
const MENU_VIEW_TOGGLE_HIGHLIGHT_W = MENU_PANEL_W * (MENU_VIEW_TOGGLE_HIGHLIGHT_TEX_W / 638);
const MENU_VIEW_TOGGLE_HIGHLIGHT_H = MENU_VIEW_TOGGLE_HIGHLIGHT_W * (MENU_VIEW_TOGGLE_HIGHLIGHT_TEX_H / MENU_VIEW_TOGGLE_HIGHLIGHT_TEX_W);

const menuViewToggleHighlightTexture = menuUiTextureLoader.load('./static/ui-toggle-active.png');
menuViewToggleHighlightTexture.colorSpace = THREE.SRGBColorSpace;

const menuViewToggleHighlight = new THREE.Mesh(
    new THREE.PlaneGeometry(MENU_VIEW_TOGGLE_HIGHLIGHT_W, MENU_VIEW_TOGGLE_HIGHLIGHT_H),
    new THREE.MeshBasicMaterial({
        map: menuViewToggleHighlightTexture,
        side: THREE.FrontSide,
        transparent: true,
        depthTest: false,
    })
);
menuViewToggleHighlight.position.set(
    MENU_VIEW_TOGGLE_CENTER_X,
    MENU_VIEW_TOGGLE_Y,
    MENU_VIEW_TOGGLE_Z
);
menuViewToggleHighlight.frustumCulled = false;
menuPanel.add(menuViewToggleHighlight);

// ==========================================
// MENU SLIDERS (XR pinch + pull)
// ==========================================

const MENU_SLIDER_TRACK_WIDTH = 0.17;
const MENU_SLIDER_TRACK_HEIGHT = 0.0025;
const MENU_SLIDER_THREE_TRACK_WIDTH = 0.08;
const MENU_SLIDER_THREE_TRACK_X = MENU_PANEL_W * (-96 / 638);
const MENU_SLIDER_THREE_LABEL_TEXT_LEFT_X = -0.092;
const MENU_SLIDER_THREE_TRACK_LINE_OFFSET_PX = -20;
const MENU_SLIDER_MIX_PAIR_GAP_PX = 130;
const MENU_SLIDER_FOUR_TRACK_X = MENU_SLIDER_THREE_TRACK_X
    + MENU_SLIDER_THREE_TRACK_WIDTH
    + MENU_PANEL_W * (MENU_SLIDER_MIX_PAIR_GAP_PX / 638);
const MENU_SLIDER_FOUR_LABEL_TEXT_LEFT_X = MENU_SLIDER_THREE_LABEL_TEXT_LEFT_X;
const MENU_SLIDER_FOUR_TRACK_LINE_OFFSET_PX = MENU_SLIDER_THREE_TRACK_LINE_OFFSET_PX;

const MENU_SLIDER_TEXT_SCALE = 0.8;
const MENU_SLIDER_TEXT_HEIGHT = 0.025 * MENU_SLIDER_TEXT_SCALE;
const MENU_SLIDER_VALUE_TEXT_WIDTH = 0.05 * MENU_SLIDER_TEXT_SCALE;
const MENU_SLIDER_VALUE_TEXT_X = 0.1;
const MENU_SLIDER_LABEL_TEXT_LEFT_X = -0.16;
const MENU_SLIDER_TEXT_FONT = `bold ${Math.round(34 * MENU_SLIDER_TEXT_SCALE)}px Helvetica`;

const FREQUENCY_PLANE_TEXT_SCALE = 0.7;
const FREQUENCY_PLANE_TEXT_X = 0.04;
const FREQUENCY_PLANE_TEXT_HEIGHT = MENU_SLIDER_TEXT_HEIGHT * 1.15 * FREQUENCY_PLANE_TEXT_SCALE;

const frequencyPlaneFont = new FontLoader().parse(helvetikerBold);

/** First-open hint above the frequency knob (matches Refraction Ray Mode). */
const FREQ_HINT_TEXT = 'Tune';
const FREQ_HINT_TEXT_SIZE = 0.00864;
const FREQ_HINT_ARROW_W = 0.0072;
const FREQ_HINT_ARROW_H = 0.0048;
const FREQ_HINT_TEXT_Y = 0.033;
const FREQ_HINT_ARROW_Y = 0.021;
const FREQ_HINT_SCALE = 1.2;
const FREQ_HINT_Y = -0.003;
const FREQ_HINT_FADE_DURATION = 0.4;

function buildFrequencyHintTextGeometry(text) {
    const geometry = new THREE.ShapeGeometry(frequencyPlaneFont.generateShapes(text, FREQ_HINT_TEXT_SIZE));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    geometry.translate(
        -(box.max.x + box.min.x) * 0.5,
        -(box.max.y + box.min.y) * 0.5,
        0
    );
    return geometry;
}

const frequencyKnobHintMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
});

const frequencyKnobHint = new THREE.Group();
frequencyKnobHint.frustumCulled = false;
frequencyKnobHint.position.set(0, FREQ_HINT_Y, 0.003);
frequencyKnobHint.scale.setScalar(FREQ_HINT_SCALE);
frequencyKnobRoot.add(frequencyKnobHint);

const frequencyHintArrowShape = new THREE.Shape();
frequencyHintArrowShape.moveTo(0, -FREQ_HINT_ARROW_H * 0.5);
frequencyHintArrowShape.lineTo(FREQ_HINT_ARROW_W * 0.5, FREQ_HINT_ARROW_H * 0.5);
frequencyHintArrowShape.lineTo(-FREQ_HINT_ARROW_W * 0.5, FREQ_HINT_ARROW_H * 0.5);
frequencyHintArrowShape.closePath();

const frequencyHintArrow = new THREE.Mesh(
    new THREE.ShapeGeometry(frequencyHintArrowShape),
    frequencyKnobHintMaterial
);
frequencyHintArrow.position.set(0, FREQ_HINT_ARROW_Y, 0);
frequencyHintArrow.renderOrder = 6;
frequencyHintArrow.frustumCulled = false;
frequencyKnobHint.add(frequencyHintArrow);

const frequencyHintLabel = new THREE.Mesh(
    buildFrequencyHintTextGeometry(FREQ_HINT_TEXT),
    frequencyKnobHintMaterial
);
frequencyHintLabel.position.set(0, FREQ_HINT_TEXT_Y, 0);
frequencyHintLabel.renderOrder = 6;
frequencyHintLabel.frustumCulled = false;
frequencyKnobHint.add(frequencyHintLabel);

let frequencyKnobHintDismissed = false;

function dismissFrequencyKnobHint() {
    if (frequencyKnobHintDismissed) return;
    frequencyKnobHintDismissed = true;

    gsap.to(frequencyKnobHintMaterial, {
        opacity: 0,
        duration: FREQ_HINT_FADE_DURATION,
        ease: 'power2.out',
        onComplete: () => {
            frequencyKnobHint.visible = false;
        },
    });
}

const menuViewToggleButtons = {
    left: null,
    center: null,
    right: null,
};

function createMenuViewToggleTextGeometry(text) {
    const geometry = new TextGeometry(text, {
        font: frequencyPlaneFont,
        size: MENU_VIEW_TOGGLE_TEXT_SIZE,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false,
    });
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    const centerX = (box.max.x + box.min.x) * 0.5;
    const visualMinY = Math.max(0, box.min.y);
    const visualCenterY = (box.max.y + visualMinY) * 0.5;
    geometry.translate(-centerX, -visualCenterY, 0);
    return geometry;
}

function createMenuViewToggleButton(slot, text, x) {
    const mesh = new THREE.Mesh(
        createMenuViewToggleTextGeometry(text),
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: false,
        })
    );
    mesh.userData.viewToggleSlot = slot;
    mesh.position.set(x, MENU_VIEW_TOGGLE_Y, MENU_VIEW_TOGGLE_Z);
    mesh.frustumCulled = false;
    menuPanel.add(mesh);
    return mesh;
}

menuViewToggleButtons.left = createMenuViewToggleButton('left', MENU_VIEW_TOGGLE_LABELS.left, MENU_VIEW_TOGGLE_LEFT_X);
menuViewToggleButtons.center = createMenuViewToggleButton('center', MENU_VIEW_TOGGLE_LABELS.center, MENU_VIEW_TOGGLE_CENTER_X);
menuViewToggleButtons.right = createMenuViewToggleButton('right', MENU_VIEW_TOGGLE_LABELS.right, MENU_VIEW_TOGGLE_RIGHT_X);

function applyMenuViewToggleColors() {
    for (const slot of ['left', 'center', 'right']) {
        const mesh = menuViewToggleButtons[slot];
        if (!mesh) continue;
        mesh.material.color.setHex(
            slot === menuViewToggleActiveSlot
                ? MENU_VIEW_TOGGLE_ACTIVE_COLOR
                : MENU_VIEW_TOGGLE_INACTIVE_COLOR
        );
    }
}

function moveMenuViewToggleHighlightToSlot(slot, animate = true) {
    const targetX = MENU_VIEW_TOGGLE_X_BY_SLOT[slot];
    if (targetX === undefined) return;

    gsap.killTweensOf(menuViewToggleHighlight.position);
    if (animate) {
        gsap.to(menuViewToggleHighlight.position, {
            x: targetX,
            duration: MENU_VIEW_TOGGLE_HIGHLIGHT_MOVE_DURATION,
            ease: 'power2.inOut',
        });
    } else {
        menuViewToggleHighlight.position.x = targetX;
    }
}

function syncMenuViewToggleToViewMode(mode, animateHighlight = true) {
    const slot = MENU_VIEW_TOGGLE_SLOT_BY_MODE[mode];
    if (!slot || slot === menuViewToggleActiveSlot) return;

    const prevSlot = menuViewToggleActiveSlot;
    menuViewToggleActiveSlot = slot;

    const prevMesh = menuViewToggleButtons[prevSlot];
    if (prevMesh) prevMesh.material.color.setHex(MENU_VIEW_TOGGLE_INACTIVE_COLOR);

    const activeMesh = menuViewToggleButtons[slot];
    if (activeMesh) activeMesh.material.color.setHex(MENU_VIEW_TOGGLE_ACTIVE_COLOR);

    moveMenuViewToggleHighlightToSlot(slot, animateHighlight);
}

function onMenuViewTogglePressed(slot) {
    const mesh = menuViewToggleButtons[slot];
    if (!mesh) return;

    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(mesh, MENU_VIEW_TOGGLE_PRESS_SCALE);

    const mode = MENU_VIEW_TOGGLE_MODES[slot];
    if (!mode || mode === getCurrentViewMode()) return;

    setViewMode(mode);
    guiParams.view = mode;
}

applyMenuViewToggleColors();

const frequencyPlaneTextMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false,
});

let frequencyPlaneTextMesh = null;
let lastFrequencyPlaneTextHz = NaN;

function createFrequencyPlaneTextGeometry(text) {
    const geometry = new TextGeometry(text, {
        font: frequencyPlaneFont,
        size: FREQUENCY_PLANE_TEXT_HEIGHT,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false,
    });
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    geometry.translate(-bb.max.x, -(bb.max.y + bb.min.y) * 0.5, 0);
    return geometry;
}

function initFrequencyPlaneText() {
    const geometry = createFrequencyPlaneTextGeometry(`${Math.round(guiParams.frequencyHz)} Hz`);
    frequencyPlaneTextMesh = new THREE.Mesh(geometry, frequencyPlaneTextMaterial);
    frequencyPlaneTextMesh.position.set(FREQUENCY_PLANE_TEXT_X, 0, 0.002);
    frequencyPlaneTextMesh.frustumCulled = false;
    frequencyPlanePivot.add(frequencyPlaneTextMesh);
    lastFrequencyPlaneTextHz = Math.round(guiParams.frequencyHz);
}

function updateFrequencyPlaneText() {
    const hz = Math.round(guiParams.frequencyHz);
    if (hz === lastFrequencyPlaneTextHz) return;
    lastFrequencyPlaneTextHz = hz;

    frequencyPlaneTextMesh.geometry.dispose();
    frequencyPlaneTextMesh.geometry = createFrequencyPlaneTextGeometry(`${hz} Hz`);
}

initFrequencyPlaneText();

const FREQUENCY_KNOB_GRAB_DISTANCE = 0.025;
const FREQUENCY_KNOB_MIN_ANGLE_RADIUS = 0.008;
const FREQUENCY_KNOB_RADIAL_INNER = 0.0155;
const FREQUENCY_KNOB_RADIAL_OUTER = 0.0195;
const FREQUENCY_KNOB_RADIAL_MID = (FREQUENCY_KNOB_RADIAL_INNER + FREQUENCY_KNOB_RADIAL_OUTER) * 0.5;
const FREQUENCY_KNOB_RADIAL_LAYER_Z = 0.001;
const FREQUENCY_KNOB_RADIAL_Z = 0.021;
const FREQUENCY_KNOB_RADIAL_OPEN_SCALE = 2;
const FREQUENCY_KNOB_RADIAL_SCALE_DURATION = 0.18;

const frequencyKnobRadialRoot = new THREE.Group();
frequencyKnobRadialRoot.position.z = FREQUENCY_KNOB_RADIAL_Z;
frequencyKnobRadialRoot.scale.setScalar(0);
frequencyKnobRadialRoot.visible = false;
frequencyKnobRadialRoot.frustumCulled = false;
frequencyKnobRoot.add(frequencyKnobRadialRoot);

const frequencyKnobRadialTrackMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.22,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
});
const frequencyKnobRadialValueMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
});

const frequencyKnobRadialTrack = new THREE.Mesh(
    new THREE.RingGeometry(FREQUENCY_KNOB_RADIAL_INNER, FREQUENCY_KNOB_RADIAL_OUTER, 72),
    frequencyKnobRadialTrackMaterial
);
frequencyKnobRadialTrack.position.z = 0;
frequencyKnobRadialTrack.renderOrder = 1;
frequencyKnobRadialTrack.frustumCulled = false;
frequencyKnobRadialRoot.add(frequencyKnobRadialTrack);

let frequencyKnobRadialValueMesh = null;
const frequencyKnobRadialMarkerGeometry = new THREE.SphereGeometry(0.0020, 12, 12);
const frequencyKnobRadialMarkerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: false,
    depthTest: true,
    depthWrite: false,
});
const frequencyKnobRadialZeroMarker = new THREE.Mesh(
    frequencyKnobRadialMarkerGeometry,
    frequencyKnobRadialMarkerMaterial
);
frequencyKnobRadialZeroMarker.position.set(0, FREQUENCY_KNOB_RADIAL_MID, FREQUENCY_KNOB_RADIAL_LAYER_Z);
frequencyKnobRadialZeroMarker.frustumCulled = false;
frequencyKnobRadialZeroMarker.renderOrder = 3;
frequencyKnobRadialRoot.add(frequencyKnobRadialZeroMarker);

const frequencyKnobRadialMarker = new THREE.Mesh(
    frequencyKnobRadialMarkerGeometry,
    frequencyKnobRadialMarkerMaterial
);
frequencyKnobRadialMarker.frustumCulled = false;
frequencyKnobRadialMarker.renderOrder = 3;
frequencyKnobRadialRoot.add(frequencyKnobRadialMarker);

const frequencyKnobRadialConnector = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        depthTest: true,
        depthWrite: false,
    })
);
frequencyKnobRadialConnector.visible = false;
frequencyKnobRadialConnector.frustumCulled = false;
frequencyKnobRadialConnector.renderOrder = 1;
scene.add(frequencyKnobRadialConnector);

const frequencyKnobState = {
    isGrabbed: false,
    isReturning: false,
    grabbingHand: null,
    planeOrigin: new THREE.Vector3(),
    planeNormal: new THREE.Vector3(),
    planeRef: new THREE.Vector3(),
    planeTangent: new THREE.Vector3(),
    lastAngle: null,
};

const _freqKnobPinchPos = new THREE.Vector3();
const _freqKnobGrabWorldPos = new THREE.Vector3();
const _freqKnobAnchorWorldPos = new THREE.Vector3();
const _freqKnobLocalPinch = new THREE.Vector3();
const _freqKnobProjectedPinch = new THREE.Vector3();
const _freqKnobPlaneNormal = new THREE.Vector3();
const _freqKnobRootWorldQuat = new THREE.Quaternion();
const _freqKnobPlaneOffset = new THREE.Vector3();
const _freqKnobRadialMarkerWorldPos = new THREE.Vector3();
const _freqKnobRadialConnectorMidpoint = new THREE.Vector3();
const _freqKnobConnectorDir = new THREE.Vector3();
const _freqKnobConnectorLocalZ = new THREE.Vector3(0, 0, 1);

function getFrequencyKnobPinchPos(hand, target) {
    if (hand === 'left') {
        target.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
    } else {
        target.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);
    }
    return target;
}

function captureFrequencyKnobGrabPlane() {
    frequencyKnobRoot.updateWorldMatrix(true, false);
    frequencyKnobAnchor.getWorldPosition(frequencyKnobState.planeOrigin);
    frequencyKnobRoot.getWorldQuaternion(_freqKnobRootWorldQuat);
    frequencyKnobState.planeNormal.set(0, 0, 1).applyQuaternion(_freqKnobRootWorldQuat);
    frequencyKnobState.planeRef.set(1, 0, 0).applyQuaternion(_freqKnobRootWorldQuat);
    frequencyKnobState.planeTangent.set(0, 1, 0).applyQuaternion(_freqKnobRootWorldQuat);
}

/** Drop depth — project world pinch onto the knob's local XY plane (normal = +Z). */
function projectPinchOntoFrequencyKnobPlane(pinchWorldPos, target) {
    frequencyKnobRoot.updateWorldMatrix(true, false);
    frequencyKnobAnchor.getWorldPosition(_freqKnobAnchorWorldPos);
    _freqKnobPlaneNormal.set(0, 0, 1).applyQuaternion(
        frequencyKnobRoot.getWorldQuaternion(_freqKnobRootWorldQuat)
    );

    _freqKnobLocalPinch.copy(pinchWorldPos).sub(_freqKnobAnchorWorldPos);
    const depth = _freqKnobLocalPinch.dot(_freqKnobPlaneNormal);
    return target.copy(pinchWorldPos).addScaledVector(_freqKnobPlaneNormal, -depth);
}

/** Project onto the plane frozen at grab time so billboarding doesn't shift the angle. */
function projectPinchOntoGrabPlane(pinchWorldPos, target) {
    _freqKnobPlaneOffset.copy(pinchWorldPos).sub(frequencyKnobState.planeOrigin);
    const depth = _freqKnobPlaneOffset.dot(frequencyKnobState.planeNormal);
    return target.copy(pinchWorldPos).addScaledVector(frequencyKnobState.planeNormal, -depth);
}

function frequencyKnobAngleToHz(angleRad) {
    let angleCW = THREE.MathUtils.radToDeg(angleRad);
    angleCW = ((angleCW % 360) + 360) % 360;
    return (angleCW / 360) * FREQUENCY_MAX_HZ;
}

function frequencyKnobHzToAngleRad(hz) {
    const t = THREE.MathUtils.clamp(hz, 0, FREQUENCY_MAX_HZ) / FREQUENCY_MAX_HZ;
    return t * Math.PI * 2;
}

function updateFrequencyKnobRadialVisual(hz) {
    const angleRad = frequencyKnobHzToAngleRad(hz);

    if (frequencyKnobRadialValueMesh) {
        frequencyKnobRadialValueMesh.geometry.dispose();
        frequencyKnobRadialRoot.remove(frequencyKnobRadialValueMesh);
        frequencyKnobRadialValueMesh = null;
    }

    if (angleRad > 1e-4) {
        const segments = Math.max(8, Math.ceil(72 * angleRad / (Math.PI * 2)));
        const valueGeometry = new THREE.RingGeometry(
            FREQUENCY_KNOB_RADIAL_INNER,
            FREQUENCY_KNOB_RADIAL_OUTER,
            segments,
            1,
            Math.PI / 2,
            -angleRad
        );
        frequencyKnobRadialValueMesh = new THREE.Mesh(valueGeometry, frequencyKnobRadialValueMaterial);
        frequencyKnobRadialValueMesh.position.z = FREQUENCY_KNOB_RADIAL_LAYER_Z;
        frequencyKnobRadialValueMesh.renderOrder = 2;
        frequencyKnobRadialValueMesh.frustumCulled = false;
        frequencyKnobRadialRoot.add(frequencyKnobRadialValueMesh);
    }

    frequencyKnobRadialMarker.visible = angleRad > 1e-4;
    frequencyKnobRadialMarker.position.set(
        Math.sin(angleRad) * FREQUENCY_KNOB_RADIAL_MID,
        Math.cos(angleRad) * FREQUENCY_KNOB_RADIAL_MID,
        FREQUENCY_KNOB_RADIAL_LAYER_Z
    );
}

function showFrequencyKnobRadial() {
    gsap.killTweensOf(frequencyKnobRadialRoot.scale);
    updateFrequencyKnobRadialVisual(guiParams.frequencyHz);
    frequencyKnobRadialRoot.visible = true;
    gsap.to(frequencyKnobRadialRoot.scale, {
        x: FREQUENCY_KNOB_RADIAL_OPEN_SCALE,
        y: FREQUENCY_KNOB_RADIAL_OPEN_SCALE,
        z: FREQUENCY_KNOB_RADIAL_OPEN_SCALE,
        duration: FREQUENCY_KNOB_RADIAL_SCALE_DURATION,
        ease: 'power2.out',
    });
}

function hideFrequencyKnobRadial() {
    gsap.killTweensOf(frequencyKnobRadialRoot.scale);
    gsap.to(frequencyKnobRadialRoot.scale, {
        x: 0,
        y: 0,
        z: 0,
        duration: FREQUENCY_KNOB_RADIAL_SCALE_DURATION,
        ease: 'power2.in',
        onComplete: () => {
            frequencyKnobRadialRoot.visible = false;
        },
    });
}

/** Clock angle in frozen XY plane: 0° at 12 o'clock (+Y), increasing clockwise → 0–FREQUENCY_MAX_HZ. */
function getFrequencyKnobAngleFromGrabPlane(pinchWorldPos) {
    projectPinchOntoGrabPlane(pinchWorldPos, _freqKnobProjectedPinch);
    _freqKnobPlaneOffset.copy(_freqKnobProjectedPinch).sub(frequencyKnobState.planeOrigin);
    const x = _freqKnobPlaneOffset.dot(frequencyKnobState.planeRef);
    const y = _freqKnobPlaneOffset.dot(frequencyKnobState.planeTangent);
    const radius = Math.hypot(x, y);
    if (radius < FREQUENCY_KNOB_MIN_ANGLE_RADIUS) return null;
    return Math.atan2(x, y);
}

function applyFrequencyKnobAngle(angleRad) {
    frequencyKnobState.lastAngle = angleRad;
    const hz = frequencyKnobAngleToHz(angleRad);
    applyFrequencyKnobHz(hz);
    if (frequencyKnobState.isGrabbed) {
        updateFrequencyKnobRadialVisual(hz);
    }
}

function updateFrequencyKnobRadialConnector() {
    frequencyKnobRoot.updateWorldMatrix(true, true);
    frequencyKnobGrab.updateWorldMatrix(true, false);

    frequencyKnobRadialMarker.getWorldPosition(_freqKnobRadialMarkerWorldPos);
    frequencyKnobGrab.getWorldPosition(_freqKnobGrabWorldPos);

    const distance = _freqKnobRadialMarkerWorldPos.distanceTo(_freqKnobGrabWorldPos);
    if (distance < 1e-6) {
        frequencyKnobRadialConnector.visible = false;
        return;
    }

    _freqKnobRadialConnectorMidpoint
        .addVectors(_freqKnobRadialMarkerWorldPos, _freqKnobGrabWorldPos)
        .multiplyScalar(0.5);
    frequencyKnobRadialConnector.position.copy(_freqKnobRadialConnectorMidpoint);

    _freqKnobConnectorDir
        .subVectors(_freqKnobGrabWorldPos, _freqKnobRadialMarkerWorldPos)
        .normalize();
    frequencyKnobRadialConnector.quaternion.setFromUnitVectors(
        _freqKnobConnectorLocalZ,
        _freqKnobConnectorDir
    );

    const thickness = 0.002;
    frequencyKnobRadialConnector.scale.set(thickness, thickness, distance);
    frequencyKnobRadialConnector.visible = true;
}

function updateFrequencyKnobGrabPosition() {
    if (frequencyKnobState.isGrabbed || frequencyKnobState.isReturning) return;
    frequencyKnobGrab.position.set(0, 0, FREQUENCY_KNOB_GRAB_Z);
}

function onFrequencyKnobGrab(hand) {
    dismissFrequencyKnobHint();
    frequencyKnobState.isGrabbed = true;
    frequencyKnobState.grabbingHand = hand;
    captureFrequencyKnobGrabPlane();
    frequencyKnobState.lastAngle = null;

    getFrequencyKnobPinchPos(hand, _freqKnobPinchPos);

    gsap.killTweensOf(frequencyKnobGrab.position);
    gsap.killTweensOf(frequencyKnobGrab.scale);
    frequencyKnobRoot.remove(frequencyKnobGrab);
    scene.add(frequencyKnobGrab);
    frequencyKnobGrab.position.copy(_freqKnobPinchPos);
    frequencyKnobGrab.scale.setScalar(0.5);

    showFrequencyKnobRadial();
    frequencyKnobRadialConnector.visible = true;

    const angle = getFrequencyKnobAngleFromGrabPlane(_freqKnobPinchPos);
    if (angle !== null) {
        applyFrequencyKnobAngle(angle);
    }
}

function onFrequencyKnobDrag() {
    const hand = frequencyKnobState.grabbingHand;
    getFrequencyKnobPinchPos(hand, _freqKnobPinchPos);
    frequencyKnobGrab.position.copy(_freqKnobPinchPos);

    const angle = getFrequencyKnobAngleFromGrabPlane(_freqKnobPinchPos);
    if (angle !== null) {
        applyFrequencyKnobAngle(angle);
    } else if (frequencyKnobState.lastAngle !== null) {
        applyFrequencyKnobAngle(frequencyKnobState.lastAngle);
    }
}

function onFrequencyKnobRelease() {
    frequencyKnobState.isGrabbed = false;
    frequencyKnobState.grabbingHand = null;
    frequencyKnobState.lastAngle = null;

    hideFrequencyKnobRadial();
    frequencyKnobRadialConnector.visible = false;

    frequencyKnobGrab.getWorldPosition(_freqKnobGrabWorldPos);
    scene.remove(frequencyKnobGrab);
    frequencyKnobRoot.add(frequencyKnobGrab);
    frequencyKnobRoot.worldToLocal(_freqKnobGrabWorldPos);
    frequencyKnobGrab.position.copy(_freqKnobGrabWorldPos);

    gsap.killTweensOf(frequencyKnobGrab.position);
    gsap.killTweensOf(frequencyKnobGrab.scale);
    frequencyKnobState.isReturning = true;
    gsap.to(frequencyKnobGrab.position, {
        x: 0,
        y: 0,
        z: FREQUENCY_KNOB_GRAB_Z,
        duration: 0.1,
        ease: 'power2.out',
        onComplete: () => {
            frequencyKnobGrab.scale.setScalar(1);
            frequencyKnobState.isReturning = false;
        },
    });
}

function tryGrabFrequencyKnob(hand) {
    getFrequencyKnobPinchPos(hand, _freqKnobPinchPos);
    projectPinchOntoFrequencyKnobPlane(_freqKnobPinchPos, _freqKnobProjectedPinch);
    frequencyKnobGrab.getWorldPosition(_freqKnobGrabWorldPos);

    if (_freqKnobProjectedPinch.distanceTo(_freqKnobGrabWorldPos) > FREQUENCY_KNOB_GRAB_DISTANCE) return false;

    onFrequencyKnobGrab(hand);
    return true;
}

function checkFrequencyKnobInteraction() {
    if (!menuButtonState.xrReady) return;
    if (activeMenuSlider) return;

    const leftPinching = pinchState.left;
    const rightPinching = pinchState.right;

    if (frequencyKnobState.isGrabbed) {
        const stillPinching =
            (frequencyKnobState.grabbingHand === 'left' && leftPinching) ||
            (frequencyKnobState.grabbingHand === 'right' && rightPinching);

        if (!stillPinching) {
            onFrequencyKnobRelease();
        } else {
            onFrequencyKnobDrag();
        }
        return;
    }

    if (leftPinching && rightPinching) return;

    if (leftPinching && tryGrabFrequencyKnob('left')) return;
    if (rightPinching) tryGrabFrequencyKnob('right');
}

const menuSliderGeometries = {
    trackDot: new THREE.SphereGeometry(0.0045, 16, 16),
    grabDot: new THREE.SphereGeometry(INTERACTION_KNOB_RADIUS, 16, 16),
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

function createMenuSlider(config) {
    const trackWidth = config.trackWidth ?? MENU_SLIDER_TRACK_WIDTH;
    const trackHeight = config.trackHeight ?? MENU_SLIDER_TRACK_HEIGHT;
    const showValueText = config.showValueText !== false;
    const labelLeftX = config.labelLeftX ?? MENU_SLIDER_LABEL_TEXT_LEFT_X;
    const trackOffsetX = config.trackOffsetX ?? 0;

    const root = new THREE.Group();
    root.position.copy(config.position);
    root.frustumCulled = false;
    menuPanel.add(root);

    let valueText = null;
    let valueTextCanvas = null;
    let valueTextCtx = null;
    let valueTextTexture = null;

    if (showValueText) {
        valueTextCanvas = document.createElement('canvas');
        valueTextCanvas.width = Math.round(128 * MENU_SLIDER_TEXT_SCALE);
        valueTextCanvas.height = Math.round(64 * MENU_SLIDER_TEXT_SCALE);
        valueTextCtx = valueTextCanvas.getContext('2d');
        valueTextTexture = new THREE.CanvasTexture(valueTextCanvas);
        valueTextTexture.colorSpace = THREE.SRGBColorSpace;

        const valueTextMaterial = new THREE.MeshBasicMaterial({
            map: valueTextTexture,
            side: THREE.DoubleSide,
            transparent: true,
            depthTest: false
        });
        valueText = new THREE.Mesh(menuSliderGeometries.valueText, valueTextMaterial);
        valueText.position.set(trackOffsetX + MENU_SLIDER_VALUE_TEXT_X, 0, 0);
        valueText.frustumCulled = false;
        root.add(valueText);
    }

    const track = new THREE.Mesh(
        new THREE.PlaneGeometry(trackWidth, trackHeight),
        new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false })
    );
    track.position.set(trackOffsetX, 0, 0);
    track.frustumCulled = false;
    root.add(track);

    let labelText = null;
    if (config.label) {
        labelText = createMenuSliderLabelText(config.label, labelLeftX);
        root.add(labelText);
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
            root,
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
            trackHalfWidth: trackWidth * 0.5,
            initialGrabX: 0
        },
        onUpdate: config.onUpdate || null
    };
}

const MENU_SLIDER_TRACK_X = 0.023;

const MENU_SLIDER_VERTICAL_GAP = 0.036 + MENU_PANEL_W * (1 / 638);
const SLIDER_ONE_Y = 0.015 + MENU_PANEL_W * (2 / 638);
const SLIDER_ONE_POSITION = new THREE.Vector3(MENU_SLIDER_TRACK_X, SLIDER_ONE_Y, 0.001);
const SLIDER_TWO_Y = SLIDER_ONE_Y - MENU_SLIDER_VERTICAL_GAP;
const SLIDER_TWO_POSITION = new THREE.Vector3(MENU_SLIDER_TRACK_X, SLIDER_TWO_Y, 0.001);
const SLIDER_THREE_Y = SLIDER_TWO_Y - MENU_SLIDER_VERTICAL_GAP;
const SLIDER_THREE_POSITION = new THREE.Vector3(MENU_SLIDER_THREE_TRACK_X, SLIDER_THREE_Y, 0.001);
const SLIDER_FOUR_POSITION = new THREE.Vector3(MENU_SLIDER_FOUR_TRACK_X, SLIDER_THREE_Y, 0.001);

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
    if (!slider.text.value) return;
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

function getMenuSliderTrackWorldDir(slider) {
    slider.elements.track.getWorldPosition(_menuSliderTrackWorldPos);
    _menuSliderTrackWorldXEnd.set(1, 0, 0);
    slider.elements.track.localToWorld(_menuSliderTrackWorldXEnd);
    _menuSliderTrackWorldDir.copy(_menuSliderTrackWorldXEnd).sub(_menuSliderTrackWorldPos).normalize();
}

function tryGrabMenuSlider(slider, hand) {
    if (!slider || !slider.elements.track.visible || slider.interaction.enabled === false) return false;

    slider.elements.grabDot.getWorldPosition(_menuSliderGrabDotWorldPos);
    if (hand === 'left') {
        _menuSliderPinchWorldPos.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
    } else {
        _menuSliderPinchWorldPos.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);
    }

    if (_menuSliderPinchWorldPos.distanceTo(_menuSliderGrabDotWorldPos) < slider.interaction.grabDistance) {
        onMenuSliderGrab(slider, hand);
        return true;
    }
    return false;
}

function checkMenuSlidersGrab() {
    if (!menuButtonState.xrReady) return;
    if (!menuPanelOpen || !menuPanel.visible) return;

    const leftPinching = pinchState.left;
    const rightPinching = pinchState.right;

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

    for (const slider of menuSliders) {
        if (leftPinching && tryGrabMenuSlider(slider, 'left')) return;
        if (rightPinching && tryGrabMenuSlider(slider, 'right')) return;
    }
}

function onMenuSliderGrab(slider, hand) {
    activeMenuSlider = slider;
    slider.interaction.isGrabbed = true;
    slider.interaction.grabbingHand = hand;

    if (hand === 'left') {
        _menuSliderPinchWorldPos.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
    } else {
        _menuSliderPinchWorldPos.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);
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
        _menuSliderPinchWorldPos.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
    } else {
        _menuSliderPinchWorldPos.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);
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
    if (slider.onUpdate) {
        slider.onUpdate(getMenuSliderActualValue(slider));
    }
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

const sliderOne = createMenuSlider({
    position: SLIDER_ONE_POSITION,
    label: 'Mode X (m)',
    defaultValue: (guiParams.modeX - MODE_INDEX_MIN) / (MODE_INDEX_MAX - MODE_INDEX_MIN),
    minValue: MODE_INDEX_MIN,
    maxValue: MODE_INDEX_MAX,
    integerValues: true,
    onUpdate: (value) => {
        const n = Math.round(value);
        guiParams.modeX = n;
        setCustomResonanceMode(n, guiParams.modeY);
    }
});

updateMenuSliderTrackDotFromValue(sliderOne);
updateMenuSliderGrabDotPosition(sliderOne);
updateMenuSliderValueText(sliderOne);

const sliderTwo = createMenuSlider({
    position: SLIDER_TWO_POSITION,
    label: 'Mode Y (n)',
    defaultValue: (guiParams.modeY - MODE_INDEX_MIN) / (MODE_INDEX_MAX - MODE_INDEX_MIN),
    minValue: MODE_INDEX_MIN,
    maxValue: MODE_INDEX_MAX,
    integerValues: true,
    onUpdate: (value) => {
        const m = Math.round(value);
        guiParams.modeY = m;
        setCustomResonanceMode(guiParams.modeX, m);
    }
});

updateMenuSliderTrackDotFromValue(sliderTwo);
updateMenuSliderGrabDotPosition(sliderTwo);
updateMenuSliderValueText(sliderTwo);

const sliderThree = createMenuSlider({
    position: SLIDER_THREE_POSITION,
    trackWidth: MENU_SLIDER_THREE_TRACK_WIDTH,
    trackOffsetX: MENU_PANEL_W * (MENU_SLIDER_THREE_TRACK_LINE_OFFSET_PX / 638),
    labelLeftX: MENU_SLIDER_THREE_LABEL_TEXT_LEFT_X,
    showValueText: false,
    label: 'Mix X',
    defaultValue: (guiParams.plateWidth + 10) / 20,
    minValue: -10,
    maxValue: 10,
    valueDecimals: 2,
    onUpdate: (value) => {
        guiParams.plateWidth = value;
        chladni.a = value;
        contourUniforms.a.value = value;
        if (getMeshUniforms()) getMeshUniforms().a.value = value;
    }
});

updateMenuSliderTrackDotFromValue(sliderThree);
updateMenuSliderGrabDotPosition(sliderThree);

const sliderFour = createMenuSlider({
    position: SLIDER_FOUR_POSITION,
    trackWidth: MENU_SLIDER_THREE_TRACK_WIDTH,
    trackOffsetX: MENU_PANEL_W * (MENU_SLIDER_FOUR_TRACK_LINE_OFFSET_PX / 638),
    labelLeftX: MENU_SLIDER_FOUR_LABEL_TEXT_LEFT_X,
    showValueText: false,
    label: 'Mix Y',
    defaultValue: (guiParams.plateHeight + 10) / 20,
    minValue: -10,
    maxValue: 10,
    valueDecimals: 2,
    onUpdate: (value) => {
        guiParams.plateHeight = value;
        chladni.b = value;
        contourUniforms.b.value = value;
        if (getMeshUniforms()) getMeshUniforms().b.value = value;
    }
});

updateMenuSliderTrackDotFromValue(sliderFour);
updateMenuSliderGrabDotPosition(sliderFour);

const menuSliders = [sliderOne, sliderTwo, sliderThree, sliderFour];

function setMenuSliderFromActualValue(slider, actualValue) {
    const { min, max } = slider.value;
    slider.value.normalized = THREE.MathUtils.clamp((actualValue - min) / (max - min), 0, 1);
    updateMenuSliderTrackDotFromValue(slider);
    updateMenuSliderGrabDotPosition(slider);
    updateMenuSliderValueText(slider);
}

function syncModeMenuSlidersFromParams() {
    setMenuSliderFromActualValue(sliderOne, guiParams.modeX);
    setMenuSliderFromActualValue(sliderTwo, guiParams.modeY);
}

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
const _audioCheckboxWorldPos = new THREE.Vector3();
const _camWorldPos = new THREE.Vector3();
const _camContainerLocal = new THREE.Vector3();
const _containerWorldScale = new THREE.Vector3();
const _freqPlaneWorldPos = new THREE.Vector3();
const _freqFaceWorldQuat = new THREE.Quaternion();
const _freqParentWorldQuat = new THREE.Quaternion();

/** Cache XR/desktop camera world pos (+ container-local) once per frame for billboards. */
function cacheCameraWorldPos() {
    renderer.xr.getCamera().getWorldPosition(_camWorldPos);
    _camContainerLocal.copy(_camWorldPos);
    containerGroup.worldToLocal(_camContainerLocal);
}

function updateMenuPlaceholder() {
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

function updateHeaderPlaneBillboard() {
    headerPlanePivot.getWorldPosition(_freqPlaneWorldPos);
    const faceDx = _camWorldPos.x - _freqPlaneWorldPos.x;
    const faceDz = _camWorldPos.z - _freqPlaneWorldPos.z;
    const faceLenSq = faceDx * faceDx + faceDz * faceDz;
    const faceYaw = faceLenSq > 1e-8 ? Math.atan2(faceDx, faceDz) : 0;

    _freqFaceWorldQuat.setFromAxisAngle(_upVector, faceYaw);
    headerPlanePivot.parent.getWorldQuaternion(_freqParentWorldQuat);
    headerPlanePivot.quaternion.copy(_freqParentWorldQuat.invert().multiply(_freqFaceWorldQuat));

    containerGroup.getWorldScale(_containerWorldScale);
    headerPlanePivot.scale.set(
        _containerWorldScale.x > 1e-8 ? 1 / _containerWorldScale.x : 1,
        _containerWorldScale.y > 1e-8 ? 1 / _containerWorldScale.y : 1,
        _containerWorldScale.z > 1e-8 ? 1 / _containerWorldScale.z : 1
    );
}

function updateReferenceSecondaryOrbit() {
    const dx = _camContainerLocal.x - referenceAnchor.position.x;
    const dz = _camContainerLocal.z - referenceAnchor.position.z;
    const horizLenSq = dx * dx + dz * dz;
    const yaw = horizLenSq > 1e-8 ? Math.atan2(dx, dz) : 0;

    // Orbit placement in container-local space (position only — no inherited rotation).
    referenceSecondaryOrbitPivot.position.set(
        Math.sin(yaw) * REFERENCE_SECONDARY_ORBIT_RADIUS + Math.cos(yaw) * REFERENCE_SECONDARY_RIGHT_OFFSET,
        KNOB_UI_Y,
        Math.cos(yaw) * REFERENCE_SECONDARY_ORBIT_RADIUS - Math.sin(yaw) * REFERENCE_SECONDARY_RIGHT_OFFSET
    );
    referenceSecondaryOrbitPivot.rotation.set(0, 0, 0);

    // getWorldPosition() updates this pivot's parent chain after the local move above.
    frequencyPlanePivot.getWorldPosition(_freqPlaneWorldPos);
    const faceDx = _camWorldPos.x - _freqPlaneWorldPos.x;
    const faceDz = _camWorldPos.z - _freqPlaneWorldPos.z;
    const faceLenSq = faceDx * faceDx + faceDz * faceDz;
    const faceYaw = (faceLenSq > 1e-8 ? Math.atan2(faceDx, faceDz) : 0) + FREQ_PLACEHOLDER_YAW_OFFSET_RAD;

    _freqFaceWorldQuat.setFromAxisAngle(_upVector, faceYaw);
    frequencyPlanePivot.parent.getWorldQuaternion(_freqParentWorldQuat);
    frequencyPlanePivot.quaternion.copy(_freqParentWorldQuat.invert().multiply(_freqFaceWorldQuat));

    containerGroup.getWorldScale(_containerWorldScale);
    frequencyPlanePivot.scale.set(
        _containerWorldScale.x > 1e-8 ? 1 / _containerWorldScale.x : 1,
        _containerWorldScale.y > 1e-8 ? 1 / _containerWorldScale.y : 1,
        _containerWorldScale.z > 1e-8 ? 1 / _containerWorldScale.z : 1
    );
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

    if (pinchState.left || pinchState.right) return;
    if (!menuButton.visible) return;

    menuButton.getWorldPosition(_menuButtonWorldPos);

    if (lIndexObj.position.distanceTo(_menuButtonWorldPos) < menuButtonState.pressDistance) {
        onMenuButtonPressed();
        return;
    }
    if (rIndexObj.position.distanceTo(_menuButtonWorldPos) < menuButtonState.pressDistance) {
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

    if (lIndexObj.position.distanceTo(_menuPanelButtonWorldPos) < menuButtonState.pressDistance) {
        onPressed();
        return true;
    }
    if (rIndexObj.position.distanceTo(_menuPanelButtonWorldPos) < menuButtonState.pressDistance) {
        onPressed();
        return true;
    }
    return false;
}

function checkMenuPanelButtonsPress() {
    if (!menuButtonState.xrReady) return;
    if (menuButtonState.cooldown > 0) return;
    if (!menuPanelOpen || !menuPanel.visible) return;
    if (activeMenuSlider) return;
    if (pinchState.left || pinchState.right) return;

    if (checkMenuPanelButtonPress(menuViewToggleButtons.left, () => onMenuViewTogglePressed('left'))) return;
    if (checkMenuPanelButtonPress(menuViewToggleButtons.center, () => onMenuViewTogglePressed('center'))) return;
    if (checkMenuPanelButtonPress(menuViewToggleButtons.right, () => onMenuViewTogglePressed('right'))) return;

    checkMenuPanelButtonPress(menuCloseButton, onMenuCloseButtonPressed);
}

function onMenuCloseButtonPressed() {
    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(menuCloseButton);
    setTimeout(() => { hideMenuPanel(); }, 150);
}

function checkAudioCheckboxPress() {
    if (!menuButtonState.xrReady) return;
    if (menuButtonState.cooldown > 0) return;
    if (pinchState.left || pinchState.right) return;

    audioCheckbox.getWorldPosition(_audioCheckboxWorldPos);

    if (lIndexObj.position.distanceTo(_audioCheckboxWorldPos) < menuButtonState.pressDistance) {
        onAudioCheckboxPressed();
        return;
    }
    if (rIndexObj.position.distanceTo(_audioCheckboxWorldPos) < menuButtonState.pressDistance) {
        onAudioCheckboxPressed();
    }
}

function onAudioCheckboxPressed() {
    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(audioCheckbox);

    setPlateAudioEnabled(!plateAudioEnabled);

    if (plateAudioEnabled) {
        deps.initPlateAudio?.();
        if (deps.plateAudioState?.ctx && deps.plateAudioState.ctx.state === 'suspended') {
            deps.plateAudioState.ctx.resume();
        }
    }
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

    const api = {
        setPlateAudioEnabled,
        checkMenuButtonPress,
        checkAudioCheckboxPress,
        checkMenuPanelButtonsPress,
        checkMenuSlidersGrab,
        checkFrequencyKnobInteraction,
        updateFrequencyKnobGrabPosition,
        updateFrequencyKnobRadialConnector,
        cacheCameraWorldPos,
        updateMenuPlaceholder,
        updateHeaderPlaneBillboard,
        updateReferenceSecondaryOrbit,
        updateFrequencyPlaneText,
        syncMenuViewToggleToViewMode,
        syncModeMenuSlidersFromParams,
        updateMenuSliderGrabDotPosition,
        menuSliders,
        frequencyKnobState,
        showMenuPanel,
        hideMenuPanel,
        HEADER_UI_Y,
        KNOB_UI_Y,
        referenceAnchor,
        INTERACTION_KNOB_RADIUS
    };
    Object.assign(deps, api);
    // Live bindings — Object.assign would snapshot `let` values
    Object.defineProperty(deps, 'plateAudioEnabled', {
        get() { return plateAudioEnabled; },
        enumerable: true,
        configurable: true,
    });
    Object.defineProperty(deps, 'activeMenuSlider', {
        get() { return activeMenuSlider; },
        enumerable: true,
        configurable: true,
    });
    Object.defineProperty(deps, 'menuPanelOpen', {
        get() { return menuPanelOpen; },
        enumerable: true,
        configurable: true,
    });
    return api;
}
