import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import gsap from 'gsap';
import { createFixedShapeTextMesh, loadHelvetikerBold, updateFixedShapeTextMesh } from './XRText.js';

export function createObjectManipulation(deps) {
    const {
        scene, camera, renderer,
        containerGroup, sceneOpticalMeshes, OPTICAL_PAGES, SHARED_MESH_GEOMS,
        disposeMeshNameLabel, redrawNameLabel, typeInScene,
        mirrorsAvailableCount, acquireMirrorNumber, releaseMirrorNumber, addSceneInstance,
        pointerGrab, DISPERSION_BANDS, DISPERSION_LINEWIDTH, THREE_RAY_SPACING,
        hand1, hand2, lThumbObj, lIndexObj, rThumbObj, rIndexObj, _camWorldPos,
    } = deps;
    const getPinchMidWorld = (...args) => deps.getPinchMidWorld(...args);
    const getWristWorldQuaternion = (...args) => deps.getWristWorldQuaternion(...args);
    if (deps.currentMenuPage === undefined) deps.currentMenuPage = 0;
    if (deps.activeLabelCount === undefined) deps.activeLabelCount = 0;
// ==========================================
// SINGLE-HAND OBJECT MANIPULATION
// ==========================================

const OBJECT_GRAB_RADIUS = 0.075;

// Menu-slot state — one mesh per slot, parented to slotRef0/1/2 (set up below in the UI section)
const slotMeshes = [null, null, null];

/**
 * Ghost silhouettes — one per slot, parented to the same slotRef as its real preview.
 * Shown only while the slot's type is currently in the scene (the real preview is absent),
 * so the empty slot still communicates which shape belongs there and the returning 3D
 * object snaps back into its own outline.
 *
 * Each ghost owns its own cloned material so opacity can be tweened independently for the
 * pull-out fade-in and the respawn fade-out.
 */
const slotGhostMeshes = [null, null, null];
const SLOT_GHOST_OPACITY = 0.18;
/** Fade-in duration when the real preview is pulled out of a slot. */
const SLOT_GHOST_FADE_IN_DURATION  = 0.25;
/** Fade-out duration when the real preview respawns — matches the scale-up so they finish together. */
const SLOT_GHOST_FADE_OUT_DURATION = 0.30;
const slotGhostMaterialTemplate = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: SLOT_GHOST_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide
});



function makeObjectGrabState() {
    return {
        active: false,
        /** @type {THREE.Mesh | null} */
        object: null,
        /** @type {'left' | 'right' | null} */
        hand: null,
        initialPinchLocal: new THREE.Vector3(),
        initialObjectLocalPos: new THREE.Vector3(),
        initialObjectLocalQuat: new THREE.Quaternion(),
        initialWristLocalQuat: new THREE.Quaternion(),
        objectOffsetFromPinchLocal: new THREE.Vector3(),
        /**
         * True once the held object has moved outside the UI return zone at least once.
         * Prevents objects freshly pulled from a slot from snapping right back if the user
         * releases them before carrying them out.
         */
        hasLeftUIArea: false
    };
}

const objectGrab = {
    left: makeObjectGrabState(),
    right: makeObjectGrabState()
};

const _grabCurrentPinchWorld = new THREE.Vector3();
const _grabCurrentPinchLocal = new THREE.Vector3();
const _grabCurrentWristWorldQuat = new THREE.Quaternion();
const _grabCurrentWristLocalQuat = new THREE.Quaternion();
const _grabContainerWorldQuat = new THREE.Quaternion();
const _grabDeltaQuat = new THREE.Quaternion();
const _grabInitialWristLocalQuatInv = new THREE.Quaternion();
const _grabNewObjectLocalPos = new THREE.Vector3();
const _grabNewObjectLocalQuat = new THREE.Quaternion();
const _grabTempPos = new THREE.Vector3();
const _grabTempScale = new THREE.Vector3();
const _grabCandidateCenter = new THREE.Vector3();

function getGrabState(handSide) {
    return handSide === 'left' ? objectGrab.left : objectGrab.right;
}

function getOtherGrabState(handSide) {
    return handSide === 'left' ? objectGrab.right : objectGrab.left;
}

