import * as THREE from 'three';
import gsap from 'gsap';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json';
import { createPinchTracker, createJumpGuard } from './HandPinch.js';

export function createTwoHandedManip(deps) {
    const {
        camera, containerGroup, containerConfig,
        slicePlaneManager, surfaceManager, sliceState,
    } = deps;
const _upVector = new THREE.Vector3(0, 1, 0);

const twoHandedManip = {
    isActive: false,
    initialHandDistance: 0,
    initialScale: 1.0,
    initialMidpoint: new THREE.Vector3(),
    initialContainerPos: new THREE.Vector3(),
    initialHandAxis: new THREE.Vector3(),
    initialContainerQuat: new THREE.Quaternion(),
    minScale: 0.7,
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
const PLANE_HANDLE_GRAB_RADIUS_SQ = 0.0025; // 0.05^2

const pinchTracker = createPinchTracker({
    pinchClose: 0.02,
    pinchOpen: 0.03,
    settleMs: 10,
});
const leftPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
const rightPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);

const pinchGrabState = {
    left:  { active: false, axis: null, startOffset: 0, startLocalAxisPos: 0 },
    right: { active: false, axis: null, startOffset: 0, startLocalAxisPos: 0 },
};
const PLANE_GRAB_MESH_OPACITY = 0.2;
const UI_PANEL_TILT_X = -22.5 * Math.PI / 180;

const _candidateHandleWorld = new THREE.Vector3();
const _pinchLocal = new THREE.Vector3();
const _grabPinchWorld = new THREE.Vector3();
const _handleWorldPos = new THREE.Vector3();
const HANDLE_REVEAL_BY_HAND_RADIUS = 0.38;
const HANDLE_REVEAL_BY_HAND_RADIUS_SQ = HANDLE_REVEAL_BY_HAND_RADIUS * HANDLE_REVEAL_BY_HAND_RADIUS;
const handleVisibilityState = { x: -1, y: -1, z: -1 };

/** First-open hint on the visible Y-axis slice handle (matches Chladni Tune). */
const SLIDE_HINT_TEXT = 'Slide';
const SLIDE_HINT_TEXT_SIZE = 0.00864;
const SLIDE_HINT_ARROW_W = 0.0072;
const SLIDE_HINT_ARROW_H = 0.0048;
const SLIDE_HINT_ARROW_X = 0.016;
const SLIDE_HINT_CONTENT_X = 0;
const SLIDE_HINT_SCALE = 1.32;
const SLIDE_HINT_FADE_DURATION = 0.4;

const slideHintFont = new FontLoader().parse(helvetikerBold);

function buildSlideHintTextGeometry(text) {
    const geometry = new THREE.ShapeGeometry(slideHintFont.generateShapes(text, SLIDE_HINT_TEXT_SIZE));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    geometry.translate(
        -(box.max.x + box.min.x) * 0.5,
        -(box.max.y + box.min.y) * 0.5,
        0
    );
    return geometry;
}

const slideHintMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
});

const slideHint = new THREE.Group();
slideHint.frustumCulled = false;
slideHint.scale.setScalar(SLIDE_HINT_SCALE);
containerGroup.add(slideHint);

const slideHintContent = new THREE.Group();
slideHintContent.position.set(SLIDE_HINT_CONTENT_X, 0, 0.003);
slideHint.add(slideHintContent);

const slideHintArrowShape = new THREE.Shape();
slideHintArrowShape.moveTo(-SLIDE_HINT_ARROW_H * 0.5, 0);
slideHintArrowShape.lineTo(SLIDE_HINT_ARROW_H * 0.5, SLIDE_HINT_ARROW_W * 0.5);
slideHintArrowShape.lineTo(SLIDE_HINT_ARROW_H * 0.5, -SLIDE_HINT_ARROW_W * 0.5);
slideHintArrowShape.closePath();

const slideHintArrow = new THREE.Mesh(
    new THREE.ShapeGeometry(slideHintArrowShape),
    slideHintMaterial
);
slideHintArrow.position.set(SLIDE_HINT_ARROW_X, 0, 0);
slideHintArrow.renderOrder = 14;
slideHintArrow.frustumCulled = false;
slideHintContent.add(slideHintArrow);

