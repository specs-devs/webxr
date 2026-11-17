import * as THREE from 'three';
import gsap from 'gsap';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { bindHeadRelativePlacementOnSessionStart } from './XRHeadPlacement.js';

export function createMenuUI(deps) {
    const {
        scene, camera, renderer,
        containerGroup, springConfig, springState,
        containerHalf, containerBottomLocalY, containerAnchorLocalY, CONTAINER_DEFAULT_YAW,
        DESKTOP_CONTAINER_POS, HEAD_OFFSET,
        helvetikerFont, helvetikerRegularFont,
        getPhaseOmega, getUndampedPhaseAmplitude,
        syncSpringLinearDamping, preserveOscillationAmplitudeOnOmegaChange, syncMassVisual,
        pinchState, lIndexObj, rIndexObj, lThumbObj, rThumbObj,
        twoHandedManip, leftPinchJumpGuard, rightPinchJumpGuard,
        pullHintState,
    } = deps;

    const _camWorldPos = new THREE.Vector3();
    const _camContainerLocal = new THREE.Vector3();
    const _containerWorldScale = new THREE.Vector3();

/** Menu placeholder: orbits on a horizontal ring to the user-facing side of the container. */
const MENU_ORBIT_OUTSET = 0.02;
const MENU_ORBIT_RADIUS = containerHalf + MENU_ORBIT_OUTSET;
/** Same vertical anchor as bottomPlaneVizGroup (ground reference frame). */
const MENU_LOCAL_Y = containerBottomLocalY;
const MENU_PLANE_SIZE = 0.04;
const MENU_TILT_UP_RAD = THREE.MathUtils.degToRad(20);
/** Hard-stop yaw window around container local +Z (front). */
const MENU_MAX_ORBIT_YAW_RAD = THREE.MathUtils.degToRad(70);
/** Orbit zero reference captured on first update (startup angle). */
let menuOrbitCenterYaw = null;

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
const MENU_PANEL_H = MENU_PANEL_W * (381 / 638);
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
const MENU_NAV_SIZE = MENU_CLOSE_SIZE * 0.8 * 0.9;
const MENU_NAV_GAP = 0.008;

const menuCloseButtonTexture = menuUiTextureLoader.load('./static/ui-button-close.png');
menuCloseButtonTexture.colorSpace = THREE.SRGBColorSpace;
const menuCloseButton = new THREE.Mesh(
    new THREE.PlaneGeometry(MENU_CLOSE_SIZE, MENU_CLOSE_SIZE),
    new THREE.MeshBasicMaterial({
        map: menuCloseButtonTexture,
        side: THREE.FrontSide,
        transparent: true,
        depthTest: false
    })
);
menuCloseButton.position.set(0.122, 0.063, 0.01);
menuCloseButton.frustumCulled = false;
menuPanel.add(menuCloseButton);

const menuPrevButtonTexture = menuUiTextureLoader.load('./static/ui-button-prev.png');
menuPrevButtonTexture.colorSpace = THREE.SRGBColorSpace;
const menuPrevButton = new THREE.Mesh(
    new THREE.PlaneGeometry(MENU_NAV_SIZE, MENU_NAV_SIZE),
    new THREE.MeshBasicMaterial({
        map: menuPrevButtonTexture,
        side: THREE.FrontSide,
        transparent: true,
        depthTest: false
    })
);
menuPrevButton.position.set(
    -0.076,
    menuCloseButton.position.y,
    menuCloseButton.position.z
);
menuPrevButton.frustumCulled = false;
menuPanel.add(menuPrevButton);

const menuNextButtonTexture = menuUiTextureLoader.load('./static/ui-button-next.png');
menuNextButtonTexture.colorSpace = THREE.SRGBColorSpace;
const menuNextButton = new THREE.Mesh(
    new THREE.PlaneGeometry(MENU_NAV_SIZE, MENU_NAV_SIZE),
    new THREE.MeshBasicMaterial({
        map: menuNextButtonTexture,
        side: THREE.FrontSide,
        transparent: true,
        depthTest: false
    })
);
menuNextButton.position.set(
    0.082,
    menuCloseButton.position.y,
    menuCloseButton.position.z
);
menuNextButton.frustumCulled = false;
menuPanel.add(menuNextButton);

const MENU_PANEL_TITLE_SIZE = 0.0045 * 1.75;
/** Extra gap between bold title and suffix (bbox ignores glyph overhang). */
const MENU_PANEL_TITLE_PART_GAP = MENU_PANEL_TITLE_SIZE * 0.5;
/** Nudge title up (cap alignment sits low vs button row). */
const MENU_PANEL_TITLE_Y_OFFSET = MENU_PANEL_TITLE_SIZE * 0.4;
const menuPanelTitleMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });

/** Preset labels: bold before dot, regular from dot; ζ / k / m applied when selected (not Custom). */
const MENU_PANEL_CUSTOM_INDEX = 5;
const MENU_PANEL_PRESETS = [
    { bold: 'Ideal Oscillator', regular: '· ζ = 0', dampingRatio: 0, springStiffness: 32, mass: 1 },
    { bold: 'Light Damping', regular: '· low ζ', dampingRatio: 0.03, springStiffness: 32, mass: 1 },
    { bold: 'Heavy Damping', regular: '· high ζ', dampingRatio: 0.24, springStiffness: 32, mass: 1 },
    { bold: 'Stiff Spring', regular: '· high k', dampingRatio: 0, springStiffness: 80, mass: 1 },
    { bold: 'Heavy Mass', regular: '· high m', dampingRatio: 0, springStiffness: 32, mass: 3 },
    { bold: 'Custom', regular: '' }
];

const menuPanelStepperState = {
    slotIndex: 0,
    slotCount: MENU_PANEL_PRESETS.length
};

function measureMenuPanelTitleBBox(text, font) {
    const geom = new TextGeometry(text, {
        font,
        size: MENU_PANEL_TITLE_SIZE,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false
    });
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    geom.dispose();
    return bb;
}

let menuPanelTitleCapY = -Infinity;
MENU_PANEL_PRESETS.forEach(({ bold, regular }) => {
    const boldBb = measureMenuPanelTitleBBox(bold, helvetikerFont);
    menuPanelTitleCapY = Math.max(menuPanelTitleCapY, boldBb.max.y);
    if (regular) {
        const regularBb = measureMenuPanelTitleBBox(regular, helvetikerRegularFont);
        menuPanelTitleCapY = Math.max(menuPanelTitleCapY, regularBb.max.y);
    }
});
/** Shared cap line (tops); descenders hang below without shifting the line. Group y = 0. */
const MENU_PANEL_TITLE_CAP_Y = menuPanelTitleCapY;
const MENU_PANEL_TITLE_ROW_Y = -MENU_PANEL_TITLE_CAP_Y;

function buildMenuPanelTitlePartGeometry(text, font) {
    const geom = new TextGeometry(text, {
        font,
        size: MENU_PANEL_TITLE_SIZE,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false
    });
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    geom.translate(-bb.min.x, MENU_PANEL_TITLE_CAP_Y - bb.max.y, 0);
    return { geom, width: bb.max.x - bb.min.x };
}

function applyMenuPanelTitlePart(mesh, text, font) {
    mesh.geometry.dispose();
    const part = buildMenuPanelTitlePartGeometry(text, font);
    mesh.geometry = part.geom;
    return part;
}