function getNearestGrabbableObject(handSide, pinchWorld, maxRadius) {
    const otherState = getOtherGrabState(handSide);
    let nearest = null;
    let nearestDistSq = maxRadius * maxRadius;

    // Existing scene instances
    for (let i = 0; i < sceneOpticalMeshes.length; i++) {
        const candidate = sceneOpticalMeshes[i];
        if (otherState.active && otherState.object === candidate) continue;
        candidate.getWorldPosition(_grabCandidateCenter);
        const distSq = pinchWorld.distanceToSquared(_grabCandidateCenter);
        if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearest = candidate;
        }
    }

    // Slot previews — only pickable while the menu panel is actually on screen
    if (deps.UIPanelOn && deps.UIPlane.visible) {
        for (let i = 0; i < slotMeshes.length; i++) {
            const candidate = slotMeshes[i];
            if (!candidate) continue;
            if (otherState.active && otherState.object === candidate) continue;
            candidate.getWorldPosition(_grabCandidateCenter);
            const distSq = pinchWorld.distanceToSquared(_grabCandidateCenter);
            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearest = candidate;
            }
        }
    }

    return nearest;
}

const _slotTransferWorldMatrix = new THREE.Matrix4();
const _slotTransferContainerInv = new THREE.Matrix4();
const _slotTransferPos = new THREE.Vector3();
const _slotTransferQuat = new THREE.Quaternion();
const _slotTransferScale = new THREE.Vector3();

/**
 * Promote a slot-preview mesh to a full scene instance:
 *   - Reparent from slotRef[N] → containerGroup, preserving world transform
 *   - Register with sceneOpticalMeshes + create its name label
 *   - Mark the type as "in scene" so the slot stays empty (one instance per type)
 */
function transferSlotMeshToScene(mesh) {
    const slotIndex = mesh.userData.slotIndex;
    if (typeof slotIndex !== 'number') return;

    const isMirror = mesh.userData.typeKey === 'mirror';

    mesh.updateMatrixWorld(true);
    _slotTransferWorldMatrix.copy(mesh.matrixWorld);

    // slotRefs is created in MenuUI.js, which initializes after this module — look it up
    // on deps at call time (always populated by the time a slot mesh can actually be grabbed).
    const slot = deps.slotRefs[slotIndex];
    slot.remove(mesh);

    containerGroup.updateMatrixWorld(true);
    _slotTransferContainerInv.copy(containerGroup.matrixWorld).invert();
    _slotTransferWorldMatrix.premultiply(_slotTransferContainerInv);
    _slotTransferWorldMatrix.decompose(_slotTransferPos, _slotTransferQuat, _slotTransferScale);

    mesh.position.copy(_slotTransferPos);
    mesh.quaternion.copy(_slotTransferQuat);
    mesh.scale.copy(_slotTransferScale);

    containerGroup.add(mesh);
    delete mesh.userData.slotIndex;

    if (isMirror) {
        // Assign a unique number BEFORE addSceneInstance so the freshly-created label reads it.
        mesh.userData.mirrorNumber = acquireMirrorNumber();
    } else {
        typeInScene.add(mesh.userData.typeKey);
    }
    addSceneInstance(mesh);

    slotMeshes[slotIndex] = null;

    if (isMirror && mirrorsAvailableCount() > 0) {
        // Mirrors remain available — spawn a fresh slot preview immediately so the slot is
        // never visually empty until the cap is reached. No ghost transition needed.
        deps.populateSlot(slotIndex, 0);
    } else {
        // Last instance taken (or non-mirror type): fade the ghost silhouette in.
        // setSlotGhostState is defined in MenuUI.js, which initializes after this module —
        // look it up on deps at call time, same as slotRefs/populateSlot above.
        deps.setSlotGhostState(slotIndex, true, SLOT_GHOST_FADE_IN_DURATION);
    }
}

