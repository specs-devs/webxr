import * as THREE from 'three';
import gsap from 'gsap';
import { bindHeadRelativePlacementOnSessionStart } from './XRHeadPlacement.js';
import {
    loadHelvetikerBold,
    getHelvetikerBold,
    createFixedShapeTextMesh,
    updateFixedShapeTextMesh,
    createNameLabelGroup,
    updateNameLabelGroup,
    disposeNameLabelGroup,
} from './XRText.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export function createMenuUI(deps) {
    const {
        scene, camera, renderer,
        containerGroup, containerConfig,
        sceneOpticalMeshes, OPTICAL_TYPES, OPTICAL_PAGES, typeInScene,
        mirrorsAvailableCount, acquireMirrorNumber,
        spawnInitialSceneObject, addSceneInstance, removeSceneInstance,
        disposeMeshNameLabel, redrawNameLabel, disableOpticalFrustumCulling, createNameLabelFor,
        slotMeshes, slotGhostMeshes,
        STEPPER_MEDIUM_IOR_MAP, IOR_SLIDER_MIN, IOR_SLIDER_MAX, IOR_SLIDER_RANGE, formatIORValue,
        availableMirrorNumbers, MAX_MIRRORS,
        applyPointerRestPose, applyPointerShape,
        pointerMenuButtonMaterial, syncLaserLineVisibility,
        dismissRayModeHint, pointerHintState, pointerMenuState,
        pointerMenuButton, pointerMenuPanel,
        pointerMenuButtonA, pointerMenuButtonB, pointerMenuButtonC,
        pointerGrab, objectGrab,
        returnObjectToSlot, stopObjectGrab,
        returningMeshes, slotGhostMaterialTemplate, SLOT_GHOST_OPACITY,
        lIndexObj, rIndexObj, lThumbObj, rThumbObj, pinchState,
        pointerMenuButtonPressAnim,
        POINTER_MENU_BUTTON_PRESS_DIST, POINTER_MENU_PANEL_CHILD_WIDTH, POINTER_MENU_PANEL_CHILD_HEIGHT,
        POINTER_MENU_PANEL_COOLDOWN_DURATION,
        setPointerMenuActiveButton,
        openPointerMenu,
        closePointerMenu,
        SHARED_MESH_GEOMS,
        _pmButtonWorldPos, _pmChildFingerLocal,
    } = deps;
    // currentStepperMediumIOR / customStepperMediumIOR are mutated here and read back from
    // OpticalObjects.js's mesh factories — kept live on deps rather than destructured as
    // local consts (which would both go stale and throw on reassignment below).
// ==========================================
// UI MENU SYSTEM
// ==========================================

// --- 4 world-space anchors at bottom edges of the container ---
const uiEdgeOffset  = containerConfig.containerSize * 0.5;
const uiOuterOffset = 0.06;
const uiDownOffset  = 0.06;

const uiEdgeLocalPositions = [
    new THREE.Vector3(0,            -uiEdgeOffset, -uiEdgeOffset), // Front
    new THREE.Vector3(0,            -uiEdgeOffset,  uiEdgeOffset), // Back
    new THREE.Vector3(-uiEdgeOffset, -uiEdgeOffset, 0),            // Left
    new THREE.Vector3( uiEdgeOffset, -uiEdgeOffset, 0)             // Right
];

const uiEdgeOffsetDirections = [
    new THREE.Vector3(0, -1, -1).normalize(), // Front
    new THREE.Vector3(0, -1,  1).normalize(), // Back
    new THREE.Vector3(-1, -1,  0).normalize(), // Left
    new THREE.Vector3( 1, -1,  0).normalize()  // Right
];

const UIReferenceNormals = [
    new THREE.Vector3(0,  0, -1), // Front
    new THREE.Vector3(0,  0,  1), // Back
    new THREE.Vector3(-1,  0,  0), // Left
    new THREE.Vector3( 1,  0,  0)  // Right
];

const UIReferencePoint = [
    new THREE.Object3D(), // Front
    new THREE.Object3D(), // Back
    new THREE.Object3D(), // Left
    new THREE.Object3D()  // Right
];
UIReferencePoint.forEach(p => scene.add(p));

const _uiEdgeWorldPos = new THREE.Vector3();
const _uiOffsetDir    = new THREE.Vector3();

function updateUIReferencePositions() {
    const scale = containerGroup.scale.x;
    const combinedOffset = Math.sqrt(uiOuterOffset * uiOuterOffset + uiDownOffset * uiDownOffset);

    for (let i = 0; i < 4; i++) {
        _uiEdgeWorldPos.copy(uiEdgeLocalPositions[i])
            .multiplyScalar(scale)
            .applyQuaternion(containerGroup.quaternion)
            .add(containerGroup.position);

        _uiOffsetDir.copy(uiEdgeOffsetDirections[i])
            .applyQuaternion(containerGroup.quaternion);

        _uiEdgeWorldPos.addScaledVector(_uiOffsetDir, combinedOffset);

        UIReferencePoint[i].position.copy(_uiEdgeWorldPos);
        UIReferencePoint[i].quaternion.copy(containerGroup.quaternion);
    }
}
updateUIReferencePositions();

const xrHeadPlacement = bindHeadRelativePlacementOnSessionStart({
    renderer,
    camera,
    placements: [{
        object: containerGroup,
        offset: containerConfig.headOffset,
        options: { yawOnly: true },
    }],
    onPlaced: () => {
        applyPointerRestPose();
        updateUIReferencePositions();
        closePointerMenu(true);
        pointerMenuState.cooldown = 1.0;
        pointerMenuState.childCooldown = 1.0;
    },
    onSessionEnd: () => {
        containerGroup.position.copy(containerConfig.desktopPosition);
        containerGroup.quaternion.identity();
        containerGroup.scale.setScalar(1);
        applyPointerRestPose();
        updateUIReferencePositions();
    },
});

// --- UIRoot — snaps to best-facing bottom edge each frame ---
const UIRoot = new THREE.Object3D();
scene.add(UIRoot);

const UIConfig = { currentEdgeIndex: 0 };

const _uiCameraWorldPos   = new THREE.Vector3();
const _uiRefPointWorldPos = new THREE.Vector3();
const _uiRefNormalWorld   = new THREE.Vector3();
const _uiToCamera         = new THREE.Vector3();
const _uiLookAt           = new THREE.Vector3();

function isCameraInsideContainer() {
    camera.getWorldPosition(_uiCameraWorldPos);
    const scaledHalfSize = containerConfig.containerSize * 0.5 * containerGroup.scale.x;
    const p = containerGroup.position;
    return (
        Math.abs(_uiCameraWorldPos.x - p.x) < scaledHalfSize &&
        Math.abs(_uiCameraWorldPos.y - p.y) < scaledHalfSize &&
        Math.abs(_uiCameraWorldPos.z - p.z) < scaledHalfSize
    );
}

function updateUIRoot() {
    if (isCameraInsideContainer()) {
        UIRoot.visible = false;
        return;
    }

    UIRoot.visible = true;
    camera.getWorldPosition(_uiCameraWorldPos);

    let bestIndex = 0;
    let bestScore = -Infinity;

    for (let i = 0; i < 4; i++) {
        UIReferencePoint[i].getWorldPosition(_uiRefPointWorldPos);
        _uiRefNormalWorld.copy(UIReferenceNormals[i]).applyQuaternion(containerGroup.quaternion);
        _uiToCamera.subVectors(_uiCameraWorldPos, _uiRefPointWorldPos).normalize();

        const facingScore   = _uiToCamera.dot(_uiRefNormalWorld);
        const distanceScore = 1 / (_uiCameraWorldPos.distanceTo(_uiRefPointWorldPos) + 0.1);
        const score = facingScore * distanceScore;

        if (facingScore > 0 && score > bestScore) {
            bestScore = score;
            bestIndex = i;
        }
    }

    UIReferencePoint[bestIndex].getWorldPosition(_uiRefPointWorldPos);
    UIRoot.position.copy(_uiRefPointWorldPos);

    _uiRefNormalWorld.copy(UIReferenceNormals[bestIndex]).applyQuaternion(containerGroup.quaternion);
    _uiLookAt.copy(UIRoot.position).add(_uiRefNormalWorld);
    UIRoot.lookAt(_uiLookAt);

    UIConfig.currentEdgeIndex = bestIndex;
}

