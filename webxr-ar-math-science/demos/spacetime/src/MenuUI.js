import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import gsap from 'gsap';
export function createMenuUI(deps) {
    const { scene, camera, renderer, containerGroup, containerConfig, disableFrustumCulling } = deps;
    const GRID_EXTENT_MULTIPLIER = deps.GRID_EXTENT_MULTIPLIER ?? 1.5;
    const GRID_PHYS = containerConfig.containerSize * GRID_EXTENT_MULTIPLIER;
    const GRID_HALF = GRID_PHYS / 2;
    deps.grabPlanetsHint = null;

const uiTextureLoader = new THREE.TextureLoader();
const HEADER_PLANE_HEIGHT = 0.2;
const HEADER_PLANE_ASPECT = 528 / 198;
const HEADER_PLANE_VERTICAL_OFFSET = GRID_PHYS * 0.9;
const HEADER_PLANE_DEPTH_OFFSET = 0.001;
const HEADER_PLANE_SCALE_RESPONSE = 0.65;
const MENU_BUTTON_SIZE = 0.032;
const MENU_BUTTON_ASPECT = 220 / 60;
const MENU_BUTTON_HALF_W = (MENU_BUTTON_SIZE * MENU_BUTTON_ASPECT) * 0.5;
const MENU_BUTTON_HALF_H = MENU_BUTTON_SIZE * 0.5;
const MENU_BUTTON_PRESS_PAD = 0.008;
const MENU_BUTTON_ACTIVE_ASPECT = 104 / 46;
const MENU_BUTTON_ACTIVE_HEIGHT = MENU_BUTTON_SIZE * (46 / 60);
const MENU_BUTTON_ACTIVE_X_OFFSET = 0.027;
const MENU_BUTTON_ACTIVE_Z_OFFSET = 0.004;
const MENU_BUTTON_ACTIVE_SLIDE_DURATION = 0.25;
const MENU_ORBIT_OUTSET = 0.16;
const MENU_ORBIT_RADIUS = GRID_HALF + MENU_ORBIT_OUTSET;
const MENU_BUTTON_LOCAL_Y = -GRID_HALF + 0.20;
const SHOOT_BUTTON_GAP = 0.014;
const SHOOT_BUTTON_SIZE = MENU_BUTTON_SIZE;

const headerPlaneTexture = uiTextureLoader.load(
    'static/ui-header.png',
    undefined,
    undefined,
    () => {
        console.warn('Missing header plane texture: static/ui-header.png');
    }
);
headerPlaneTexture.colorSpace = THREE.SRGBColorSpace;

const headerPlaneMaterial = new THREE.MeshBasicMaterial({
    map: headerPlaneTexture,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false
});

const headerPlaneRoot = new THREE.Object3D();
headerPlaneRoot.position.set(0, HEADER_PLANE_VERTICAL_OFFSET, HEADER_PLANE_DEPTH_OFFSET);
containerGroup.add(headerPlaneRoot);

const headerPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(HEADER_PLANE_HEIGHT * HEADER_PLANE_ASPECT, HEADER_PLANE_HEIGHT),
    headerPlaneMaterial
);
headerPlane.frustumCulled = false;
headerPlane.renderOrder = 3;
headerPlaneRoot.add(headerPlane);

const headerSwitchTexture = uiTextureLoader.load(
    'static/ui-switch-base.png',
    undefined,
    undefined,
    () => {
        console.warn('Missing header switch texture: static/ui-switch-base.png');
    }
);
headerSwitchTexture.colorSpace = THREE.SRGBColorSpace;

const headerSwitchMaterial = new THREE.MeshBasicMaterial({
    map: headerSwitchTexture,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false
});

const headerSwitchHeight = HEADER_PLANE_HEIGHT * (24 / 198);
const headerSwitch = new THREE.Mesh(
    new THREE.PlaneGeometry(headerSwitchHeight * (42 / 24), headerSwitchHeight),
    headerSwitchMaterial
);
headerSwitch.position.set(-0.156, -0.074, 0.001);
headerSwitch.frustumCulled = false;
headerSwitch.renderOrder = 4;
headerPlane.add(headerSwitch);

const headerSwitchActiveTexture = uiTextureLoader.load(
    'static/ui-switch-active.png',
    undefined,
    undefined,
    () => {
        console.warn('Missing header switch active texture: static/ui-switch-active.png');
    }
);
headerSwitchActiveTexture.colorSpace = THREE.SRGBColorSpace;

const headerSwitchActiveMaterial = new THREE.MeshBasicMaterial({
    map: headerSwitchActiveTexture,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false
});

const headerSwitchActive = new THREE.Mesh(
    new THREE.PlaneGeometry(headerSwitchHeight * 0.55, headerSwitchHeight * 0.55),
    headerSwitchActiveMaterial
);
headerSwitchActive.position.set(-0.008, 0, 0.001);
headerSwitchActive.frustumCulled = false;
headerSwitchActive.renderOrder = 5;
headerSwitch.add(headerSwitchActive);

const FORCE_CHECKBOX_GAP = 0.014;
const forceCheckboxSize = headerSwitchHeight;
const hdrSwitchHalfW = (headerSwitchHeight * (42 / 24)) * 0.5;