function startObjectGrab(handSide) {
    const state = getGrabState(handSide);
    const isLeft = handSide === 'left';
    const hand = isLeft ? hand1 : hand2;
    if (!hand || state.active) return false;

    getPinchMidWorld(isLeft, _grabCurrentPinchWorld);
    const target = getNearestGrabbableObject(handSide, _grabCurrentPinchWorld, OBJECT_GRAB_RADIUS);
    if (!target) return false;

    // If the user is picking a slot preview, materialize it into the scene before the grab takes effect
    if (typeof target.userData.slotIndex === 'number') {
        transferSlotMeshToScene(target);
    }

    containerGroup.updateMatrixWorld(true);
    containerGroup.worldToLocal(_grabCurrentPinchLocal.copy(_grabCurrentPinchWorld));
    state.initialPinchLocal.copy(_grabCurrentPinchLocal);

    state.initialObjectLocalPos.copy(target.position);
    state.initialObjectLocalQuat.copy(target.quaternion);

    state.objectOffsetFromPinchLocal
        .copy(state.initialObjectLocalPos)
        .sub(state.initialPinchLocal);

    state.active = true;
    state.object = target;
    state.hand = handSide;
    state.hasLeftUIArea = false;
    if (!getWristWorldQuaternion(hand, _grabCurrentWristWorldQuat)) {
        _grabCurrentWristWorldQuat.identity();
    }
    containerGroup.getWorldQuaternion(_grabContainerWorldQuat);
    state.initialWristLocalQuat
        .copy(_grabContainerWorldQuat)
        .invert()
        .multiply(_grabCurrentWristWorldQuat);
    return true;
}

// Short lockout after any grab release — prevents the open-menu / close-panel / nav buttons
// from firing in the same frame (or frames) that an object is dropped.
// Ticked down every frame in App.js and read from MenuUI.js — kept live on deps (not a
// local let) so both modules always see the current value instead of a stale snapshot.
deps.grabReleaseCooldown = 0;
const GRAB_RELEASE_LOCKOUT = 0.35; // seconds

function stopObjectGrab(handSide) {
    const state = getGrabState(handSide);
    state.active = false;
    state.object = null;
    state.hand = null;
    deps.grabReleaseCooldown = GRAB_RELEASE_LOCKOUT;
}

// ==========================================
// RETURN OBJECT TO SLOT (release near panel/button → scale down → repopulate slot → scale up)
// ==========================================

/** Distances (in world meters) within which a release sends the object back to its slot. */
const RETURN_TO_PANEL_DIST  = 0.22;
const RETURN_TO_BUTTON_DIST = 0.10;

/** GSAP durations for the release animation. */
const RETURN_SCALE_DOWN_DURATION = 0.2;
const RETURN_SCALE_UP_DURATION   = 0.30;

/** typeKey → { page, slot } — built once from OPTICAL_PAGES for fast lookup. */
const TYPE_KEY_LOCATIONS = (() => {
    const map = new Map();
    for (let p = 0; p < OPTICAL_PAGES.length; p++) {
        for (let s = 0; s < OPTICAL_PAGES[p].length; s++) {
            map.set(OPTICAL_PAGES[p][s], { page: p, slot: s });
        }
    }
    return map;
})();

const _returnUITargetWorldPos = new THREE.Vector3();
const _returnMeshWorldPos     = new THREE.Vector3();

/**
 * Meshes currently mid-shrink in returnObjectToSlot(). They're removed from sceneOpticalMeshes
 * so they can't be grabbed or ray-traced while shrinking — but the sphere-outline updater still
 * reads from this list so the outline tracks the mesh scale all the way down to 0.
 */
const returningMeshes = [];

/** True if `mesh` was released close enough to the active UI (open panel or visible button). */
function isReleasedNearUI(mesh) {
    if (!renderer.xr.isPresenting) return false;
    mesh.getWorldPosition(_returnMeshWorldPos);

    if (deps.UIPanelOn && deps.UIPlane.visible) {
        deps.UIPlane.getWorldPosition(_returnUITargetWorldPos);
        if (_returnMeshWorldPos.distanceTo(_returnUITargetWorldPos) < RETURN_TO_PANEL_DIST) return true;
    }
    if (deps.UIButton.visible) {
        deps.UIButton.getWorldPosition(_returnUITargetWorldPos);
        if (_returnMeshWorldPos.distanceTo(_returnUITargetWorldPos) < RETURN_TO_BUTTON_DIST) return true;
    }
    return false;
}

/** Full cleanup of a scene instance — registry removal, label/outline disposal, geometry/material disposal. */
function removeSceneInstance(mesh) {
    const idx = sceneOpticalMeshes.indexOf(mesh);
    if (idx >= 0) sceneOpticalMeshes.splice(idx, 1);

    disposeMeshNameLabel(mesh);

    if (mesh.userData.sphereOutline) {
        const outline = mesh.userData.sphereOutline;
        if (outline.parent) outline.parent.remove(outline);
        mesh.userData.sphereOutline = null;
    }

    if (mesh.parent) mesh.parent.remove(mesh);

    mesh.traverse(child => {
        if (child.isLineSegments && child.material && typeof child.material.dispose === 'function') {
            child.material.dispose();
        }
        if (child.isLineSegments && child.geometry && typeof child.geometry.dispose === 'function') {
            child.geometry.dispose();
        }
    });
    if (mesh.geometry && SHARED_MESH_GEOMS.indexOf(mesh.geometry) < 0) {
        mesh.geometry.dispose();
    }
}

