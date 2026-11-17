import * as THREE from 'three';
import { Text } from 'troika-three-text';
import gsap from 'gsap';
import { SURFACES } from './Surfaces.js';

export function createMenuUI(deps) {
    const {
        scene, camera, renderer, containerGroup, halfContainerSize,
        guiState, updateParams, cycleSurface, isAnyPlaneHandleBeingDriven,
        lIndexObj, rIndexObj, lPinchSphere, rPinchSphere,
        lThumbObj, rThumbObj, pinchState,
        slicePlaneManager, surfaceManager, syncSlicePlanes,
        INITIAL_SURFACE,
    } = deps;
const UI_PANEL_TILT_X = -22.5 * Math.PI / 180;

const UI_ORBIT_OUTSET = 0.14;
const UI_ORBIT_RADIUS = halfContainerSize + UI_ORBIT_OUTSET;
const UI_LOCAL_Y = -halfContainerSize - 0.08;

const UIRoot = new THREE.Object3D();
containerGroup.add(UIRoot);

const UIButtonPivot = new THREE.Object3D();
UIButtonPivot.rotation.x = UI_PANEL_TILT_X;
UIButtonPivot.position.z = -0.001;
UIRoot.add(UIButtonPivot);

const uiTextureLoader = new THREE.TextureLoader();
const uiMenuButtonTexture = uiTextureLoader.load('static/ui-button-menu.png');
uiMenuButtonTexture.colorSpace = THREE.SRGBColorSpace;
const uiPanelTexture = uiTextureLoader.load('static/ui-panel.png');
uiPanelTexture.colorSpace = THREE.SRGBColorSpace;
const uiCloseButtonTexture = uiTextureLoader.load('static/ui-button-close.png');
uiCloseButtonTexture.colorSpace = THREE.SRGBColorSpace;
const uiPrevButtonTexture = uiTextureLoader.load('static/ui-button-prev.png');
uiPrevButtonTexture.colorSpace = THREE.SRGBColorSpace;
const uiNextButtonTexture = uiTextureLoader.load('static/ui-button-next.png');
uiNextButtonTexture.colorSpace = THREE.SRGBColorSpace;
const UI_PANEL_WIDTH = 0.26 * 1.12;
const UI_PANEL_ASPECT = 508 / 272;
const UI_PANEL_HEIGHT = UI_PANEL_WIDTH / UI_PANEL_ASPECT;

const UIButton = new THREE.Mesh(
    new THREE.PlaneGeometry(0.04, 0.04),
    new THREE.MeshBasicMaterial({
        map: uiMenuButtonTexture,
        transparent: true,
        opacity: 0.95,
        side: THREE.FrontSide
    })
);
UIButton.frustumCulled = false;
UIButtonPivot.add(UIButton);

const UIPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(UI_PANEL_WIDTH, UI_PANEL_HEIGHT),
    new THREE.MeshBasicMaterial({
        map: uiPanelTexture,
        transparent: true,
        opacity: 0.9,
        side: THREE.FrontSide,
        depthTest: true,
        depthWrite: false
    })
);
UIPlane.rotation.x = UI_PANEL_TILT_X;
UIPlane.scale.set(0, 0, 0);
UIPlane.visible = false;
UIPlane.frustumCulled = false;
UIRoot.add(UIPlane);

const UICloseButton = new THREE.Mesh(
    new THREE.PlaneGeometry(0.03, 0.03),
    new THREE.MeshBasicMaterial({
        map: uiCloseButtonTexture,
        transparent: true,
        opacity: 0.98,
        side: THREE.FrontSide,
        depthTest: false
    })
);
UICloseButton.position.set(0.117, 0.048, 0.01);
UICloseButton.frustumCulled = false;
UIPlane.add(UICloseButton);

const UIPrevButton = new THREE.Mesh(
    new THREE.PlaneGeometry(0.023, 0.023),
    new THREE.MeshBasicMaterial({
        map: uiPrevButtonTexture,
        transparent: true,
        opacity: 0.98,
        side: THREE.FrontSide,
        depthTest: false
    })
);
UIPrevButton.position.set(-0.114, 0.048, 0.01);
UIPrevButton.frustumCulled = false;
UIPlane.add(UIPrevButton);