function layoutMenuPanelTitle(boldPart, regularPart, hasRegularSuffix) {
    const gap = hasRegularSuffix ? MENU_PANEL_TITLE_PART_GAP : 0;
    const totalWidth = boldPart.width + gap + (hasRegularSuffix ? regularPart.width : 0);
    menuPanelTitleBoldMesh.position.set(-totalWidth * 0.5, MENU_PANEL_TITLE_ROW_Y, 0);
    menuPanelTitleRegularMesh.visible = hasRegularSuffix;
    if (hasRegularSuffix) {
        menuPanelTitleRegularMesh.position.set(
            -totalWidth * 0.5 + boldPart.width + gap,
            MENU_PANEL_TITLE_ROW_Y,
            0
        );
    }
}

function setMenuPanelTitleSlot(index, options = {}) {
    const { applyValues = false } = options;
    const n = menuPanelStepperState.slotCount;
    menuPanelStepperState.slotIndex = ((index % n) + n) % n;
    const preset = MENU_PANEL_PRESETS[menuPanelStepperState.slotIndex];
    const boldPart = applyMenuPanelTitlePart(menuPanelTitleBoldMesh, preset.bold, helvetikerFont);
    const hasRegularSuffix = preset.regular.length > 0;
    const regularPart = hasRegularSuffix
        ? applyMenuPanelTitlePart(menuPanelTitleRegularMesh, preset.regular, helvetikerRegularFont)
        : { width: 0 };
    layoutMenuPanelTitle(boldPart, regularPart, hasRegularSuffix);

    if (applyValues && menuPanelStepperState.slotIndex !== MENU_PANEL_CUSTOM_INDEX) {
        applyMenuPanelPresetValues(preset);
    }
}

function stepMenuPanelTitle(delta) {
    setMenuPanelTitleSlot(menuPanelStepperState.slotIndex + delta, { applyValues: true });
}

function selectCustomMenuPreset() {
    if (menuPanelStepperState.slotIndex === MENU_PANEL_CUSTOM_INDEX) return;
    setMenuPanelTitleSlot(MENU_PANEL_CUSTOM_INDEX);
}

const menuPanelTitle = new THREE.Group();
const menuPanelTitleBoldMesh = new THREE.Mesh(new THREE.BufferGeometry(), menuPanelTitleMat);
const menuPanelTitleRegularMesh = new THREE.Mesh(new THREE.BufferGeometry(), menuPanelTitleMat);
menuPanelTitleBoldMesh.frustumCulled = false;
menuPanelTitleRegularMesh.frustumCulled = false;
menuPanelTitle.add(menuPanelTitleBoldMesh);
menuPanelTitle.add(menuPanelTitleRegularMesh);
menuPanelTitle.position.set(
    (menuPrevButton.position.x + menuNextButton.position.x) * 0.5,
    menuCloseButton.position.y + MENU_PANEL_TITLE_Y_OFFSET,
    0.001
);
menuPanelTitle.frustumCulled = false;
menuPanel.add(menuPanelTitle);
setMenuPanelTitleSlot(0);

// --- Menu panel XR slider (see slider-ref) ---
const MENU_SLIDER_TRACK_W = 0.166;
const MENU_SLIDER_TRACK_H = 0.0025;
const MENU_SLIDER_ZETA_MIN = 0;
const MENU_SLIDER_ZETA_MAX = 0.3;
const MENU_SLIDER_K_MIN = 4;
const MENU_SLIDER_K_MAX = 80;
const MENU_SLIDER_M_MIN = 0.4;
const MENU_SLIDER_M_MAX = 4.0;
const MENU_SLIDER_M_STEP = 0.05;
const MENU_SLIDER_ONE_POS = new THREE.Vector3(0.019, 0.018, 0);
/** Vertical gap (local Y) between consecutive sliders. */
const MENU_SLIDER_ROW_GAP = -0.038;

const MENU_SLIDER_GRAB_RADIUS = 0.008;

const menuSliderSharedGeometries = {
    track: new THREE.PlaneGeometry(MENU_SLIDER_TRACK_W, MENU_SLIDER_TRACK_H),
    trackDot: new THREE.SphereGeometry(0.0045, 16, 16),
    grabDot: new THREE.SphereGeometry(MENU_SLIDER_GRAB_RADIUS, 16, 16),
    connector: new THREE.BoxGeometry(1, 1, 1),
    valueText: new THREE.PlaneGeometry(0.05, 0.025)
};

/** Match knob-reference.js: depthTest on + renderOrder ladder (knob 300 above connector 220). */
const MENU_SLIDER_RENDER_ORDER = {
    track: 200,
    trackDot: 210,
    connector: 220,
    valueText: 230,
    grabDot: 300
};

const _menuSliderGrabDotWorldPos = new THREE.Vector3();
const _menuSliderTrackWorldPos = new THREE.Vector3();
const _menuSliderTrackWorldDir = new THREE.Vector3();
const _menuSliderPinchWorldPos = new THREE.Vector3();
const _menuSliderConnectorTrackDotPos = new THREE.Vector3();
const _menuSliderConnectorGrabDotPos = new THREE.Vector3();
const _menuSliderConnectorMidpoint = new THREE.Vector3();
const _menuSliderConnectorEnd = new THREE.Vector3();
const _menuSliderConnectorDir = new THREE.Vector3();
const _menuSliderTrackWorldX = new THREE.Vector3();

let activeMenuSliderKey = null;

function createMenuSlider(config) {
    const textCanvas = document.createElement('canvas');
    textCanvas.width = 128;
    textCanvas.height = 64;
    const textCtx = textCanvas.getContext('2d');
    const textTexture = new THREE.CanvasTexture(textCanvas);
    textTexture.colorSpace = THREE.SRGBColorSpace;

    const valueTextMaterial = new THREE.MeshBasicMaterial({
        map: textTexture,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false
    });
    const valueText = new THREE.Mesh(menuSliderSharedGeometries.valueText, valueTextMaterial);
    valueText.position.set(0.105, 0, 0);
    valueText.renderOrder = MENU_SLIDER_RENDER_ORDER.valueText;
    valueText.frustumCulled = false;

    const trackMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.9,
        depthTest: true,
        depthWrite: true
    });
    const track = new THREE.Mesh(menuSliderSharedGeometries.track, trackMaterial);
    track.position.copy(config.position);
    track.position.z = 0.001;
    track.renderOrder = MENU_SLIDER_RENDER_ORDER.track;
    track.frustumCulled = false;
    menuPanel.add(track);
    track.add(valueText);

    const trackDotMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        depthTest: true,
        depthWrite: true
    });
    const trackDot = new THREE.Mesh(menuSliderSharedGeometries.trackDot, trackDotMaterial);
    trackDot.position.set(0, 0, 0.001);
    trackDot.renderOrder = MENU_SLIDER_RENDER_ORDER.trackDot;
    trackDot.frustumCulled = false;
    track.add(trackDot);

    const grabDotMaterial = new THREE.MeshBasicMaterial({
        color: 0xffff00,
        depthTest: true,
        depthWrite: true
    });
    const grabDot = new THREE.Mesh(menuSliderSharedGeometries.grabDot, grabDotMaterial);
    grabDot.position.set(0, 0, 0);
    grabDot.renderOrder = MENU_SLIDER_RENDER_ORDER.grabDot;
    grabDot.frustumCulled = false;
    track.add(grabDot);

    const connectorMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
        depthTest: true,
        depthWrite: true
    });
    const connector = new THREE.Mesh(menuSliderSharedGeometries.connector, connectorMaterial);
    connector.renderOrder = MENU_SLIDER_RENDER_ORDER.connector;
    connector.visible = false;
    connector.frustumCulled = false;
    scene.add(connector);

    return {
        state: {
            isGrabbed: false,
            grabbingHand: null,
            value: config.defaultValue,
            minValue: config.minValue,
            maxValue: config.maxValue,
            grabDistance: 0.04,
            trackHalfWidth: MENU_SLIDER_TRACK_W * 0.5,
            initialGrabX: 0
        },
        track,
        trackDot,
        grabDot,
        connector,
        valueText,
        textCanvas,
        textCtx,
        textTexture,
        onUpdate: config.onUpdate || null,
        valueDecimals: config.valueDecimals ?? 2
    };
}