/**
 * Scale the scene mesh down to 0, fully remove it, then — if its page is currently visible
 * in the open panel — repopulate that slot and scale the preview up from 0 to 1.
 */
function returnObjectToSlot(mesh) {
    const typeKey  = mesh.userData.typeKey;
    const location = TYPE_KEY_LOCATIONS.get(typeKey);
    const isMirror = typeKey === 'mirror';

    // Capture the slot's pre-release state: was it ghost-only (no real preview) before the return?
    // This determines whether we need to repopulate + scale-up animate (was at cap) or simply
    // refresh the existing preview's "Mirror (N)" label text.
    const slotWasGhostOnly = isMirror && mirrorsAvailableCount() === 0;

    // Deactivate immediately so it can't be re-grabbed or ray-traced while shrinking
    const idx = sceneOpticalMeshes.indexOf(mesh);
    if (idx >= 0) sceneOpticalMeshes.splice(idx, 1);

    if (isMirror) {
        releaseMirrorNumber(mesh.userData.mirrorNumber);
        delete mesh.userData.mirrorNumber;
    } else {
        typeInScene.delete(typeKey);
    }

    // Keep the sphere-outline updater in sync with the shrink animation
    returningMeshes.push(mesh);

    if (mesh.userData.nameLabel) mesh.userData.nameLabel.visible = false;

    gsap.to(mesh.scale, {
        x: 0, y: 0, z: 0,
        duration: RETURN_SCALE_DOWN_DURATION,
        ease: 'power2.in',
        onComplete: () => {
            const retIdx = returningMeshes.indexOf(mesh);
            if (retIdx >= 0) returningMeshes.splice(retIdx, 1);

            removeSceneInstance(mesh);

            if (!location) return;
            if (location.page !== deps.currentMenuPage) return;

            // Mirror returning while the slot still has a preview: just refresh its "Mirror (N)"
            // label text — no respawn animation needed since the preview never disappeared.
            if (isMirror && !slotWasGhostOnly) {
                const slotMesh = slotMeshes[location.slot];
                if (slotMesh) redrawNameLabel(slotMesh);
                return;
            }

            // All other paths: non-mirror return, or mirror return when the slot was at cap
            // (ghost-only). Repopulate and play the scale-up animation if the panel is visible.
            const ghostFade = deps.UIPanelOn ? SLOT_GHOST_FADE_OUT_DURATION : 0;
            deps.populateSlot(location.slot, ghostFade);
            const slotMesh = slotMeshes[location.slot];
            if (!slotMesh) return;

            if (!deps.UIPanelOn) return;

            // Capture the factory's native scale (some lens factories set non-unit scales)
            // so we animate back to the correct target, not to (1,1,1).
            const targetX = slotMesh.scale.x;
            const targetY = slotMesh.scale.y;
            const targetZ = slotMesh.scale.z;

            slotMesh.scale.set(0, 0, 0);
            gsap.to(slotMesh.scale, {
                x: targetX, y: targetY, z: targetZ,
                duration: RETURN_SCALE_UP_DURATION,
                ease: 'power2.out'
            });
        }
    });
}

function applyObjectGrab(handSide) {
    const state = getGrabState(handSide);
    if (!state.active || !state.object) return false;

    const isLeft = handSide === 'left';
    const hand = isLeft ? hand1 : hand2;
    if (!hand) {
        stopObjectGrab(handSide);
        return false;
    }

    getPinchMidWorld(isLeft, _grabCurrentPinchWorld);
    containerGroup.updateMatrixWorld(true);
    containerGroup.worldToLocal(_grabCurrentPinchLocal.copy(_grabCurrentPinchWorld));

    if (!getWristWorldQuaternion(hand, _grabCurrentWristWorldQuat)) {
        _grabCurrentWristWorldQuat.identity();
    }
    containerGroup.getWorldQuaternion(_grabContainerWorldQuat);
    _grabCurrentWristLocalQuat
        .copy(_grabContainerWorldQuat)
        .invert()
        .multiply(_grabCurrentWristWorldQuat);

    _grabDeltaQuat
        .copy(_grabCurrentWristLocalQuat)
        .multiply(_grabInitialWristLocalQuatInv.copy(state.initialWristLocalQuat).invert());

    _grabNewObjectLocalQuat.copy(_grabDeltaQuat).multiply(state.initialObjectLocalQuat);

    _grabNewObjectLocalPos
        .copy(state.objectOffsetFromPinchLocal)
        .applyQuaternion(_grabDeltaQuat)
        .add(_grabCurrentPinchLocal);

    state.object.position.copy(_grabTempPos.copy(_grabNewObjectLocalPos));
    state.object.quaternion.copy(_grabNewObjectLocalQuat);

    // Arm the return-to-slot gesture only once the object has been carried outside the UI zone.
    if (!state.hasLeftUIArea && !isReleasedNearUI(state.object)) {
        state.hasLeftUIArea = true;
    }

    return true;
}