const UINextButton = new THREE.Mesh(
    new THREE.PlaneGeometry(0.023, 0.023),
    new THREE.MeshBasicMaterial({
        map: uiNextButtonTexture,
        transparent: true,
        opacity: 0.98,
        side: THREE.FrontSide,
        depthTest: false
    })
);
UINextButton.position.set(0.076, 0.048, 0.01);
UINextButton.frustumCulled = false;
UIPlane.add(UINextButton);

const uiSurfaceTitleCanvas = document.createElement('canvas');
uiSurfaceTitleCanvas.width = 1024;
uiSurfaceTitleCanvas.height = 256;
const uiSurfaceTitleCtx = uiSurfaceTitleCanvas.getContext('2d');
const uiSurfaceTitleTexture = new THREE.CanvasTexture(uiSurfaceTitleCanvas);
uiSurfaceTitleTexture.colorSpace = THREE.SRGBColorSpace;
uiSurfaceTitleTexture.needsUpdate = true;
const UI_SURFACE_TITLE_WORLD_HEIGHT = 0.037268;
const UI_SURFACE_TITLE_ASPECT = uiSurfaceTitleCanvas.width / uiSurfaceTitleCanvas.height;
const uiSurfaceTitleLabel = new THREE.Mesh(
    new THREE.PlaneGeometry(UI_SURFACE_TITLE_WORLD_HEIGHT * UI_SURFACE_TITLE_ASPECT, UI_SURFACE_TITLE_WORLD_HEIGHT),
    new THREE.MeshBasicMaterial({
        map: uiSurfaceTitleTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.FrontSide
    })
);
uiSurfaceTitleLabel.position.set((UIPrevButton.position.x + UINextButton.position.x) * 0.5, 0.048, 0.001);
uiSurfaceTitleLabel.frustumCulled = false;
UIPlane.add(uiSurfaceTitleLabel);

const sliderTrackWidth = 0.18;
const sliderTrackHeight = 0.0025;
const SLIDER_ONE_Y = 0.001;
const SLIDER_VERTICAL_GAP = 0.0262;

const sharedSliderGeometries = {
    track: new THREE.PlaneGeometry(sliderTrackWidth, sliderTrackHeight),
    trackDot: new THREE.SphereGeometry(0.0045, 16, 16),
    grabDot: new THREE.SphereGeometry(0.008, 16, 16),
    connector: new THREE.BoxGeometry(1, 1, 1),
    sliderOneValue: new THREE.PlaneGeometry(0.054, 0.027),
};

let activeSliderKey = null;
const sliders = {
    sliderOne: createSlider({
        position: new THREE.Vector3(-0.008, SLIDER_ONE_Y, 0.001),
        labelText: 'a',
        defaultValue: 0.5,
        minValue: 0.1,
        maxValue: 2.0,
        onUpdate: null,
    }),
    sliderTwo: createSlider({
        position: new THREE.Vector3(-0.008, SLIDER_ONE_Y - SLIDER_VERTICAL_GAP, 0.001),
        labelText: 'b',
        defaultValue: 0.5,
        minValue: 0.1,
        maxValue: 2.0,
        onUpdate: null,
    }),
    sliderThree: createSlider({
        position: new THREE.Vector3(-0.008, SLIDER_ONE_Y - SLIDER_VERTICAL_GAP * 2, 0.001),
        labelText: 'c',
        defaultValue: 0.5,
        minValue: 0.1,
        maxValue: 2.0,
        onUpdate: null,
    }),
};

function setSliderActualValue(sliderKey, actualValue) {
    const slider = sliders[sliderKey];
    const range = slider.state.maxValue - slider.state.minValue;
    if (range <= 0) return;
    const normalized = (actualValue - slider.state.minValue) / range;
    slider.state.value = THREE.MathUtils.clamp(normalized, 0, 1);
    updateSliderTrackDotFromValue(sliderKey);
    updateSliderText(sliderKey);
    updateSliderGrabDotPosition(sliderKey);
}

