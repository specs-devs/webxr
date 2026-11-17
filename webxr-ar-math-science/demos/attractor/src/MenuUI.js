import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import gsap from 'gsap';

export function createMenuUI(deps) {
    const { scene, camera, renderer } = deps;
const _viewCameraPos = new THREE.Vector3();
const _containerWorldQuat = new THREE.Quaternion();

const navButtonState = {
    cooldown: 0,
    cooldownDuration: 0.5,
    pressSlopXY: 0.012,
    pressSlopZ: 0.05,
    presentingAt: null,
    xrStartupDelay: 0.3,
};

renderer.xr.addEventListener('sessionstart', () => {
    navButtonState.presentingAt = null;
});
renderer.xr.addEventListener('sessionend', () => {
    navButtonState.presentingAt = null;
    navButtonState.cooldown = 0;
});


const TEMP_REF_UI_PLANE_ASPECT = 540 / 84;
const TEMP_REF_MENU_PANEL_DESIGN_W = 540;
const TEMP_REF_MENU_PANEL_DESIGN_H = 84;
const TEMP_REF_UI_ROW_PANEL_DESIGN_W = 293;
const TEMP_REF_UI_ROW_PANEL_DESIGN_H = 52;
const TEMP_REF_UI_ROW_PANEL_SCALE = 1.2;
const tempRefUiPlaneHeight = 0.038;
const tempRefUiPlaneTiltUpDeg = 20; // pitch up after yaw
/** Freeze UI ref tracking while a fingertip is this close to the UI plane (meters). */
const TEMP_REF_FINGER_PROXIMITY_ENTER_M = 0.10;
const TEMP_REF_FINGER_PROXIMITY_EXIT_M = 0.13;

/** Always-on-top UI: no depth test, no frustum culling. */

function configureTempRefUiOverlayStack() {
    deps.tempRefGroundCenterSphere.frustumCulled = false;
    deps.tempRefTowardUserSphere.frustumCulled = false;
    uiRowPanelLabelGroup.frustumCulled = false;
    uiRowPanelListGroup.frustumCulled = false;
    deps.applyOverlayRenderSettings(deps.tempRefContainerRightSpherePlane, deps.TEMP_REF_UI_RENDER_ORDER.plane);
    deps.applyOverlayRenderSettings(tempRefUiPlane, deps.TEMP_REF_UI_RENDER_ORDER.plane);
    deps.applyOverlayRenderSettings(tempRefUiRowPanel, deps.TEMP_REF_UI_RENDER_ORDER.panel);
    deps.applyOverlayRenderSettings(previousButton, deps.TEMP_REF_UI_RENDER_ORDER.button);
    deps.applyOverlayRenderSettings(nextButton, deps.TEMP_REF_UI_RENDER_ORDER.button);
    if (uiRowPanelLabelMesh) {
        deps.applyOverlayRenderSettings(uiRowPanelLabelMesh, deps.TEMP_REF_UI_RENDER_ORDER.label);
    }
    for (const entry of uiRowPanelListEntries) {
        applyUiRowPanelListEntryOverlaySettings(entry);
    }
}

const tempRefUiPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(
        tempRefUiPlaneHeight * TEMP_REF_UI_PLANE_ASPECT,
        tempRefUiPlaneHeight
    ),
    new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthTest: false,
        depthWrite: false,
    })
);
deps.tempRefTowardUserSphere.add(tempRefUiPlane);

// Drop Down Button (center stepper pill) — SDF rounded rect + white stroke; vertical stretch via uniform (not distorted corners)
/** Pill caps on left/right: radius = half of design height (52 → 26px). */
const TEMP_REF_UI_ROW_PANEL_STROKE_WIDTH_DESIGN = 3.5;
const tempRefUiRowPanelWidth =
    tempRefUiPlaneHeight * (TEMP_REF_UI_ROW_PANEL_DESIGN_W / TEMP_REF_MENU_PANEL_DESIGN_H) * TEMP_REF_UI_ROW_PANEL_SCALE;
const tempRefUiRowPanelHeight =
    tempRefUiPlaneHeight * (TEMP_REF_UI_ROW_PANEL_DESIGN_H / TEMP_REF_MENU_PANEL_DESIGN_H) * TEMP_REF_UI_ROW_PANEL_SCALE;
const tempRefUiRowPanelHalfSize = new THREE.Vector2(
    tempRefUiRowPanelWidth * 0.5,
    tempRefUiRowPanelHeight * 0.5
);
const tempRefUiRowPanelCornerRadius = tempRefUiRowPanelHeight * 0.5;
const tempRefUiRowPanelStrokeWidth =
    tempRefUiRowPanelHeight * (TEMP_REF_UI_ROW_PANEL_STROKE_WIDTH_DESIGN / TEMP_REF_UI_ROW_PANEL_DESIGN_H);