/** World-space red beam from pointer local +Z while grab is active */
const POINTER_LASER_MAX_LENGTH = 4.5;
const POINTER_LASER_ORIGIN_OFFSET = 0.008;
/** World-space half-width of the fat beam (~8 mm full width in XR) */
const POINTER_LASER_LINEWIDTH = 0.003;

// ------------------------------------------------------------------
// PERF: all laser rays are packed into TWO merged LineSegments2 meshes
// (one for 1-ray / 3-ray, one vertex-colored for the 7 dispersion bands)
// so the whole laser costs 1 draw call instead of up to 7. Buffers are
// preallocated at max capacity; per frame we only rewrite the interleaved
// instance buffers in place and cap instanceCount — no dispose/recreate,
// no array copies, no GPU buffer reallocation.
// ------------------------------------------------------------------
const MAX_RAY_POINTS = 26;   // = RAY_MAX_BOUNCES (24) + 2
const MAX_RAY_SEGMENTS = MAX_RAY_POINTS - 1;
const LASER_SEG_CAPACITY = MAX_RAY_SEGMENTS * 3;                        // main + 2 side rays
const DISPERSION_SEG_CAPACITY = MAX_RAY_SEGMENTS * DISPERSION_BANDS.length;

function makeSegmentsGeometry(segCapacity, withColors) {
    const geom = new LineSegmentsGeometry();
    // Allocates instanceStart/instanceEnd interleaved buffers at full capacity.
    geom.setPositions(new Float32Array(segCapacity * 6));
    geom.attributes.instanceStart.data.setUsage(THREE.DynamicDrawUsage);
    if (withColors) {
        geom.setColors(new Float32Array(segCapacity * 6));
        geom.attributes.instanceColorStart.data.setUsage(THREE.DynamicDrawUsage);
    }
    geom.instanceCount = 0;
    return geom;
}

/**
 * Append one traced polyline (flat xyz point list) into a segment buffer
 * starting at segment index `segOffset`. Returns the number of segments written.
 */
function appendPolylineSegments(arr, segOffset, positions) {
    const segCount = Math.min((positions.length / 3) - 1, MAX_RAY_SEGMENTS);
    for (let s = 0; s < segCount; s++) {
        const p = s * 3;
        const o = (segOffset + s) * 6;
        arr[o]     = positions[p];
        arr[o + 1] = positions[p + 1];
        arr[o + 2] = positions[p + 2];
        arr[o + 3] = positions[p + 3];
        arr[o + 4] = positions[p + 4];
        arr[o + 5] = positions[p + 5];
    }
    return segCount;
}

