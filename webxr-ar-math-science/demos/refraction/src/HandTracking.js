import * as THREE from 'three';
import { createPinchTracker, createJumpGuard } from './HandPinch.js';

export function createHandTracking(deps) {
    const { scene, renderer } = deps;
// ==========================================
// HAND TRACKING
// ==========================================

// Pinch state tracking.
// pinchState is derived from pinchTracker each frame: it is tracking-gated
// (an untracked / off-screen hand never reads as pinching), debounced, and
// hysteresis-filtered. See handPinch.js.
const pinchState = { left: false, right: false };

const pinchTracker = createPinchTracker({
    pinchClose: 0.02,
    pinchOpen: 0.03,
    settleMs: 10,
});

/** Extra settle before a two-handed gesture may capture its baseline (ms). */
const TWO_HAND_SETTLE_MS = 20;

/**
 * Physically implausible per-frame hand travel (m). A jump beyond this while a
 * two-handed manip is active is treated as a tracking discontinuity and forces
 * a baseline re-base instead of applying the (huge) delta.
 */
const MAX_HAND_JUMP_PER_FRAME = 0.08;
const leftPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
const rightPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);

/** Set true to show pinch-mid and bone2-midpoint debug spheres */
const SHOW_PINCH_AND_MIDPOINT_MARKERS = false;

/**
 * Joint references are non-rendered anchors by default.
 * Optional tiny debug spheres appear only when marker debug is enabled.
 */
function createJointAnchor(debugRadius = 0.002, debugColor = 0xff0000) {
    const anchor = new THREE.Object3D();
    if (SHOW_PINCH_AND_MIDPOINT_MARKERS) {
        const debugGeom = new THREE.SphereGeometry(debugRadius, 16, 16);
        const debugMat = new THREE.MeshBasicMaterial({ color: debugColor });
        anchor.add(new THREE.Mesh(debugGeom, debugMat));
    }
    return anchor;
}

const lThumbObj = createJointAnchor()
const lIndexObj = createJointAnchor()
const rThumbObj = createJointAnchor()
const rIndexObj = createJointAnchor()

scene.add(lThumbObj)
scene.add(lIndexObj)
scene.add(rThumbObj)
scene.add(rIndexObj)

/**
 * Pinch / midpoint markers use empty anchors by default (no geometry, no draw calls).
 * If visual debugging is enabled, attach tiny sphere meshes to these anchors.
 */
function createMarkerAnchor(debugRadius, debugColor) {
    const anchor = new THREE.Object3D();
    anchor.visible = false;
    if (SHOW_PINCH_AND_MIDPOINT_MARKERS) {
        const debugGeom = new THREE.SphereGeometry(debugRadius, 24, 24);
        const debugMat = new THREE.MeshBasicMaterial({ color: debugColor });
        const debugMesh = new THREE.Mesh(debugGeom, debugMat);
        anchor.add(debugMesh);
    }
    scene.add(anchor);
    return anchor;
}

const lPinchSphere = createMarkerAnchor(0.006, 0xffcc66);
const rPinchSphere = createMarkerAnchor(0.006, 0xffcc66);
const lBone2MidSphere = createMarkerAnchor(0.0035, 0xffffff);
const rBone2MidSphere = createMarkerAnchor(0.0035, 0xffffff);

const _thumbSecondFromTip = new THREE.Vector3();
const _indexSecondFromTip = new THREE.Vector3();
const _pinchMidVis = new THREE.Vector3();

/**
 * Hands
 */
var hand1, hand2;

// PERF: no OculusHandModel — the visual hand meshes were hidden anyway
// (handsGroup.visible = false) but still loaded a GLTF and updated ~25 bones
// per hand every frame. Pinch tracking only needs hand.joints, which
// renderer.xr.getHand() provides on its own.
hand1 = renderer.xr.getHand( 0 );
scene.add( hand1 );

hand2 = renderer.xr.getHand( 1 );
scene.add( hand2 );

const handsGroup = new THREE.Group();
handsGroup.add(hand1, hand2);
scene.add(handsGroup);
handsGroup.visible = false;