const forceCheckboxTexture = uiTextureLoader.load(
    'static/ui-checkbox.png',
    undefined,
    undefined,
    () => {
        console.warn('Missing force checkbox texture: static/ui-checkbox.png');
    }
);
forceCheckboxTexture.colorSpace = THREE.SRGBColorSpace;

const forceCheckboxMaterial = new THREE.MeshBasicMaterial({
    map: forceCheckboxTexture,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false
});

const forceCheckbox = new THREE.Mesh(
    new THREE.PlaneGeometry(forceCheckboxSize, forceCheckboxSize),
    forceCheckboxMaterial
);
forceCheckbox.position.set(
    0.027,
    headerSwitch.position.y,
    headerSwitch.position.z
);
forceCheckbox.frustumCulled = false;
forceCheckbox.renderOrder = 4;
headerPlane.add(forceCheckbox);

const forceCheckboxInnerTexture = uiTextureLoader.load(
    'static/ui-checkbox-in.png',
    undefined,
    undefined,
    () => {
        console.warn('Missing force checkbox inner texture: static/ui-checkbox-in.png');
    }
);
forceCheckboxInnerTexture.colorSpace = THREE.SRGBColorSpace;

const forceCheckboxInnerMaterial = new THREE.MeshBasicMaterial({
    map: forceCheckboxInnerTexture,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false
});

const forceCheckboxInner = new THREE.Mesh(
    new THREE.PlaneGeometry(forceCheckboxSize * 0.62, forceCheckboxSize * 0.62),
    forceCheckboxInnerMaterial
);
forceCheckboxInner.position.set(0, 0, 0.001);
forceCheckboxInner.visible = false;
forceCheckboxInner.frustumCulled = false;
forceCheckboxInner.renderOrder = 5;
forceCheckbox.add(forceCheckboxInner);

const FORCE_CHECKBOX_ORIGINAL_Z = forceCheckbox.position.z;

const forceCheckboxPressState = {
    isPressed: false,
    cooldown: 0,
    cooldownDuration: 0.5,
    pressDistance: 0.02,
    xrReady: false,
    xrStartupDelay: 1.0
};

function resetForceCheckboxPressVisualState() {
    gsap.killTweensOf(forceCheckbox.position);
    gsap.killTweensOf(forceCheckbox.scale);
    forceCheckbox.position.z = FORCE_CHECKBOX_ORIGINAL_Z;
    forceCheckbox.scale.set(1, 1, 1);
}

function animateForceCheckboxPress() {
    resetForceCheckboxPressVisualState();

    const originalZ = forceCheckbox.position.z;
    const pressDepth = -0.02;
    const scaleUp = 1.2;
    const pressDuration = 0.15;
    const returnDuration = 0.15;
    const delayBeforeReturn = 0.075;

    const pressTimeline = gsap.timeline({
        onComplete: () => {
            forceCheckboxPressState.isPressed = false;
        }
    });

    pressTimeline.to(forceCheckbox.position, {
        z: originalZ + pressDepth,
        duration: pressDuration,
        ease: 'power2.out'
    }, 0);
    pressTimeline.to(forceCheckbox.scale, {
        x: scaleUp,
        y: scaleUp,
        duration: pressDuration,
        ease: 'power2.out'
    }, 0);
    pressTimeline.to(forceCheckbox.position, {
        z: originalZ,
        duration: returnDuration,
        ease: 'power2.out'
    }, pressDuration + delayBeforeReturn);
    pressTimeline.to(forceCheckbox.scale, {
        x: 1,
        y: 1,
        duration: returnDuration,
        ease: 'power2.out'
    }, pressDuration + delayBeforeReturn);
}

const HEADER_SWITCH_ACTIVE_X_OFFSET = 0.008;
const HEADER_SWITCH_ACTIVE_SLIDE_DURATION = 0.25;
const HEADER_SWITCH_ORIGINAL_Z = headerSwitch.position.z;

function updateHeaderSwitchActivePosition(mode = deps.gravityViewState.mode, animate = true) {
    const targetX = mode === 'contour'
        ? HEADER_SWITCH_ACTIVE_X_OFFSET
        : -HEADER_SWITCH_ACTIVE_X_OFFSET;

    gsap.killTweensOf(headerSwitchActive.position);

    if (animate) {
        gsap.to(headerSwitchActive.position, {
            x: targetX,
            duration: HEADER_SWITCH_ACTIVE_SLIDE_DURATION,
            ease: 'power2.inOut'
        });
    } else {
        headerSwitchActive.position.x = targetX;
    }
}

const headerSwitchPressState = {
    isPressed: false,
    cooldown: 0,
    cooldownDuration: 0.5,
    pressDistance: 0.02,
    xrReady: false,
    xrStartupDelay: 1.0
};

let headerSwitchXRReadyTimeoutId = null;

function resetHeaderSwitchPressVisualState() {
    gsap.killTweensOf(headerSwitch.position);
    gsap.killTweensOf(headerSwitch.scale);
    headerSwitch.position.z = HEADER_SWITCH_ORIGINAL_Z;
    headerSwitch.scale.set(1, 1, 1);
}

