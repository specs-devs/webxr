import * as THREE from 'three';
import { createPinchTracker, createJumpGuard } from './HandPinch.js';

export function createHandTracking(deps) {
    const { scene, renderer } = deps;

// Pinch state tracking (mirrors pinchTracker for existing call sites)
const pinchState = { left: false, right: false };

/** Tracking-gated pinch + settle (see HandPinch.js). */
const pinchTracker = createPinchTracker({
    pinchClose: 0.028,
    pinchOpen: 0.04,
    settleMs: 10,
});

/**
 * Joint References (empty anchors — no mesh, no depth occlusion)
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
 * Pinch References (empty anchors)
 */
const lPinchSphere = new THREE.Object3D();
scene.add(lPinchSphere);

const rPinchSphere = new THREE.Object3D();
scene.add(rPinchSphere);

/**
 * Hands — XRHand joints only (no skinned mesh / OculusHandModel).
 * Tip positions are mirrored onto the empty Object3D anchors above.
 */
var hand1, hand2;

hand1 = renderer.xr.getHand( 0 );
scene.add( hand1 );

hand2 = renderer.xr.getHand( 1 );
scene.add( hand2 );

/** Extra settle before a two-handed gesture may capture its baseline (ms). */
const TWO_HAND_SETTLE_MS = 20;
const MAX_HAND_JUMP_PER_FRAME = 0.08;
const leftPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
const rightPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);

function handTracking() {
    if (hand1?.joints?.['thumb-tip']?.visible) {
        const j = hand1.joints['thumb-tip'];
        lThumbObj.position.copy(j.position);
        lThumbObj.rotation.copy(j.rotation);
    }

    if (hand1?.joints?.['index-finger-tip']?.visible) {
        const j = hand1.joints['index-finger-tip'];
        lIndexObj.position.copy(j.position);
        lIndexObj.rotation.copy(j.rotation);
    }

    if (hand2?.joints?.['thumb-tip']?.visible) {
        const j = hand2.joints['thumb-tip'];
        rThumbObj.position.copy(j.position);
        rThumbObj.rotation.copy(j.rotation);
    }

    if (hand2?.joints?.['index-finger-tip']?.visible) {
        const j = hand2.joints['index-finger-tip'];
        rIndexObj.position.copy(j.position);
        rIndexObj.rotation.copy(j.rotation);
    }

    pinchTracker.update({ left: hand1, right: hand2 });
    pinchState.left = pinchTracker.left.pinching;
    pinchState.right = pinchTracker.right.pinching;

    if (pinchState.left) {
        lPinchSphere.position.copy(lThumbObj.position);
    }

    if (pinchState.right) {
        rPinchSphere.position.copy(rThumbObj.position);
    }
}


    const api = {

        handTracking,
        hand1,
        hand2,
        pinchTracker,
        pinchState,
        leftPinchJumpGuard,
        rightPinchJumpGuard,
        TWO_HAND_SETTLE_MS,
        lThumbObj,
        lIndexObj,
        rThumbObj,
        rIndexObj,
        lPinchSphere,
        rPinchSphere
    };
    Object.assign(deps, api);
    return api;
}