function syncABCSlidersFromState() {
    setSliderActualValue('sliderOne', guiState.a);
    setSliderActualValue('sliderTwo', guiState.b);
    setSliderActualValue('sliderThree', guiState.c);
}

sliders.sliderOne.onUpdate = (value) => {
    guiState.a = value;
    updateParams();
};

sliders.sliderTwo.onUpdate = (value) => {
    guiState.b = value;
    updateParams();
};

sliders.sliderThree.onUpdate = (value) => {
    guiState.c = value;
    updateParams();
};

function updateUISurfaceTitle(surfaceName) {
    if (!uiSurfaceTitleCtx) return;
    uiSurfaceTitleCtx.clearRect(0, 0, uiSurfaceTitleCanvas.width, uiSurfaceTitleCanvas.height);

    const shapeLabel = SURFACES[surfaceName]?.label ?? surfaceName ?? '';
    if (!shapeLabel) {
        uiSurfaceTitleTexture.needsUpdate = true;
        return;
    }

    const baseFontPx = 88;
    const minFontPx = 52;
    const maxTextWidth = uiSurfaceTitleCanvas.width * 0.9;
    let fontPx = baseFontPx;
    uiSurfaceTitleCtx.font = `700 ${fontPx}px Helvetica, Arial, sans-serif`;
    while (fontPx > minFontPx && uiSurfaceTitleCtx.measureText(shapeLabel).width > maxTextWidth) {
        fontPx -= 2;
        uiSurfaceTitleCtx.font = `700 ${fontPx}px Helvetica, Arial, sans-serif`;
    }

    uiSurfaceTitleCtx.fillStyle = '#ffffff';
    uiSurfaceTitleCtx.textAlign = 'center';
    uiSurfaceTitleCtx.textBaseline = 'middle';
    uiSurfaceTitleCtx.fillText(shapeLabel, uiSurfaceTitleCanvas.width * 0.5, uiSurfaceTitleCanvas.height * 0.5);
    uiSurfaceTitleTexture.needsUpdate = true;
}

updateUISurfaceTitle(INITIAL_SURFACE);

const buttonState = {
    cooldown: 0,
    cooldownDuration: 0.5,
    pressDistance: 0.025,
    xrReady: false,
    xrStartupDelay: 1.0,
};
deps.UIPanelOn = false;
const UIDistanceConfig = {
    autoCollapseEnabled: false,
    maxDistance: 1.2,
    isAnimating: false,
};
const UIAnimConfig = {
    buttonHideDelay: 0.1,
    panelShowDelay: 0.0,
    panelScaleDuration: 0.3,
    panelHideDuration: 0.3,
    buttonScaleDuration: 0.25,
    panelEase: 'power2.out',
    buttonEase: 'power2.inOut',
};

const _uiCameraWorldPos = new THREE.Vector3();
const _uiCamContainerLocal = new THREE.Vector3();
const _uiContainerWorldScale = new THREE.Vector3();
const _menuButtonWorldPos = new THREE.Vector3();
const _closeButtonWorldPos = new THREE.Vector3();
const _prevButtonWorldPos = new THREE.Vector3();
const _nextButtonWorldPos = new THREE.Vector3();
const _uiDistanceWorldPos = new THREE.Vector3();
const _sliderGrabDotWorldPos = new THREE.Vector3();
const _sliderTrackWorldPos = new THREE.Vector3();
const _sliderTrackWorldDir = new THREE.Vector3();
const _sliderTrackWorldX = new THREE.Vector3();
const _pinchWorldPos = new THREE.Vector3();
const _connectorTrackDotPos = new THREE.Vector3();
const _connectorGrabDotPos = new THREE.Vector3();
const _connectorMidpoint = new THREE.Vector3();