// --- Textures ---
const uiTextureLoader = new THREE.TextureLoader();

// --- UIPlane (panel — empty except close button) ---
const uiPanelWidth = 0.2535 * 1.5;
const uiPanelHeight = uiPanelWidth * (468 / 900);
const UIPlaneGeometry = new THREE.PlaneGeometry(uiPanelWidth, uiPanelHeight);
const uiPanelTexture  = uiTextureLoader.load('static/ui-panel.png');
uiPanelTexture.colorSpace = THREE.SRGBColorSpace;
const UIPlaneMaterial = new THREE.MeshBasicMaterial({
    map: uiPanelTexture,
    side: THREE.FrontSide,
    transparent: true,
    depthTest: false,
    depthWrite: false
});
const UIPlane = new THREE.Mesh(UIPlaneGeometry, UIPlaneMaterial);
UIPlane.rotation.x = -22.5 * Math.PI / 180;
UIPlane.scale.set(0, 0, 0);
UIPlane.visible = false;
UIPlane.frustumCulled = false;
UIRoot.add(UIPlane);

// Simple page dots indicator (top segment of the panel).
const PAGE_DOT_COUNT = OPTICAL_PAGES.length;
const PAGE_DOT_SMALL_RADIUS = 0.002;
const PAGE_DOT_LARGE_RADIUS = 0.0032;
const PAGE_DOT_SPACING = 0.0088;
const pageDotsGroup = new THREE.Group();
pageDotsGroup.position.set(0, 0.078, 0);
pageDotsGroup.frustumCulled = false;
UIPlane.add(pageDotsGroup);

const pageDotGeometrySmall = new THREE.CircleGeometry(PAGE_DOT_SMALL_RADIUS, 32);
const pageDotGeometryLarge = new THREE.CircleGeometry(PAGE_DOT_LARGE_RADIUS, 32);
const pageDotInactiveMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.8,
    depthTest: false,
    depthWrite: false
});
const pageDotActiveMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 1.0,
    depthTest: false,
    depthWrite: false
});
const pageDotMeshes = [];

for (let i = 0; i < PAGE_DOT_COUNT; i++) {
    const dot = new THREE.Mesh(pageDotGeometrySmall, pageDotInactiveMaterial);
    const x = (i - (PAGE_DOT_COUNT - 1) / 2) * PAGE_DOT_SPACING;
    dot.position.set(x, 0, 0);
    dot.frustumCulled = false;
    pageDotsGroup.add(dot);
    pageDotMeshes.push(dot);
}

function updateMenuPageDots() {
    for (let i = 0; i < pageDotMeshes.length; i++) {
        const isActive = i === deps.currentMenuPage;
        pageDotMeshes[i].geometry = isActive ? pageDotGeometryLarge : pageDotGeometrySmall;
        pageDotMeshes[i].material = isActive ? pageDotActiveMaterial : pageDotInactiveMaterial;
    }
}

// Invisible slot anchors on the panel
const slotRefOffsetX = 0.1;

const slotRef0 = new THREE.Object3D();
slotRef0.position.set(-slotRefOffsetX, 0.008, 0);
slotRef0.frustumCulled = false;
UIPlane.add(slotRef0);

const slotRef1 = new THREE.Object3D();
slotRef1.position.set(0, 0.008, 0);
slotRef1.frustumCulled = false;
UIPlane.add(slotRef1);

const slotRef2 = new THREE.Object3D();
slotRef2.position.set(slotRefOffsetX, 0.008, 0);
slotRef2.frustumCulled = false;
UIPlane.add(slotRef2);

// Slot-ref array used by the menu pager (slotMeshes state declared higher up)
const slotRefs = [slotRef0, slotRef1, slotRef2];

/** Release a retired slot preview — remove from its parent and free per-instance resources. */
function disposeSlotMesh(mesh) {
    if (mesh.parent) mesh.parent.remove(mesh);

    // Edge overlays use cloned line materials — dispose them
    mesh.traverse(child => {
        if (child.isLineSegments && child.material && typeof child.material.dispose === 'function') {
            child.material.dispose();
        }
        if (child.isLineSegments && child.geometry && typeof child.geometry.dispose === 'function') {
            child.geometry.dispose();
        }
    });

    // Mesh geometry: only dispose when it's a per-instance geometry (not a shared one)
    if (mesh.geometry && SHARED_MESH_GEOMS.indexOf(mesh.geometry) < 0) {
        mesh.geometry.dispose();
    }

    // Sphere billboard outline, if any
    if (mesh.userData.sphereOutline) {
        const outline = mesh.userData.sphereOutline;
        if (outline.parent) outline.parent.remove(outline);
        mesh.userData.sphereOutline = null;
    }

    disposeMeshNameLabel(mesh);
}

/**
 * Build a flat white silhouette ghost for a given type.
 * Reuses the factory so the ghost inherits the exact geometry, orientation and scale of
 * the real preview — the returning 3D object therefore fits its ghost perfectly.
 * Strips edge overlays, sphere outline and swaps the material for a semi-transparent white.
 */
function buildSlotGhost(typeKey) {
    const ghost = OPTICAL_TYPES[typeKey].factory();

    // Sphere factory registers an outline directly on `scene` — drop it, the ghost doesn't need it.
    if (ghost.userData.sphereOutline) {
        const outline = ghost.userData.sphereOutline;
        if (outline.parent) outline.parent.remove(outline);
        ghost.userData.sphereOutline = null;
    }

    // Remove edge-overlay children so the silhouette reads as a clean white shape.
    const toRemove = [];
    ghost.traverse(child => {
        if (child === ghost) return;
        if (child.isLineSegments || child.isLine2 || child.isLine) {
            toRemove.push(child);
        }
    });
    for (let i = 0; i < toRemove.length; i++) {
        const c = toRemove[i];
        if (c.parent) c.parent.remove(c);
        if (c.material && typeof c.material.dispose === 'function') c.material.dispose();
        if (c.geometry && typeof c.geometry.dispose === 'function') c.geometry.dispose();
    }

    // Own material per ghost so opacity tweens are independent between slots.
    ghost.material = slotGhostMaterialTemplate.clone();
    ghost.renderOrder = -1;
    disableOpticalFrustumCulling(ghost);
    ghost.visible = false;

    // Match populateSlot()'s orientation reset so the ghost aligns with the real preview
    // (lens factories apply rotation.y = π/2 which populateSlot wipes with quaternion.identity()).
    ghost.position.set(0, 0, 0);
    ghost.quaternion.identity();

    // Clear user data that's only meaningful for real previews
    ghost.userData = { isSlotGhost: true };
    return ghost;
}

function disposeSlotGhost(ghost) {
    if (!ghost) return;
    gsap.killTweensOf(ghost.material);
    if (ghost.parent) ghost.parent.remove(ghost);
    if (ghost.material && typeof ghost.material.dispose === 'function') {
        ghost.material.dispose();
    }
    if (ghost.geometry && SHARED_MESH_GEOMS.indexOf(ghost.geometry) < 0) {
        ghost.geometry.dispose();
    }
}

/**
 * Show or hide a slot ghost, optionally tweening opacity.
 * - duration <= 0 snaps the state instantly (used for page changes).
 * - shouldShow=true sets visible immediately so the fade-in is perceivable;
 *   shouldShow=false defers visible=false until the fade-out finishes.
 */
function setSlotGhostState(slotIndex, shouldShow, duration = 0) {
    const ghost = slotGhostMeshes[slotIndex];
    if (!ghost) return;
    const targetOpacity = shouldShow ? SLOT_GHOST_OPACITY : 0;

    gsap.killTweensOf(ghost.material);

    if (duration <= 0) {
        ghost.visible = shouldShow;
        ghost.material.opacity = targetOpacity;
        return;
    }

    if (shouldShow) {
        ghost.visible = true;
        gsap.to(ghost.material, {
            opacity: targetOpacity,
            duration,
            ease: 'power2.out'
        });
    } else {
        gsap.to(ghost.material, {
            opacity: targetOpacity,
            duration,
            ease: 'power2.in',
            onComplete: () => { ghost.visible = false; }
        });
    }
}