function menuSliderNormalized(actual, minValue, maxValue) {
    const span = maxValue - minValue;
    if (span <= 0) return 0;
    return THREE.MathUtils.clamp((actual - minValue) / span, 0, 1);
}

const menuSliders = {
    SliderOne: createMenuSlider({
        position: MENU_SLIDER_ONE_POS.clone(),
        defaultValue: menuSliderNormalized(
            springConfig.dampingRatio,
            MENU_SLIDER_ZETA_MIN,
            MENU_SLIDER_ZETA_MAX
        ),
        minValue: MENU_SLIDER_ZETA_MIN,
        maxValue: MENU_SLIDER_ZETA_MAX,
        valueDecimals: 2,
        onUpdate: (actualValue) => {
            springConfig.dampingRatio = actualValue;
            syncSpringLinearDamping();
        }
    }),
    SliderTwo: createMenuSlider({
        position: new THREE.Vector3(
            MENU_SLIDER_ONE_POS.x,
            MENU_SLIDER_ONE_POS.y + MENU_SLIDER_ROW_GAP,
            MENU_SLIDER_ONE_POS.z
        ),
        defaultValue: menuSliderNormalized(
            springConfig.springStiffness,
            MENU_SLIDER_K_MIN,
            MENU_SLIDER_K_MAX
        ),
        minValue: MENU_SLIDER_K_MIN,
        maxValue: MENU_SLIDER_K_MAX,
        valueDecimals: 0,
        onUpdate: (actualValue) => {
            const prevOmega = getPhaseOmega();
            springConfig.springStiffness = Math.round(actualValue);
            syncSpringLinearDamping();
            preserveOscillationAmplitudeOnOmegaChange(prevOmega);
        }
    }),
    SliderThree: createMenuSlider({
        position: new THREE.Vector3(
            MENU_SLIDER_ONE_POS.x,
            MENU_SLIDER_ONE_POS.y + MENU_SLIDER_ROW_GAP * 2,
            MENU_SLIDER_ONE_POS.z
        ),
        defaultValue: menuSliderNormalized(
            springConfig.mass,
            MENU_SLIDER_M_MIN,
            MENU_SLIDER_M_MAX
        ),
        minValue: MENU_SLIDER_M_MIN,
        maxValue: MENU_SLIDER_M_MAX,
        valueDecimals: 2,
        onUpdate: (actualValue) => {
            const prevOmega = getPhaseOmega();
            springConfig.mass =
                Math.round(actualValue / MENU_SLIDER_M_STEP) * MENU_SLIDER_M_STEP;
            syncSpringLinearDamping();
            syncMassVisual();
            preserveOscillationAmplitudeOnOmegaChange(prevOmega);
        }
    })
};

function setMenuSliderNormalizedValue(sliderKey, normalized) {
    const slider = menuSliders[sliderKey];
    slider.state.value = THREE.MathUtils.clamp(normalized, 0, 1);
    updateMenuSliderTrackDotFromValue(sliderKey);
    updateMenuSliderGrabDotPosition(sliderKey);
    updateMenuSliderText(sliderKey);
}

function setMenuSliderActualValue(sliderKey, actual) {
    const slider = menuSliders[sliderKey];
    setMenuSliderNormalizedValue(
        sliderKey,
        menuSliderNormalized(actual, slider.state.minValue, slider.state.maxValue)
    );
}

function applyMenuPanelPresetValues(preset) {
    setMenuSliderActualValue('SliderOne', preset.dampingRatio);
    applyMenuSliderValue('SliderOne');
    setMenuSliderActualValue('SliderTwo', preset.springStiffness);
    applyMenuSliderValue('SliderTwo');
    setMenuSliderActualValue('SliderThree', preset.mass);
    applyMenuSliderValue('SliderThree');
}

function updateMenuSliderValueText(sliderKey, value) {
    const slider = menuSliders[sliderKey];
    slider.textCtx.clearRect(0, 0, slider.textCanvas.width, slider.textCanvas.height);
    slider.textCtx.fillStyle = '#ffffff';
    slider.textCtx.font = 'bold 34px Helvetica';
    slider.textCtx.textAlign = 'center';
    slider.textCtx.textBaseline = 'middle';
    slider.textCtx.fillText(String(value), slider.textCanvas.width / 2, slider.textCanvas.height / 2);
    slider.textTexture.needsUpdate = true;
}

function getMenuSliderActualValue(sliderKey) {
    const state = menuSliders[sliderKey].state;
    return state.minValue + state.value * (state.maxValue - state.minValue);
}

function updateMenuSliderText(sliderKey) {
    const slider = menuSliders[sliderKey];
    const actual = getMenuSliderActualValue(sliderKey);
    updateMenuSliderValueText(sliderKey, actual.toFixed(slider.valueDecimals));
}

function updateMenuSliderTrackDotFromValue(sliderKey) {
    const slider = menuSliders[sliderKey];
    const trackX = (slider.state.value - 0.5) * 2 * slider.state.trackHalfWidth;
    slider.trackDot.position.x = trackX;
}

function updateMenuSliderGrabDotPosition(sliderKey) {
    const slider = menuSliders[sliderKey];
    if (slider.state.isGrabbed) return;
    slider.grabDot.position.x = slider.trackDot.position.x;
}

function updateAllMenuSliderGrabDots() {
    for (const key in menuSliders) {
        updateMenuSliderGrabDotPosition(key);
    }
}

function applyMenuSliderValue(sliderKey) {
    const slider = menuSliders[sliderKey];
    if (slider.onUpdate) slider.onUpdate(getMenuSliderActualValue(sliderKey));
}

function menuSliderPanelActive() {
    return menuPanelOpen && menuPanel.visible;
}

function updateMenuSliderConnector(sliderKey) {
    const slider = menuSliders[sliderKey];

    slider.trackDot.getWorldPosition(_menuSliderConnectorTrackDotPos);
    slider.grabDot.getWorldPosition(_menuSliderConnectorGrabDotPos);

    _menuSliderConnectorDir.subVectors(
        _menuSliderConnectorGrabDotPos,
        _menuSliderConnectorTrackDotPos
    );
    const fullDistance = _menuSliderConnectorDir.length();
    if (fullDistance < 1e-6) {
        slider.connector.visible = false;
        return;
    }
    slider.connector.visible = true;

    _menuSliderConnectorDir.multiplyScalar(1 / fullDistance);
    const grabRadius = MENU_SLIDER_GRAB_RADIUS * slider.grabDot.scale.x;
    _menuSliderConnectorEnd
        .copy(_menuSliderConnectorGrabDotPos)
        .addScaledVector(_menuSliderConnectorDir, -grabRadius);

    const distance = _menuSliderConnectorTrackDotPos.distanceTo(_menuSliderConnectorEnd);
    if (distance < 1e-6) {
        slider.connector.visible = false;
        return;
    }

    _menuSliderConnectorMidpoint
        .addVectors(_menuSliderConnectorTrackDotPos, _menuSliderConnectorEnd)
        .multiplyScalar(0.5);
    slider.connector.position.copy(_menuSliderConnectorMidpoint);

    const thickness = 0.002;
    slider.connector.scale.set(thickness, thickness, distance);
    slider.connector.lookAt(_menuSliderConnectorEnd);
}