function createSlider(config) {
    const sliderLabelCanvas = document.createElement('canvas');
    sliderLabelCanvas.width = 256;
    sliderLabelCanvas.height = 128;
    const sliderLabelCtx = sliderLabelCanvas.getContext('2d');
    const sliderLabelTexture = new THREE.CanvasTexture(sliderLabelCanvas);
    sliderLabelTexture.colorSpace = THREE.SRGBColorSpace;
    sliderLabelTexture.minFilter = THREE.LinearFilter;
    sliderLabelTexture.magFilter = THREE.LinearFilter;

    const track = new THREE.Mesh(
        sharedSliderGeometries.track,
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: false,
            opacity: 1.0,
            depthTest: false,
            side: THREE.FrontSide,
        })
    );
    track.position.copy(config.position);
    track.frustumCulled = false;
    UIPlane.add(track);

    const sliderOneValue = new Text();
    sliderOneValue.text = Number(config.defaultValue ?? 0).toFixed(2);
    sliderOneValue.fontWeight = 'bold';
    sliderOneValue.fontSize = 0.0145;
    sliderOneValue.color = 0xffffff;
    sliderOneValue.anchorX = 'center';
    sliderOneValue.anchorY = 'middle';
    sliderOneValue.depthTest = false;
    sliderOneValue.depthWrite = false;
    sliderOneValue.renderOrder = 1000;
    sliderOneValue.sync();
    sliderOneValue.position.set(sliderTrackWidth * 0.5 + 0.03, -0.0, 0.003);
    sliderOneValue.frustumCulled = false;
    track.add(sliderOneValue);

    const sliderOneLabel = new THREE.Mesh(
        sharedSliderGeometries.sliderOneValue,
        new THREE.MeshBasicMaterial({
            map: sliderLabelTexture,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            side: THREE.FrontSide,
        })
    );
    sliderOneLabel.position.set(-0.112, -0.0, 0.001);
    sliderOneLabel.scale.setScalar(1.1);
    sliderOneLabel.frustumCulled = false;
    track.add(sliderOneLabel);

    if (sliderLabelCtx) {
        sliderLabelCtx.clearRect(0, 0, sliderLabelCanvas.width, sliderLabelCanvas.height);
        sliderLabelCtx.fillStyle = '#ffffff';
        sliderLabelCtx.font = '700 62px Helvetica, Arial, sans-serif';
        sliderLabelCtx.textAlign = 'center';
        sliderLabelCtx.textBaseline = 'middle';
        sliderLabelCtx.fillText(config.labelText ?? 'a', sliderLabelCanvas.width * 0.5, sliderLabelCanvas.height * 0.52);
        sliderLabelTexture.needsUpdate = true;
    }

    const trackDot = new THREE.Mesh(
        sharedSliderGeometries.trackDot,
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            depthTest: false,
        })
    );
    trackDot.position.set(0, 0, 0.001);
    trackDot.frustumCulled = false;
    track.add(trackDot);

    const grabDot = new THREE.Mesh(
        sharedSliderGeometries.grabDot,
        new THREE.MeshBasicMaterial({
            color: 0xffff00,
            depthTest: true,
        })
    );
    grabDot.position.set(0, 0, 0.002);
    grabDot.frustumCulled = false;
    track.add(grabDot);

    const connector = new THREE.Mesh(
        sharedSliderGeometries.connector,
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            depthTest: true,
            transparent: true,
            opacity: 0.6,
        })
    );
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
            grabDistance: 0.025,
            trackHalfWidth: sliderTrackWidth * 0.5,
            initialGrabX: 0,
            lastValueText: '',
            lastValueTextUpdateMs: 0,
        },
        track,
        trackDot,
        grabDot,
        connector,
        sliderOneValue,
        sliderOneLabel,
        onUpdate: config.onUpdate || null,
    };
}

const SLIDER_TEXT_UPDATE_INTERVAL_MS = 50;

function updateSliderValueText(sliderKey, valueText, force = false) {
    const slider = sliders[sliderKey];
    if (!slider.sliderOneValue) return;
    const now = performance.now();
    if (!force && slider.state.lastValueText === valueText) return;
    if (!force && slider.state.isGrabbed && (now - slider.state.lastValueTextUpdateMs) < SLIDER_TEXT_UPDATE_INTERVAL_MS) return;
    slider.state.lastValueText = valueText;
    slider.state.lastValueTextUpdateMs = now;
    slider.sliderOneValue.text = valueText;
    slider.sliderOneValue.sync();
}