/** (Re)build the ghost for `slotIndex` based on the current page's type. */
function refreshSlotGhost(slotIndex) {
    if (slotGhostMeshes[slotIndex]) {
        disposeSlotGhost(slotGhostMeshes[slotIndex]);
        slotGhostMeshes[slotIndex] = null;
    }
    const typeKey = OPTICAL_PAGES[deps.currentMenuPage][slotIndex];
    const ghost = buildSlotGhost(typeKey);
    slotRefs[slotIndex].add(ghost);
    slotGhostMeshes[slotIndex] = ghost;
    // Initial state matches slotMeshes — populateSlot will refine it as it runs.
    setSlotGhostState(slotIndex, !slotMeshes[slotIndex], 0);
}

/**
 * Spawn a preview of the current page's type for a single slot.
 * One-instance-per-type: if the type has already been pulled into the scene, the slot stays empty
 * and the ghost silhouette takes over to show which shape belongs there.
 *
 * `ghostFadeDuration` controls how the ghost transitions as a result of this call:
 *   - 0 (default): instant — used for page changes.
 *   - > 0: fade — used for respawns so the ghost dissolves as the real preview scales up.
 */
function populateSlot(slotIndex, ghostFadeDuration = 0) {
    const typeKey = OPTICAL_PAGES[deps.currentMenuPage][slotIndex];
    // Mirror is the one type that supports multiple instances — its slot stays populated
    // until every mirror in the pool has been pulled into the scene.
    const consumed = typeKey === 'mirror'
        ? mirrorsAvailableCount() === 0
        : typeInScene.has(typeKey);
    if (consumed) {
        slotMeshes[slotIndex] = null;
        setSlotGhostState(slotIndex, true, 0);
        return;
    }
    const mesh = OPTICAL_TYPES[typeKey].factory();
    // Rest on the slot position with neutral rotation so the object visually aligns with the panel
    mesh.position.set(0, 0, 0);
    mesh.quaternion.identity();
    mesh.userData.slotIndex = slotIndex;
    slotMeshes[slotIndex] = mesh;
    slotRefs[slotIndex].add(mesh);
    createNameLabelFor(mesh);

    // Real preview present → fade the ghost out (or snap, depending on ghostFadeDuration).
    setSlotGhostState(slotIndex, false, ghostFadeDuration);
}

/** Rebuild all three slot previews for the current page. Called on Prev/Next and at init. */
function populateAllSlots() {
    for (let i = 0; i < slotMeshes.length; i++) {
        if (slotMeshes[i]) {
            disposeSlotMesh(slotMeshes[i]);
            slotMeshes[i] = null;
        }
    }
    // Ghosts are per-page too (each page has different types), so rebuild them alongside.
    for (let i = 0; i < slotGhostMeshes.length; i++) refreshSlotGhost(i);
    for (let i = 0; i < 3; i++) populateSlot(i);
    updateMenuPageDots();
}

// --- UICloseButton (child of UIPlane — inherits panel scale animation) ---
const uiCloseButtonSize = 0.03;
const UICloseButtonGeometry = new THREE.PlaneGeometry(uiCloseButtonSize, uiCloseButtonSize);
const uiCloseButtonTexture  = uiTextureLoader.load('static/ui-button-close.png');
uiCloseButtonTexture.colorSpace = THREE.SRGBColorSpace;
const UICloseButtonMaterial = new THREE.MeshBasicMaterial({
    map: uiCloseButtonTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UICloseButton = new THREE.Mesh(UICloseButtonGeometry, UICloseButtonMaterial);
UICloseButton.position.set(0.165, 0.075, 0.01);
UICloseButton.frustumCulled = false;
UIPlane.add(UICloseButton);

// --- UIPrevButton / UINextButton (children of UIPlane) ---
const uiNavButtonSize = uiCloseButtonSize * 0.88;
const UINavButtonGeometry = new THREE.PlaneGeometry(uiNavButtonSize, uiNavButtonSize);

const uiPrevButtonTexture = uiTextureLoader.load('static/ui-button-prev.png');
uiPrevButtonTexture.colorSpace = THREE.SRGBColorSpace;
const UIPrevButtonMaterial = new THREE.MeshBasicMaterial({
    map: uiPrevButtonTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UIPrevButton = new THREE.Mesh(UINavButtonGeometry, UIPrevButtonMaterial);
UIPrevButton.position.set(-0.162, 0.008, 0.01);
UIPrevButton.frustumCulled = false;
UIPlane.add(UIPrevButton);

const uiNextButtonTexture = uiTextureLoader.load('static/ui-button-next.png');
uiNextButtonTexture.colorSpace = THREE.SRGBColorSpace;
const UINextButtonMaterial = new THREE.MeshBasicMaterial({
    map: uiNextButtonTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});
const UINextButton = new THREE.Mesh(UINavButtonGeometry, UINextButtonMaterial);
UINextButton.position.set(0.162, 0.008, 0.01);
UINextButton.frustumCulled = false;
UIPlane.add(UINextButton);

// --- UIStepperPrev / UIStepperNext (copy of nav row: 0.8 scale, lower Y — press only, no pager yet) ---
const UI_STEPPER_NAV_ROW_Y = 0.008 - 0.079;
const uiStepperNavButtonSize = uiNavButtonSize * 0.8;
const UIStepperNavButtonGeometry = new THREE.PlaneGeometry(uiStepperNavButtonSize, uiStepperNavButtonSize);
const UIStepperPrevButton = new THREE.Mesh(UIStepperNavButtonGeometry, UIPrevButtonMaterial);
UIStepperPrevButton.position.set(-0.11, UI_STEPPER_NAV_ROW_Y, 0.01);
UIStepperPrevButton.frustumCulled = false;
UIPlane.add(UIStepperPrevButton);
const UIStepperNextButton = new THREE.Mesh(UIStepperNavButtonGeometry, UINextButtonMaterial);
UIStepperNextButton.position.set(0.002, UI_STEPPER_NAV_ROW_Y, 0.01);
UIStepperNextButton.frustumCulled = false;
UIPlane.add(UIStepperNextButton);

const STEPPER_MEDIUM_OPTIONS = ['Air', 'Water', 'Glass', 'Sapphire', 'Diamond', 'Custom'];
const STEPPER_DEFAULT_MEDIUM = 'Glass';
// Exposed on deps: OpticalObjects.js's getSceneIORLineFor() reads these to label scene
// objects, and needs the live index (not a stale copy) whenever the stepper changes.
deps.STEPPER_MEDIUM_OPTIONS = STEPPER_MEDIUM_OPTIONS;
deps.currentStepperMediumIndex = Math.max(0, STEPPER_MEDIUM_OPTIONS.indexOf(STEPPER_DEFAULT_MEDIUM));

/** Stepper medium label — helvetiker ShapeGeometry (was canvas 44px on 0.144×0.036 plane). */
const STEPPER_LABEL_SIZE_SCALE = 0.65;
const STEPPER_LABEL_PLANE_H = 0.036;
const STEPPER_LABEL_FONT_SIZE = STEPPER_LABEL_PLANE_H * (44 / 128) * STEPPER_LABEL_SIZE_SCALE;
const UIStepperLabel = new THREE.Group();
UIStepperLabel.position.set(-0.054, UI_STEPPER_NAV_ROW_Y, 0.002);
UIStepperLabel.frustumCulled = false;
UIPlane.add(UIStepperLabel);
let UIStepperLabelMesh = null;

function redrawStepperLabel() {
    const font = getHelvetikerBold();
    if (!UIStepperLabelMesh || !font) return;
    updateFixedShapeTextMesh(
        UIStepperLabelMesh,
        font,
        STEPPER_MEDIUM_OPTIONS[deps.currentStepperMediumIndex]
    );
}

function isMirrorMesh(mesh) {
    return !!(mesh && mesh.userData && (mesh.userData.isMirror || mesh.userData.typeKey === 'mirror'));
}
function applyCurrentStepperIORToAllOpticalMeshes(options = {}) {
    const refreshNameLabels = options.refreshNameLabels !== false;
    const selectedMedium = STEPPER_MEDIUM_OPTIONS[deps.currentStepperMediumIndex];
    if (selectedMedium === 'Custom') {
        deps.currentStepperMediumIOR = deps.customStepperMediumIOR;
    } else {
        deps.currentStepperMediumIOR = STEPPER_MEDIUM_IOR_MAP[selectedMedium] ?? STEPPER_MEDIUM_IOR_MAP.Glass;
    }

    const applyIOR = (mesh) => {
        if (!mesh || !mesh.userData || isMirrorMesh(mesh)) return;
        mesh.userData.ior = deps.currentStepperMediumIOR;
        if (refreshNameLabels && mesh.userData.nameLabel) redrawNameLabel(mesh);
    };

    for (let i = 0; i < sceneOpticalMeshes.length; i++) applyIOR(sceneOpticalMeshes[i]);
    for (let i = 0; i < slotMeshes.length; i++) applyIOR(slotMeshes[i]);
    for (let i = 0; i < returningMeshes.length; i++) applyIOR(returningMeshes[i]);
}

function refreshSceneObjectNameLabels() {
    for (let i = 0; i < sceneOpticalMeshes.length; i++) {
        const mesh = sceneOpticalMeshes[i];
        if (mesh.userData.nameLabel) redrawNameLabel(mesh);
    }
}
applyCurrentStepperIORToAllOpticalMeshes();

// --- Menu slider ---
const MENU_SLIDER_TRACK_WIDTH = 0.07;
const MENU_SLIDER_TRACK_HEIGHT = 0.0024 // MENU_SLIDER_TRACK_WIDTH * (5 / 215);
const MENU_SLIDER_ROW_Y = UI_STEPPER_NAV_ROW_Y;
const MENU_SLIDER_POS_X = 0.094;
const MENU_SLIDER_POS_Y = MENU_SLIDER_ROW_Y;
const MENU_SLIDER_POS_Z = 0.002;
const MENU_SLIDER_TRACK_HALF_WIDTH = MENU_SLIDER_TRACK_WIDTH * 0.5;
const MENU_SLIDER_GRAB_DISTANCE = 0.025;
const MENU_SLIDER_KNOB_Z = 0.0;
const menuSliderTrack = new THREE.Mesh(
    new THREE.PlaneGeometry(MENU_SLIDER_TRACK_WIDTH, MENU_SLIDER_TRACK_HEIGHT),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0, depthTest: true, depthWrite: true })
);
menuSliderTrack.position.set(MENU_SLIDER_POS_X, MENU_SLIDER_POS_Y, MENU_SLIDER_POS_Z);
menuSliderTrack.frustumCulled = false;
menuSliderTrack.renderOrder = 200;
UIPlane.add(menuSliderTrack);

const menuSliderTrackDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.0045, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: true, depthWrite: true })
);
menuSliderTrackDot.position.set(0, 0, 0.001);
menuSliderTrackDot.frustumCulled = false;
menuSliderTrackDot.renderOrder = 210;
menuSliderTrack.add(menuSliderTrackDot);