function onMenuSliderGrab(sliderKey, hand) {
    const slider = menuSliders[sliderKey];
    activeMenuSliderKey = sliderKey;
    slider.state.isGrabbed = true;
    slider.state.grabbingHand = hand;

    if (hand === 'left') {
        _menuSliderPinchWorldPos
            .addVectors(lThumbObj.position, lIndexObj.position)
            .multiplyScalar(0.5);
    } else {
        _menuSliderPinchWorldPos
            .addVectors(rThumbObj.position, rIndexObj.position)
            .multiplyScalar(0.5);
    }

    slider.track.getWorldPosition(_menuSliderTrackWorldPos);
    _menuSliderTrackWorldDir.set(1, 0, 0);
    _menuSliderTrackWorldX.copy(_menuSliderTrackWorldDir).add(slider.track.position);
    slider.track.localToWorld(_menuSliderTrackWorldX);
    _menuSliderTrackWorldDir.copy(_menuSliderTrackWorldX).sub(_menuSliderTrackWorldPos).normalize();

    const toPinch = _menuSliderPinchWorldPos.clone().sub(_menuSliderTrackWorldPos);
    slider.state.initialGrabX = toPinch.dot(_menuSliderTrackWorldDir);

    slider.grabDot.getWorldPosition(_menuSliderGrabDotWorldPos);
    slider.track.remove(slider.grabDot);
    scene.add(slider.grabDot);
    slider.grabDot.position.copy(_menuSliderGrabDotWorldPos);
    slider.grabDot.renderOrder = MENU_SLIDER_RENDER_ORDER.grabDot;
    slider.grabDot.scale.setScalar(1.2);

    updateMenuSliderConnector(sliderKey);
}

function onMenuSliderDrag(sliderKey) {
    const slider = menuSliders[sliderKey];

    if (slider.state.grabbingHand === 'left') {
        _menuSliderPinchWorldPos
            .addVectors(lThumbObj.position, lIndexObj.position)
            .multiplyScalar(0.5);
    } else {
        _menuSliderPinchWorldPos
            .addVectors(rThumbObj.position, rIndexObj.position)
            .multiplyScalar(0.5);
    }

    slider.grabDot.position.copy(_menuSliderPinchWorldPos);

    slider.track.getWorldPosition(_menuSliderTrackWorldPos);
    _menuSliderTrackWorldDir.set(1, 0, 0);
    _menuSliderTrackWorldX.copy(_menuSliderTrackWorldDir).add(slider.track.position);
    slider.track.localToWorld(_menuSliderTrackWorldX);
    _menuSliderTrackWorldDir.copy(_menuSliderTrackWorldX).sub(_menuSliderTrackWorldPos).normalize();

    const toPinch = _menuSliderPinchWorldPos.clone().sub(_menuSliderTrackWorldPos);
    const currentProjectedX = toPinch.dot(_menuSliderTrackWorldDir);

    const deltaX = currentProjectedX - slider.state.initialGrabX;
    const currentTrackX = (slider.state.value - 0.5) * 2 * slider.state.trackHalfWidth;
    let newTrackX = currentTrackX + deltaX;
    newTrackX = Math.max(-slider.state.trackHalfWidth, Math.min(slider.state.trackHalfWidth, newTrackX));

    slider.state.value = (newTrackX / slider.state.trackHalfWidth + 1) * 0.5;
    slider.state.initialGrabX = currentProjectedX;

    selectCustomMenuPreset();

    updateMenuSliderTrackDotFromValue(sliderKey);
    updateMenuSliderText(sliderKey);
    applyMenuSliderValue(sliderKey);
    updateMenuSliderConnector(sliderKey);
}

function onMenuSliderRelease(sliderKey) {
    const slider = menuSliders[sliderKey];
    slider.state.isGrabbed = false;
    slider.state.grabbingHand = null;
    activeMenuSliderKey = null;

    slider.connector.visible = false;
    slider.grabDot.scale.setScalar(1);

    slider.grabDot.getWorldPosition(_menuSliderGrabDotWorldPos);
    scene.remove(slider.grabDot);
    slider.track.add(slider.grabDot);

    slider.track.worldToLocal(_menuSliderGrabDotWorldPos);
    slider.grabDot.position.copy(_menuSliderGrabDotWorldPos);
    slider.grabDot.renderOrder = MENU_SLIDER_RENDER_ORDER.grabDot;

    gsap.killTweensOf(slider.grabDot.position);
    gsap.to(slider.grabDot.position, {
        x: slider.trackDot.position.x,
        y: slider.trackDot.position.y,
        z: 0,
        duration: 0.1,
        ease: 'power2.out'
    });
}

function releaseActiveMenuSlider() {
    if (!activeMenuSliderKey) return;
    const key = activeMenuSliderKey;
    const slider = menuSliders[key];
    gsap.killTweensOf(slider.grabDot.position);
    if (slider.state.isGrabbed) {
        onMenuSliderRelease(key);
    }
}

/** Min distance from grab knob to pinch midpoint or either fingertip (more forgiving than midpoint alone). */
function menuSliderPinchProximity(hand, grabWorldPos) {
    const thumb = hand === 'left' ? lThumbObj.position : rThumbObj.position;
    const index = hand === 'left' ? lIndexObj.position : rIndexObj.position;
    _menuSliderPinchWorldPos.addVectors(thumb, index).multiplyScalar(0.5);
    return Math.min(
        _menuSliderPinchWorldPos.distanceTo(grabWorldPos),
        thumb.distanceTo(grabWorldPos),
        index.distanceTo(grabWorldPos)
    );
}