function animateHeaderSwitchPress() {
    resetHeaderSwitchPressVisualState();

    const originalZ = headerSwitch.position.z;
    const pressDepth = -0.02;
    const scaleUp = 1.2;
    const pressDuration = 0.15;
    const returnDuration = 0.15;
    const delayBeforeReturn = 0.075;

    const pressTimeline = gsap.timeline({
        onComplete: () => {
            headerSwitchPressState.isPressed = false;
        }
    });

    pressTimeline.to(headerSwitch.position, {
        z: originalZ + pressDepth,
        duration: pressDuration,
        ease: 'power2.out'
    }, 0);
    pressTimeline.to(headerSwitch.scale, {
        x: scaleUp,
        y: scaleUp,
        duration: pressDuration,
        ease: 'power2.out'
    }, 0);
    pressTimeline.to(headerSwitch.position, {
        z: originalZ,
        duration: returnDuration,
        ease: 'power2.out'
    }, pressDuration + delayBeforeReturn);
    pressTimeline.to(headerSwitch.scale, {
        x: 1,
        y: 1,
        duration: returnDuration,
        ease: 'power2.out'
    }, pressDuration + delayBeforeReturn);
}

function onHeaderSwitchPressed() {
    headerSwitchPressState.isPressed = true;
    headerSwitchPressState.cooldown = headerSwitchPressState.cooldownDuration;
    animateHeaderSwitchPress();
    deps.gravityViewState.mode = deps.gravityViewState.mode === 'grid' ? 'contour' : 'grid';
    deps.applyGravityViewMode();
}

const _headerPlaneContainerScale = new THREE.Vector3();
const _headerPlaneCameraWorldPos = new THREE.Vector3();
const _headerPlaneCameraLocalPos = new THREE.Vector3();

function updateHeaderPlane() {
    const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
    activeCamera.getWorldPosition(_headerPlaneCameraWorldPos);

    containerGroup.updateWorldMatrix(true, false);
    containerGroup.getWorldScale(_headerPlaneContainerScale);

    headerPlane.scale.set(
        _headerPlaneContainerScale.x !== 0 ? Math.pow(_headerPlaneContainerScale.x, HEADER_PLANE_SCALE_RESPONSE - 1) : 1,
        _headerPlaneContainerScale.y !== 0 ? Math.pow(_headerPlaneContainerScale.y, HEADER_PLANE_SCALE_RESPONSE - 1) : 1,
        _headerPlaneContainerScale.z !== 0 ? Math.pow(_headerPlaneContainerScale.z, HEADER_PLANE_SCALE_RESPONSE - 1) : 1
    );

    _headerPlaneCameraLocalPos.copy(_headerPlaneCameraWorldPos);
    containerGroup.worldToLocal(_headerPlaneCameraLocalPos);

    const dx = _headerPlaneCameraLocalPos.x - headerPlaneRoot.position.x;
    const dz = _headerPlaneCameraLocalPos.z - headerPlaneRoot.position.z;
    if (dx !== 0 || dz !== 0) {
        headerPlaneRoot.rotation.set(0, Math.atan2(dx, dz), 0);
    }
}

updateHeaderPlane();

const menuButtonTexture = uiTextureLoader.load(
    'static/ui-toggle-base.png',
    undefined,
    undefined,
    () => {
        console.warn('Missing menu button texture: static/ui-toggle-base.png');
    }
);
menuButtonTexture.colorSpace = THREE.SRGBColorSpace;

const menuButtonMaterial = new THREE.MeshBasicMaterial({
    map: menuButtonTexture,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false
});

const menuButtonRoot = new THREE.Object3D();
containerGroup.add(menuButtonRoot);

const menuButtonPivot = new THREE.Object3D();
menuButtonPivot.rotation.x = -30.0 * Math.PI / 180;
menuButtonPivot.position.z = -0.001;
menuButtonRoot.add(menuButtonPivot);

const menuButton = new THREE.Mesh(
    new THREE.PlaneGeometry(MENU_BUTTON_SIZE * MENU_BUTTON_ASPECT, MENU_BUTTON_SIZE),
    menuButtonMaterial
);
menuButton.frustumCulled = false;
menuButton.renderOrder = 3;
menuButtonPivot.add(menuButton);

const menuButtonActiveTexture = uiTextureLoader.load(
    'static/ui-toggle-active.png',
    undefined,
    undefined,
    () => {
        console.warn('Missing menu button active texture: static/ui-toggle-active.png');
    }
);
menuButtonActiveTexture.colorSpace = THREE.SRGBColorSpace;

const menuButtonActiveMaterial = new THREE.MeshBasicMaterial({
    map: menuButtonActiveTexture,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false
});

const menuButtonActive = new THREE.Mesh(
    new THREE.PlaneGeometry(MENU_BUTTON_ACTIVE_HEIGHT * MENU_BUTTON_ACTIVE_ASPECT, MENU_BUTTON_ACTIVE_HEIGHT),
    menuButtonActiveMaterial
);
menuButtonActive.position.set(-MENU_BUTTON_ACTIVE_X_OFFSET, 0, MENU_BUTTON_ACTIVE_Z_OFFSET);
menuButtonActive.frustumCulled = false;
menuButtonActive.renderOrder = 4;
menuButton.add(menuButtonActive);