const menuSliderGrabDot = new THREE.Mesh(
    new THREE.SphereGeometry(0.008, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffff00, depthTest: true, depthWrite: true })
);
menuSliderGrabDot.position.set(0, 0, MENU_SLIDER_KNOB_Z);
menuSliderGrabDot.frustumCulled = false;
menuSliderGrabDot.renderOrder = 300;
menuSliderTrack.add(menuSliderGrabDot);

const menuSliderConnector = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6, depthTest: true, depthWrite: true })
);
menuSliderConnector.visible = false;
menuSliderConnector.frustumCulled = false;
menuSliderConnector.renderOrder = 220;
scene.add(menuSliderConnector);

/** IOR slider value — helvetiker ShapeGeometry (was canvas 40px on 0.06×0.03 plane ×1.2). */
const MENU_SLIDER_LABEL_SCALE = 1.2;
const MENU_SLIDER_LABEL_PLANE_H = 0.03 * MENU_SLIDER_LABEL_SCALE;
/** Static "Material" / "IOR" headers — canvas bold 40px on 256×128, plane 0.06×0.03 ×1.2. */
const MENU_SLIDER_HEADER_SIZE_SCALE = 0.7;
const MENU_SLIDER_HEADER_FONT_SIZE = MENU_SLIDER_LABEL_PLANE_H * (40 / 128) * MENU_SLIDER_HEADER_SIZE_SCALE;
const MENU_SLIDER_VALUE_SIZE_SCALE = 0.75;
/** +2px on the original 128px-tall canvas, in local world units. */
const MENU_SLIDER_VALUE_Y_OFFSET = (2 / 128) * MENU_SLIDER_LABEL_PLANE_H;
const MENU_SLIDER_VALUE_FONT_SIZE = MENU_SLIDER_LABEL_PLANE_H * (40 / 128) * MENU_SLIDER_VALUE_SIZE_SCALE;
const menuSliderValueLabel = new THREE.Group();
menuSliderValueLabel.position.set(0.06, MENU_SLIDER_VALUE_Y_OFFSET, 0.001);
menuSliderValueLabel.frustumCulled = false;
menuSliderValueLabel.renderOrder = 230;
menuSliderTrack.add(menuSliderValueLabel);
let menuSliderValueMesh = null;

const uiStepperMaterialLabel = new THREE.Group();
uiStepperMaterialLabel.position.set(-0.245, 0, 0.001);
uiStepperMaterialLabel.frustumCulled = false;
uiStepperMaterialLabel.renderOrder = 230;
menuSliderTrack.add(uiStepperMaterialLabel);
let uiStepperMaterialLabelMesh = null;

const menuSliderIORLabel = new THREE.Group();
menuSliderIORLabel.position.set(-0.054, 0, 0.001);
menuSliderIORLabel.frustumCulled = false;
menuSliderIORLabel.renderOrder = 230;
menuSliderTrack.add(menuSliderIORLabel);
let menuSliderIORLabelMesh = null;

/** Reset button — shape text + canvas progress ring (was all canvas 40px on 288×144, plane 0.06×0.03 ×1.2). */
const RESET_BUTTON_SCALE = 1.2;
const RESET_BUTTON_SIZE_SCALE = 0.7;
const RESET_BUTTON_FONT_SIZE = 0.03 * (40 / 144) * RESET_BUTTON_SIZE_SCALE;
const uiResetButtonCanvas = document.createElement('canvas');
uiResetButtonCanvas.width = 288;
uiResetButtonCanvas.height = 144;
const uiResetButtonCtx = uiResetButtonCanvas.getContext('2d');
const uiResetButtonTexture = new THREE.CanvasTexture(uiResetButtonCanvas);
uiResetButtonTexture.minFilter = THREE.LinearFilter;
const RESET_HOLD_DURATION = 1.0;
const resetHoldState = {
    active: false,
    elapsed: 0,
    finger: null
};

function redrawResetButton(progress = 0) {
    if (!uiResetButtonCtx) return;
    const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
    const w = uiResetButtonCanvas.width;
    const h = uiResetButtonCanvas.height;
    const cx = w * 0.5;
    const cy = h * 0.5;
    const ringLineWidth = 8;
    const desiredRadius = Math.min(w, h) * 0.8;
    const maxSafeRadius = (Math.min(w, h) * 0.5) - (ringLineWidth * 0.5) - 1;
    const radius = Math.min(desiredRadius, maxSafeRadius);
    const startAngle = -Math.PI * 0.5;
    const endAngle = startAngle + clamped * Math.PI * 2;

    uiResetButtonCtx.clearRect(0, 0, w, h);

    if (clamped > 0) {
        uiResetButtonCtx.lineWidth = ringLineWidth;
        uiResetButtonCtx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        uiResetButtonCtx.beginPath();
        uiResetButtonCtx.arc(cx, cy, radius, 0, Math.PI * 2);
        uiResetButtonCtx.stroke();

        uiResetButtonCtx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
        uiResetButtonCtx.beginPath();
        uiResetButtonCtx.arc(cx, cy, radius, startAngle, endAngle);
        uiResetButtonCtx.stroke();
    }

    uiResetButtonTexture.needsUpdate = true;
}
redrawResetButton(0);

const UIResetButton = new THREE.Group();
UIResetButton.position.set(-0.251, 0.15, 0.001);
UIResetButton.scale.set(RESET_BUTTON_SCALE, RESET_BUTTON_SCALE, 2);
UIResetButton.frustumCulled = false;
menuSliderTrack.add(UIResetButton);

const uiResetButtonRing = new THREE.Mesh(
    new THREE.PlaneGeometry(0.06, 0.03),
    new THREE.MeshBasicMaterial({
        map: uiResetButtonTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    })
);
uiResetButtonRing.renderOrder = 230;
UIResetButton.add(uiResetButtonRing);
let uiResetButtonTextMesh = null;