const slideHintLabelGeometry = buildSlideHintTextGeometry(SLIDE_HINT_TEXT);
const slideHintLabelWidth = slideHintLabelGeometry.boundingBox.max.x - slideHintLabelGeometry.boundingBox.min.x;
const _slideHintLabelX = SLIDE_HINT_ARROW_X + SLIDE_HINT_ARROW_H * 0.5 + 0.006 + slideHintLabelWidth * 0.5;
const slideHintLabel = new THREE.Mesh(slideHintLabelGeometry, slideHintMaterial);
slideHintLabel.position.set(_slideHintLabelX, 0, 0);
slideHintLabel.renderOrder = 14;
slideHintLabel.frustumCulled = false;
slideHintContent.add(slideHintLabel);

let slideHintDismissed = false;
const _slideHintCamWorld = new THREE.Vector3();
const _slideHintHandleWorld = new THREE.Vector3();
const _slideHintCubeWorld = new THREE.Vector3();
const _slideHintOutward = new THREE.Vector3();
const _slideHintCamRight = new THREE.Vector3();
const _slideHintYAxis = new THREE.Vector3(0, 1, 0);
const _slideHintWorldYawQuat = new THREE.Quaternion();
const _slideHintParentWorldQuat = new THREE.Quaternion();
const _slideHintWorldQuat = new THREE.Quaternion();

function dismissSlideHint() {
    if (slideHintDismissed) return;
    slideHintDismissed = true;

    gsap.to(slideHintMaterial, {
        opacity: 0,
        duration: SLIDE_HINT_FADE_DURATION,
        ease: 'power2.out',
        onComplete: () => {
            slideHint.visible = false;
        },
    });
}

function getVisibleYSliceHandle() {
    const handles = slicePlaneManager.getCornerHandles('y');
    for (let i = 0; i < handles.length; i++) {
        if (handles[i].visible) return handles[i];
    }
    return null;
}

function updateSliceHint() {
    if (slideHintDismissed && !slideHint.visible) return;

    if (!slideHintDismissed && isAnyPlaneHandleBeingDriven()) {
        dismissSlideHint();
    }

    if (!slideHint.visible) return;

    const handle = getVisibleYSliceHandle();
    if (!handle) return;

    slideHint.position.copy(handle.position);
    handle.getWorldPosition(_slideHintHandleWorld);

    camera.getWorldPosition(_slideHintCamWorld);
    const dx = _slideHintCamWorld.x - _slideHintHandleWorld.x;
    const dz = _slideHintCamWorld.z - _slideHintHandleWorld.z;
    if (dx * dx + dz * dz >= 1e-10) {
        _slideHintWorldYawQuat.setFromAxisAngle(_slideHintYAxis, Math.atan2(dx, dz));
        slideHint.parent.getWorldQuaternion(_slideHintParentWorldQuat);
        slideHint.quaternion.copy(_slideHintParentWorldQuat.invert()).multiply(_slideHintWorldYawQuat);
    }

    containerGroup.getWorldPosition(_slideHintCubeWorld);
    _slideHintOutward.set(
        _slideHintHandleWorld.x - _slideHintCubeWorld.x,
        0,
        _slideHintHandleWorld.z - _slideHintCubeWorld.z
    );
    slideHint.getWorldQuaternion(_slideHintWorldQuat);
    _slideHintCamRight.set(1, 0, 0).applyQuaternion(_slideHintWorldQuat);
    const side = _slideHintOutward.dot(_slideHintCamRight) >= 0 ? 1 : -1;
    slideHintContent.position.x = SLIDE_HINT_CONTENT_X * side;
    slideHintArrow.position.x = SLIDE_HINT_ARROW_X * side;
    slideHintArrow.scale.x = side;
    slideHintLabel.position.x = _slideHintLabelX * side;
    slideHintLabel.scale.set(1, 1, 1);
}


function getAxisComponent(v, axis) {
    if (axis === 'x') return v.x;
    if (axis === 'y') return v.y;
    return v.z;
}

function updateSliceOffsetUI(axis, value) {
    const key = `${axis}Offset`;
    sliceState[key] = value;
}

function getActiveGrabAxes() {
    const activeAxes = new Set();
    if (pinchGrabState.left.active && pinchGrabState.left.axis) activeAxes.add(pinchGrabState.left.axis);
    if (pinchGrabState.right.active && pinchGrabState.right.axis) activeAxes.add(pinchGrabState.right.axis);
    return activeAxes;
}

/** Compact signature of which plane axes are currently grabbed (avoids Set alloc when unchanged). */
function getActiveGrabAxesKey() {
    let key = '';
    if (pinchGrabState.left.active && pinchGrabState.left.axis) key += 'L' + pinchGrabState.left.axis;
    if (pinchGrabState.right.active && pinchGrabState.right.axis) key += 'R' + pinchGrabState.right.axis;
    return key;
}