const shootButtonTexture = uiTextureLoader.load(
    'static/ui-button-shoot.png',
    undefined,
    undefined,
    () => {
        console.warn('Missing shoot button texture: static/ui-button-shoot.png');
    }
);
shootButtonTexture.colorSpace = THREE.SRGBColorSpace;

const shootButtonMaterial = new THREE.MeshBasicMaterial({
    map: shootButtonTexture,
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false
});
const shootButton = new THREE.Mesh(
    new THREE.PlaneGeometry(SHOOT_BUTTON_SIZE, SHOOT_BUTTON_SIZE),
    shootButtonMaterial
);
shootButton.name = 'Shoot Button';
const shootButtonRoot = new THREE.Object3D();
shootButtonRoot.name = 'Shoot Button Root';
shootButtonRoot.position.set(
    MENU_BUTTON_HALF_W + SHOOT_BUTTON_GAP + SHOOT_BUTTON_SIZE * 0.5,
    0,
    0
);
shootButton.position.set(0, 0, 0);
shootButtonRoot.scale.setScalar(0.0001);
shootButtonRoot.visible = false;
shootButton.frustumCulled = false;
shootButton.renderOrder = 3;
shootButtonRoot.add(shootButton);
menuButtonPivot.add(shootButtonRoot);

const labelActiveMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 1,
    depthWrite: false
});

const labelInactiveMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.7,
    depthWrite: false
});

let LabelA = null;
let LabelB = null;
let helvetikerFont = null;
let grabPlanetsHintDismissed = false;

const grabPlanetsHintMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
    side: THREE.DoubleSide
});

function createGrabPlanetsHint() {
    if (deps.grabPlanetsHint || !helvetikerFont) {
        return;
    }

    const grabHintGeometry = new TextGeometry('Grab and place planets', {
        font: helvetikerFont,
        size: 0.018,
        height: 0,
        curveSegments: 4,
        bevelEnabled: false
    });
    grabHintGeometry.center();

    deps.grabPlanetsHint = new THREE.Mesh(grabHintGeometry, grabPlanetsHintMaterial);
    deps.grabPlanetsHint.position.set(0, deps.wellBottomY + 0.3, 0);
    deps.grabPlanetsHint.frustumCulled = false;
    deps.grabPlanetsHint.renderOrder = 11;
    grabPlanetsHintMaterial.opacity = 0.95;
    deps.grabPlanetsHint.visible = deps.orbitState.mode === 'edit';
    containerGroup.add(deps.grabPlanetsHint);
}

function revealGrabPlanetsHint() {
    grabPlanetsHintDismissed = false;
    if (deps.grabPlanetsHint) {
        gsap.killTweensOf(deps.grabPlanetsHint.material);
        deps.grabPlanetsHint.material.opacity = 0.95;
        deps.grabPlanetsHint.visible = deps.orbitState.mode === 'edit';
        return;
    }
    createGrabPlanetsHint();
}

function dismissGrabPlanetsHint() {
    if (grabPlanetsHintDismissed) {
        return;
    }
    grabPlanetsHintDismissed = true;

    if (!deps.grabPlanetsHint) {
        return;
    }

    const hint = deps.grabPlanetsHint;
    gsap.killTweensOf(hint.material);
    gsap.to(hint.material, {
        opacity: 0,
        duration: 0.45,
        ease: 'power2.out',
        onComplete: () => {
            if (hint.parent) {
                hint.parent.remove(hint);
            }
            if (hint.geometry) {
                hint.geometry.dispose();
            }
            if (deps.grabPlanetsHint === hint) {
                deps.grabPlanetsHint = null;
            }
        }
    });
}

function updateMenuButtonLabelMaterials(mode = deps.orbitState.mode) {
    if (!LabelA || !LabelB) return;
    LabelA.material = mode === 'edit' ? labelActiveMaterial : labelInactiveMaterial;
    LabelB.material = mode === 'orbit' ? labelActiveMaterial : labelInactiveMaterial;
}

const fontLoader = new FontLoader();
fontLoader.load(
    'static/fonts/helvetiker_bold.typeface.json',
    (font) => {
        const labelGeometryA = new TextGeometry('Place', {
            font,
            size: 0.008,
            height: 0,
            curveSegments: 4,
            bevelEnabled: false
        });
        labelGeometryA.center();

        LabelA = new THREE.Mesh(labelGeometryA, labelActiveMaterial);
        LabelA.position.set(-0.027, 0, 0.001);
        LabelA.frustumCulled = false;
        LabelA.renderOrder = 5;
        menuButton.add(LabelA);

        const labelGeometryB = new TextGeometry('Orbit', {
            font,
            size: 0.008,
            height: 0,
            curveSegments: 4,
            bevelEnabled: false
        });
        labelGeometryB.center();

        LabelB = new THREE.Mesh(labelGeometryB, labelInactiveMaterial);
        LabelB.position.set(0.027, 0, 0.001);
        LabelB.frustumCulled = false;
        LabelB.renderOrder = 5;
        menuButton.add(LabelB);

        updateMenuButtonLabelMaterials();

        helvetikerFont = font;
        createGrabPlanetsHint();
    },
    undefined,
    () => {
        console.warn('Missing font: static/fonts/helvetiker_bold.typeface.json');
    }
);

