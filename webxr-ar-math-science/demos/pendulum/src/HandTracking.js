import * as THREE from 'three';
import { createPinchTracker, createJumpGuard } from './HandPinch.js';

export function createHandTracking(deps) {
    const { scene, renderer } = deps;

    // Pinch state: derived from pinchTracker each frame (tracking-gated, hysteresis, settle).
    const pinchState = { left: false, right: false };

    const pinchTracker = createPinchTracker({
        pinchClose: 0.02,
        pinchOpen: 0.03,
        settleMs: 10,
    });

    /** Extra settle before a two-handed gesture may capture its baseline (ms). */
    const TWO_HAND_SETTLE_MS = 20;

    /**
     * Physically implausible per-frame hand travel (m). Beyond this while two-handed
     * manip is active → re-base instead of applying a huge delta (incl. scale).
     */
    const MAX_HAND_JUMP_PER_FRAME = 0.08;
    const leftPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
    const rightPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);

    /**
     * Joint References (empty Object3D anchors — position/rotation only, no render cost)
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
     * Pinch References (empty Object3D anchors for active pinch position)
     */
    const lPinchSphere = new THREE.Object3D();
    scene.add(lPinchSphere);

    const rPinchSphere = new THREE.Object3D();
    scene.add(rPinchSphere);

    /**
     * Hands (joint poses only — no OculusHandModel meshes)
     */
    const hand1 = renderer.xr.getHand(0);
    scene.add(hand1);

    const hand2 = renderer.xr.getHand(1);
    scene.add(hand2);

    const handsGroup = new THREE.Group();
    handsGroup.add(hand1, hand2);
    scene.add(handsGroup);
    handsGroup.visible = false;

    function handTracking() {
        // Only copy joints that are visibly tracked this frame (avoids stale off-screen poses)
        if (hand1 && hand1.joints && hand1.joints['thumb-tip'] && hand1.joints['thumb-tip'].visible) {
            const j = hand1.joints['thumb-tip'];
            lThumbObj.position.copy(j.position);
            lThumbObj.rotation.copy(j.rotation);
        }

        if (hand1 && hand1.joints && hand1.joints['index-finger-tip'] && hand1.joints['index-finger-tip'].visible) {
            const j = hand1.joints['index-finger-tip'];
            lIndexObj.position.copy(j.position);
            lIndexObj.rotation.copy(j.rotation);
        }

        if (hand2 && hand2.joints && hand2.joints['thumb-tip'] && hand2.joints['thumb-tip'].visible) {
            const j = hand2.joints['thumb-tip'];
            rThumbObj.position.copy(j.position);
            rThumbObj.rotation.copy(j.rotation);
        }

        if (hand2 && hand2.joints && hand2.joints['index-finger-tip'] && hand2.joints['index-finger-tip'].visible) {
            const j = hand2.joints['index-finger-tip'];
            rIndexObj.position.copy(j.position);
            rIndexObj.rotation.copy(j.rotation);
        }

        // Tracking-gated, debounced pinch — untracked/off-screen hands never false-pinch
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
        handsGroup,
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
        rPinchSphere
    };
    Object.assign(deps, api);
    return api;
}