function applyPlaneFocusState(activeAxes) {
    const hasActivePlane = activeAxes.size > 0;
    for (const axis of ['x', 'y', 'z']) {
        const axisIsActive = hasActivePlane && activeAxes.has(axis);
        slicePlaneManager.setCurveVisible(axis, axisIsActive);
        slicePlaneManager.setCurveActive(axis, axisIsActive);
        slicePlaneManager.setFillVisible(axis, axisIsActive);
        slicePlaneManager.setPlaneOutlineVisible(axis, axisIsActive);
        slicePlaneManager.setPlaneOutlineActive(axis, axisIsActive);
        slicePlaneManager.setHandlesVisible(axis, Boolean(sliceState[`${axis}Visible`]));
    }
    surfaceManager.setOpacity(hasActivePlane ? PLANE_GRAB_MESH_OPACITY : 1.0);
}

function updateClosestHandleVisibility() {
    const BOTTOM_Y_EPS = 1e-4;
    const isAnyHandSliding = pinchGrabState.left.active || pinchGrabState.right.active;
    const isAnySliderActive = deps.isUISliderBeingDriven();

    for (const axis of ['x', 'y', 'z']) {
        const handles = slicePlaneManager.getCornerHandles(axis);
        if (!handles.length) continue;

        const axisAllowed = Boolean(sliceState[`${axis}Visible`]);

        if (!axisAllowed) {
            for (let i = 0; i < handles.length; i++) handles[i].visible = false;
            handleVisibilityState[axis] = -1;
            continue;
        }

        let minY = Infinity;
        for (let i = 0; i < handles.length; i++) {
            handles[i].getWorldPosition(_handleWorldPos);
            if (_handleWorldPos.y < minY) minY = _handleWorldPos.y;
        }

        let closestIdx = -1;
        let closestDistSq = Infinity;
        const isHandResponsiveAxisY = axis === 'y';
        const shouldFreezeSwitching = isHandResponsiveAxisY && (isAnyHandSliding || isAnySliderActive);

        if (shouldFreezeSwitching) {
            if (handleVisibilityState[axis] >= 0) {
                closestIdx = handleVisibilityState[axis];
            } else {
                // During active slider/handle interaction, avoid hand-distance switching:
                // pick a stable camera-nearest bottom handle until interaction ends.
                let fallbackIdx = -1;
                let fallbackDistSq = Infinity;
                for (let i = 0; i < handles.length; i++) {
                    handles[i].getWorldPosition(_handleWorldPos);
                    if (_handleWorldPos.y > minY + BOTTOM_Y_EPS) continue;
                    const d2 = _handleWorldPos.distanceToSquared(camera.position);
                    if (d2 < fallbackDistSq) {
                        fallbackDistSq = d2;
                        fallbackIdx = i;
                    }
                }
                closestIdx = fallbackIdx;
                handleVisibilityState[axis] = closestIdx;
            }
        } else {
            for (let i = 0; i < handles.length; i++) {
                handles[i].getWorldPosition(_handleWorldPos);
                if (_handleWorldPos.y > minY + BOTTOM_Y_EPS) continue;
                let scoreDistSq;
                if (isHandResponsiveAxisY) {
                    const leftDistSq = _handleWorldPos.distanceToSquared(deps.lIndexObj.position);
                    const rightDistSq = _handleWorldPos.distanceToSquared(deps.rIndexObj.position);
                    scoreDistSq = Math.min(leftDistSq, rightDistSq);
                } else {
                    scoreDistSq = _handleWorldPos.distanceToSquared(camera.position);
                }
                if (scoreDistSq < closestDistSq) {
                    closestDistSq = scoreDistSq;
                    closestIdx = i;
                }
            }

            if (isHandResponsiveAxisY && closestDistSq > HANDLE_REVEAL_BY_HAND_RADIUS_SQ) {
                if (handleVisibilityState[axis] >= 0) {
                    closestIdx = handleVisibilityState[axis];
                } else {
                    // No recent hand candidate yet: fall back to camera-nearest bottom Y handle.
                    let fallbackIdx = -1;
                    let fallbackDistSq = Infinity;
                    for (let i = 0; i < handles.length; i++) {
                        handles[i].getWorldPosition(_handleWorldPos);
                        if (_handleWorldPos.y > minY + BOTTOM_Y_EPS) continue;
                        const d2 = _handleWorldPos.distanceToSquared(camera.position);
                        if (d2 < fallbackDistSq) {
                            fallbackDistSq = d2;
                            fallbackIdx = i;
                        }
                    }
                    closestIdx = fallbackIdx;
                }
            }

            handleVisibilityState[axis] = closestIdx;
        }

        const shouldReveal = isHandResponsiveAxisY
            ? closestIdx !== -1
            : closestIdx !== -1;
        for (let i = 0; i < handles.length; i++) {
            handles[i].visible = shouldReveal && i === closestIdx;
        }
    }
}