function checkMenuSliderGrab() {
    if (!menuButtonState.xrReady) return;
    if (!menuSliderPanelActive()) return;

    const leftPinching = pinchState.left;
    const rightPinching = pinchState.right;

    if (activeMenuSliderKey) {
        const slider = menuSliders[activeMenuSliderKey];
        const stillPinching =
            (slider.state.grabbingHand === 'left' && leftPinching) ||
            (slider.state.grabbingHand === 'right' && rightPinching);

        if (!stillPinching) {
            onMenuSliderRelease(activeMenuSliderKey);
        } else {
            onMenuSliderDrag(activeMenuSliderKey);
        }
        return;
    }

    let bestKey = null;
    let bestHand = null;
    let bestDist = Infinity;

    for (const sliderKey in menuSliders) {
        const slider = menuSliders[sliderKey];
        slider.grabDot.getWorldPosition(_menuSliderGrabDotWorldPos);
        const reach = slider.state.grabDistance;

        if (leftPinching) {
            const d = menuSliderPinchProximity('left', _menuSliderGrabDotWorldPos);
            if (d < reach && d < bestDist) {
                bestDist = d;
                bestKey = sliderKey;
                bestHand = 'left';
            }
        }

        if (rightPinching) {
            const d = menuSliderPinchProximity('right', _menuSliderGrabDotWorldPos);
            if (d < reach && d < bestDist) {
                bestDist = d;
                bestKey = sliderKey;
                bestHand = 'right';
            }
        }
    }

    if (bestKey) onMenuSliderGrab(bestKey, bestHand);
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
        setHeaderUiVisible(true);
    }, menuButtonState.xrStartupDelay * 1000);
});
renderer.xr.addEventListener('sessionend', () => {
    menuButtonState.xrReady = false;
    setHeaderUiVisible(false);
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
const _menuCloseButtonWorldPos = new THREE.Vector3();
const _headerToggleWorldPos = new THREE.Vector3();


/**
 * Header: Object3D refs (like menu); top anchor fixed, orbit group on ring opposite menu.
 */
const HEADER_TOP_OUTSET = 0.28;
const HEADER_ORBIT_OUTSET = 0.12;
const HEADER_ORBIT_RADIUS = containerHalf + HEADER_ORBIT_OUTSET;
const HEADER_LOCAL_Y = containerAnchorLocalY() + HEADER_TOP_OUTSET;
const HEADER_ORBIT_Z_OFFSET = -0.05;
const HEADER_PLANE_HEIGHT = 0.23;
const HEADER_PLANE_ASPECT = 528 / 194;
const HEADER_PLANE_Z_OFFSET = 0.001;
/** Header orbit yaw clamp (rad) around startup angle — independent of menu. */
const HEADER_MIN_ORBIT_YAW_RAD = THREE.MathUtils.degToRad(-45);
const HEADER_MAX_ORBIT_YAW_RAD = THREE.MathUtils.degToRad(45);
/** When false, header stays at startup position (opposite user). */
const HEADER_ORBIT_ENABLED = false;
let headerOrbitCenterYaw = null;

const headerTopAnchor = new THREE.Object3D();
headerTopAnchor.position.set(0, HEADER_LOCAL_Y, 0);
containerGroup.add(headerTopAnchor);

const headerAnchorRef = new THREE.Object3D();
headerTopAnchor.add(headerAnchorRef);

const headerOrbitGroup = new THREE.Group();
containerGroup.add(headerOrbitGroup);

const headerPlanePivot = new THREE.Object3D();
headerPlanePivot.position.set(0, 0, HEADER_ORBIT_Z_OFFSET);
headerOrbitGroup.add(headerPlanePivot);

const headerPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(HEADER_PLANE_HEIGHT * HEADER_PLANE_ASPECT, HEADER_PLANE_HEIGHT),
    new THREE.MeshBasicMaterial({
        side: THREE.FrontSide,
        transparent: true,
        depthWrite: false
    })
);
headerPlane.position.z = HEADER_PLANE_Z_OFFSET;
headerPlane.frustumCulled = false;
headerPlane.renderOrder = 3;
headerPlane.visible = false;
headerPlanePivot.add(headerPlane);

/** Live readouts on the header plane (3 rows × 2 columns): labels Regular, values/title Bold. */
const HEADER_PLANE_W = HEADER_PLANE_HEIGHT * HEADER_PLANE_ASPECT;
const HEADER_STATS_TEXT_SIZE = 0.0195;
/** Description copy only (toggle “description” mode); tweak this, not HEADER_STATS_TEXT_SIZE. */
const HEADER_STATS_DESC_TEXT_SIZE = HEADER_STATS_TEXT_SIZE * 1.2;
const HEADER_STATS_TITLE_SIZE = 0.032 * 1.1;
const HEADER_STATS_TITLE_TEXT = 'Simple Harmonic Motion';
const HEADER_STATS_VALUE_FONT = helvetikerFont;
const HEADER_STATS_LABEL_FONT = helvetikerRegularFont;
const HEADER_STATS_Z = HEADER_PLANE_Z_OFFSET + 0.003;
/** Row baselines (m). Middle row is centered so line 1↔2 and 2↔3 gaps stay equal. */
const HEADER_STATS_ROW_TOP_Y = 0.04;
const HEADER_STATS_ROW_BOTTOM_Y = -0.028;
/** Title above the stats block; baseline sits above the top stats row. */
const HEADER_STATS_TITLE_GAP_ABOVE_STATS = 0.056;
const HEADER_STATS_TITLE_Y =
    HEADER_STATS_ROW_TOP_Y + HEADER_STATS_TEXT_SIZE + HEADER_STATS_TITLE_GAP_ABOVE_STATS;
const HEADER_STATS_ROW_Y = [
    HEADER_STATS_ROW_TOP_Y,
    (HEADER_STATS_ROW_TOP_Y + HEADER_STATS_ROW_BOTTOM_Y) * 0.5,
    HEADER_STATS_ROW_BOTTOM_Y
];
/** Insets (m): outer edges, center gutter between columns, min gap name↔value. */
const HEADER_STATS_EDGE_PAD = 0.012;
const HEADER_STATS_CENTER_GAP = 0.14;
const HEADER_STATS_NAME_VALUE_GAP = 0.024;
/** Gap between the numeric value and its unit (m). */
const HEADER_STATS_UNIT_GAP = 0.005;
/** Cap height of a bold digit — shared y reference so numbers and units share the same baseline. */
const HEADER_STATS_DIGIT_CAP_Y = (() => {
    const g = new TextGeometry('0', {
        font: HEADER_STATS_VALUE_FONT,
        size: HEADER_STATS_TEXT_SIZE,
        height: 0,
        curveSegments: 4,
        bevelEnabled: false
    });
    g.computeBoundingBox();
    const cy = g.boundingBox.max.y;
    g.dispose();
    return cy;
})();

function measureHeaderStatsTextWidth(text, font = HEADER_STATS_VALUE_FONT) {
    const geom = new TextGeometry(text, {
        font,
        size: HEADER_STATS_TEXT_SIZE,
        height: 0,
        curveSegments: 6,
        bevelEnabled: false
    });
    geom.computeBoundingBox();
    const w = geom.boundingBox.max.x - geom.boundingBox.min.x;
    geom.dispose();
    return w;
}

function buildHeaderStatsColumnAnchors(col, labelTexts, valueSamples) {
    const halfW = HEADER_PLANE_W * 0.5;
    const halfGap = HEADER_STATS_CENTER_GAP * 0.5;
    const colLeft = col === 0 ? -halfW + HEADER_STATS_EDGE_PAD : halfGap;
    const colRight = col === 0 ? -halfGap : halfW - HEADER_STATS_EDGE_PAD;
    const maxLabelW = Math.max(
        ...labelTexts.map((t) => measureHeaderStatsTextWidth(t, HEADER_STATS_LABEL_FONT))
    );
    const maxValueW = Math.max(...valueSamples.map((t) => measureHeaderStatsTextWidth(t)));
    const labelX = colLeft;
    const minValueX = colLeft + maxLabelW + HEADER_STATS_NAME_VALUE_GAP + maxValueW;
    const valueX = Math.max(colRight, minValueX);
    if (valueX > colRight + 1e-6) {
        console.warn(
            `Header stats column ${col} needs more width (min value x ${minValueX.toFixed(3)} > col right ${colRight.toFixed(3)}).`
        );
    }
    return { labelX, valueX };
}

const HEADER_STATS_COL_BOUNDS = [
    buildHeaderStatsColumnAnchors(
        0,
        ['Displacement', 'Amplitude', 'Acceleration'],
        ['0.000 m', '0.000 m', '0.00 m/s2']
    ),
    buildHeaderStatsColumnAnchors(
        1,
        ['Period', 'Velocity', 'Total Energy'],
        ['0.00 s', '0.00 m/s', '0.00 J']
    )
];
const headerStatsMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false });
const headerStatsGroup = new THREE.Group();
headerPlanePivot.add(headerStatsGroup);
const headerStatsValuesGroup = new THREE.Group();
const headerStatsDescriptionGroup = new THREE.Group();
headerStatsGroup.add(headerStatsValuesGroup);
headerStatsGroup.add(headerStatsDescriptionGroup);

let headerStatsContentMode = 'values';
/**
 * The stat readout is a human-readable numeric display, not a physics-critical
 * visual — refreshing it at ~12 Hz instead of full frame rate (up to ~90 Hz in
 * headset) is imperceptible but avoids disposing/recreating 6 TextGeometry
 * meshes (CPU tessellation + GPU buffer re-upload) on every single frame.
 */
const HEADER_STATS_UPDATE_INTERVAL = 1 / 12;
let headerStatsUpdateAccum = HEADER_STATS_UPDATE_INTERVAL;