loadHelvetikerBold().then((font) => {
    UIStepperLabelMesh = createFixedShapeTextMesh(
        font,
        STEPPER_MEDIUM_OPTIONS[deps.currentStepperMediumIndex],
        {
            fontSize: STEPPER_LABEL_FONT_SIZE,
            color: 0xffffff,
            stableVerticalCenter: true,
        }
    );
    UIStepperLabel.add(UIStepperLabelMesh);

    menuSliderValueMesh = createFixedShapeTextMesh(
        font,
        formatIORValue(getCurrentStepperIOR()),
        { fontSize: MENU_SLIDER_VALUE_FONT_SIZE, color: 0xffffff, renderOrder: 230 }
    );
    menuSliderValueLabel.add(menuSliderValueMesh);

    uiStepperMaterialLabelMesh = createFixedShapeTextMesh(
        font,
        'Material',
        {
            fontSize: MENU_SLIDER_HEADER_FONT_SIZE,
            color: 0xffffff,
            renderOrder: 230,
            stableVerticalCenter: true,
        }
    );
    uiStepperMaterialLabel.add(uiStepperMaterialLabelMesh);

    menuSliderIORLabelMesh = createFixedShapeTextMesh(
        font,
        'IOR',
        {
            fontSize: MENU_SLIDER_HEADER_FONT_SIZE,
            color: 0xffffff,
            renderOrder: 230,
            stableVerticalCenter: true,
        }
    );
    menuSliderIORLabel.add(menuSliderIORLabelMesh);

    uiResetButtonTextMesh = createFixedShapeTextMesh(
        font,
        'Reset',
        {
            fontSize: RESET_BUTTON_FONT_SIZE,
            color: 0xffff00,
            renderOrder: 231,
            stableVerticalCenter: true,
        }
    );
    uiResetButtonTextMesh.position.z = 0.0005;
    UIResetButton.add(uiResetButtonTextMesh);
});

const menuSlider = {
    state: {
        value: (STEPPER_MEDIUM_IOR_MAP.Glass - IOR_SLIDER_MIN) / IOR_SLIDER_RANGE, // normalized 0..1
        isGrabbed: false,
        grabbingHand: null,
        initialGrabX: 0
    }
};

// --- UIButton (menu button — opens the panel) ---
const UIButtonGeometry = new THREE.PlaneGeometry(0.04, 0.04);
const uiButtonTexture  = uiTextureLoader.load('static/ui-button-menu.png');
uiButtonTexture.colorSpace = THREE.SRGBColorSpace;
const UIButtonMaterial = new THREE.MeshBasicMaterial({
    map: uiButtonTexture,
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false
});

// Pivot decouples the 22.5° tilt from the Z-axis press animation
const UIButtonPivot = new THREE.Object3D();
UIButtonPivot.rotation.x = -22.5 * Math.PI / 180;
UIButtonPivot.position.z = -0.001;
UIRoot.add(UIButtonPivot);

const UIButton = new THREE.Mesh(UIButtonGeometry, UIButtonMaterial);
UIButton.frustumCulled = false;
UIButtonPivot.add(UIButton);

// --- State ---
const buttonState = {
    isPressed: false,
    cooldown: 0,
    cooldownDuration: 0.5,
    pressDistance: 0.04   // 4 cm — covers finger tracking jitter in XR
};

// Kept live on deps (not a local let) — ObjectManipulation.js and SnellsLawTracer.js read
// this every frame to gate slot-mesh grabbing, and a plain local var would only ever export
// a one-time snapshot (always false) via Object.assign below.
deps.UIPanelOn = false;

const UIDistanceConfig = {
    isAnimating: false
};

const UIAnimConfig = {
    buttonHideDelay:     0.1,
    panelShowDelay:      0.0,
    panelScaleDuration:  0.3,
    panelHideDuration:   0.3,
    buttonScaleDuration: 0.3,
    panelEase:  'power2.out',
    buttonEase: 'power2.inOut'
};

// --- Helper vectors ---
const _uiButtonWorldPos      = new THREE.Vector3();
const _uiCloseButtonWorldPos = new THREE.Vector3();
const _uiPrevButtonWorldPos  = new THREE.Vector3();
const _uiNextButtonWorldPos  = new THREE.Vector3();
const _uiStepperPrevButtonWorldPos = new THREE.Vector3();
const _uiStepperNextButtonWorldPos = new THREE.Vector3();
const _uiResetButtonWorldPos = new THREE.Vector3();
const _menuSliderGrabWorldPos = new THREE.Vector3();
const _menuSliderTrackWorldPos = new THREE.Vector3();
const _menuSliderTrackWorldDir = new THREE.Vector3();
const _menuSliderPinchWorldPos = new THREE.Vector3();
const _menuSliderTrackDotWorldPos = new THREE.Vector3();
const _menuSliderConnectorMid = new THREE.Vector3();

// --- Press animation (shared by UIButton and UICloseButton) ---
function animateButtonPress(buttonMesh) {
    gsap.killTweensOf(buttonMesh.position);
    gsap.killTweensOf(buttonMesh.scale);

    const originalZ       = buttonMesh.position.z;
    const originalScaleX  = buttonMesh.scale.x;
    const originalScaleY  = buttonMesh.scale.y;
    const pressDepth      = -0.02;
    const scaleUpFactor   = 1.3;
    const pressDuration   = 0.15;
    const returnDuration  = 0.15;
    const returnDelay     = 0.075;

    const tl = gsap.timeline();
    tl.to(buttonMesh.position, { z: originalZ + pressDepth, duration: pressDuration,  ease: 'power2.out' }, 0);
    tl.to(buttonMesh.scale,    { x: originalScaleX * scaleUpFactor, y: originalScaleY * scaleUpFactor, duration: pressDuration,  ease: 'power2.out' }, 0);
    tl.to(buttonMesh.position, { z: originalZ,              duration: returnDuration, ease: 'power2.out' }, pressDuration + returnDelay);
    tl.to(buttonMesh.scale,    { x: originalScaleX, y: originalScaleY, duration: returnDuration, ease: 'power2.out' }, pressDuration + returnDelay);
}

// --- Pointer Menu Button / Panel press checks ---

/**
 * Detects a finger press on the yellow `pointerMenuButton` sphere and opens the menu.
 * The hand currently grabbing the pointer is excluded (its index tip lives at the button).
 */
function checkPointerMenuButtonPress(delta) {
    if (!renderer.xr.isPresenting) return;

    if (pointerMenuState.cooldown > 0) {
        pointerMenuState.cooldown -= delta;
        return;
    }

    // Button must be fully visible (scale-in complete)
    if (!pointerMenuButton.visible || pointerMenuButton.scale.x < 0.5) return;

    pointerMenuButton.getWorldPosition(_pmButtonWorldPos);

    // Skip the hand that is currently holding the pointer — its index tip IS at the button
    const skipLeft  = pointerGrab.active && pointerGrab.hand === 'left';
    const skipRight = pointerGrab.active && pointerGrab.hand === 'right';

    if (!skipLeft  && lIndexObj.position.distanceTo(_pmButtonWorldPos) < POINTER_MENU_BUTTON_PRESS_DIST) {
        animatePointerMenuButtonPress();
        dismissRayModeHint();
        if (pointerMenuState.isOpen) closePointerMenu();
        else openPointerMenu();
        return;
    }
    if (!skipRight && rIndexObj.position.distanceTo(_pmButtonWorldPos) < POINTER_MENU_BUTTON_PRESS_DIST) {
        animatePointerMenuButtonPress();
        dismissRayModeHint();
        if (pointerMenuState.isOpen) closePointerMenu();
        else openPointerMenu();
        return;
    }
}

const POINTER_MENU_CHILD_PRESS_DEPTH  = 0.025;
const POINTER_MENU_CHILD_COOLDOWN_DUR = 0.35;

/**
 * Detects an index-finger poke on each of the three child buttons inside the
 * pointer menu panel. Buttons behave as a radio group — pressing one activates
 * it and deactivates the others.
 */