function updateMenuButtonActivePosition(mode = deps.orbitState.mode, animate = true) {
    const targetX = mode === 'orbit'
        ? MENU_BUTTON_ACTIVE_X_OFFSET
        : -MENU_BUTTON_ACTIVE_X_OFFSET;

    updateMenuButtonLabelMaterials(mode);

    gsap.killTweensOf(menuButtonActive.position);

    if (animate) {
        gsap.to(menuButtonActive.position, {
            x: targetX,
            duration: MENU_BUTTON_ACTIVE_SLIDE_DURATION,
            ease: 'power2.inOut'
        });
    } else {
        menuButtonActive.position.x = targetX;
    }
}

const menuButtonPressState = {
    isPressed: false,
    cooldown: 0,
    cooldownDuration: 0.5,
    pressDepth: 0.025,
    xrReady: false,
    xrStartupDelay: 1.0
};

let menuButtonXRReadyTimeoutId = null;

function resetMenuButtonPressVisualState() {
    gsap.killTweensOf(menuButton.position);
    gsap.killTweensOf(menuButton.scale);
    menuButton.position.z = 0;
    menuButton.scale.set(1, 1, 1);
}

function animateMenuButtonPress() {
    resetMenuButtonPressVisualState();

    const originalZ = menuButton.position.z;
    const pressDepth = -0.02;
    const scaleUp = 1.2;
    const pressDuration = 0.15;
    const returnDuration = 0.15;
    const delayBeforeReturn = 0.075;

    const pressTimeline = gsap.timeline({
        onComplete: () => {
            menuButtonPressState.isPressed = false;
        }
    });

    pressTimeline.to(menuButton.position, {
        z: originalZ + pressDepth,
        duration: pressDuration,
        ease: 'power2.out'
    }, 0);
    pressTimeline.to(menuButton.scale, {
        x: scaleUp,
        y: scaleUp,
        duration: pressDuration,
        ease: 'power2.out'
    }, 0);
    pressTimeline.to(menuButton.position, {
        z: originalZ,
        duration: returnDuration,
        ease: 'power2.out'
    }, pressDuration + delayBeforeReturn);
    pressTimeline.to(menuButton.scale, {
        x: 1,
        y: 1,
        duration: returnDuration,
        ease: 'power2.out'
    }, pressDuration + delayBeforeReturn);
}

const SHOOT_BUTTON_ORIGINAL_Z = shootButton.position.z;

const shootButtonPressState = {
    isPressed: false,
    cooldown: 0,
    cooldownDuration: 0.5,
    pressDistance: 0.025,
    xrReady: false,
    xrStartupDelay: 1.0
};

function resetShootButtonPressVisualState() {
    gsap.killTweensOf(shootButton.position);
    gsap.killTweensOf(shootButton.scale);
    shootButton.position.z = SHOOT_BUTTON_ORIGINAL_Z;
    shootButton.scale.set(1, 1, 1);
}

const SHOOT_BUTTON_ORBIT_VISIBILITY_DURATION = 0.35;

function animateShootButtonOrbitVisibility(show) {
    gsap.killTweensOf(shootButtonRoot.scale);
    if (show) {
        shootButtonRoot.visible = true;
        shootButtonRoot.scale.setScalar(0.0001);
        gsap.to(shootButtonRoot.scale, {
            x: 1,
            y: 1,
            z: 1,
            duration: SHOOT_BUTTON_ORBIT_VISIBILITY_DURATION,
            ease: 'power2.out'
        });
    } else {
        gsap.to(shootButtonRoot.scale, {
            x: 0.0001,
            y: 0.0001,
            z: 0.0001,
            duration: SHOOT_BUTTON_ORBIT_VISIBILITY_DURATION,
            ease: 'power2.inOut',
            onComplete: () => {
                shootButtonRoot.visible = false;
            }
        });
    }
}

function animateShootButtonPress() {
    resetShootButtonPressVisualState();

    const originalZ = shootButton.position.z;
    const pressDepth = -0.02;
    const scaleUp = 1.2;
    const pressDuration = 0.15;
    const returnDuration = 0.15;
    const delayBeforeReturn = 0.075;

    const pressTimeline = gsap.timeline({
        onComplete: () => {
            shootButtonPressState.isPressed = false;
        }
    });

    pressTimeline.to(shootButton.position, {
        z: originalZ + pressDepth,
        duration: pressDuration,
        ease: 'power2.out'
    }, 0);
    pressTimeline.to(shootButton.scale, {
        x: scaleUp,
        y: scaleUp,
        duration: pressDuration,
        ease: 'power2.out'
    }, 0);
    pressTimeline.to(shootButton.position, {
        z: originalZ,
        duration: returnDuration,
        ease: 'power2.out'
    }, pressDuration + delayBeforeReturn);
    pressTimeline.to(shootButton.scale, {
        x: 1,
        y: 1,
        duration: returnDuration,
        ease: 'power2.out'
    }, pressDuration + delayBeforeReturn);
}