function updateSliderText(sliderKey, force = false) {
    const slider = sliders[sliderKey];
    const actualValue = slider.state.minValue + slider.state.value * (slider.state.maxValue - slider.state.minValue);
    updateSliderValueText(sliderKey, actualValue.toFixed(2), force);
}

function updateSliderTrackDotFromValue(sliderKey) {
    const slider = sliders[sliderKey];
    const trackX = (slider.state.value - 0.5) * 2 * slider.state.trackHalfWidth;
    slider.trackDot.position.x = trackX;
}

function updateSliderGrabDotPosition(sliderKey) {
    const slider = sliders[sliderKey];
    if (slider.state.isGrabbed) return;
    slider.grabDot.position.x = slider.trackDot.position.x;
}

function updateAllSliderGrabDots() {
    for (const key in sliders) updateSliderGrabDotPosition(key);
}

function applySliderValue(sliderKey) {
    const slider = sliders[sliderKey];
    if (!slider.onUpdate) return;
    const actualValue = slider.state.minValue + slider.state.value * (slider.state.maxValue - slider.state.minValue);
    slider.onUpdate(actualValue);
}

function updateSliderConnector(sliderKey) {
    const slider = sliders[sliderKey];
    slider.trackDot.getWorldPosition(_connectorTrackDotPos);
    slider.grabDot.getWorldPosition(_connectorGrabDotPos);

    const distance = _connectorTrackDotPos.distanceTo(_connectorGrabDotPos);
    _connectorMidpoint.addVectors(_connectorTrackDotPos, _connectorGrabDotPos).multiplyScalar(0.5);
    slider.connector.position.copy(_connectorMidpoint);
    slider.connector.scale.set(0.002, 0.002, distance);
    slider.connector.lookAt(_connectorGrabDotPos);
}

function onSliderGrab(sliderKey, hand) {
    const slider = sliders[sliderKey];
    activeSliderKey = sliderKey;
    slider.state.isGrabbed = true;
    slider.state.grabbingHand = hand;

    // Coarse slice-curve grid while dragging (~4× cheaper per recompute).
    slicePlaneManager.setInteractive(true);

    if (hand === 'left') _pinchWorldPos.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
    else _pinchWorldPos.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);

    slider.track.getWorldPosition(_sliderTrackWorldPos);
    _sliderTrackWorldX.set(1, 0, 0);
    slider.track.localToWorld(_sliderTrackWorldX);
    _sliderTrackWorldDir.copy(_sliderTrackWorldX).sub(_sliderTrackWorldPos).normalize();
    slider.state.initialGrabX = _pinchWorldPos.clone().sub(_sliderTrackWorldPos).dot(_sliderTrackWorldDir);

    slider.grabDot.getWorldPosition(_sliderGrabDotWorldPos);
    slider.track.remove(slider.grabDot);
    scene.add(slider.grabDot);
    slider.grabDot.position.copy(_sliderGrabDotWorldPos);
    slider.grabDot.scale.setScalar(1.2);

    slider.connector.visible = true;
    updateSliderConnector(sliderKey);
}