function handTracking() {
    if (hand1 && hand1.joints && hand1.joints['thumb-tip'] && hand1.joints['thumb-tip'].visible) {
        lThumbObj.position.x = hand1.joints['thumb-tip'].position.x;
        lThumbObj.position.y = hand1.joints['thumb-tip'].position.y;
        lThumbObj.position.z = hand1.joints['thumb-tip'].position.z;
        lThumbObj.rotation.x = hand1.joints['thumb-tip'].rotation.x;
        lThumbObj.rotation.y = hand1.joints['thumb-tip'].rotation.y;
        lThumbObj.rotation.z = hand1.joints['thumb-tip'].rotation.z;
    }

    if (hand1 && hand1.joints && hand1.joints['index-finger-tip'] && hand1.joints['index-finger-tip'].visible) {
        lIndexObj.position.x = hand1.joints['index-finger-tip'].position.x;
        lIndexObj.position.y = hand1.joints['index-finger-tip'].position.y;
        lIndexObj.position.z = hand1.joints['index-finger-tip'].position.z;
        lIndexObj.rotation.x = hand1.joints['index-finger-tip'].rotation.x;
        lIndexObj.rotation.y = hand1.joints['index-finger-tip'].rotation.y;
        lIndexObj.rotation.z = hand1.joints['index-finger-tip'].rotation.z;
    } else {
        lIndexObj.position.set(1e6, 1e6, 1e6);
    }

    const lThumbJ2 = hand1 && hand1.joints && hand1.joints[deps.THUMB_JOINT_SECOND_FROM_TIP];
    const lIndexJ2 = hand1 && hand1.joints && hand1.joints[deps.INDEX_JOINT_SECOND_FROM_TIP];
    if (lThumbJ2 && lIndexJ2 && lThumbJ2.visible && lIndexJ2.visible) {
        _thumbSecondFromTip.set(
            lThumbJ2.position.x,
            lThumbJ2.position.y,
            lThumbJ2.position.z
        );
        _indexSecondFromTip.set(
            lIndexJ2.position.x,
            lIndexJ2.position.y,
            lIndexJ2.position.z
        );
        lBone2MidSphere.position
            .addVectors(_thumbSecondFromTip, _indexSecondFromTip)
            .multiplyScalar(0.5);
        lBone2MidSphere.visible = SHOW_PINCH_AND_MIDPOINT_MARKERS;
    } else {
        lBone2MidSphere.visible = false;
    }

    if (hand2 && hand2.joints && hand2.joints['thumb-tip'] && hand2.joints['thumb-tip'].visible) {
        rThumbObj.position.x = hand2.joints['thumb-tip'].position.x;
        rThumbObj.position.y = hand2.joints['thumb-tip'].position.y;
        rThumbObj.position.z = hand2.joints['thumb-tip'].position.z;
        rThumbObj.rotation.x = hand2.joints['thumb-tip'].rotation.x;
        rThumbObj.rotation.y = hand2.joints['thumb-tip'].rotation.y;
        rThumbObj.rotation.z = hand2.joints['thumb-tip'].rotation.z;
    }

    if (hand2 && hand2.joints && hand2.joints['index-finger-tip'] && hand2.joints['index-finger-tip'].visible) {
        rIndexObj.position.x = hand2.joints['index-finger-tip'].position.x;
        rIndexObj.position.y = hand2.joints['index-finger-tip'].position.y;
        rIndexObj.position.z = hand2.joints['index-finger-tip'].position.z;
        rIndexObj.rotation.x = hand2.joints['index-finger-tip'].rotation.x;
        rIndexObj.rotation.y = hand2.joints['index-finger-tip'].rotation.y;
        rIndexObj.rotation.z = hand2.joints['index-finger-tip'].rotation.z;
    } else {
        rIndexObj.position.set(1e6, 1e6, 1e6);
    }

    const rThumbJ2 = hand2 && hand2.joints && hand2.joints[deps.THUMB_JOINT_SECOND_FROM_TIP];
    const rIndexJ2 = hand2 && hand2.joints && hand2.joints[deps.INDEX_JOINT_SECOND_FROM_TIP];
    if (rThumbJ2 && rIndexJ2 && rThumbJ2.visible && rIndexJ2.visible) {
        _thumbSecondFromTip.set(
            rThumbJ2.position.x,
            rThumbJ2.position.y,
            rThumbJ2.position.z
        );
        _indexSecondFromTip.set(
            rIndexJ2.position.x,
            rIndexJ2.position.y,
            rIndexJ2.position.z
        );
        rBone2MidSphere.position
            .addVectors(_thumbSecondFromTip, _indexSecondFromTip)
            .multiplyScalar(0.5);
        rBone2MidSphere.visible = SHOW_PINCH_AND_MIDPOINT_MARKERS;
    } else {
        rBone2MidSphere.visible = false;
    }

    // Tracking-gated, debounced pinch state. An untracked / off-screen hand
    // (joints not visible) can no longer register a false pinch, which was the
    // root cause of blocked single-hand pinches and first-double-pinch jumps.
    pinchTracker.update({ left: hand1, right: hand2 });
    pinchState.left = pinchTracker.left.pinching;
    pinchState.right = pinchTracker.right.pinching;

    if (pinchState.left) {
        _pinchMidVis.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
        lPinchSphere.position.copy(_pinchMidVis);
        lPinchSphere.visible = SHOW_PINCH_AND_MIDPOINT_MARKERS;
    } else {
        lPinchSphere.visible = false;
    }

    if (pinchState.right) {
        _pinchMidVis.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);
        rPinchSphere.position.copy(_pinchMidVis);
        rPinchSphere.visible = SHOW_PINCH_AND_MIDPOINT_MARKERS;
    } else {
        rPinchSphere.visible = false;
    }
}

    const api = {
        handTracking,
        hand1,
        hand2,
        pinchState,
        pinchTracker,
        leftPinchJumpGuard,
        rightPinchJumpGuard,
        TWO_HAND_SETTLE_MS,
        lThumbObj,
        lIndexObj,
        rThumbObj,
        rIndexObj,
        lPinchSphere,
        rPinchSphere,
        lBone2MidSphere,
        rBone2MidSphere,
        SHOW_PINCH_AND_MIDPOINT_MARKERS
    };
    Object.assign(deps, api);
    return api;
}