function getClosestGrabbableHandle(pinchWorldPos) {
    const handles = slicePlaneManager.getAllCornerHandles();
    let closestHandle = null;
    let closestDistSq = PLANE_HANDLE_GRAB_RADIUS_SQ;

    for (let i = 0; i < handles.length; i++) {
        const handle = handles[i];
        if (!handle.visible) continue;
        handle.getWorldPosition(_candidateHandleWorld);
        const d2 = _candidateHandleWorld.distanceToSquared(pinchWorldPos);
        if (d2 < closestDistSq) {
            closestDistSq = d2;
            closestHandle = handle;
        }
    }
    return closestHandle;
}

function updatePlaneHandleGrabForHand(handKey, pinchActive, pinchWorldPos) {
    const state = pinchGrabState[handKey];

    if (!pinchActive) {
        state.active = false;
        state.axis = null;
        return false;
    }

    if (!state.active) {
        const handle = getClosestGrabbableHandle(pinchWorldPos);
        if (!handle) return false;

        const axis = handle.userData.sliceAxis;
        if (!axis) return false;

        state.active = true;
        state.axis = axis;
        dismissSlideHint();
        state.startOffset = slicePlaneManager.offsets[axis];
        _pinchLocal.copy(pinchWorldPos);
        containerGroup.worldToLocal(_pinchLocal);
        state.startLocalAxisPos = getAxisComponent(_pinchLocal, axis);
        return true;
    }

    _pinchLocal.copy(pinchWorldPos);
    containerGroup.worldToLocal(_pinchLocal);
    const currentLocalAxisPos = getAxisComponent(_pinchLocal, state.axis);
    const localDelta = currentLocalAxisPos - state.startLocalAxisPos;
    const normalizedDelta = localDelta / containerConfig.containerSize;
    const nextOffset = THREE.MathUtils.clamp(state.startOffset + normalizedDelta, -0.5, 0.5);

    slicePlaneManager.setOffset(state.axis, nextOffset);
    updateSliceOffsetUI(state.axis, nextOffset);
    return true;
}

function isAnyPlaneHandleBeingDriven() {
    return pinchGrabState.left.active || pinchGrabState.right.active;
}

/** Snapshot the current two-handed pose as the manip baseline (zero delta). */
function captureTwoHandedBaseline(containerGroup, handDistance) {
    twoHandedManip.isActive = true;
    twoHandedManip.initialHandDistance = handDistance;
    twoHandedManip.initialScale = containerGroup.scale.x;
    twoHandedManip.initialMidpoint.copy(_handMidpoint);
    twoHandedManip.initialContainerPos.copy(containerGroup.position);
    twoHandedManip.initialHandAxis.copy(_rightPinchPos).sub(_leftPinchPos);
    twoHandedManip.initialContainerQuat.copy(containerGroup.quaternion);
}

/**
 * Both hands pinching: move / rotate / scale containerGroup.
 * Uses tracking-gated pinch + settle + jump guard (see HandPinch.js).
 */
function applyTwoHandedContainerManip(containerGroup) {
    const leftPinching = pinchTracker.left.pinching && pinchTracker.left.tracked;
    const rightPinching = pinchTracker.right.pinching && pinchTracker.right.tracked;

    if (!leftPinching || !rightPinching) {
        twoHandedManip.isActive = false;
        leftPinchJumpGuard.reset();
        rightPinchJumpGuard.reset();
        return false;
    }

    _leftPinchPos.copy(deps.lThumbObj.position);
    _rightPinchPos.copy(deps.rThumbObj.position);

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
            captureTwoHandedBaseline(containerGroup, handDistance);
        }
        return false;
    }

    if (discontinuity) {
        captureTwoHandedBaseline(containerGroup, handDistance);
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
        pinchTracker,
        leftPinchJumpGuard,
        rightPinchJumpGuard,
        pinchGrabState,
        getAxisComponent,
        getActiveGrabAxes,
        getActiveGrabAxesKey,
        applyPlaneFocusState,
        updateClosestHandleVisibility,
        updateSliceHint,
        getClosestGrabbableHandle,
        updatePlaneHandleGrabForHand,
        isAnyPlaneHandleBeingDriven,
        captureTwoHandedBaseline,
        applyTwoHandedContainerManip
    };
    Object.assign(deps, api);
    return api;
}