function onSliderDrag(sliderKey) {
    const slider = sliders[sliderKey];
    if (slider.state.grabbingHand === 'left') _pinchWorldPos.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
    else _pinchWorldPos.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);

    slider.grabDot.position.copy(_pinchWorldPos);

    slider.track.getWorldPosition(_sliderTrackWorldPos);
    _sliderTrackWorldX.set(1, 0, 0);
    slider.track.localToWorld(_sliderTrackWorldX);
    _sliderTrackWorldDir.copy(_sliderTrackWorldX).sub(_sliderTrackWorldPos).normalize();

    const currentProjectedX = _pinchWorldPos.clone().sub(_sliderTrackWorldPos).dot(_sliderTrackWorldDir);
    const deltaX = currentProjectedX - slider.state.initialGrabX;
    const currentTrackX = (slider.state.value - 0.5) * 2 * slider.state.trackHalfWidth;
    let newTrackX = currentTrackX + deltaX;
    newTrackX = Math.max(-slider.state.trackHalfWidth, Math.min(slider.state.trackHalfWidth, newTrackX));

    slider.state.value = (newTrackX / slider.state.trackHalfWidth + 1) * 0.5;
    slider.state.initialGrabX = currentProjectedX;

    updateSliderTrackDotFromValue(sliderKey);
    updateSliderText(sliderKey);
    applySliderValue(sliderKey);
    updateSliderConnector(sliderKey);
}

function onSliderRelease(sliderKey) {
    const slider = sliders[sliderKey];
    slider.state.isGrabbed = false;
    slider.state.grabbingHand = null;
    activeSliderKey = null;

    slider.connector.visible = false;
    slider.grabDot.scale.setScalar(1);
    slider.grabDot.getWorldPosition(_sliderGrabDotWorldPos);
    scene.remove(slider.grabDot);
    slider.track.add(slider.grabDot);
    slider.track.worldToLocal(_sliderGrabDotWorldPos);
    slider.grabDot.position.copy(_sliderGrabDotWorldPos);
    updateSliderText(sliderKey, true);

    // Drag used a frozen vertex distribution for speed; recompute it once now.
    surfaceManager.refreshVertexDistribution();
    // Restore the full-resolution slice-curve grid before the final recompute.
    slicePlaneManager.setInteractive(false);
    syncSlicePlanes();

    gsap.to(slider.grabDot.position, {
        x: slider.trackDot.position.x,
        y: slider.trackDot.position.y,
        z: 0.002,
        duration: 0.1,
        ease: 'power2.out',
    });
}

function isUIPanelFullyOpen() {
    return deps.UIPanelOn
        && !UIDistanceConfig.isAnimating
        && UIPlane.visible
        && UIRoot.visible;
}

function checkSliderGrab() {
    if (!buttonState.xrReady) return;
    if (!isUIPanelFullyOpen()) {
        if (activeSliderKey) onSliderRelease(activeSliderKey);
        return;
    }

    const leftPinching = pinchState.left;
    const rightPinching = pinchState.right;

    if (activeSliderKey) {
        const slider = sliders[activeSliderKey];
        const stillPinching =
            (slider.state.grabbingHand === 'left' && leftPinching) ||
            (slider.state.grabbingHand === 'right' && rightPinching);
        if (!stillPinching) onSliderRelease(activeSliderKey);
        else onSliderDrag(activeSliderKey);
        return;
    }

    for (const sliderKey in sliders) {
        const slider = sliders[sliderKey];
        slider.grabDot.getWorldPosition(_sliderGrabDotWorldPos);

        if (leftPinching) {
            _pinchWorldPos.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
            if (_pinchWorldPos.distanceTo(_sliderGrabDotWorldPos) < slider.state.grabDistance) {
                onSliderGrab(sliderKey, 'left');
                return;
            }
        }

        if (rightPinching) {
            _pinchWorldPos.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);
            if (_pinchWorldPos.distanceTo(_sliderGrabDotWorldPos) < slider.state.grabDistance) {
                onSliderGrab(sliderKey, 'right');
                return;
            }
        }
    }
}

function isUISliderBeingDriven() {
    return activeSliderKey !== null;
}