const _pmChildButtons = [];
function checkPointerMenuChildButtonsPress(delta) {
    if (!renderer.xr.isPresenting) return;

    if (pointerMenuState.childCooldown > 0) {
        pointerMenuState.childCooldown -= delta;
        return;
    }

    if (!pointerMenuState.isOpen) return;
    if (pointerMenuState.cooldown > 0) return;

    const hw = POINTER_MENU_PANEL_CHILD_WIDTH  * 0.5;
    const hh = POINTER_MENU_PANEL_CHILD_HEIGHT * 0.5;

    if (_pmChildButtons.length === 0) {
        _pmChildButtons.push(
            { mesh: pointerMenuButtonA, id: 'A' },
            { mesh: pointerMenuButtonB, id: 'B' },
            { mesh: pointerMenuButtonC, id: 'C' },
        );
    }

    for (let f = 0; f < 2; f++) {
        const fingerPos = f === 0 ? lIndexObj.position : rIndexObj.position;
        for (const { mesh, id } of _pmChildButtons) {
            mesh.worldToLocal(_pmChildFingerLocal.copy(fingerPos));
            if (
                Math.abs(_pmChildFingerLocal.x) < hw &&
                Math.abs(_pmChildFingerLocal.y) < hh &&
                Math.abs(_pmChildFingerLocal.z) < POINTER_MENU_CHILD_PRESS_DEPTH
            ) {
                animatePointerMenuChildButtonPress(mesh, id);
                pointerMenuState.childCooldown = POINTER_MENU_CHILD_COOLDOWN_DUR;
                return;
            }
        }
    }
}

// --- checkButtonPress / onButtonPressed ---
function checkButtonPress(delta) {
    if (!renderer.xr.isPresenting) return;

    if (buttonState.cooldown > 0) {
        buttonState.cooldown -= delta;
        return;
    }

    if (!UIButton.visible) return;

    // Don't open the panel while an object is being held or just released
    if (objectGrab.left.active || objectGrab.right.active || deps.grabReleaseCooldown > 0) return;

    UIButton.getWorldPosition(_uiButtonWorldPos);

    if (lIndexObj.position.distanceTo(_uiButtonWorldPos) < buttonState.pressDistance) { onButtonPressed(); return; }
    if (rIndexObj.position.distanceTo(_uiButtonWorldPos) < buttonState.pressDistance) { onButtonPressed(); return; }
}

function onButtonPressed() {
    buttonState.isPressed = true;
    buttonState.cooldown  = buttonState.cooldownDuration;
    animateButtonPress(UIButton);
    if (!deps.UIPanelOn) showUIPanel();
}

// --- checkCloseButtonPress / onCloseButtonPressed ---
function checkCloseButtonPress() {
    if (!renderer.xr.isPresenting) return;

    if (buttonState.cooldown > 0) return;
    if (!deps.UIPanelOn || !UIPlane.visible) return;

    // Don't close the panel while an object is being held or just released
    if (objectGrab.left.active || objectGrab.right.active || deps.grabReleaseCooldown > 0) return;

    UICloseButton.getWorldPosition(_uiCloseButtonWorldPos);

    if (lIndexObj.position.distanceTo(_uiCloseButtonWorldPos) < buttonState.pressDistance) { onCloseButtonPressed(); return; }
    if (rIndexObj.position.distanceTo(_uiCloseButtonWorldPos) < buttonState.pressDistance) { onCloseButtonPressed(); return; }
}

function onCloseButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    animateButtonPress(UICloseButton);
    setTimeout(() => { hideUIPanel(); }, 150);
}

// --- checkPrevNextButtonPress / onPrevNextButtonPressed ---

const _slotGuardPos = new THREE.Vector3();

/**
 * Returns true only if the finger is within pressDistance of buttonPos
 * AND no slot mesh is even closer — so a nearby slot always wins over the nav button.
 */
function fingerPrefersButton(fingerPos, buttonPos) {
    const distToButton = fingerPos.distanceTo(buttonPos);
    if (distToButton >= buttonState.pressDistance) return false;
    for (let i = 0; i < slotMeshes.length; i++) {
        const m = slotMeshes[i];
        if (!m) continue;
        m.getWorldPosition(_slotGuardPos);
        if (fingerPos.distanceTo(_slotGuardPos) < distToButton) return false;
    }
    return true;
}

function checkPrevNextButtonPress() {
    if (!renderer.xr.isPresenting) return;

    if (buttonState.cooldown > 0) return;
    if (!deps.UIPanelOn || !UIPlane.visible) return;

    // Never fire nav buttons while an object is being held or just released
    if (objectGrab.left.active || objectGrab.right.active || deps.grabReleaseCooldown > 0) return;

    UIPrevButton.getWorldPosition(_uiPrevButtonWorldPos);
    UINextButton.getWorldPosition(_uiNextButtonWorldPos);

    if (fingerPrefersButton(lIndexObj.position, _uiPrevButtonWorldPos)) { onPrevButtonPressed(); return; }
    if (fingerPrefersButton(rIndexObj.position, _uiPrevButtonWorldPos)) { onPrevButtonPressed(); return; }
    if (fingerPrefersButton(lIndexObj.position, _uiNextButtonWorldPos)) { onNextButtonPressed(); return; }
    if (fingerPrefersButton(rIndexObj.position, _uiNextButtonWorldPos)) { onNextButtonPressed(); return; }
}

function onPrevButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    animateButtonPress(UIPrevButton);
    deps.currentMenuPage = (deps.currentMenuPage + OPTICAL_PAGES.length - 1) % OPTICAL_PAGES.length;
    populateAllSlots();
}

function onNextButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    animateButtonPress(UINextButton);
    deps.currentMenuPage = (deps.currentMenuPage + 1) % OPTICAL_PAGES.length;
    populateAllSlots();
}

function checkStepperNavButtonPress() {
    if (!renderer.xr.isPresenting) return;

    if (buttonState.cooldown > 0) return;
    if (!deps.UIPanelOn || !UIPlane.visible) return;

    if (objectGrab.left.active || objectGrab.right.active || deps.grabReleaseCooldown > 0) return;

    UIStepperPrevButton.getWorldPosition(_uiStepperPrevButtonWorldPos);
    UIStepperNextButton.getWorldPosition(_uiStepperNextButtonWorldPos);

    if (fingerPrefersButton(lIndexObj.position, _uiStepperPrevButtonWorldPos)) { onStepperPrevButtonPressed(); return; }
    if (fingerPrefersButton(rIndexObj.position, _uiStepperPrevButtonWorldPos)) { onStepperPrevButtonPressed(); return; }
    if (fingerPrefersButton(lIndexObj.position, _uiStepperNextButtonWorldPos)) { onStepperNextButtonPressed(); return; }
    if (fingerPrefersButton(rIndexObj.position, _uiStepperNextButtonWorldPos)) { onStepperNextButtonPressed(); return; }
}

function onStepperPrevButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    animateButtonPress(UIStepperPrevButton);
    deps.currentStepperMediumIndex = (deps.currentStepperMediumIndex + STEPPER_MEDIUM_OPTIONS.length - 1) % STEPPER_MEDIUM_OPTIONS.length;
    redrawStepperLabel();
    syncMenuSliderToCurrentStepperMedium();
    applyCurrentStepperIORToAllOpticalMeshes();
}

function onStepperNextButtonPressed() {
    buttonState.cooldown = buttonState.cooldownDuration;
    animateButtonPress(UIStepperNextButton);
    deps.currentStepperMediumIndex = (deps.currentStepperMediumIndex + 1) % STEPPER_MEDIUM_OPTIONS.length;
    redrawStepperLabel();
    syncMenuSliderToCurrentStepperMedium();
    applyCurrentStepperIORToAllOpticalMeshes();
}

function checkResetButtonPress(delta) {
    if (!renderer.xr.isPresenting) {
        cancelResetHold();
        return;
    }

    if (!deps.UIPanelOn || !UIPlane.visible) {
        cancelResetHold();
        return;
    }

    if (objectGrab.left.active || objectGrab.right.active || deps.grabReleaseCooldown > 0) {
        cancelResetHold();
        return;
    }

    UIResetButton.getWorldPosition(_uiResetButtonWorldPos);

    if (!resetHoldState.active) {
        if (buttonState.cooldown > 0) return;
        if (fingerPrefersButton(lIndexObj.position, _uiResetButtonWorldPos)) { startResetHold('left'); return; }
        if (fingerPrefersButton(rIndexObj.position, _uiResetButtonWorldPos)) { startResetHold('right'); return; }
        return;
    }

    if (!isResetFingerStillPressing(resetHoldState.finger)) {
        cancelResetHold();
        return;
    }

    resetHoldState.elapsed += delta;
    const progress = Math.min(1, resetHoldState.elapsed / RESET_HOLD_DURATION);
    redrawResetButton(progress);

    if (progress >= 1) {
        cancelResetHold();
        onResetButtonPressed(false);
    }
}