const pointerLaserMat = new LineMaterial({
    color: 0xff1515,
    linewidth: POINTER_LASER_LINEWIDTH,
    worldUnits: true,
    transparent: true,
    opacity: 1,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
pointerLaserMat.toneMapped = false;
pointerLaserMat.resolution.set(
    renderer.domElement.width,
    renderer.domElement.height
);

/** Main ray + both 3-ray side rays share this single mesh/draw call (1-ray / 3-ray modes). */
const laserSegments = new LineSegments2(makeSegmentsGeometry(LASER_SEG_CAPACITY, false), pointerLaserMat);
laserSegments.visible = deps.laserMode !== 'dispersion';
laserSegments.frustumCulled = false; // set once — dynamic line bounds
laserSegments.renderOrder = 50;
scene.add(laserSegments);

/** All 7 dispersion bands share this single vertex-colored mesh/draw call. */
const dispersionMat = new LineMaterial({
    color: 0xffffff,
    vertexColors: true,
    linewidth: DISPERSION_LINEWIDTH,
    worldUnits: true,
    transparent: true,
    opacity: 0.8,
    depthTest: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
});
dispersionMat.toneMapped = false;
dispersionMat.resolution.set(renderer.domElement.width, renderer.domElement.height);

// Matches material.color hex handling (sRGB → working color space).
const DISPERSION_BAND_RGB = DISPERSION_BANDS.map((band) => new THREE.Color(band.color));

const dispersionSegments = new LineSegments2(makeSegmentsGeometry(DISPERSION_SEG_CAPACITY, true), dispersionMat);
dispersionSegments.visible = deps.laserMode === 'dispersion';
dispersionSegments.frustumCulled = false;
dispersionSegments.renderOrder = 50;
scene.add(dispersionSegments);

/** World-space tick through each hit point along the mesh geometric normal (entry / exit / mirror). */
const NORMAL_VIZ_HALF_LEN = 0.034;

// PERF: preallocated buffers for normal ticks + angle arcs (1-ray mode only).
// Max 24 hits per ray; ticks use 2 vertices per hit, arcs 12 segments per hit.
const MAX_NORMAL_TICK_VERTS = 24 * 2;
const MAX_ARC_VERTS = 24 * 12 * 2;

function makeDynamicSegmentAttributes(geom, maxVerts, withLineDistances = false) {
    const posAttr = new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3);
    posAttr.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('position', posAttr);
    if (withLineDistances) {
        const distAttr = new THREE.BufferAttribute(new Float32Array(maxVerts), 1);
        distAttr.setUsage(THREE.DynamicDrawUsage);
        geom.setAttribute('lineDistance', distAttr);
    }
    geom.setDrawRange(0, 0);
    return posAttr;
}

/** Copy a flat segment array into a preallocated attribute and set the draw range. */
function uploadSegmentsInPlace(geom, flat) {
    const posAttr = geom.attributes.position;
    const floatCount = Math.min(flat.length, posAttr.array.length);
    for (let i = 0; i < floatCount; i++) posAttr.array[i] = flat[i];
    posAttr.needsUpdate = true;
    geom.setDrawRange(0, floatCount / 3);
    return floatCount / 3;
}

const normalsVizGeom = new THREE.BufferGeometry();
const normalsVizMat = new THREE.LineDashedMaterial({
    color: 0xffffff,
    dashSize: 0.004,
    gapSize: 0.004,
    opacity: 1.0,
    depthTest: false,
    depthWrite: false
});
makeDynamicSegmentAttributes(normalsVizGeom, MAX_NORMAL_TICK_VERTS, true);
const normalsVizLines = new THREE.LineSegments(normalsVizGeom, normalsVizMat);
normalsVizLines.visible = false;
normalsVizLines.frustumCulled = false;
scene.add(normalsVizLines);

/**
 * Fill the preallocated lineDistance attribute for the dashed normal ticks —
 * same cumulative distances THREE.LineSegments.computeLineDistances() produces,
 * but without allocating a new attribute every frame.
 */
function updateNormalsVizLineDistances(vertCount) {
    const pos = normalsVizGeom.attributes.position.array;
    const dist = normalsVizGeom.attributes.lineDistance;
    const dArr = dist.array;
    let cum = 0;
    for (let v = 0; v + 1 < vertCount; v += 2) {
        const i = v * 3;
        const dx = pos[i + 3] - pos[i];
        const dy = pos[i + 4] - pos[i + 1];
        const dz = pos[i + 5] - pos[i + 2];
        dArr[v] = cum;
        cum += Math.sqrt(dx * dx + dy * dy + dz * dz);
        dArr[v + 1] = cum;
    }
    dist.needsUpdate = true;
}

/** Angle-arc visualization: θ₁ (incident) in cyan, θ₂ (refracted/reflected) in yellow */
const ANGLE_ARC_RADIUS = 0.012;
const ANGLE_ARC_SEGMENTS = 12;
const ANGLE_LABEL_OFFSET = 0.008;
const ANGLE_LABEL_MIRROR_TANGENT_SPLIT = 0.003;

const _theta1ArcFlat = [];
const _theta2ArcFlat = [];
const _angleLabelEntries = [];

const theta1ArcGeom = new THREE.BufferGeometry();
const theta1ArcMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false
});
makeDynamicSegmentAttributes(theta1ArcGeom, MAX_ARC_VERTS);
const theta1ArcLines = new THREE.LineSegments(theta1ArcGeom, theta1ArcMat);
theta1ArcLines.visible = false;
theta1ArcLines.frustumCulled = false;
scene.add(theta1ArcLines);

