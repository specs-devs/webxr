import * as THREE from 'three';
import { createPinchTracker, createJumpGuard } from './HandPinch.js';
export function createHandTracking(deps) {
    const { scene, renderer } = deps;

    const pinchTracker = createPinchTracker({
        pinchClose: 0.02,
        pinchOpen: 0.03,
        settleMs: 10,
    });

    const TWO_HAND_SETTLE_MS = 20;
    const MAX_HAND_JUMP_PER_FRAME = 0.08;
    const leftPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
    const rightPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);

    const pinchState = { left: false, right: false };

    const lThumbObj = new THREE.Object3D();
    const lIndexObj = new THREE.Object3D();
    const rThumbObj = new THREE.Object3D();
    const rIndexObj = new THREE.Object3D();

    scene.add(lThumbObj, lIndexObj, rThumbObj, rIndexObj);

    const hand1 = renderer.xr.getHand(0);
    const hand2 = renderer.xr.getHand(1);
    scene.add(hand1, hand2);

    deps.disableFrustumCulling(scene);

function handTracking() {
    // Only copy joint poses when visibly tracked (avoids stale/off-screen positions)
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
    pinchState.left = pinchTracker.left.pinching && pinchTracker.left.tracked;
    pinchState.right = pinchTracker.right.pinching && pinchTracker.right.tracked;
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
        rIndexObj
    };
    Object.assign(deps, api);
    return api;
}