function onResetButtonPressed(playPressAnimation = true) {
    buttonState.cooldown = buttonState.cooldownDuration;
    if (playPressAnimation) animateButtonPress(UIResetButton);
    resetSceneFromResetButton();
}

function isResetFingerStillPressing(hand) {
    if (hand === 'left') return fingerPrefersButton(lIndexObj.position, _uiResetButtonWorldPos);
    if (hand === 'right') return fingerPrefersButton(rIndexObj.position, _uiResetButtonWorldPos);
    return false;
}

function startResetHold(hand) {
    resetHoldState.active = true;
    resetHoldState.elapsed = 0;
    resetHoldState.finger = hand;
    redrawResetButton(0);

    gsap.killTweensOf(UIResetButton.position);
    gsap.killTweensOf(UIResetButton.scale);
    gsap.to(UIResetButton.position, { z: -0.019, duration: 0.12, ease: 'power2.out' });
    gsap.to(UIResetButton.scale, { x: 1.56, y: 1.56, duration: 0.12, ease: 'power2.out' });
}

function cancelResetHold() {
    if (!resetHoldState.active) return;
    resetHoldState.active = false;
    resetHoldState.elapsed = 0;
    resetHoldState.finger = null;
    redrawResetButton(0);

    gsap.killTweensOf(UIResetButton.position);
    gsap.killTweensOf(UIResetButton.scale);
    gsap.to(UIResetButton.position, { z: 0.001, duration: 0.16, ease: 'power2.out' });
    gsap.to(UIResetButton.scale, { x: 1.2, y: 1.2, duration: 0.16, ease: 'power2.out' });
}

function resetSceneFromResetButton() {
    // Abort any active grabs so stale references cannot survive the reset.
    stopObjectGrab('left');
    stopObjectGrab('right');
    pointerGrab.active = false;
    pointerGrab.hand = null;
    deps.grabReleaseCooldown = 0;

    // Clear optical scene state: release type occupancy + mirror numbering.
    typeInScene.clear();
    availableMirrorNumbers.length = 0;
    for (let i = 1; i <= MAX_MIRRORS; i++) availableMirrorNumbers.push(i);

    // Cancel pending return tweens and remove those meshes immediately.
    const returningCopy = returningMeshes.slice();
    for (let i = 0; i < returningCopy.length; i++) {
        gsap.killTweensOf(returningCopy[i].scale);
        removeSceneInstance(returningCopy[i]);
    }
    returningMeshes.length = 0;

    // Remove all currently placed optical objects.
    const sceneCopy = sceneOpticalMeshes.slice();
    for (let i = 0; i < sceneCopy.length; i++) {
        removeSceneInstance(sceneCopy[i]);
    }
    sceneOpticalMeshes.length = 0;

    // Rebuild visible menu slot previews so all optics are back in the menu.
    populateAllSlots();

    // Restore material controls to the default medium and refresh dependent UI.
    const glassIndex = STEPPER_MEDIUM_OPTIONS.indexOf('Glass');
    if (glassIndex >= 0) {
        deps.currentStepperMediumIndex = glassIndex;
        redrawStepperLabel();
        syncMenuSliderToCurrentStepperMedium();
    }
    applyCurrentStepperIORToAllOpticalMeshes();

    // Restore pointer authored startup pose and force 1-ray mode + button visual.
    closePointerMenu(true);
    applyPointerRestPose();
    setPointerMenuActiveButton('A');
}

function clampIOR(ior) {
    return Math.max(IOR_SLIDER_MIN, Math.min(IOR_SLIDER_MAX, Number(ior) || IOR_SLIDER_MIN));
}

function normalizedSliderToIOR(value) {
    const normalized = Math.max(0, Math.min(1, Number(value) || 0));
    return clampIOR(IOR_SLIDER_MIN + normalized * IOR_SLIDER_RANGE);
}

function iorToNormalizedSlider(ior) {
    return (clampIOR(ior) - IOR_SLIDER_MIN) / IOR_SLIDER_RANGE;
}

function redrawMenuSliderValueLabel(ior) {
    const font = getHelvetikerBold();
    if (!menuSliderValueMesh || !font) return;
    updateFixedShapeTextMesh(menuSliderValueMesh, font, formatIORValue(ior));
}

function setMenuSliderFromIOR(ior) {
    menuSlider.state.value = iorToNormalizedSlider(ior);
    updateMenuSliderTrackDotFromValue();
    updateMenuSliderGrabDotResting();
    redrawMenuSliderValueLabel(ior);
}

function getCurrentStepperIOR() {
    const selectedMedium = STEPPER_MEDIUM_OPTIONS[deps.currentStepperMediumIndex];
    return selectedMedium === 'Custom'
        ? deps.customStepperMediumIOR
        : (STEPPER_MEDIUM_IOR_MAP[selectedMedium] ?? STEPPER_MEDIUM_IOR_MAP.Glass);
}

function syncMenuSliderToCurrentStepperMedium() {
    setMenuSliderFromIOR(getCurrentStepperIOR());
}

function onMenuSliderVisualValueChanged(value) {
    const ior = normalizedSliderToIOR(value);
    deps.customStepperMediumIOR = ior;
    redrawMenuSliderValueLabel(ior);

    const customIndex = STEPPER_MEDIUM_OPTIONS.indexOf('Custom');
    if (customIndex >= 0 && deps.currentStepperMediumIndex !== customIndex) {
        deps.currentStepperMediumIndex = customIndex;
        redrawStepperLabel();
    }

    // Live IOR on meshes while dragging; object-label IOR line will update on release (phase 2).
    applyCurrentStepperIORToAllOpticalMeshes({ refreshNameLabels: false });
}

function updateMenuSliderTrackDotFromValue() {
    const trackX = (menuSlider.state.value - 0.5) * 2 * MENU_SLIDER_TRACK_HALF_WIDTH;
    menuSliderTrackDot.position.x = trackX;
}

function updateMenuSliderGrabDotResting() {
    if (menuSlider.state.isGrabbed) return;
    menuSliderGrabDot.position.x = menuSliderTrackDot.position.x;
}

function updateMenuSliderConnector() {
    menuSliderTrackDot.getWorldPosition(_menuSliderTrackDotWorldPos);
    menuSliderGrabDot.getWorldPosition(_menuSliderGrabWorldPos);
    const distance = _menuSliderTrackDotWorldPos.distanceTo(_menuSliderGrabWorldPos);
    _menuSliderConnectorMid.addVectors(_menuSliderTrackDotWorldPos, _menuSliderGrabWorldPos).multiplyScalar(0.5);
    menuSliderConnector.position.copy(_menuSliderConnectorMid);
    menuSliderConnector.scale.set(0.002, 0.002, distance);
    menuSliderConnector.lookAt(_menuSliderGrabWorldPos);
}

function startMenuSliderGrab(hand) {
    menuSlider.state.isGrabbed = true;
    menuSlider.state.grabbingHand = hand;

    if (hand === 'left') {
        _menuSliderPinchWorldPos.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
    } else {
        _menuSliderPinchWorldPos.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);
    }

    menuSliderTrack.getWorldPosition(_menuSliderTrackWorldPos);
    _menuSliderTrackWorldDir.set(1, 0, 0);
    menuSliderTrack.localToWorld(_menuSliderTrackWorldDir);
    _menuSliderTrackWorldDir.sub(_menuSliderTrackWorldPos).normalize();
    menuSlider.state.initialGrabX = _menuSliderPinchWorldPos.clone().sub(_menuSliderTrackWorldPos).dot(_menuSliderTrackWorldDir);

    menuSliderGrabDot.getWorldPosition(_menuSliderGrabWorldPos);
    menuSliderTrack.remove(menuSliderGrabDot);
    scene.add(menuSliderGrabDot);
    menuSliderGrabDot.position.copy(_menuSliderGrabWorldPos);
    menuSliderGrabDot.scale.setScalar(1.2);
    menuSliderConnector.visible = true;
    updateMenuSliderConnector();
}

