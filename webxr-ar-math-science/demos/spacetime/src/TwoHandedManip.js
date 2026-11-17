import * as THREE from 'three';

export function createTwoHandedManip(deps) {
    const {
        pinchTracker, leftPinchJumpGuard, rightPinchJumpGuard,
        TWO_HAND_SETTLE_MS, lThumbObj, rThumbObj, containerGroup,
    } = deps;

    const twoHandedManip = {
        isActive: false,
        initialHandDistance: 0,
        initialScale: 1.0,
        initialMidpoint: new THREE.Vector3(),
        initialContainerPos: new THREE.Vector3(),
        initialHandAxis: new THREE.Vector3(),
        initialContainerQuat: new THREE.Quaternion(),
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
    const _upVector = new THREE.Vector3(0, 1, 0);

    const MIN_TWO_HAND_DISTANCE = 0.05;
    const TWO_HAND_TRANSLATION_GAIN = 2.75;

    function captureTwoHandedBaseline(handDistance) {
        twoHandedManip.isActive = true;
        twoHandedManip.initialHandDistance = handDistance;
        twoHandedManip.initialScale = containerGroup.scale.x;
        twoHandedManip.initialMidpoint.copy(_handMidpoint);
        twoHandedManip.initialContainerPos.copy(containerGroup.position);
        twoHandedManip.initialHandAxis.copy(_rightPinchPos).sub(_leftPinchPos);
        twoHandedManip.initialContainerQuat.copy(containerGroup.quaternion);
    }

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

        const leftJumped = leftPinchJumpGuard.check(_leftPinchPos);
        const rightJumped = rightPinchJumpGuard.check(_rightPinchPos);
        const discontinuity = leftJumped || rightJumped;

        _handMidpoint.addVectors(_leftPinchPos, _rightPinchPos).multiplyScalar(0.5);
        const handDistance = _leftPinchPos.distanceTo(_rightPinchPos);

        if (handDistance <= MIN_TWO_HAND_DISTANCE) {
            return false;
        }

        if (!twoHandedManip.isActive) {
            if (pinchTracker.bothPinchStable(performance.now(), TWO_HAND_SETTLE_MS)) {
                captureTwoHandedBaseline(handDistance);
            }
            return false;
        }

        if (discontinuity) {
            captureTwoHandedBaseline(handDistance);
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
        return true;
    }

    const api = {
        twoHandedManip,
        applyTwoHandedContainerManip,
        captureTwoHandedBaseline
    };
    Object.assign(deps, api);
    return api;
}