/** Toggle: 'values' | 'description'. */
function setHeaderStatsContentMode(mode) {
    headerStatsContentMode = mode;
    const showValues = mode === 'values';
    headerStatsValuesGroup.visible = showValues;
    headerStatsDescriptionGroup.visible = !showValues;
    if (headerToggleCheckboxIn) {
        headerToggleCheckboxIn.visible = showValues;
    }
    // Force the next updateHeaderStats() call to refresh immediately instead of
    // waiting out whatever's left of the throttle interval from before the switch.
    headerStatsUpdateAccum = HEADER_STATS_UPDATE_INTERVAL;
}

function setHeaderUiVisible(visible) {
    headerToggleCheckbox.visible = visible;
    headerToggleLabel.visible = visible;
}

/** Header checkbox: off = live stats, on = description copy (ui-checkbox / ui-checkbox-in). */
const HEADER_TOGGLE_UI_SCALE = 1.2;
const HEADER_TOGGLE_CHECKBOX_SIZE = 0.028 * HEADER_TOGGLE_UI_SCALE;
const HEADER_TOGGLE_CHECKBOX_X = -0.285;
const HEADER_TOGGLE_CHECKBOX_Y = -0.1;
const HEADER_TOGGLE_CHECKBOX_Z = HEADER_PLANE_Z_OFFSET + 0.004;

const headerToggleCheckboxTexture = menuUiTextureLoader.load('./static/ui-checkbox.png');
headerToggleCheckboxTexture.colorSpace = THREE.SRGBColorSpace;
const headerToggleCheckbox = new THREE.Mesh(
    new THREE.PlaneGeometry(HEADER_TOGGLE_CHECKBOX_SIZE, HEADER_TOGGLE_CHECKBOX_SIZE),
    new THREE.MeshBasicMaterial({
        map: headerToggleCheckboxTexture,
        transparent: true,
        side: THREE.FrontSide,
        depthTest: false
    })
);
headerToggleCheckbox.position.set(
    HEADER_TOGGLE_CHECKBOX_X,
    HEADER_TOGGLE_CHECKBOX_Y,
    HEADER_TOGGLE_CHECKBOX_Z
);
headerToggleCheckbox.frustumCulled = false;
headerToggleCheckbox.renderOrder = 5;
headerPlanePivot.add(headerToggleCheckbox);

const headerToggleCheckboxInSize = HEADER_TOGGLE_CHECKBOX_SIZE * 0.5;
const headerToggleCheckboxInTexture = menuUiTextureLoader.load('./static/ui-checkbox-in.png');
headerToggleCheckboxInTexture.colorSpace = THREE.SRGBColorSpace;
const headerToggleCheckboxIn = new THREE.Mesh(
    new THREE.PlaneGeometry(headerToggleCheckboxInSize, headerToggleCheckboxInSize),
    new THREE.MeshBasicMaterial({
        map: headerToggleCheckboxInTexture,
        transparent: true,
        side: THREE.FrontSide,
        depthTest: false
    })
);
headerToggleCheckboxIn.position.set(0, 0, 0.001);
headerToggleCheckboxIn.visible = false;
headerToggleCheckboxIn.frustumCulled = false;
headerToggleCheckboxIn.renderOrder = 6;
headerToggleCheckbox.add(headerToggleCheckboxIn);

const headerToggleLabelCanvas = document.createElement('canvas');
headerToggleLabelCanvas.width = 256;
headerToggleLabelCanvas.height = 64;
const headerToggleLabelCtx = headerToggleLabelCanvas.getContext('2d');
headerToggleLabelCtx.fillStyle = '#ffffff';
headerToggleLabelCtx.font = `bold ${Math.round(48 * HEADER_TOGGLE_UI_SCALE)}px Helvetica, Arial, sans-serif`;
headerToggleLabelCtx.textAlign = 'center';
headerToggleLabelCtx.textBaseline = 'middle';
headerToggleLabelCtx.fillText(
    'STATS',
    headerToggleLabelCanvas.width / 2,
    headerToggleLabelCanvas.height / 2
);
const headerToggleLabelTexture = new THREE.CanvasTexture(headerToggleLabelCanvas);
headerToggleLabelTexture.colorSpace = THREE.SRGBColorSpace;
const HEADER_TOGGLE_LABEL_WIDTH = 0.09 * HEADER_TOGGLE_UI_SCALE;
const HEADER_TOGGLE_LABEL_HEIGHT = 0.022 * HEADER_TOGGLE_UI_SCALE;
const HEADER_TOGGLE_LABEL_GAP = -0.005;
const headerToggleLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(HEADER_TOGGLE_LABEL_WIDTH, HEADER_TOGGLE_LABEL_HEIGHT),
    new THREE.MeshBasicMaterial({
        map: headerToggleLabelTexture,
        transparent: true,
        side: THREE.DoubleSide,
        depthTest: false
    })
);
headerToggleLabel.position.set(
    HEADER_TOGGLE_CHECKBOX_X +
        HEADER_TOGGLE_CHECKBOX_SIZE * 0.5 +
        HEADER_TOGGLE_LABEL_GAP +
        HEADER_TOGGLE_LABEL_WIDTH * 0.5,
    HEADER_TOGGLE_CHECKBOX_Y,
    HEADER_TOGGLE_CHECKBOX_Z + 0.001
);
headerToggleLabel.frustumCulled = false;
headerToggleLabel.renderOrder = 5;
headerPlanePivot.add(headerToggleLabel);

const headerStatsTitleGeom = new TextGeometry(HEADER_STATS_TITLE_TEXT, {
    font: HEADER_STATS_VALUE_FONT,
    size: HEADER_STATS_TITLE_SIZE,
    height: 0,
    curveSegments: 8,
    bevelEnabled: false
});
headerStatsTitleGeom.computeBoundingBox();
headerStatsTitleGeom.translate(
    -headerStatsTitleGeom.boundingBox.min.x,
    -headerStatsTitleGeom.boundingBox.max.y,
    0
);
const headerStatsTitle = new THREE.Mesh(headerStatsTitleGeom, headerStatsMat);
headerStatsTitle.position.set(
    -HEADER_PLANE_W * 0.5 + HEADER_STATS_EDGE_PAD,
    HEADER_STATS_TITLE_Y,
    HEADER_STATS_Z
);
headerStatsTitle.frustumCulled = false;
headerStatsTitle.renderOrder = 4;
headerStatsGroup.add(headerStatsTitle);

function makeHeaderStatsTextGeometry(text, align, font = HEADER_STATS_VALUE_FONT, yRef = null) {
    const geom = new TextGeometry(text, {
        font,
        size: HEADER_STATS_TEXT_SIZE,
        height: 0,
        curveSegments: 6,
        bevelEnabled: false
    });
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    const xAnchor = align === 'right' ? -bb.max.x : -bb.min.x;
    geom.translate(xAnchor, -(yRef ?? bb.max.y), 0);
    return geom;
}

const HEADER_STATS_DESC_X = -HEADER_PLANE_W * 0.5 + HEADER_STATS_EDGE_PAD;
const HEADER_STATS_DESC_LINES = [
    'Simple harmonic motion with real-time',
    'sine-wave and phase circle projections.'
];
/** Nudge description block down (negative = lower on header plane). */
const HEADER_STATS_DESC_Y_OFFSET = -0.012;
const HEADER_STATS_DESC_LINE_Y = [
    HEADER_STATS_ROW_TOP_Y + HEADER_STATS_DESC_Y_OFFSET,
    (HEADER_STATS_ROW_TOP_Y + HEADER_STATS_ROW_BOTTOM_Y) * 0.5 + HEADER_STATS_DESC_Y_OFFSET
];

