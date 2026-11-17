import * as THREE from 'three';

export function createTwoHandedManip(deps) {
    const {
        pinchTracker, leftPinchJumpGuard, rightPinchJumpGuard,
        TWO_HAND_SETTLE_MS, lThumbObj, rThumbObj, pointerObj,
    } = deps;
// ==========================================
// TWO-HANDED CONTAINER MANIPULATION
// ==========================================

const _upVector = new THREE.Vector3(0, 1, 0);

const twoHandedManip = {
    isActive: false,
    initialHandDistance: 0,
    initialScale: 1.0,
    initialMidpoint: new THREE.Vector3(),
    initialContainerPos: new THREE.Vector3(),
    initialHandAxis: new THREE.Vector3(),
    initialContainerQuat: new THREE.Quaternion(),
    initialPointerPos: new THREE.Vector3(),
    initialPointerQuat: new THREE.Quaternion(),
    minScale: 0.5,
    maxScale: 4.0
};

const _leftPinchPos = new THREE.Vector3();
const _rightPinchPos = new THREE.Vector3();
const _handMidpoint = new THREE.Vector3();
const _posDelta = new THREE.Vector3();
const _newContainerPos = new THREE.Vector3();
const _currentHandAxis = new THREE.Vector3();
const _rotationQuat = new THREE.Quaternion();
const _finalQuat = new THREE.Quaternion();
const _ptrOffset = new THREE.Vector3();
const _newPointerPos = new THREE.Vector3();

const MIN_TWO_HAND_DISTANCE = 0.05;
/** >1 = container moves farther per unit of hand travel (two-hand translate). */
const TWO_HAND_TRANSLATION_GAIN = 2.75;

/** Snapshot the current two-handed pose as the manip baseline (zero delta). */
function captureTwoHandedBaseline(containerGroup, handDistance) {
    twoHandedManip.isActive = true;
    twoHandedManip.initialHandDistance = handDistance;
    twoHandedManip.initialScale = containerGroup.scale.x;
    twoHandedManip.initialMidpoint.copy(_handMidpoint);
    twoHandedManip.initialContainerPos.copy(containerGroup.position);
    twoHandedManip.initialHandAxis.copy(_rightPinchPos).sub(_leftPinchPos);
    twoHandedManip.initialContainerQuat.copy(containerGroup.quaternion);
    twoHandedManip.initialPointerPos.copy(pointerObj.position);
    twoHandedManip.initialPointerQuat.copy(pointerObj.quaternion);
}

function applyTwoHandedContainerManip(containerGroup) {
    // Use the tracking-gated, debounced pinch state (not raw joint distance) so
    // an untracked hand can never drive the two-handed gesture.
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

    // Detect a tracking teleport this frame (a joint popping into place). If
    // either hand jumped, we must NOT apply the resulting delta — instead
    // re-base the gesture from the (now valid) current pose.
    const leftJumped = leftPinchJumpGuard.check(_leftPinchPos);
    const rightJumped = rightPinchJumpGuard.check(_rightPinchPos);
    const discontinuity = leftJumped || rightJumped;

    _handMidpoint.addVectors(_leftPinchPos, _rightPinchPos).multiplyScalar(0.5);
    const handDistance = _leftPinchPos.distanceTo(_rightPinchPos);

    if (handDistance <= MIN_TWO_HAND_DISTANCE) {
        return false;
    }

    if (!twoHandedManip.isActive) {
        // Only capture a baseline once both hands have been stably pinching for
        // the settle window, guaranteeing clean initial data (no init jump).
        if (pinchTracker.bothPinchStable(performance.now(), TWO_HAND_SETTLE_MS)) {
            captureTwoHandedBaseline(containerGroup, handDistance);
        }
        return false;
    }

    if (discontinuity) {
        // Tracking glitch mid-gesture: rebase so the jump is absorbed, not applied.
        captureTwoHandedBaseline(containerGroup, handDistance);
        return true;
    }

    if (twoHandedManip.isActive && handDistance > MIN_TWO_HAND_DISTANCE) {
        // Two-hand scale disabled — rotate/move only.
        // const scaleRatio = handDistance / twoHandedManip.initialHandDistance;
        // let newScale = twoHandedManip.initialScale * scaleRatio;
        // newScale = Math.max(twoHandedManip.minScale, Math.min(twoHandedManip.maxScale, newScale));
        // containerGroup.scale.setScalar(newScale);

        _rotationQuat.identity();
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

        // Move pointer with the container: rotate its offset around container center, then translate
        _ptrOffset.copy(twoHandedManip.initialPointerPos).sub(twoHandedManip.initialContainerPos);
        _ptrOffset.applyQuaternion(_rotationQuat);
        _newPointerPos.copy(_newContainerPos).add(_ptrOffset);
        pointerObj.position.copy(_newPointerPos);

        _finalQuat.copy(twoHandedManip.initialPointerQuat).premultiply(_rotationQuat);
        pointerObj.quaternion.copy(_finalQuat);
    }
}

    const api = {
        twoHandedManip,
        applyTwoHandedContainerManip
    };
    Object.assign(deps, api);
    return api;
}