function onShootButtonPressed() {
    shootButtonPressState.isPressed = true;
    shootButtonPressState.cooldown = shootButtonPressState.cooldownDuration;
    animateShootButtonPress();
    if (deps.orbitState.mode === 'orbit') {
        deps.spawnComet();
    }
}

function onMenuButtonPressed() {
    menuButtonPressState.isPressed = true;
    menuButtonPressState.cooldown = menuButtonPressState.cooldownDuration;
    animateMenuButtonPress();
    deps.setMode(deps.orbitState.mode === 'edit' ? 'orbit' : 'edit');
}

const UI_HIDE_SCALE_THRESHOLD = 2.25;
const UI_SHOW_SCALE_THRESHOLD = 2.05;
const UI_VISIBILITY_ANIM_DURATION = 0.35;
const UI_VISIBILITY_MIN_SCALE = 0.0001;

const uiScaleVisibilityState = {
    hidden: false
};

function setUIScaleHidden(hidden, immediate = false) {
    uiScaleVisibilityState.hidden = hidden;

    const targetScale = hidden ? UI_VISIBILITY_MIN_SCALE : 1;
    const ease = hidden ? 'power2.inOut' : 'power2.out';
    const visibilityRoots = [headerPlaneRoot, menuButtonRoot];

    visibilityRoots.forEach((root) => {
        gsap.killTweensOf(root.scale);

        if (!hidden) {
            root.visible = true;
        }

        if (immediate) {
            root.scale.setScalar(targetScale);
            root.visible = !hidden;
            return;
        }

        gsap.to(root.scale, {
            x: targetScale,
            y: targetScale,
            z: targetScale,
            duration: UI_VISIBILITY_ANIM_DURATION,
            ease,
            onComplete: () => {
                if (uiScaleVisibilityState.hidden === hidden && hidden) {
                    root.visible = false;
                }
            }
        });
    });
}

function updateUIScaleVisibility() {
    const containerScale = containerGroup.scale.x;

    if (!uiScaleVisibilityState.hidden && containerScale >= UI_HIDE_SCALE_THRESHOLD) {
        setUIScaleHidden(true);
    } else if (uiScaleVisibilityState.hidden && containerScale <= UI_SHOW_SCALE_THRESHOLD) {
        setUIScaleHidden(false);
    }
}

setUIScaleHidden(containerGroup.scale.x >= UI_HIDE_SCALE_THRESHOLD, true);

const _menuButtonCameraWorldPos = new THREE.Vector3();
const _menuButtonCameraLocalPos = new THREE.Vector3();
const _menuButtonContainerWorldScale = new THREE.Vector3();

function updateMenuButton() {
    const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
    activeCamera.getWorldPosition(_menuButtonCameraWorldPos);
    _menuButtonCameraLocalPos.copy(_menuButtonCameraWorldPos);
    containerGroup.worldToLocal(_menuButtonCameraLocalPos);

    const dx = _menuButtonCameraLocalPos.x;
    const dz = _menuButtonCameraLocalPos.z;
    const horizLenSq = dx * dx + dz * dz;
    const yaw = horizLenSq > 1e-8 ? Math.atan2(dx, dz) : 0;

    menuButtonRoot.position.set(
        Math.sin(yaw) * MENU_ORBIT_RADIUS,
        MENU_BUTTON_LOCAL_Y,
        Math.cos(yaw) * MENU_ORBIT_RADIUS
    );
    menuButtonRoot.rotation.set(0, yaw, 0);

    containerGroup.getWorldScale(_menuButtonContainerWorldScale);
    menuButtonRoot.scale.set(
        _menuButtonContainerWorldScale.x > 1e-8 ? 1 / _menuButtonContainerWorldScale.x : 1,
        _menuButtonContainerWorldScale.y > 1e-8 ? 1 / _menuButtonContainerWorldScale.y : 1,
        _menuButtonContainerWorldScale.z > 1e-8 ? 1 / _menuButtonContainerWorldScale.z : 1
    );
}

const _menuButtonFingerLocal = new THREE.Vector3();

function isFingerOverMenuButton(fingerWorldPos) {
    menuButton.worldToLocal(_menuButtonFingerLocal.copy(fingerWorldPos));
    return (
        Math.abs(_menuButtonFingerLocal.x) <= MENU_BUTTON_HALF_W + MENU_BUTTON_PRESS_PAD &&
        Math.abs(_menuButtonFingerLocal.y) <= MENU_BUTTON_HALF_H + MENU_BUTTON_PRESS_PAD &&
        Math.abs(_menuButtonFingerLocal.z) <= menuButtonPressState.pressDepth
    );
}

