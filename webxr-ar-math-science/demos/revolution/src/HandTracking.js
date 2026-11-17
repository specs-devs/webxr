import * as THREE from 'three';
import { createPinchTracker } from './HandPinch.js';

export function createHandTracking(deps) {
    const { scene, renderer } = deps;

    const pinchTracker = createPinchTracker({
        pinchClose: 0.028,
        pinchOpen: 0.04,
        settleMs: 10,
    });

const pinchState = { left: false, right: false };

/**
 * Joint References — always invisible (opacity 0), used only as
 * position/rotation carriers for fingertip tracking. Plain Object3D avoids
 * the wasted geometry, material, and draw calls of a fully transparent mesh.
 */
const lThumbObj = new THREE.Object3D()
const lIndexObj = new THREE.Object3D()
const rThumbObj = new THREE.Object3D()
const rIndexObj = new THREE.Object3D()

scene.add(lThumbObj)
scene.add(lIndexObj)
scene.add(rThumbObj)
scene.add(rIndexObj)

/**
 * Pinch References — never made visible; plain Object3D (position-only carriers).
 */
const lPinchSphere = new THREE.Object3D()
scene.add(lPinchSphere)

const rPinchSphere = new THREE.Object3D()
scene.add(rPinchSphere)

/**
 * Hands — joint tracking only, no visible hand mesh (OculusHandModel removed).
 * renderer.xr.getHand() still populates hand.joints every frame for tracking;
 * we just never attach a renderable model to it.
 */
var hand1, hand2;

hand1 = renderer.xr.getHand( 0 );
scene.add( hand1 );

hand2 = renderer.xr.getHand( 1 );
scene.add( hand2 );

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
        pinchState,
        pinchTracker,
        hand1,
        hand2,
        lThumbObj,
        lIndexObj,
        rThumbObj,
        rIndexObj,
        lPinchSphere,
        rPinchSphere,
        handTracking
    };
    Object.assign(deps, api);
    return api;
}