function updateUIRoot() {
    camera.getWorldPosition(_uiCameraWorldPos);
    _uiCamContainerLocal.copy(_uiCameraWorldPos);
    containerGroup.worldToLocal(_uiCamContainerLocal);

    const dx = _uiCamContainerLocal.x;
    const dz = _uiCamContainerLocal.z;
    const horizLenSq = dx * dx + dz * dz;
    const yaw = horizLenSq > 1e-8 ? Math.atan2(dx, dz) : 0;

    UIRoot.position.set(
        Math.sin(yaw) * UI_ORBIT_RADIUS,
        UI_LOCAL_Y,
        Math.cos(yaw) * UI_ORBIT_RADIUS
    );
    UIRoot.rotation.set(0, yaw, 0);

    containerGroup.getWorldScale(_uiContainerWorldScale);
    UIRoot.scale.set(
        _uiContainerWorldScale.x > 1e-8 ? 1 / _uiContainerWorldScale.x : 1,
        _uiContainerWorldScale.y > 1e-8 ? 1 / _uiContainerWorldScale.y : 1,
        _uiContainerWorldScale.z > 1e-8 ? 1 / _uiContainerWorldScale.z : 1
    );
}

function animateButtonPress(buttonMesh) {
    gsap.killTweensOf(buttonMesh.position);
    gsap.killTweensOf(buttonMesh.scale);

    const originalZ = buttonMesh.position.z;
    const tl = gsap.timeline();

    tl.to(buttonMesh.position, { z: originalZ - 0.02, duration: 0.15, ease: 'power2.out' }, 0);
    tl.to(buttonMesh.scale, { x: 1.25, y: 1.25, duration: 0.15, ease: 'power2.out' }, 0);
    tl.to(buttonMesh.position, { z: originalZ, duration: 0.15, ease: 'power2.out' }, 0.225);
    tl.to(buttonMesh.scale, { x: 1, y: 1, duration: 0.15, ease: 'power2.out' }, 0.225);
}

function showUIPanel() {
    if (deps.UIPanelOn || UIDistanceConfig.isAnimating) return;
    deps.UIPanelOn = true;
    UIDistanceConfig.isAnimating = true;

    const tl = gsap.timeline({
        onComplete: () => { UIDistanceConfig.isAnimating = false; }
    });

    tl.to({}, { duration: UIAnimConfig.buttonHideDelay });
    tl.to(UIButton.scale, {
        x: 0, y: 0,
        duration: UIAnimConfig.buttonScaleDuration,
        ease: UIAnimConfig.buttonEase,
        onComplete: () => { UIButton.visible = false; }
    });
    tl.to({}, { duration: UIAnimConfig.panelShowDelay });
    tl.call(() => { UIPlane.visible = true; });
    tl.to(UIPlane.scale, {
        x: 1, y: 1, z: 1,
        duration: UIAnimConfig.panelScaleDuration,
        ease: UIAnimConfig.panelEase
    });
}

function hideUIPanel() {
    if (!deps.UIPanelOn || UIDistanceConfig.isAnimating) return;
    deps.UIPanelOn = false;
    UIDistanceConfig.isAnimating = true;
    UIButton.position.z = 0;

    const tl = gsap.timeline({
        onComplete: () => { UIDistanceConfig.isAnimating = false; }
    });

    tl.to(UIPlane.scale, {
        x: 0, y: 0, z: 0,
        duration: UIAnimConfig.panelHideDuration,
        ease: 'power2.in',
        onComplete: () => { UIPlane.visible = false; }
    });
    tl.call(() => { UIButton.visible = true; }, [], `-=${UIAnimConfig.panelHideDuration * 0.3}`);
    tl.to(UIButton.scale, {
        x: 1, y: 1,
        duration: UIAnimConfig.buttonScaleDuration,
        ease: UIAnimConfig.panelEase
    }, `-=${UIAnimConfig.panelHideDuration * 0.3}`);
}

function onMenuButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    animateButtonPress(UIButton);
    showUIPanel();
}

function onCloseButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    animateButtonPress(UICloseButton);
    setTimeout(() => {
        hideUIPanel();
    }, 150);
}

function onPrevButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    animateButtonPress(UIPrevButton);
    setTimeout(() => {
        cycleSurface(-1);
    }, 150);
}

function onNextButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    animateButtonPress(UINextButton);
    setTimeout(() => {
        cycleSurface(1);
    }, 150);
}