function checkMenuButtonPress() {
    if (!renderer.xr.isPresenting || !menuButtonPressState.xrReady) {
        return;
    }

    if (menuButtonPressState.cooldown > 0) {
        menuButtonPressState.cooldown = Math.max(0, menuButtonPressState.cooldown - deps.delta);
        return;
    }

    if (!menuButton.visible || !menuButtonRoot.visible) {
        return;
    }

    if (deps.isAnyPlanetDragging() || deps.twoHandedManip.isActive) {
        return;
    }

    if (isFingerOverMenuButton(deps.lIndexObj.position)) {
        onMenuButtonPressed();
        return;
    }

    if (isFingerOverMenuButton(deps.rIndexObj.position)) {
        onMenuButtonPressed();
    }
}

const _shootButtonWorldPos = new THREE.Vector3();

function checkShootButtonPress() {
    if (!renderer.xr.isPresenting || !shootButtonPressState.xrReady) {
        return;
    }

    if (shootButtonPressState.cooldown > 0) {
        shootButtonPressState.cooldown = Math.max(0, shootButtonPressState.cooldown - deps.delta);
        return;
    }

    if (!shootButtonRoot.visible || !menuButtonRoot.visible) {
        return;
    }

    if (deps.isAnyPlanetDragging() || deps.twoHandedManip.isActive) {
        return;
    }

    shootButton.getWorldPosition(_shootButtonWorldPos);

    const leftDistance = deps.lIndexObj.position.distanceTo(_shootButtonWorldPos);
    if (leftDistance < shootButtonPressState.pressDistance) {
        onShootButtonPressed();
        return;
    }

    const rightDistance = deps.rIndexObj.position.distanceTo(_shootButtonWorldPos);
    if (rightDistance < shootButtonPressState.pressDistance) {
        onShootButtonPressed();
    }
}

const _headerSwitchWorldPos = new THREE.Vector3();
const _forceCheckboxWorldPos = new THREE.Vector3();

function checkHeaderSwitchPress() {
    if (!renderer.xr.isPresenting || !headerSwitchPressState.xrReady) {
        return;
    }

    if (headerSwitchPressState.cooldown > 0) {
        headerSwitchPressState.cooldown = Math.max(0, headerSwitchPressState.cooldown - deps.delta);
        return;
    }

    if (!headerSwitch.visible || !headerPlane.visible || !headerPlaneRoot.visible) {
        return;
    }

    if (deps.isAnyPlanetDragging() || deps.twoHandedManip.isActive) {
        return;
    }

    headerSwitch.getWorldPosition(_headerSwitchWorldPos);

    const leftDistance = deps.lIndexObj.position.distanceTo(_headerSwitchWorldPos);
    if (leftDistance < headerSwitchPressState.pressDistance) {
        onHeaderSwitchPressed();
        return;
    }

    const rightDistance = deps.rIndexObj.position.distanceTo(_headerSwitchWorldPos);
    if (rightDistance < headerSwitchPressState.pressDistance) {
        onHeaderSwitchPressed();
    }
}

function checkForceCheckboxPress() {
    if (!renderer.xr.isPresenting || !forceCheckboxPressState.xrReady) {
        return;
    }

    if (forceCheckboxPressState.cooldown > 0) {
        forceCheckboxPressState.cooldown = Math.max(0, forceCheckboxPressState.cooldown - deps.delta);
        return;
    }

    if (!forceCheckbox.visible || !headerPlane.visible || !headerPlaneRoot.visible) {
        return;
    }

    if (deps.isAnyPlanetDragging() || deps.twoHandedManip.isActive) {
        return;
    }

    forceCheckbox.getWorldPosition(_forceCheckboxWorldPos);

    const leftDistance = deps.lIndexObj.position.distanceTo(_forceCheckboxWorldPos);
    if (leftDistance < forceCheckboxPressState.pressDistance) {
        onForceCheckboxPressed();
        return;
    }

    const rightDistance = deps.rIndexObj.position.distanceTo(_forceCheckboxWorldPos);
    if (rightDistance < forceCheckboxPressState.pressDistance) {
        onForceCheckboxPressed();
    }
}

renderer.xr.addEventListener('sessionstart', () => {
    deps.syncRendererPixelRatio();
    menuButtonPressState.xrReady = false;
    menuButtonPressState.cooldown = 0;
    menuButtonPressState.isPressed = false;
    resetMenuButtonPressVisualState();

    shootButtonPressState.xrReady = false;
    shootButtonPressState.cooldown = 0;
    shootButtonPressState.isPressed = false;
    resetShootButtonPressVisualState();

    if (menuButtonXRReadyTimeoutId !== null) {
        window.clearTimeout(menuButtonXRReadyTimeoutId);
    }

    menuButtonXRReadyTimeoutId = window.setTimeout(() => {
        menuButtonPressState.xrReady = true;
        shootButtonPressState.xrReady = true;
        menuButtonXRReadyTimeoutId = null;
    }, menuButtonPressState.xrStartupDelay * 1000);

    headerSwitchPressState.xrReady = false;
    headerSwitchPressState.cooldown = 0;
    headerSwitchPressState.isPressed = false;
    resetHeaderSwitchPressVisualState();

    forceCheckboxPressState.xrReady = false;
    forceCheckboxPressState.cooldown = 0;
    forceCheckboxPressState.isPressed = false;
    resetForceCheckboxPressVisualState();

    if (headerSwitchXRReadyTimeoutId !== null) {
        window.clearTimeout(headerSwitchXRReadyTimeoutId);
    }

    headerSwitchXRReadyTimeoutId = window.setTimeout(() => {
        headerSwitchPressState.xrReady = true;
        forceCheckboxPressState.xrReady = true;
        headerSwitchXRReadyTimeoutId = null;
    }, headerSwitchPressState.xrStartupDelay * 1000);

    revealGrabPlanetsHint();
});

