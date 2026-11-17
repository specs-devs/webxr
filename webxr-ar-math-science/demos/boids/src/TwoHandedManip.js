import * as THREE from 'three';

export function createTwoHandedManip(deps) {
    const {
        pinchTracker, leftPinchJumpGuard, rightPinchJumpGuard,
        TWO_HAND_SETTLE_MS, lThumbObj, rThumbObj,
        containerCube, boidsGroup,
    } = deps;

/**
 * Two-Handed Manipulation State
 * When both hands are pinching, allows repositioning, rotating, and scaling the container
 */
const twoHandedManip = {
    isActive: false,
    initialHandDistance: 0,
    initialScale: 1.0,
    initialMidpoint: new THREE.Vector3(),
    initialContainerPos: new THREE.Vector3(),
    initialHandAxis: new THREE.Vector3(),      // Vector from left to right hand at start
    initialContainerQuat: new THREE.Quaternion(), // Container rotation at start
    // Scale limits (relative to original container size)
    minScale: 0.5,  // Minimum 50% of original size
    maxScale: 4.0   // Maximum 400% of original size
};

// Helper vectors for two-handed manipulation (pre-allocated to avoid GC)
const _leftPinchPos = new THREE.Vector3();
const _rightPinchPos = new THREE.Vector3();
const _handMidpoint = new THREE.Vector3();
const _posDelta = new THREE.Vector3();
const _newContainerPos = new THREE.Vector3();
const _currentHandAxis = new THREE.Vector3();
const _rotationQuat = new THREE.Quaternion();
const _finalQuat = new THREE.Quaternion();
const _upVector = new THREE.Vector3(0, 1, 0);

/** >1 = container moves farther per unit of hand travel (two-hand translate). */
const TWO_HAND_TRANSLATION_GAIN = 2.75;
const MIN_HAND_DISTANCE = 0.05;

/** Snapshot the current two-handed pose as the manip baseline (zero delta). */
function captureTwoHandedBaseline(handDistance) {
    twoHandedManip.isActive = true;
    twoHandedManip.initialHandDistance = handDistance;
    twoHandedManip.initialScale = containerCube.scale.x;
    twoHandedManip.initialMidpoint.copy(_handMidpoint);
    twoHandedManip.initialContainerPos.copy(containerCube.position);
    twoHandedManip.initialHandAxis.copy(_rightPinchPos).sub(_leftPinchPos);
    twoHandedManip.initialContainerQuat.copy(containerCube.quaternion);
}

function applyTwoHandedContainerManip() {
    const leftPinching = pinchTracker.left.pinching && pinchTracker.left.tracked;
    const rightPinching = pinchTracker.right.pinching && pinchTracker.right.tracked;

    // Two-Handed Manipulation (both hands pinching): move, rotate, scale
    if (!leftPinching || !rightPinching) {
        twoHandedManip.isActive = false;
        leftPinchJumpGuard.reset();
        rightPinchJumpGuard.reset();
        return;
    }

    _leftPinchPos.copy(lThumbObj.position);
    _rightPinchPos.copy(rThumbObj.position);

    // Tracking teleport mid-gesture → re-base instead of applying a huge delta
    const leftJumped = leftPinchJumpGuard.check(_leftPinchPos);
    const rightJumped = rightPinchJumpGuard.check(_rightPinchPos);
    const discontinuity = leftJumped || rightJumped;

    _handMidpoint.addVectors(_leftPinchPos, _rightPinchPos).multiplyScalar(0.5);
    const handDistance = _leftPinchPos.distanceTo(_rightPinchPos);

    if (handDistance <= MIN_HAND_DISTANCE) {
        return;
    }

    if (!twoHandedManip.isActive) {
        // Only start once both hands have been stably pinching (clean baseline)
        if (pinchTracker.bothPinchStable(performance.now(), TWO_HAND_SETTLE_MS)) {
            captureTwoHandedBaseline(handDistance);
        }
        return;
    }

    if (discontinuity) {
        captureTwoHandedBaseline(handDistance);
        return;
    }

    // Scale from hand distance ratio
    const scaleRatio = handDistance / twoHandedManip.initialHandDistance;
    let newScale = twoHandedManip.initialScale * scaleRatio;
    newScale = Math.max(twoHandedManip.minScale, Math.min(twoHandedManip.maxScale, newScale));
    containerCube.scale.setScalar(newScale);
    boidsGroup.scale.setScalar(newScale);

    // Y-axis rotation from hand axis change
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
        containerCube.quaternion.copy(_finalQuat);
        boidsGroup.quaternion.copy(_finalQuat);
    }

    // Translate from midpoint delta
    _posDelta.copy(_handMidpoint).sub(twoHandedManip.initialMidpoint);
    _posDelta.multiplyScalar(TWO_HAND_TRANSLATION_GAIN);
    _newContainerPos.copy(twoHandedManip.initialContainerPos).add(_posDelta);
    containerCube.position.copy(_newContainerPos);
    boidsGroup.position.copy(_newContainerPos);
}


    const api = {
        twoHandedManip,
        applyTwoHandedContainerManip,
        captureTwoHandedBaseline
    };
    Object.assign(deps, api);
    return api;
}
