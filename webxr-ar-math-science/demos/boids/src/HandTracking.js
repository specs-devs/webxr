import * as THREE from 'three';
import { createPinchTracker, createJumpGuard } from './HandPinch.js';

export function createHandTracking(deps) {
    const { scene, renderer } = deps;

const pinchTracker = createPinchTracker({
    pinchClose: 0.02,
    pinchOpen: 0.03,
    settleMs: 10,
});

/** Extra settle before a two-handed gesture may capture its baseline (ms). */
const TWO_HAND_SETTLE_MS = 20;

/**
 * Physically implausible per-frame hand travel (m). A jump beyond this while a
 * two-handed manip is active re-bases instead of applying a huge delta (incl. scale).
 */
const MAX_HAND_JUMP_PER_FRAME = 0.08;
const leftPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
const rightPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);

const _inverseQuat = new THREE.Quaternion();

/**
 * Joint References — empty Object3Ds (position only, no depth occlusion)
 */
const lThumbObj = new THREE.Object3D();
const lIndexObj = new THREE.Object3D();
const rThumbObj = new THREE.Object3D();
const rIndexObj = new THREE.Object3D();

scene.add(lThumbObj);
scene.add(lIndexObj);
scene.add(rThumbObj);
scene.add(rIndexObj);

/**
 * Hands — XR joint tracking only (no visual hand mesh)
 */
const hand1 = renderer.xr.getHand(0);
const hand2 = renderer.xr.getHand(1);
scene.add(hand1);
scene.add(hand2);

function handTracking() {
    // Pre-compute inverse quaternion for world-to-local conversion
    _inverseQuat.copy(deps.boidsGroup.quaternion).invert();
    const containerScale = deps.boidsGroup.scale.x;
    
    // Track left hand position for boid interaction (using index finger tip)
    // Convert world position to local space (accounting for position, rotation, and scale)
    if (hand1 && hand1.joints && hand1.joints['index-finger-tip']) {
        const joint = hand1.joints['index-finger-tip'];
        deps.handPositions.left.copy(joint.position)
            .sub(deps.boidsGroup.position)
            .applyQuaternion(_inverseQuat)
            .divideScalar(containerScale);
        deps.handPositions.leftActive = true;
    } else {
        deps.handPositions.leftActive = false;
    }
    
    // Track right hand position for boid interaction (using index finger tip)
    // Convert world position to local space (accounting for position, rotation, and scale)
    if (hand2 && hand2.joints && hand2.joints['index-finger-tip']) {
        const joint = hand2.joints['index-finger-tip'];
        deps.handPositions.right.copy(joint.position)
            .sub(deps.boidsGroup.position)
            .applyQuaternion(_inverseQuat)
            .divideScalar(containerScale);
        deps.handPositions.rightActive = true;
    } else {
        deps.handPositions.rightActive = false;
    }
    
    // Left Hand Joint References (only when joints are tracked / visible)
    if (hand1 && hand1.joints && hand1.joints['thumb-tip'] && hand1.joints['thumb-tip'].visible) {
        const joint = hand1.joints['thumb-tip'];
        lThumbObj.position.copy(joint.position);
        lThumbObj.rotation.copy(joint.rotation);
    }

    if (hand1 && hand1.joints && hand1.joints['index-finger-tip'] && hand1.joints['index-finger-tip'].visible) {
        const joint = hand1.joints['index-finger-tip'];
        lIndexObj.position.copy(joint.position);
        lIndexObj.rotation.copy(joint.rotation);
    }

    // Right Hand Joint References
    if (hand2 && hand2.joints && hand2.joints['thumb-tip'] && hand2.joints['thumb-tip'].visible) {
        const joint = hand2.joints['thumb-tip'];
        rThumbObj.position.copy(joint.position);
        rThumbObj.rotation.copy(joint.rotation);
    }

    if (hand2 && hand2.joints && hand2.joints['index-finger-tip'] && hand2.joints['index-finger-tip'].visible) {
        const joint = hand2.joints['index-finger-tip'];
        rIndexObj.position.copy(joint.position);
        rIndexObj.rotation.copy(joint.rotation);
    }

    // Tracking-gated, debounced pinch — untracked hands never register as pinching
    pinchTracker.update({ left: hand1, right: hand2 });
}


    const api = {
        handTracking,
        hand1,
        hand2,
        pinchTracker,
        leftPinchJumpGuard,
        rightPinchJumpGuard,
        TWO_HAND_SETTLE_MS,
        lThumbObj,
        lIndexObj,
        rThumbObj,
        rIndexObj
    };
    Object.assign(deps, api);
    return api;
}