renderer.xr.addEventListener('sessionend', () => {
    deps.syncRendererPixelRatio();
    if (menuButtonXRReadyTimeoutId !== null) {
        window.clearTimeout(menuButtonXRReadyTimeoutId);
        menuButtonXRReadyTimeoutId = null;
    }

    menuButtonPressState.xrReady = false;
    menuButtonPressState.cooldown = 0;
    menuButtonPressState.isPressed = false;
    resetMenuButtonPressVisualState();

    shootButtonPressState.xrReady = false;
    shootButtonPressState.cooldown = 0;
    shootButtonPressState.isPressed = false;
    resetShootButtonPressVisualState();

    if (headerSwitchXRReadyTimeoutId !== null) {
        window.clearTimeout(headerSwitchXRReadyTimeoutId);
        headerSwitchXRReadyTimeoutId = null;
    }

    headerSwitchPressState.xrReady = false;
    headerSwitchPressState.cooldown = 0;
    headerSwitchPressState.isPressed = false;
    resetHeaderSwitchPressVisualState();

    forceCheckboxPressState.xrReady = false;
    forceCheckboxPressState.cooldown = 0;
    forceCheckboxPressState.isPressed = false;
    resetForceCheckboxPressVisualState();
});

function syncGridOpacityWithForceField() {
    const dimmed = deps.fieldArrowState.visible;
    if (dimmed) {
        deps.gridMat.opacity = deps.GRID_OPACITY_WITH_FORCE_FIELD;
        deps.gridBorderMaterial.opacity = deps.GRID_OPACITY_WITH_FORCE_FIELD;
        deps.gravityContourMat.opacity = deps.GRID_OPACITY_WITH_FORCE_FIELD;
    } else {
        deps.gridMat.opacity = 1;
        deps.gridBorderMaterial.opacity = 1;
        deps.gravityContourMat.opacity = deps.GRAVITY_CONTOUR_OPACITY;
    }
}

function syncForceCheckboxInnerVisual() {
    forceCheckboxInner.visible = deps.fieldArrowState.visible;
}

function applyForceFieldFromState() {
    deps.fieldArrows.visible = deps.fieldArrowState.visible;
    syncGridOpacityWithForceField();
    syncForceCheckboxInnerVisual();
    if (deps.fieldArrowState.visible) {
        deps.updateFieldArrowsIfNeeded({ force: true });
    }
}

function onForceCheckboxPressed() {
    forceCheckboxPressState.isPressed = true;
    forceCheckboxPressState.cooldown = forceCheckboxPressState.cooldownDuration;
    animateForceCheckboxPress();
    deps.fieldArrowState.visible = !deps.fieldArrowState.visible;
    applyForceFieldFromState();
}

const forceCheckboxRaycaster = new THREE.Raycaster();
const forceCheckboxPointerNdc = new THREE.Vector2();

renderer.domElement.addEventListener('click', (event) => {
    if (renderer.xr.isPresenting) {
        return;
    }
    const rect = renderer.domElement.getBoundingClientRect();
    forceCheckboxPointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    forceCheckboxPointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    forceCheckboxRaycaster.setFromCamera(forceCheckboxPointerNdc, camera);
    const hits = forceCheckboxRaycaster.intersectObject(forceCheckbox, false);
    if (hits.length > 0) {
        onForceCheckboxPressed();
    }
});


    const api = {
        headerPlaneRoot,
        headerPlane,
        headerSwitch,
        headerSwitchActive,
        forceCheckbox,
        forceCheckboxInner,
        menuButtonRoot,
        menuButton,
        menuButtonActive,
        shootButton,
        shootButtonRoot,
        menuButtonPressState,
        shootButtonPressState,
        headerSwitchPressState,
        forceCheckboxPressState,
        updateHeaderPlane,
        updateMenuButton,
        checkMenuButtonPress,
        checkShootButtonPress,
        checkHeaderSwitchPress,
        checkForceCheckboxPress,
        updateUIScaleVisibility,
        setUIScaleHidden,
        updateMenuButtonActivePosition,
        updateMenuButtonLabelMaterials,
        revealGrabPlanetsHint,
        dismissGrabPlanetsHint,
        animateShootButtonOrbitVisibility,
        onMenuButtonPressed,
        onShootButtonPressed,
        onHeaderSwitchPressed,
        onForceCheckboxPressed,
        applyForceFieldFromState,
        syncGridOpacityWithForceField,
        syncForceCheckboxInnerVisual,
        updateHeaderSwitchActivePosition,
        GRID_HALF,
        MENU_ORBIT_RADIUS,
        MENU_BUTTON_LOCAL_Y
    };
    Object.assign(deps, api);
    return api;
}