function makeHeaderStatsDescriptionGeometry(text) {
    const geom = new TextGeometry(text, {
        font: helvetikerRegularFont,
        size: HEADER_STATS_DESC_TEXT_SIZE,
        height: 0,
        curveSegments: 6,
        bevelEnabled: false
    });
    geom.computeBoundingBox();
    geom.translate(-geom.boundingBox.min.x, -geom.boundingBox.max.y, 0);
    return geom;
}

for (let i = 0; i < HEADER_STATS_DESC_LINES.length; i++) {
    const descMesh = new THREE.Mesh(
        makeHeaderStatsDescriptionGeometry(HEADER_STATS_DESC_LINES[i]),
        headerStatsMat
    );
    descMesh.position.set(HEADER_STATS_DESC_X, HEADER_STATS_DESC_LINE_Y[i], HEADER_STATS_Z);
    descMesh.frustumCulled = false;
    descMesh.renderOrder = 4;
    headerStatsDescriptionGroup.add(descMesh);
}

function createHeaderStatCell(col, row, labelText, initialValue) {
    const y = HEADER_STATS_ROW_Y[row];
    const { labelX: xLabel, valueX: xValue } = HEADER_STATS_COL_BOUNDS[col];

    const labelMesh = new THREE.Mesh(
        makeHeaderStatsTextGeometry(labelText, 'left', HEADER_STATS_LABEL_FONT),
        headerStatsMat
    );
    labelMesh.position.set(xLabel, y, HEADER_STATS_Z);
    labelMesh.frustumCulled = false;
    labelMesh.renderOrder = 4;
    headerStatsValuesGroup.add(labelMesh);

    function splitValue(text) {
        const si = text.lastIndexOf(' ');
        return si >= 0
            ? { num: text.slice(0, si), unit: text.slice(si + 1) }
            : { num: text, unit: '' };
    }

    const { num: initNum, unit: initUnit } = splitValue(initialValue);

    const unitMesh = new THREE.Mesh(
        makeHeaderStatsTextGeometry(initUnit, 'right', HEADER_STATS_LABEL_FONT, HEADER_STATS_DIGIT_CAP_Y),
        headerStatsMat
    );
    unitMesh.position.set(xValue, y, HEADER_STATS_Z);
    unitMesh.frustumCulled = false;
    unitMesh.renderOrder = 4;
    headerStatsValuesGroup.add(unitMesh);

    const initUnitW = measureHeaderStatsTextWidth(initUnit, HEADER_STATS_LABEL_FONT);
    const numberMesh = new THREE.Mesh(
        makeHeaderStatsTextGeometry(initNum, 'right'),
        headerStatsMat
    );
    numberMesh.position.set(xValue - initUnitW - HEADER_STATS_UNIT_GAP, y, HEADER_STATS_Z);
    numberMesh.frustumCulled = false;
    numberMesh.renderOrder = 4;
    headerStatsValuesGroup.add(numberMesh);

    let lastValue = initialValue;
    return {
        setValue(text) {
            if (text === lastValue) return;
            lastValue = text;
            const { num, unit } = splitValue(text);
            unitMesh.geometry.dispose();
            unitMesh.geometry = makeHeaderStatsTextGeometry(unit, 'right', HEADER_STATS_LABEL_FONT, HEADER_STATS_DIGIT_CAP_Y);
            const unitW = measureHeaderStatsTextWidth(unit, HEADER_STATS_LABEL_FONT);
            numberMesh.geometry.dispose();
            numberMesh.geometry = makeHeaderStatsTextGeometry(num, 'right');
            numberMesh.position.x = xValue - unitW - HEADER_STATS_UNIT_GAP;
        }
    };
}

const headerStatDisplacement = createHeaderStatCell(0, 0, 'Displacement', '0.000 m');
const headerStatPeriod = createHeaderStatCell(1, 0, 'Period', '0.00 s');
const headerStatAmplitude = createHeaderStatCell(0, 1, 'Amplitude', '0.000 m');
const headerStatVelocity = createHeaderStatCell(1, 1, 'Velocity', '0.00 m/s');
const headerStatAcceleration = createHeaderStatCell(0, 2, 'Acceleration', '0.00 m/s2');
const headerStatEnergy = createHeaderStatCell(1, 2, 'Total Energy', '0.00 J');

setHeaderStatsContentMode('description');

function updateHeaderRef() {
    const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
    activeCamera.getWorldPosition(_camWorldPos);
    _camContainerLocal.copy(_camWorldPos);
    containerGroup.worldToLocal(_camContainerLocal);

    const dx = _camContainerLocal.x;
    const dz = _camContainerLocal.z;
    const horizLenSq = dx * dx + dz * dz;
    const yawRaw = horizLenSq > 1e-8 ? Math.atan2(dx, dz) : 0;
    if (headerOrbitCenterYaw === null) {
        headerOrbitCenterYaw = yawRaw;
    }

    let yawTowardUser;
    if (HEADER_ORBIT_ENABLED) {
        let yawDelta = yawRaw - headerOrbitCenterYaw;
        yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta));
        const yawDeltaClamped = THREE.MathUtils.clamp(
            yawDelta,
            HEADER_MIN_ORBIT_YAW_RAD,
            HEADER_MAX_ORBIT_YAW_RAD
        );
        yawTowardUser = headerOrbitCenterYaw + yawDeltaClamped;
    } else {
        yawTowardUser = headerOrbitCenterYaw;
    }
    const yawAway = yawTowardUser + Math.PI;

    headerOrbitGroup.position.set(
        Math.sin(yawAway) * HEADER_ORBIT_RADIUS,
        HEADER_LOCAL_Y,
        Math.cos(yawAway) * HEADER_ORBIT_RADIUS
    );
    // Far side of ring, but plane faces the user (same yaw as menu — not yawAway).
    headerOrbitGroup.rotation.set(0, yawTowardUser, 0);
}

function updateHeaderStats(delta) {
    if (headerStatsContentMode !== 'values') return;

    headerStatsUpdateAccum += delta;
    if (headerStatsUpdateAccum < HEADER_STATS_UPDATE_INTERVAL) return;
    headerStatsUpdateAccum = 0;

    const u = springState.displacement;
    const v = springState.velocity;
    const { mass: m, springStiffness: k, linearDamping: c } = springConfig;
    const a = -(k / m) * u - (c / m) * v;
    const omega = getPhaseOmega();
    const period = omega > 1e-9 ? (2 * Math.PI) / omega : 0;
    const amplitude = getUndampedPhaseAmplitude(u, v, omega);
    const energy = 0.5 * m * v * v + 0.5 * k * u * u;

    headerStatDisplacement.setValue(`${u.toFixed(3)} m`);
    headerStatPeriod.setValue(`${period.toFixed(2)} s`);
    headerStatAmplitude.setValue(`${amplitude.toFixed(3)} m`);
    headerStatVelocity.setValue(`${v.toFixed(2)} m/s`);
    headerStatAcceleration.setValue(`${a.toFixed(2)} m/s2`);
    headerStatEnergy.setValue(`${energy.toFixed(2)} J`);
}

