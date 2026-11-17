import * as THREE from 'three';
import { createPinchTracker, createJumpGuard } from './HandPinch.js';

export function createHandTracking(deps) {
    const { scene, renderer } = deps;

    const pinchTracker = createPinchTracker({
        pinchClose: 0.02,
        pinchOpen: 0.03,
        settleMs: 10,
    });

    const MAX_HAND_JUMP_PER_FRAME = 0.08;
    const leftPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
    const rightPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
    const TWO_HAND_SETTLE_MS = 20;

/**
 * Joint References — empty Object3Ds (pose only; no geometry/material cost)
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
 * Pinch References
 */
const sphere2 = new THREE.SphereGeometry(0.006, 32, 32)
const defaultMat2 = new THREE.MeshLambertMaterial({ 
    color: 0xffffff,
})

const lPinchSphere = new THREE.Mesh(sphere2, defaultMat2)
scene.add(lPinchSphere)
lPinchSphere.visible = false;

const rPinchSphere = new THREE.Mesh(sphere2, defaultMat2)
scene.add(rPinchSphere)
rPinchSphere.visible = false;

/**
 * Hands
 */
var hand1, hand2;

hand1 = renderer.xr.getHand( 0 );
scene.add( hand1 );

hand2 = renderer.xr.getHand( 1 );
scene.add( hand2 );

const handsGroup = new THREE.Group();
handsGroup.add(hand1, hand2);
scene.add(handsGroup);
handsGroup.visible = false;

function handTracking() {
    // Left hand joints — only when visibly tracked
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

    // Right hand joints — only when visibly tracked
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

    if (pinchTracker.left.pinching) {
        lPinchSphere.position.copy(lThumbObj.position);
    }
    if (pinchTracker.right.pinching) {
        rPinchSphere.position.copy(rThumbObj.position);
    }
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
        rIndexObj,
        lPinchSphere,
        rPinchSphere,
        handsGroup
    };
    Object.assign(deps, api);
    return api;
}
