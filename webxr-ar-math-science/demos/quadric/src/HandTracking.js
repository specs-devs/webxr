import * as THREE from 'three';

export function createHandTracking(deps) {
    const { scene, renderer, pinchTracker } = deps;
const lThumbObj = new THREE.Object3D();
const lIndexObj = new THREE.Object3D();
const rThumbObj = new THREE.Object3D();
const rIndexObj = new THREE.Object3D();

scene.add(lThumbObj);
scene.add(lIndexObj);
scene.add(rThumbObj);
scene.add(rIndexObj);

/**
 * Pinch References — empty Object3Ds used as pinch world-position anchors
 */
const lPinchSphere = new THREE.Object3D();
scene.add(lPinchSphere);

const rPinchSphere = new THREE.Object3D();
scene.add(rPinchSphere);

/**
 * Hands (joint tracking only — no visual hand mesh)
 */
const hand1 = renderer.xr.getHand(0);
scene.add(hand1);

const hand2 = renderer.xr.getHand(1);
scene.add(hand2);

const pinchState = { left: false, right: false };

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
        lThumbObj,
        lIndexObj,
        rThumbObj,
        rIndexObj,
        lPinchSphere,
        rPinchSphere,
        hand1,
        hand2,
        pinchState,
        handTracking
    };
    Object.assign(deps, api);
    return api;
}