function checkMenuButtonPress() {
    if (!buttonState.xrReady) return;
    if (isAnyPlaneHandleBeingDriven() || isUISliderBeingDriven()) return;
    if (buttonState.cooldown > 0) return;
    if (UIDistanceConfig.isAnimating) return;
    if (!UIButton.visible || deps.UIPanelOn || !UIRoot.visible) return;

    UIButton.getWorldPosition(_menuButtonWorldPos);
    const leftDist = lIndexObj.position.distanceTo(_menuButtonWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onMenuButtonPressed();
        return;
    }

    const rightDist = rIndexObj.position.distanceTo(_menuButtonWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onMenuButtonPressed();
    }
}

function checkCloseButtonPress() {
    if (!buttonState.xrReady) return;
    if (isAnyPlaneHandleBeingDriven() || isUISliderBeingDriven()) return;
    if (buttonState.cooldown > 0) return;
    if (!isUIPanelFullyOpen()) return;

    UICloseButton.getWorldPosition(_closeButtonWorldPos);
    const leftDist = lIndexObj.position.distanceTo(_closeButtonWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onCloseButtonPressed();
        return;
    }

    const rightDist = rIndexObj.position.distanceTo(_closeButtonWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onCloseButtonPressed();
    }
}

function checkPrevButtonPress() {
    if (!buttonState.xrReady) return;
    if (isAnyPlaneHandleBeingDriven() || isUISliderBeingDriven()) return;
    if (buttonState.cooldown > 0) return;
    if (!isUIPanelFullyOpen()) return;

    UIPrevButton.getWorldPosition(_prevButtonWorldPos);
    const leftDist = lIndexObj.position.distanceTo(_prevButtonWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onPrevButtonPressed();
        return;
    }

    const rightDist = rIndexObj.position.distanceTo(_prevButtonWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onPrevButtonPressed();
    }
}

function checkNextButtonPress() {
    if (!buttonState.xrReady) return;
    if (isAnyPlaneHandleBeingDriven() || isUISliderBeingDriven()) return;
    if (buttonState.cooldown > 0) return;
    if (!isUIPanelFullyOpen()) return;

    UINextButton.getWorldPosition(_nextButtonWorldPos);
    const leftDist = lIndexObj.position.distanceTo(_nextButtonWorldPos);
    if (leftDist < buttonState.pressDistance) {
        onNextButtonPressed();
        return;
    }

    const rightDist = rIndexObj.position.distanceTo(_nextButtonWorldPos);
    if (rightDist < buttonState.pressDistance) {
        onNextButtonPressed();
    }
}

function checkPanelDistance() {
    if (!UIDistanceConfig.autoCollapseEnabled) return;
    if (!deps.UIPanelOn || UIDistanceConfig.isAnimating) return;
    UIButton.getWorldPosition(_uiDistanceWorldPos);
    const distance = camera.position.distanceTo(_uiDistanceWorldPos);
    if (distance > UIDistanceConfig.maxDistance) {
        hideUIPanel();
    }
}



    const api = {
        UIRoot,
        UIButton,
        UIPlane,
        UICloseButton,
        UIPrevButton,
        UINextButton,
        sliders,
        activeSliderKey,
        buttonState,
        UIDistanceConfig,
        UIAnimConfig,
        _uiCameraWorldPos,
        createSlider,
        setSliderActualValue,
        syncABCSlidersFromState,
        updateUISurfaceTitle,
        updateSliderValueText,
        updateSliderText,
        updateSliderTrackDotFromValue,
        updateSliderGrabDotPosition,
        updateAllSliderGrabDots,
        applySliderValue,
        updateSliderConnector,
        onSliderGrab,
        onSliderDrag,
        onSliderRelease,
        isUIPanelFullyOpen,
        checkSliderGrab,
        isUISliderBeingDriven,
        updateUIRoot,
        animateButtonPress,
        showUIPanel,
        hideUIPanel,
        onMenuButtonPressed,
        onCloseButtonPressed,
        onPrevButtonPressed,
        onNextButtonPressed,
        checkMenuButtonPress,
        checkCloseButtonPress,
        checkPrevButtonPress,
        checkNextButtonPress,
        checkPanelDistance
    };
    Object.assign(deps, api);
    return api;
}
