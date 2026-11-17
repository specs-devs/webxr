import * as THREE from 'three';
import { createJumpGuard } from './HandPinch.js';

export function createTwoHandedManip(deps) {
    const {
        pinchTracker,
        containerGroup,
        lThumbObj,
        rThumbObj,
    } = deps;

const _upVector = new THREE.Vector3(0, 1, 0);

const twoHandedManip = {
    isActive: false,
    /** Set while a real two-hand gesture is running; used to suppress accidental grabs on release. */
    hadActiveManip: false,
    initialHandDistance: 0,
    initialScale: 1.0,
    initialMidpoint: new THREE.Vector3(),
    initialContainerPos: new THREE.Vector3(),
    initialHandAxis: new THREE.Vector3(),
    initialContainerQuat: new THREE.Quaternion(),
    minScale: 0.6,
    maxScale: 1.5
};

const _leftPinchPos = new THREE.Vector3();
const _rightPinchPos = new THREE.Vector3();
const _handMidpoint = new THREE.Vector3();
const _posDelta = new THREE.Vector3();
const _newContainerPos = new THREE.Vector3();
const _currentHandAxis = new THREE.Vector3();
const _rotationQuat = new THREE.Quaternion();
const _finalQuat = new THREE.Quaternion();

const MIN_TWO_HAND_DISTANCE = 0.05;
/** >1 = container moves farther per unit of hand travel (two-hand translate). */
const TWO_HAND_TRANSLATION_GAIN = 2.75;

/** Extra settle before a two-handed gesture may capture its baseline (ms). */
const TWO_HAND_SETTLE_MS = 20;

/**
 * Physically implausible per-frame hand travel (m). Beyond this while two-handed
 * manip is active → re-base instead of applying a huge delta (incl. scale).
 */
const MAX_HAND_JUMP_PER_FRAME = 0.08;
const leftPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
const rightPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);

/** Snapshot the current two-handed pose as the manip baseline (zero delta). */
function captureTwoHandedBaseline(handDistance) {
    twoHandedManip.isActive = true;
    twoHandedManip.initialHandDistance = handDistance;
    twoHandedManip.initialScale = containerGroup.scale.x;
    twoHandedManip.initialMidpoint.copy(_handMidpoint);
    twoHandedManip.initialContainerPos.copy(containerGroup.position);
    twoHandedManip.initialHandAxis.copy(_rightPinchPos).sub(_leftPinchPos);
    twoHandedManip.initialContainerQuat.copy(containerGroup.quaternion);
}

/**
 * Both hands pinching: move/scale/rotate containerGroup.
 * Uses tracking-gated pinch + settle + jump guard (see HandPinch.js).
 */
function applyTwoHandedContainerManip() {
    const leftPinching = pinchTracker.left.pinching && pinchTracker.left.tracked;
    const rightPinching = pinchTracker.right.pinching && pinchTracker.right.tracked;

    if (!leftPinching || !rightPinching) {
        twoHandedManip.isActive = false;
        leftPinchJumpGuard.reset();
        rightPinchJumpGuard.reset();
        return false;
    }

    _leftPinchPos.copy(lThumbObj.position);
    _rightPinchPos.copy(rThumbObj.position);

    // Tracking teleport mid-gesture → re-base instead of applying a huge delta
    const leftJumped = leftPinchJumpGuard.check(_leftPinchPos);
    const rightJumped = rightPinchJumpGuard.check(_rightPinchPos);
    const discontinuity = leftJumped || rightJumped;

    _handMidpoint.addVectors(_leftPinchPos, _rightPinchPos).multiplyScalar(0.5);
    const handDistance = _leftPinchPos.distanceTo(_rightPinchPos);

    if (handDistance <= MIN_TWO_HAND_DISTANCE) {
        return false;
    }

    if (!twoHandedManip.isActive) {
        // Only capture baseline once both hands have been stably pinching
        if (pinchTracker.bothPinchStable(performance.now(), TWO_HAND_SETTLE_MS)) {
            captureTwoHandedBaseline(handDistance);
        }
        return false;
    }

    if (discontinuity) {
        captureTwoHandedBaseline(handDistance);
        twoHandedManip.hadActiveManip = true;
        return true;
    }

    const scaleRatio = handDistance / twoHandedManip.initialHandDistance;
    let newScale = twoHandedManip.initialScale * scaleRatio;
    newScale = Math.max(twoHandedManip.minScale, Math.min(twoHandedManip.maxScale, newScale));
    containerGroup.scale.setScalar(newScale);

    _currentHandAxis.copy(_rightPinchPos).sub(_leftPinchPos);
    const currentHorizLenSq = _currentHandAxis.x * _currentHandAxis.x + _currentHandAxis.z * _currentHandAxis.z;
    const initialHorizLenSq = twoHandedManip.initialHandAxis.x * twoHandedManip.initialHandAxis.x +
        twoHandedManip.initialHandAxis.z * twoHandedManip.initialHandAxis.z;

    if (currentHorizLenSq > 0.001 && initialHorizLenSq > 0.001) {
        const currentAngle = Math.atan2(_currentHandAxis.x, _currentHandAxis.z);
        const initialAngle = Math.atan2(twoHandedManip.initialHandAxis.x, twoHandedManip.initialHandAxis.z);
        const deltaAngle = currentAngle - initialAngle;
        _rotationQuat.setFromAxisAngle(_upVector, deltaAngle);
        _finalQuat.copy(twoHandedManip.initialContainerQuat).premultiply(_rotationQuat);
        containerGroup.quaternion.copy(_finalQuat);
    }

    _posDelta.copy(_handMidpoint).sub(twoHandedManip.initialMidpoint);
    _posDelta.multiplyScalar(TWO_HAND_TRANSLATION_GAIN);
    _newContainerPos.copy(twoHandedManip.initialContainerPos).add(_posDelta);
    containerGroup.position.copy(_newContainerPos);
    twoHandedManip.hadActiveManip = true;
    return true;
}


    const api = {
        twoHandedManip,
        leftPinchJumpGuard,
        rightPinchJumpGuard,
        applyTwoHandedContainerManip,
        captureTwoHandedBaseline,
        TWO_HAND_SETTLE_MS
    };
    Object.assign(deps, api);
    return api;
}
