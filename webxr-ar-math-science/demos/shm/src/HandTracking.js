import * as THREE from 'three';
import { createPinchTracker, createJumpGuard } from './HandPinch.js';

export function createHandTracking(deps) {
    const { scene, renderer } = deps;

    const pinchState = { left: false, right: false };

    const pinchTracker = createPinchTracker({
        pinchClose: 0.028,
        pinchOpen: 0.04,
        settleMs: 10,
    });

    const TWO_HAND_SETTLE_MS = 20;

    const MAX_HAND_JUMP_PER_FRAME = 0.08;
    const leftPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
    const rightPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);

    const lThumbObj = new THREE.Object3D();
    const lIndexObj = new THREE.Object3D();
    const rThumbObj = new THREE.Object3D();
    const rIndexObj = new THREE.Object3D();

    scene.add(lThumbObj);
    scene.add(lIndexObj);
    scene.add(rThumbObj);
    scene.add(rIndexObj);

    const lPinchSphere = new THREE.Object3D();
    const rPinchSphere = new THREE.Object3D();
    scene.add(lPinchSphere);
    scene.add(rPinchSphere);

    const hand1 = renderer.xr.getHand(0);
    scene.add(hand1);

    const hand2 = renderer.xr.getHand(1);
    scene.add(hand2);

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
    };
    Object.assign(deps, api);
    return api;
}