const tempRefUiRowPanelVertexShader = /* glsl */`
varying vec2 vPanelPos;
void main() {
    vPanelPos = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const tempRefUiRowPanelFragmentShader = /* glsl */`
uniform vec2 uHalfSize;
uniform float uRadius;
uniform float uStrokeWidth;
uniform vec3 uStrokeColor;

varying vec2 vPanelPos;

float sdRoundBox(vec2 p, vec2 halfSize, float radius) {
    vec2 q = abs(p) - halfSize + radius;
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
}

void main() {
    vec2 p = vPanelPos * uHalfSize;
    float d = sdRoundBox(p, uHalfSize, uRadius);
    float aa = fwidth(d) * 1.5;
    // Inside stroke (d < 0): outer edge at d = 0, inner edge at d = -uStrokeWidth
    float outerEdge = smoothstep(0.0, aa, -d);
    float innerEdge = 1.0 - smoothstep(0.0, -aa, d + uStrokeWidth);
    float strokeAlpha = outerEdge * innerEdge;
    gl_FragColor = vec4(uStrokeColor, strokeAlpha);
}
`;

const tempRefUiRowPanelMaterial = new THREE.ShaderMaterial({
    uniforms: {
        uHalfSize: { value: tempRefUiRowPanelHalfSize.clone() },
        uRadius: { value: tempRefUiRowPanelCornerRadius },
        uStrokeWidth: { value: tempRefUiRowPanelStrokeWidth },
        uStrokeColor: { value: new THREE.Color(0xffffff) },
    },
    vertexShader: tempRefUiRowPanelVertexShader,
    fragmentShader: tempRefUiRowPanelFragmentShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
});

const tempRefUiRowPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    tempRefUiRowPanelMaterial
);
tempRefUiRowPanel.scale.set(tempRefUiRowPanelWidth * 0.5, tempRefUiRowPanelHeight * 0.5, 1);
tempRefUiRowPanel.position.z = 0.001;
tempRefUiRowPanel.name = 'Drop Down Button';
tempRefUiPlane.add(tempRefUiRowPanel);
/** Center stepper pill — pressable; label text updated by Prev/Next only. */
const dropDownButton = tempRefUiRowPanel;

const uiRowPanelLabelGroup = new THREE.Object3D();
tempRefUiRowPanel.add(uiRowPanelLabelGroup);

const uiRowPanelListGroup = new THREE.Object3D();
uiRowPanelListGroup.visible = false;
tempRefUiRowPanel.add(uiRowPanelListGroup);

/** One mesh per attractor — same order as deps.ATTRACTOR_KEYS / Prev–Next cycling (top → bottom). */
let uiRowPanelListEntries = [];

function syncUiRowPanelLabelGroupScale() {
    const sx = tempRefUiRowPanel.scale.x;
    const sy = tempRefUiRowPanel.scale.y;
    uiRowPanelLabelGroup.scale.set(1 / sx, 1 / sy, 1);
    syncUiRowPanelListItemTextScales();
}
syncUiRowPanelLabelGroupScale();

const UI_ROW_PANEL_LABEL_SIZE = tempRefUiRowPanelHeight * 0.42;
let uiRowPanelLabelMesh = null;

function disposeUiRowPanelLabel() {
    if (!uiRowPanelLabelMesh) return;
    uiRowPanelLabelGroup.remove(uiRowPanelLabelMesh);
    uiRowPanelLabelMesh.geometry.dispose();
    uiRowPanelLabelMesh.material.dispose();
    uiRowPanelLabelMesh = null;
}

function buildUiRowPanelLabel(font) {
    disposeUiRowPanelLabel();
    syncUiRowPanelLabelGroupScale();

    const geometry = new TextGeometry(deps.getCurrentAttractor().label, {
        font,
        size: UI_ROW_PANEL_LABEL_SIZE,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false,
    });
    deps.centerOverlayTextGeometry(geometry, font, UI_ROW_PANEL_LABEL_SIZE);

    uiRowPanelLabelMesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 1,
            depthTest: false,
            depthWrite: false,
        })
    );
    uiRowPanelLabelMesh.position.z = 0.001;
    uiRowPanelLabelGroup.add(uiRowPanelLabelMesh);
    deps.applyOverlayRenderSettings(uiRowPanelLabelMesh, deps.TEMP_REF_UI_RENDER_ORDER.label);
    syncUiRowPanelStepperLabelVisibility();
}

/** Stepper label only visible when dropdown is closed (unless a reveal tween is running). */
function syncUiRowPanelStepperLabelVisibility() {
    if (!uiRowPanelLabelMesh) return;
    if (dropDownPanelState.isOpen) {
        uiRowPanelLabelMesh.visible = false;
        uiRowPanelLabelMesh.material.opacity = 0;
    } else {
        uiRowPanelLabelMesh.visible = true;
        uiRowPanelLabelMesh.material.opacity = 1;
    }
}

const UI_ROW_PANEL_LIST_COLOR = 0xffffff;
const UI_ROW_PANEL_LIST_ACTIVE_COLOR = 0xffff00;
/** Extra gap between measured line heights (world meters). */
const UI_ROW_PANEL_LIST_LINE_GAP = UI_ROW_PANEL_LABEL_SIZE * 1.6;

function disposeUiRowPanelList() {
    for (const entry of uiRowPanelListEntries) {
        uiRowPanelListGroup.remove(entry.root);
        entry.mesh.geometry.dispose();
        entry.mesh.material.dispose();
    }
    uiRowPanelListEntries = [];
}

function syncUiRowPanelListItemTextScales() {
    const sx = tempRefUiRowPanel.scale.x;
    const sy = tempRefUiRowPanel.scale.y;
    for (const { mesh } of uiRowPanelListEntries) {
        mesh.scale.set(1 / sx, 1 / sy, 1);
    }
}

function applyUiRowPanelListEntryOverlaySettings(entry) {
    entry.root.frustumCulled = false;
    deps.applyOverlayRenderSettings(entry.mesh, deps.TEMP_REF_UI_RENDER_ORDER.label);
}

function layoutUiRowPanelListItems() {
    const n = uiRowPanelListEntries.length;
    if (n === 0) return;
    const panelHalfHeight = tempRefUiRowPanel.scale.y;
    if (panelHalfHeight <= 0) return;

    const maxLineHeightM = uiRowPanelListEntries.reduce(
        (max, entry) => Math.max(max, entry.lineHeightM),
        UI_ROW_PANEL_LABEL_SIZE
    );
    const stepWorldM = maxLineHeightM + UI_ROW_PANEL_LIST_LINE_GAP;
    const totalSpanWorldM = stepWorldM * (n - 1);

    for (let i = 0; i < n; i++) {
        const yWorldM = totalSpanWorldM * 0.5 - stepWorldM * i;
        uiRowPanelListEntries[i].root.position.set(0, yWorldM / panelHalfHeight, 0);
    }
}

function updateUiRowPanelListHighlight() {
    for (const { key, mesh } of uiRowPanelListEntries) {
        mesh.material.color.setHex(
            key === deps.currentAttractorKey ? UI_ROW_PANEL_LIST_ACTIVE_COLOR : UI_ROW_PANEL_LIST_COLOR
        );
    }
}

function buildUiRowPanelList(font) {
    disposeUiRowPanelList();
    syncUiRowPanelLabelGroupScale();

    for (const key of deps.ATTRACTOR_KEYS) {
        const label = deps.ATTRACTOR_TYPES[key].label;
        const geometry = new TextGeometry(label, {
            font,
            size: UI_ROW_PANEL_LABEL_SIZE,
            height: 0,
            curveSegments: 8,
            bevelEnabled: false,
        });
        deps.centerOverlayTextGeometry(geometry, font, UI_ROW_PANEL_LABEL_SIZE);
        geometry.computeBoundingBox();
        const bb = geometry.boundingBox;
        const lineHeightM = bb.max.y - bb.min.y;
        const hitHalfX = (bb.max.x - bb.min.x) * 0.5;
        const hitHalfY = lineHeightM * 0.5;

        const mesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
                color: UI_ROW_PANEL_LIST_COLOR,
                transparent: true,
                opacity: 0,
                depthTest: false,
                depthWrite: false,
            })
        );
        mesh.name = `Attractor List Item: ${label}`;
        mesh.position.z = 0.001;

        const root = new THREE.Object3D();
        root.add(mesh);
        uiRowPanelListGroup.add(root);
        uiRowPanelListEntries.push({ key, mesh, root, lineHeightM, hitHalfX, hitHalfY });
    }

    syncUiRowPanelListItemTextScales();
    layoutUiRowPanelListItems();
    updateUiRowPanelListHighlight();
    for (const entry of uiRowPanelListEntries) {
        applyUiRowPanelListEntryOverlaySettings(entry);
    }
}

const DROP_DOWN_TEXT_FADE_DURATION = 0.2;

function killDropDownStepperFadeTweens() {
    if (uiRowPanelLabelMesh) gsap.killTweensOf(uiRowPanelLabelMesh.material);
}

function killDropDownListFadeTweens() {
    for (const { mesh } of uiRowPanelListEntries) {
        gsap.killTweensOf(mesh.material);
    }
}

function killDropDownTextFadeTweens() {
    killDropDownStepperFadeTweens();
    killDropDownListFadeTweens();
}

function applyDropDownListPresentationInstant() {
    killDropDownTextFadeTweens();
    const open = dropDownPanelState.isOpen;
    syncUiRowPanelStepperLabelVisibility();
    uiRowPanelListGroup.visible = open;
    for (const { mesh } of uiRowPanelListEntries) {
        mesh.material.opacity = open ? 1 : 0;
    }
    if (open) {
        layoutUiRowPanelListItems();
        updateUiRowPanelListHighlight();
    }
}

function animateDropDownListReveal() {
    killDropDownTextFadeTweens();
    layoutUiRowPanelListItems();
    updateUiRowPanelListHighlight();
    uiRowPanelListGroup.visible = true;
    for (const { mesh } of uiRowPanelListEntries) {
        mesh.material.opacity = 0;
    }
    if (uiRowPanelLabelMesh) {
        uiRowPanelLabelMesh.visible = true;
        uiRowPanelLabelMesh.material.opacity = 1;
    }

    const tl = gsap.timeline();
    if (uiRowPanelLabelMesh) {
        tl.to(
            uiRowPanelLabelMesh.material,
            { opacity: 0, duration: DROP_DOWN_TEXT_FADE_DURATION, ease: 'power2.out' },
            0
        );
        tl.call(() => {
            uiRowPanelLabelMesh.visible = false;
            uiRowPanelLabelMesh.material.opacity = 1;
        });
    }
    const listMaterials = uiRowPanelListEntries.map((entry) => entry.mesh.material);
    if (listMaterials.length > 0) {
        tl.to(
            listMaterials,
            { opacity: 1, duration: DROP_DOWN_TEXT_FADE_DURATION, ease: 'power2.out' },
            0
        );
    }
}

function animateDropDownListConceal() {
    killDropDownListFadeTweens();
    const tl = gsap.timeline();
    const listMaterials = uiRowPanelListEntries.map((entry) => entry.mesh.material);
    if (listMaterials.length > 0) {
        tl.to(
            listMaterials,
            { opacity: 0, duration: DROP_DOWN_TEXT_FADE_DURATION, ease: 'power2.out' },
            0
        );
    }
    tl.call(() => {
        uiRowPanelListGroup.visible = false;
        for (const { mesh } of uiRowPanelListEntries) {
            mesh.material.opacity = 0;
        }
    });
    return tl;
}

function animateDropDownStepperLabelReveal() {
    if (!uiRowPanelLabelMesh) return;
    killDropDownStepperFadeTweens();
    uiRowPanelLabelMesh.visible = true;
    uiRowPanelLabelMesh.material.opacity = 0;
    gsap.to(uiRowPanelLabelMesh.material, {
        opacity: 1,
        duration: DROP_DOWN_TEXT_FADE_DURATION,
        ease: 'power2.out',
    });
}

function syncDropDownListPresentation() {
    applyDropDownListPresentationInstant();
}


const UI_NAV_BUTTON_GAP_DESIGN = 16; // gap between row panel and button; lower = closer to panel
const uiNavButtonSize = tempRefUiRowPanelHeight; // square — same height as center row panel
const uiNavButtonGap =
    tempRefUiPlaneHeight * (UI_NAV_BUTTON_GAP_DESIGN / TEMP_REF_MENU_PANEL_DESIGN_H);
/** Move left: decrease x (more negative). Move right: increase x. */
const UI_PREVIOUS_BUTTON_X =
    -(tempRefUiRowPanelWidth * 0.5 + uiNavButtonSize * 0.5 + uiNavButtonGap);
const UI_NEXT_BUTTON_X =
    tempRefUiRowPanelWidth * 0.5 + uiNavButtonSize * 0.5 + uiNavButtonGap;
const previousButton = new THREE.Mesh(
    new THREE.PlaneGeometry(uiNavButtonSize, uiNavButtonSize),
    new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 1,
        side: THREE.FrontSide,
        depthTest: false,
        depthWrite: false,
    })
);
const assetBase = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
new THREE.TextureLoader().load(`${assetBase}static/ui-button-prev.png`, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    previousButton.material.map = texture;
    previousButton.material.needsUpdate = true;
});
previousButton.name = 'Previous Button';
previousButton.position.set(UI_PREVIOUS_BUTTON_X, 0, 0.001);
tempRefUiPlane.add(previousButton);

const nextButton = new THREE.Mesh(
    new THREE.PlaneGeometry(uiNavButtonSize, uiNavButtonSize),
    new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 1,
        side: THREE.FrontSide,
        depthTest: false,
        depthWrite: false,
    })
);
new THREE.TextureLoader().load(`${assetBase}static/ui-button-next.png`, (texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    nextButton.material.map = texture;
    nextButton.material.needsUpdate = true;
});
nextButton.name = 'Next Button';
nextButton.position.set(UI_NEXT_BUTTON_X, 0, 0.001);
tempRefUiPlane.add(nextButton);
configureTempRefUiOverlayStack();

const _navIndexTipWorld = new THREE.Vector3();
const _navTipInButtonLocal = new THREE.Vector3();
const navButtonHalfExtent = uiNavButtonSize * 0.5;

const NAV_BUTTON_PRESS_SCALE_UP = 1.3;

function animateNavButtonPress(buttonMesh, scaleUp = NAV_BUTTON_PRESS_SCALE_UP, onComplete) {
    gsap.killTweensOf(buttonMesh.position);
    gsap.killTweensOf(buttonMesh.scale);

    const originalZ = buttonMesh.position.z;
    const originalScaleX = buttonMesh.scale.x;
    const originalScaleY = buttonMesh.scale.y;
    const pressDepth = -0.02;
    const pressDuration = 0.15;
    const returnDuration = 0.15;
    const delayBeforeReturn = 0.075;

    const tl = gsap.timeline(onComplete ? { onComplete } : undefined);
    tl.to(buttonMesh.position, { z: originalZ + pressDepth, duration: pressDuration, ease: 'power2.out' }, 0);
    tl.to(
        buttonMesh.scale,
        { x: originalScaleX * scaleUp, y: originalScaleY * scaleUp, duration: pressDuration, ease: 'power2.out' },
        0
    );
    tl.to(buttonMesh.position, { z: originalZ, duration: returnDuration, ease: 'power2.out' }, pressDuration + delayBeforeReturn);
    tl.to(
        buttonMesh.scale,
        { x: originalScaleX, y: originalScaleY, duration: returnDuration, ease: 'power2.out' },
        pressDuration + delayBeforeReturn
    );
    return tl;
}

function isNavButtonPressReady() {
    if (!renderer.xr.isPresenting) {
        navButtonState.presentingAt = null;
        return false;
    }
    if (navButtonState.presentingAt === null) {
        navButtonState.presentingAt = performance.now();
    }
    return performance.now() - navButtonState.presentingAt >= navButtonState.xrStartupDelay * 1000;
}

function isIndexTipNearButtonMesh(buttonMesh, halfX, halfY) {
    buttonMesh.updateWorldMatrix(true, false);
    const slopXY = navButtonState.pressSlopXY;
    const slopZ = navButtonState.pressSlopZ;

    const hands = [
        { hand: deps.hand1, pinching: deps.pinchTracker.left.pinching },
        { hand: deps.hand2, pinching: deps.pinchTracker.right.pinching },
    ];
    for (const { hand, pinching } of hands) {
        if (!hand?.joints || pinching) continue;
        const tip = hand.joints['index-finger-tip'];
        if (!tip) continue;
        tip.getWorldPosition(_navIndexTipWorld);
        _navTipInButtonLocal.copy(_navIndexTipWorld);
        buttonMesh.worldToLocal(_navTipInButtonLocal);

        if (
            Math.abs(_navTipInButtonLocal.x) <= halfX + slopXY &&
            Math.abs(_navTipInButtonLocal.y) <= halfY + slopXY &&
            Math.abs(_navTipInButtonLocal.z) <= slopZ
        ) {
            return true;
        }
    }
    return false;
}

function isIndexTipNearNavButton(buttonMesh) {
    return isIndexTipNearButtonMesh(buttonMesh, navButtonHalfExtent, navButtonHalfExtent);
}

/** PlaneGeometry(2, 2) — local bounds are ±1; world scale is already in the world matrix. */
const DROP_DOWN_BUTTON_LOCAL_HALF = 1;

function isIndexTipNearDropDownButton() {
    return isIndexTipNearButtonMesh(dropDownButton, DROP_DOWN_BUTTON_LOCAL_HALF, DROP_DOWN_BUTTON_LOCAL_HALF);
}

const UI_ROW_PANEL_LIST_HIT_PAD = 1.25;

function isIndexTipNearDropDownListItem(entry) {
    if (entry.mesh.material.opacity < 0.3) return false;
    return isIndexTipNearButtonMesh(
        entry.mesh,
        entry.hitHalfX * UI_ROW_PANEL_LIST_HIT_PAD,
        entry.hitHalfY * UI_ROW_PANEL_LIST_HIT_PAD
    );
}

function onDropDownListItemPressed(entry) {
    navButtonState.cooldown = navButtonState.cooldownDuration;
    if (entry.key !== deps.currentAttractorKey) {
        deps.setAttractorKey(entry.key);
    }
    animateNavButtonPress(entry.mesh, NAV_BUTTON_PRESS_SCALE_UP, () => closeDropDownPanel({ skipZPress: true }));
}

function checkDropDownListItemPress() {
    if (!dropDownPanelState.isOpen || !uiRowPanelListGroup.visible) return false;

    for (const entry of uiRowPanelListEntries) {
        if (isIndexTipNearDropDownListItem(entry)) {
            onDropDownListItemPressed(entry);
            return true;
        }
    }
    return false;
}

function onNavButtonPressed(buttonMesh) {
    navButtonState.cooldown = navButtonState.cooldownDuration;
    animateNavButtonPress(buttonMesh);
    if (dropDownPanelState.isOpen) {
        closeDropDownPanel();
    }
    if (buttonMesh === previousButton) {
        deps.cycleAttractorPrev();
    } else if (buttonMesh === nextButton) {
        deps.cycleAttractorNext();
    }
}

const DROP_DOWN_PANEL_STRETCH_CLOSED = 1;
const DROP_DOWN_PANEL_STRETCH_OPEN = 9.2;
const DROP_DOWN_PANEL_STRETCH_DURATION = 0.25;
/** Start list fade-in this many seconds before the stretch tween ends (open only). */
const DROP_DOWN_LIST_REVEAL_LEAD_TIME = 0.1;
/** Delay before list fade-out begins when closing. */
const DROP_DOWN_LIST_CONCEAL_DELAY = 0.08;
/** Start stepper fade-in this many seconds before the stretch tween ends (close only). */
const DROP_DOWN_STEPPER_REVEAL_LEAD_TIME = 0.12;

const dropDownPanelState = {
    isOpen: false,
    verticalStretch: DROP_DOWN_PANEL_STRETCH_CLOSED,
};

function openDropDownPanel() {
    if (dropDownPanelState.isOpen) return;
    dropDownPanelState.isOpen = true;

    killDropDownTextFadeTweens();
    uiRowPanelListGroup.visible = false;
    for (const { mesh } of uiRowPanelListEntries) {
        mesh.material.opacity = 0;
    }
    if (uiRowPanelLabelMesh) {
        uiRowPanelLabelMesh.visible = true;
        uiRowPanelLabelMesh.material.opacity = 1;
    }

    animateDropDownButtonPressWithStretch(DROP_DOWN_PANEL_STRETCH_OPEN);
}

function closeDropDownPanel({ skipZPress = false } = {}) {
    if (!dropDownPanelState.isOpen) return;
    dropDownPanelState.isOpen = false;

    killDropDownTextFadeTweens();
    if (uiRowPanelLabelMesh) {
        uiRowPanelLabelMesh.visible = false;
        uiRowPanelLabelMesh.material.opacity = 0;
    }
    gsap.delayedCall(DROP_DOWN_LIST_CONCEAL_DELAY, () => {
        if (!dropDownPanelState.isOpen) {
            animateDropDownListConceal();
        }
    });

    animateDropDownButtonPressWithStretch(DROP_DOWN_PANEL_STRETCH_CLOSED, { skipZPress });
}

function onDropDownButtonPressed() {
    navButtonState.cooldown = navButtonState.cooldownDuration;
    if (dropDownPanelState.isOpen) {
        closeDropDownPanel();
    } else {
        openDropDownPanel();
    }
}

function isTwoHandedPinchBlockingNavButtons() {
    return deps.pinchTracker.left.pinching && deps.pinchTracker.right.pinching;
}

function checkNavButtonsPress() {
    if (!isNavButtonPressReady()) return;
    if (isTwoHandedPinchBlockingNavButtons()) return;
    if (navButtonState.cooldown > 0) {
        navButtonState.cooldown -= deps.delta;
        return;
    }
    if (!tempRefUiPlane.visible) return;

    if (isIndexTipNearNavButton(previousButton)) {
        onNavButtonPressed(previousButton);
        return;
    }
    if (isIndexTipNearNavButton(nextButton)) {
        onNavButtonPressed(nextButton);
        return;
    }
    if (checkDropDownListItemPress()) return;
    if (isIndexTipNearDropDownButton()) {
        onDropDownButtonPressed();
    }
}

/** Row panel vertical stretch — also wired to Drop Down Button open/close. */
const tempRefUiRowPanelGuiState = { verticalStretch: DROP_DOWN_PANEL_STRETCH_CLOSED };

function getDropDownPanelHalfHeightForStretch(stretchY) {
    return tempRefUiRowPanelHeight * 0.5 * stretchY;
}

/** Vertical stretch factor (1 = design height). Updates half-height + mesh scale; corner radius stays constant. */
function setTempRefUiRowPanelVerticalStretch(stretchY) {
    const halfH = getDropDownPanelHalfHeightForStretch(stretchY);
    tempRefUiRowPanelMaterial.uniforms.uHalfSize.value.y = halfH;
    tempRefUiRowPanel.scale.y = halfH;
    syncUiRowPanelLabelGroupScale();
    dropDownPanelState.verticalStretch = stretchY;
    tempRefUiRowPanelGuiState.verticalStretch = stretchY;
    if (dropDownPanelState.isOpen && uiRowPanelListGroup.visible && uiRowPanelListEntries.length > 0) {
        layoutUiRowPanelListItems();
    }
}

function animateDropDownPanelVerticalStretch(targetStretch) {
    gsap.killTweensOf(dropDownPanelState);
    gsap.to(dropDownPanelState, {
        verticalStretch: targetStretch,
        duration: DROP_DOWN_PANEL_STRETCH_DURATION,
        ease: 'power2.inOut',
        onUpdate: () => setTempRefUiRowPanelVerticalStretch(dropDownPanelState.verticalStretch),
    });
}

/** Z press in → vertical stretch → Z release (optional skipZPress for list-item close). */
function animateDropDownButtonPressWithStretch(targetStretch, { skipZPress = false } = {}) {
    gsap.killTweensOf(dropDownButton.position);
    gsap.killTweensOf(dropDownPanelState);

    const mesh = dropDownButton;
    const opening = dropDownPanelState.isOpen;
    const originalZ = mesh.position.z;
    const pressDepth = -0.02;
    const pressDuration = 0.15;
    const returnDuration = 0.15;

    const tl = gsap.timeline();

    let stretchStart = 0;
    if (!skipZPress) {
        tl.to(mesh.position, { z: originalZ + pressDepth, duration: pressDuration, ease: 'power2.out' });
        stretchStart = pressDuration;
    }

    tl.to(
        dropDownPanelState,
        {
            verticalStretch: targetStretch,
            duration: DROP_DOWN_PANEL_STRETCH_DURATION,
            ease: 'power2.inOut',
            onUpdate: () => setTempRefUiRowPanelVerticalStretch(dropDownPanelState.verticalStretch),
        },
        stretchStart
    );

    if (opening) {
        const listRevealStart = stretchStart + DROP_DOWN_PANEL_STRETCH_DURATION - DROP_DOWN_LIST_REVEAL_LEAD_TIME;
        tl.call(() => animateDropDownListReveal(), null, listRevealStart);
    } else {
        const stepperRevealStart = skipZPress
            ? stretchStart + DROP_DOWN_PANEL_STRETCH_DURATION
            : stretchStart + DROP_DOWN_PANEL_STRETCH_DURATION - DROP_DOWN_STEPPER_REVEAL_LEAD_TIME;
        tl.call(() => animateDropDownStepperLabelReveal(), null, stepperRevealStart);
    }

    if (!skipZPress) {
        tl.to(mesh.position, { z: originalZ, duration: returnDuration, ease: 'power2.out' });
    }

    tl.eventCallback('onComplete', () => {
        setTempRefUiRowPanelVerticalStretch(targetStretch);
        if (!opening && uiRowPanelLabelMesh) {
            uiRowPanelLabelMesh.visible = true;
            uiRowPanelLabelMesh.material.opacity = 1;
        }
    });

    return tl;
}

const _tempRefCenterWorld = new THREE.Vector3();
const _tempRefGroundUpWorld = new THREE.Vector3();
const _tempRefTowardUserWorld = new THREE.Vector3();
const _tempRefUiPlaneWorldPos = new THREE.Vector3();
const _tempRefUiPlaneWorldQuat = new THREE.Quaternion();
const _tempRefUiPlaneParentWorldQuat = new THREE.Quaternion();
const _tempRefUiPlaneNormalWorld = new THREE.Vector3();
const _tempRefFingerTipWorld = new THREE.Vector3();
const _tempRefFingerToPlane = new THREE.Vector3();
let tempRefFrozenByFinger = false;

function getNearestIndexTipDistToTempRefUiPlane() {
    tempRefUiPlane.getWorldPosition(_tempRefUiPlaneWorldPos);
    tempRefUiPlane.getWorldQuaternion(_tempRefUiPlaneParentWorldQuat);
    _tempRefUiPlaneNormalWorld.set(0, 0, 1).applyQuaternion(_tempRefUiPlaneParentWorldQuat);

    let minDist = Infinity;
    for (const hand of [deps.hand1, deps.hand2]) {
        if (!hand?.joints) continue;
        const tip = hand.joints['index-finger-tip'];
        if (!tip) continue;
        tip.getWorldPosition(_tempRefFingerTipWorld);
        _tempRefFingerToPlane.subVectors(_tempRefFingerTipWorld, _tempRefUiPlaneWorldPos);
        const dist = Math.abs(_tempRefFingerToPlane.dot(_tempRefUiPlaneNormalWorld));
        if (dist < minDist) minDist = dist;
    }
    return minDist;
}

function shouldFreezeTempRefByFingerProximity() {
    if (deps.pinchTracker.left.pinching && deps.pinchTracker.right.pinching) {
        tempRefFrozenByFinger = false;
        return false;
    }

    const dist = getNearestIndexTipDistToTempRefUiPlane();
    if (dist === Infinity) {
        tempRefFrozenByFinger = false;
        return false;
    }
    if (tempRefFrozenByFinger) {
        if (dist > TEMP_REF_FINGER_PROXIMITY_EXIT_M) tempRefFrozenByFinger = false;
    } else if (dist < TEMP_REF_FINGER_PROXIMITY_ENTER_M) {
        tempRefFrozenByFinger = true;
    }
    return tempRefFrozenByFinger;
}

function updateTempRefTowardUserSphere() {
    deps.tempRefGroundCenterSphere.getWorldPosition(_tempRefCenterWorld);
    deps.getViewCameraWorldPosition(_viewCameraPos);

    deps.container.getWorldQuaternion(_containerWorldQuat);
    _tempRefGroundUpWorld.set(0, 1, 0).applyQuaternion(_containerWorldQuat);

    _tempRefTowardUserWorld.subVectors(_viewCameraPos, _tempRefCenterWorld);
    _tempRefTowardUserWorld.addScaledVector(
        _tempRefGroundUpWorld,
        -_tempRefTowardUserWorld.dot(_tempRefGroundUpWorld)
    );

    if (_tempRefTowardUserWorld.lengthSq() > 1e-10) {
        _tempRefTowardUserWorld.normalize().multiplyScalar(
            deps.tempRefTowardUserOffsetBase * deps.containerGroup.scale.x
        );
    } else {
        _tempRefTowardUserWorld.set(0, 0, 0);
    }

    _tempRefTowardUserWorld.add(_tempRefCenterWorld);
    deps.tempRefGroundCenterSphere.worldToLocal(_tempRefTowardUserWorld);
    deps.tempRefTowardUserSphere.position.copy(_tempRefTowardUserWorld);
}

function setObjectQuaternionLikeTempRefUiPlane(object3D, worldAnchorPos) {
    deps.getViewCameraWorldPosition(_viewCameraPos);

    const dx = _viewCameraPos.x - worldAnchorPos.x;
    const dz = _viewCameraPos.z - worldAnchorPos.z;
    if (dx * dx + dz * dz < 1e-10) return false;

    _tempRefUiPlaneWorldQuat.setFromEuler(
        new THREE.Euler(
            -THREE.MathUtils.degToRad(tempRefUiPlaneTiltUpDeg),
            Math.atan2(dx, dz),
            0,
            'YXZ'
        )
    );
    object3D.parent.getWorldQuaternion(_tempRefUiPlaneParentWorldQuat);
    _tempRefUiPlaneParentWorldQuat.invert();
    object3D.quaternion.copy(
        _tempRefUiPlaneParentWorldQuat.multiply(_tempRefUiPlaneWorldQuat)
    );
    return true;
}

/** Yaw toward camera only — world Y stays vertical (no UI pitch tilt). */
function setObjectQuaternionVerticalBillboard(object3D, worldAnchorPos) {
    deps.getViewCameraWorldPosition(_viewCameraPos);

    const dx = _viewCameraPos.x - worldAnchorPos.x;
    const dz = _viewCameraPos.z - worldAnchorPos.z;
    if (dx * dx + dz * dz < 1e-10) return false;

    _tempRefUiPlaneWorldQuat.setFromEuler(
        new THREE.Euler(0, Math.atan2(dx, dz), 0, 'YXZ')
    );
    object3D.parent.getWorldQuaternion(_tempRefUiPlaneParentWorldQuat);
    _tempRefUiPlaneParentWorldQuat.invert();
    object3D.quaternion.copy(
        _tempRefUiPlaneParentWorldQuat.multiply(_tempRefUiPlaneWorldQuat)
    );
    return true;
}

function updateTempRefUiPlaneYaw() {
    tempRefUiPlane.scale.setScalar(1 / deps.containerGroup.scale.x);
    tempRefUiPlane.getWorldPosition(_tempRefUiPlaneWorldPos);
    setObjectQuaternionLikeTempRefUiPlane(tempRefUiPlane, _tempRefUiPlaneWorldPos);
}

new FontLoader().load(deps.CONTAINER_ATTRACTOR_LABEL_FONT_URL, (font) => {
    deps.containerAttractorLabelFont = font;
    deps.buildContainerAttractorLabel(font);
    buildUiRowPanelLabel(font);
    buildUiRowPanelList(font);
    syncDropDownListPresentation();
    deps.syncBuildProgressLabel();
});


    const api = {
        navButtonState,
        tempRefUiPlane,
        tempRefUiRowPanel,
        dropDownButton,
        dropDownPanelState,
        previousButton,
        nextButton,
        closeDropDownPanel,
        checkNavButtonsPress,
        shouldFreezeTempRefByFingerProximity,
        updateTempRefTowardUserSphere,
        updateTempRefUiPlaneYaw,
        buildUiRowPanelLabel,
        buildUiRowPanelList,
        updateUiRowPanelListHighlight,
        syncDropDownListPresentation
    };
    Object.assign(deps, api);
    return api;
}