function dragMenuSlider() {
    const hand = menuSlider.state.grabbingHand;
    if (!hand) return;

    if (hand === 'left') {
        _menuSliderPinchWorldPos.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
    } else {
        _menuSliderPinchWorldPos.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);
    }
    menuSliderGrabDot.position.copy(_menuSliderPinchWorldPos);

    menuSliderTrack.getWorldPosition(_menuSliderTrackWorldPos);
    _menuSliderTrackWorldDir.set(1, 0, 0);
    menuSliderTrack.localToWorld(_menuSliderTrackWorldDir);
    _menuSliderTrackWorldDir.sub(_menuSliderTrackWorldPos).normalize();

    const currentProjectedX = _menuSliderPinchWorldPos.clone().sub(_menuSliderTrackWorldPos).dot(_menuSliderTrackWorldDir);
    const deltaX = currentProjectedX - menuSlider.state.initialGrabX;
    const currentTrackX = (menuSlider.state.value - 0.5) * 2 * MENU_SLIDER_TRACK_HALF_WIDTH;
    let nextTrackX = currentTrackX + deltaX;
    nextTrackX = Math.max(-MENU_SLIDER_TRACK_HALF_WIDTH, Math.min(MENU_SLIDER_TRACK_HALF_WIDTH, nextTrackX));
    menuSlider.state.value = (nextTrackX / MENU_SLIDER_TRACK_HALF_WIDTH + 1) * 0.5;
    menuSlider.state.initialGrabX = currentProjectedX;

    updateMenuSliderTrackDotFromValue();
    onMenuSliderVisualValueChanged(menuSlider.state.value);
    updateMenuSliderConnector();
}

function releaseMenuSlider(animateToTrackDot = true) {
    if (!menuSlider.state.isGrabbed) return;
    menuSlider.state.isGrabbed = false;
    menuSlider.state.grabbingHand = null;
    menuSliderConnector.visible = false;
    menuSliderGrabDot.scale.setScalar(1);

    menuSliderGrabDot.getWorldPosition(_menuSliderGrabWorldPos);
    scene.remove(menuSliderGrabDot);
    menuSliderTrack.add(menuSliderGrabDot);
    menuSliderTrack.worldToLocal(_menuSliderGrabWorldPos);
    menuSliderGrabDot.position.copy(_menuSliderGrabWorldPos);

    refreshSceneObjectNameLabels();

    gsap.killTweensOf(menuSliderGrabDot.position);
    if (!animateToTrackDot) {
        updateMenuSliderGrabDotResting();
        return;
    }
    gsap.to(menuSliderGrabDot.position, {
        x: menuSliderTrackDot.position.x,
        y: menuSliderTrackDot.position.y,
        z: MENU_SLIDER_KNOB_Z,
        duration: 0.1,
        ease: 'power2.out'
    });
}

function checkMenuSliderGrab() {
    if (!renderer.xr.isPresenting) return;
    if (!deps.UIPanelOn || !UIPlane.visible) {
        releaseMenuSlider(false);
        return;
    }

    const leftPinching = pinchState.left;
    const rightPinching = pinchState.right;

    if (menuSlider.state.isGrabbed) {
        const hand = menuSlider.state.grabbingHand;
        const stillPinching = (hand === 'left' && leftPinching) || (hand === 'right' && rightPinching);
        if (!stillPinching) {
            releaseMenuSlider(true);
            return;
        }
        dragMenuSlider();
        return;
    }

    if (objectGrab.left.active || objectGrab.right.active || pointerGrab.active) return;

    menuSliderGrabDot.getWorldPosition(_menuSliderGrabWorldPos);

    if (leftPinching) {
        _menuSliderPinchWorldPos.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
        if (_menuSliderPinchWorldPos.distanceTo(_menuSliderGrabWorldPos) < MENU_SLIDER_GRAB_DISTANCE) {
            startMenuSliderGrab('left');
            return;
        }
    }

    if (rightPinching) {
        _menuSliderPinchWorldPos.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);
        if (_menuSliderPinchWorldPos.distanceTo(_menuSliderGrabWorldPos) < MENU_SLIDER_GRAB_DISTANCE) {
            startMenuSliderGrab('right');
        }
    }
}

// --- Pointer Menu Panel open / close ---

function animatePointerMenuButtonPress() {
    gsap.killTweensOf(pointerMenuButton.scale);
    gsap.killTweensOf(pointerMenuButtonPressAnim);
    pointerMenuButton.visible = true;

    const pressDepth = -0.02;
    const scaleUp = 1.3;
    const pressDuration = 0.15;
    const returnDuration = 0.15;
    const returnDelay = 0.075;
    const tl = gsap.timeline();
    tl.to(pointerMenuButton.scale,    { x: scaleUp, y: scaleUp, z: 1, duration: pressDuration,  ease: 'power2.out' }, 0);
    tl.to(pointerMenuButtonPressAnim, { depthOffset: pressDepth,        duration: pressDuration,  ease: 'power2.out' }, 0);
    tl.to(pointerMenuButton.scale,    { x: 1, y: 1, z: 1,               duration: returnDuration, ease: 'power2.out' }, pressDuration + returnDelay);
    tl.to(pointerMenuButtonPressAnim, { depthOffset: 0,                 duration: returnDuration, ease: 'power2.out' }, pressDuration + returnDelay);
}

function animatePointerMenuChildButtonPress(mesh, id) {
    gsap.killTweensOf(mesh.scale);
    gsap.killTweensOf(mesh.position);

    const originalZ     = mesh.position.z;
    const pressDepth    = -0.012;
    const scaleUp       = 1.1;
    const pressDuration = 0.13;
    const returnDuration = 0.15;
    const returnDelay   = 0.06;

    const tl = gsap.timeline();
    tl.to(mesh.scale,    { x: scaleUp, y: scaleUp,        duration: pressDuration,  ease: 'power2.out' }, 0);
    tl.to(mesh.position, { z: originalZ + pressDepth,     duration: pressDuration,  ease: 'power2.out' }, 0);
    // swap texture at the peak — most scaled-up and furthest back
    tl.call(() => { setPointerMenuActiveButton(id); }, null, pressDuration);
    tl.to(mesh.scale,    { x: 1, y: 1,                    duration: returnDuration, ease: 'power2.out' }, pressDuration + returnDelay);
    tl.to(mesh.position, { z: originalZ,                  duration: returnDuration, ease: 'power2.out' }, pressDuration + returnDelay);
    // Close the menu exactly when this button feedback animation completes.
    tl.call(() => {
        if (pointerMenuState.isOpen) closePointerMenu();
    }, null, pressDuration + returnDelay + returnDuration);
}

// --- showUIPanel: button shrinks → panel grows ---
function showUIPanel() {
    deps.UIPanelOn = true;
    UIDistanceConfig.isAnimating = true;

    const tl = gsap.timeline({ onComplete: () => { UIDistanceConfig.isAnimating = false; } });

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

// --- hideUIPanel: panel shrinks → button grows back ---
function hideUIPanel() {
    deps.UIPanelOn = false;
    cancelResetHold();
    releaseMenuSlider(false);
    UIDistanceConfig.isAnimating = true;
    UIButton.position.z = 0;

    const tl = gsap.timeline({ onComplete: () => { UIDistanceConfig.isAnimating = false; } });

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
    }, `-=${UIAnimConfig.panelScaleDuration * 0.3}`);
}

// Initial slot population — page 0 (biconvex / plano-convex / positive meniscus)
spawnInitialSceneObject(
    'prism',
    { x: -0.004, y: -0.051, z: 0.033 },
    { x: 179.469, y: 0.576, z: 56.693 }
);
spawnInitialSceneObject(
    'mirror',
    { x: -0.130, y: -0.160, z: 0.025 },
    { x: -90, y: 0, z: 90 }
);
populateAllSlots();
syncMenuSliderToCurrentStepperMedium();

    const api = {
        xrHeadPlacement,
        UIPlane,
        UIButton,
        slotRefs,
        menuSlider,
        updateUIReferencePositions,
        updateUIRoot,
        checkMenuSliderGrab,
        checkButtonPress,
        checkCloseButtonPress,
        checkPrevNextButtonPress,
        checkStepperNavButtonPress,
        checkResetButtonPress,
        checkPointerMenuButtonPress,
        checkPointerMenuChildButtonsPress,
        updateMenuSliderGrabDotResting,
        populateSlot,
        populateAllSlots,
        syncMenuSliderToCurrentStepperMedium,
        setSlotGhostState
    };
    Object.assign(deps, api);
    return api;
}