function updateMenuPlaceholder() {
    camera.getWorldPosition(_camWorldPos);
    _camContainerLocal.copy(_camWorldPos);
    containerGroup.worldToLocal(_camContainerLocal);

    const dx = _camContainerLocal.x;
    const dz = _camContainerLocal.z;
    const horizLenSq = dx * dx + dz * dz;
    const yawRaw = horizLenSq > 1e-8 ? Math.atan2(dx, dz) : 0;
    if (menuOrbitCenterYaw === null) {
        menuOrbitCenterYaw = yawRaw;
    }

    // Clamp around startup angle so left/right travel is symmetric from initial position.
    let yawDelta = yawRaw - menuOrbitCenterYaw;
    yawDelta = Math.atan2(Math.sin(yawDelta), Math.cos(yawDelta)); // wrap to [-pi, pi]
    const yawDeltaClamped = THREE.MathUtils.clamp(
        yawDelta,
        -MENU_MAX_ORBIT_YAW_RAD,
        MENU_MAX_ORBIT_YAW_RAD
    );
    const yaw = menuOrbitCenterYaw + yawDeltaClamped;

    menuPlaceholderGroup.position.set(
        Math.sin(yaw) * MENU_ORBIT_RADIUS,
        MENU_LOCAL_Y,
        Math.cos(yaw) * MENU_ORBIT_RADIUS
    );
    menuPlaceholderGroup.rotation.set(0, yaw, 0);

    // Keep constant world size while parent container scales.
    containerGroup.getWorldScale(_containerWorldScale);
    menuPlaceholderGroup.scale.set(
        _containerWorldScale.x > 1e-8 ? 1 / _containerWorldScale.x : 1,
        _containerWorldScale.y > 1e-8 ? 1 / _containerWorldScale.y : 1,
        _containerWorldScale.z > 1e-8 ? 1 / _containerWorldScale.z : 1
    );
}

function animateMenuButtonPress(buttonMesh) {
    gsap.killTweensOf(buttonMesh.position);
    gsap.killTweensOf(buttonMesh.scale);

    const originalZ = buttonMesh.position.z;
    const pressDepth = -0.02;
    const scaleUp = 1.3;
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

function checkHeaderTogglePress() {
    if (!headerToggleCheckbox.visible) return;
    if (!menuButtonState.xrReady) return;
    if (menuButtonState.cooldown > 0) return;

    if (pinchState.left || pinchState.right) return;

    headerToggleCheckbox.getWorldPosition(_headerToggleWorldPos);

    if (lIndexObj.position.distanceTo(_headerToggleWorldPos) < menuButtonState.pressDistance) {
        onHeaderTogglePressed();
        return;
    }
    if (rIndexObj.position.distanceTo(_headerToggleWorldPos) < menuButtonState.pressDistance) {
        onHeaderTogglePressed();
    }
}

function onHeaderTogglePressed() {
    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(headerToggleCheckbox);

    const nextMode = headerStatsContentMode === 'values' ? 'description' : 'values';
    setHeaderStatsContentMode(nextMode);
}

function checkMenuCloseButtonPress() {
    if (!menuButtonState.xrReady) return;
    if (menuButtonState.cooldown > 0) return;
    if (!menuPanelOpen || !menuPanel.visible) return;
    if (pinchState.left || pinchState.right) return;

    menuCloseButton.getWorldPosition(_menuCloseButtonWorldPos);

    if (lIndexObj.position.distanceTo(_menuCloseButtonWorldPos) < menuButtonState.pressDistance) {
        onMenuCloseButtonPressed();
        return;
    }
    if (rIndexObj.position.distanceTo(_menuCloseButtonWorldPos) < menuButtonState.pressDistance) {
        onMenuCloseButtonPressed();
    }
}

function onMenuCloseButtonPressed() {
    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(menuCloseButton);
    setTimeout(() => { hideMenuPanel(); }, 150);
}

function checkMenuPrevButtonPress() {
    if (!menuButtonState.xrReady) return;
    if (menuButtonState.cooldown > 0) return;
    if (!menuPanelOpen || !menuPanel.visible) return;
    if (pinchState.left || pinchState.right) return;

    menuPrevButton.getWorldPosition(_menuCloseButtonWorldPos);

    if (lIndexObj.position.distanceTo(_menuCloseButtonWorldPos) < menuButtonState.pressDistance) {
        onMenuPrevButtonPressed();
        return;
    }
    if (rIndexObj.position.distanceTo(_menuCloseButtonWorldPos) < menuButtonState.pressDistance) {
        onMenuPrevButtonPressed();
    }
}

function onMenuPrevButtonPressed() {
    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(menuPrevButton);
    stepMenuPanelTitle(-1);
}

function checkMenuNextButtonPress() {
    if (!menuButtonState.xrReady) return;
    if (menuButtonState.cooldown > 0) return;
    if (!menuPanelOpen || !menuPanel.visible) return;
    if (pinchState.left || pinchState.right) return;

    menuNextButton.getWorldPosition(_menuCloseButtonWorldPos);

    if (lIndexObj.position.distanceTo(_menuCloseButtonWorldPos) < menuButtonState.pressDistance) {
        onMenuNextButtonPressed();
        return;
    }
    if (rIndexObj.position.distanceTo(_menuCloseButtonWorldPos) < menuButtonState.pressDistance) {
        onMenuNextButtonPressed();
    }
}

function onMenuNextButtonPressed() {
    menuButtonState.cooldown = menuButtonState.cooldownDuration;
    animateMenuButtonPress(menuNextButton);
    stepMenuPanelTitle(1);
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

    for (const key in menuSliders) {
        updateMenuSliderTrackDotFromValue(key);
        updateMenuSliderGrabDotPosition(key);
        updateMenuSliderText(key);
        applyMenuSliderValue(key);
    }

    const xrHeadPlacement = bindHeadRelativePlacementOnSessionStart({
        renderer,
        camera,
        placements: [{
            object: containerGroup,
            offset: HEAD_OFFSET,
            options: { yawOnly: true, matchYaw: true },
        }],
        onPlaced: () => {
            containerGroup.rotateY(CONTAINER_DEFAULT_YAW);
            twoHandedManip.isActive = false;
            leftPinchJumpGuard.reset();
            rightPinchJumpGuard.reset();
            menuOrbitCenterYaw = null;
            headerOrbitCenterYaw = null;
            pullHintState.needsReset = true;
        },
        onSessionEnd: () => {
            containerGroup.position.copy(DESKTOP_CONTAINER_POS);
            containerGroup.rotation.set(0, CONTAINER_DEFAULT_YAW, 0);
            containerGroup.scale.setScalar(springConfig.compositionScale);
            twoHandedManip.isActive = false;
            leftPinchJumpGuard.reset();
            rightPinchJumpGuard.reset();
            menuOrbitCenterYaw = null;
            headerOrbitCenterYaw = null;
            pullHintState.needsReset = true;
        },
    });

    const api = {
        menuPanelOpen, activeMenuSliderKey, menuSliders, menuButtonState,
        menuUiAnimConfig, menuOrbitCenterYaw, headerOrbitCenterYaw,
        headerStatsContentMode, headerStatsUpdateAccum,
        updateMenuPlaceholder, animateMenuButtonPress, checkMenuButtonPress,
        onMenuButtonPressed, checkHeaderTogglePress, onHeaderTogglePressed,
        checkMenuCloseButtonPress, onMenuCloseButtonPressed, checkMenuPrevButtonPress,
        onMenuPrevButtonPressed, checkMenuNextButtonPress, onMenuNextButtonPressed,
        showMenuPanel, hideMenuPanel, checkMenuSliderGrab, onMenuSliderGrab,
        onMenuSliderDrag, onMenuSliderRelease, releaseActiveMenuSlider,
        updateAllMenuSliderGrabDots, updateHeaderRef, updateHeaderStats,
        setHeaderStatsContentMode, setHeaderUiVisible, applyMenuPanelPresetValues,
        setMenuPanelTitleSlot, stepMenuPanelTitle, selectCustomMenuPreset,
        xrHeadPlacement, headerPlane, headerToggleCheckbox,
    };
    Object.assign(deps, api);
    return api;
}