const theta2ArcGeom = new THREE.BufferGeometry();
const theta2ArcMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false
});
makeDynamicSegmentAttributes(theta2ArcGeom, MAX_ARC_VERTS);
const theta2ArcLines = new THREE.LineSegments(theta2ArcGeom, theta2ArcMat);
theta2ArcLines.visible = false;
theta2ArcLines.frustumCulled = false;
scene.add(theta2ArcLines);

const MAX_ANGLE_LABELS = 16;
/** Fixed em size — 57px equivalent in the original 80px-tall canvas. */
const ANGLE_LABEL_WORLD_H = 0.01936 * 0.6;
const ANGLE_LABEL_FONT_SIZE = ANGLE_LABEL_WORLD_H * (57 / 80);
const angleLabelPool = [];
let angleLabelFont = null;

loadHelvetikerBold().then((font) => {
    angleLabelFont = font;
    for (let i = 0; i < MAX_ANGLE_LABELS; i++) {
        const mesh = createFixedShapeTextMesh(font, '', {
            fontSize: ANGLE_LABEL_FONT_SIZE,
            color: 0xffffff,
        });
        mesh.visible = false;
        scene.add(mesh);
        angleLabelPool.push({ mesh, lastText: '', lastColor: '#ffffff' });
    }
});
const _labelCamDir = new THREE.Vector3();

function updateAngleLabelBillboards() {
    camera.getWorldPosition(_camWorldPos);
    for (let i = 0; i < deps.activeLabelCount; i++) {
        const mesh = angleLabelPool[i].mesh;
        if (!mesh.visible) continue;
        _labelCamDir.subVectors(_camWorldPos, mesh.position);
        _labelCamDir.y = 0;
        if (_labelCamDir.lengthSq() > 1e-8) {
            mesh.rotation.y = Math.atan2(_labelCamDir.x, _labelCamDir.z);
        }
    }
}

function drawAngleLabel(index, text, x, y, z, cssColor) {
    if (!angleLabelFont || index >= angleLabelPool.length) return;
    const label = angleLabelPool[index];
    if (label.lastText !== text || label.lastColor !== cssColor) {
        updateFixedShapeTextMesh(label.mesh, angleLabelFont, text, cssColor);
        label.lastText = text;
        label.lastColor = cssColor;
    }
    label.mesh.position.set(x, y, z);
    label.mesh.visible = true;
}

function hideUnusedLabels() {
    if (angleLabelPool.length === 0) return;
    for (let i = deps.activeLabelCount; i < angleLabelPool.length; i++) {
        angleLabelPool[i].mesh.visible = false;
    }
}


    const api = {
        objectGrab,
        slotMeshes,
        slotGhostMeshes,
        returningMeshes,
        startObjectGrab,
        stopObjectGrab,
        applyObjectGrab,
        returnObjectToSlot,
        isReleasedNearUI,
        removeSceneInstance,
        TYPE_KEY_LOCATIONS,
        slotGhostMaterialTemplate,
        SLOT_GHOST_OPACITY,
        laserSegments,
        dispersionSegments,
        pointerLaserMat,
        dispersionMat,
        appendPolylineSegments,
        MAX_RAY_SEGMENTS,
        hideUnusedLabels,
        drawAngleLabel,
        angleLabelPool,
        normalsVizLines,
        theta1ArcLines,
        theta2ArcLines,
        normalsVizGeom,
        theta1ArcGeom,
        theta2ArcGeom,
        uploadSegmentsInPlace,
        updateNormalsVizLineDistances,
        DISPERSION_BAND_RGB,
        updateAngleLabelBillboards,
        POINTER_LASER_MAX_LENGTH,
        POINTER_LASER_ORIGIN_OFFSET,
        NORMAL_VIZ_HALF_LEN,
        ANGLE_ARC_RADIUS,
        ANGLE_ARC_SEGMENTS,
        ANGLE_LABEL_OFFSET,
        ANGLE_LABEL_MIRROR_TANGENT_SPLIT,
        _theta1ArcFlat,
        _theta2ArcFlat,
        _angleLabelEntries
    };
    Object.assign(deps, api);
    return api;
}
