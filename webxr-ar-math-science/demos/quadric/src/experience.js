import * as THREE from 'three';
import gsap from 'gsap';
import { createSceneSetup } from './SceneSetup.js';
import { createContainer } from './Container.js';
import { createQuadSurfaces } from './QuadSurfaces.js';
import { createTwoHandedManip } from './TwoHandedManip.js';
import { createHandTracking } from './HandTracking.js';
import { createMenuUI } from './MenuUI.js';
import { createStartModal } from './StartModal.js';
import { bindHeadRelativePlacementOnSessionStart, placeObjectAtHeadOffset } from './XRHeadPlacement.js';

export function createExperience({ session = null, showXRButton = false } = {}) {
    const { scene, camera, renderer } = createSceneSetup({ session, showXRButton });

    /** Shared runtime context — modules read/write exports here via Object.assign. */
    const ctx = { scene, camera, renderer, session };

    createContainer(ctx);
    createQuadSurfaces(ctx);
    createTwoHandedManip(ctx);
    createHandTracking(ctx);
    createMenuUI(ctx);

    function placeContainerAtHeadOnDismiss() {
        if (!renderer.xr.isPresenting) return;
        camera.updateMatrixWorld(true);
        placeObjectAtHeadOffset(ctx.containerGroup, camera, ctx.HEAD_OFFSET, { yawOnly: true, matchYaw: true });
        ctx.twoHandedManip.isActive = false;
        ctx.leftPinchJumpGuard.reset();
        ctx.rightPinchJumpGuard.reset();
        ctx.updateHeaderPlaneTransform();
        ctx.updateUIRoot();
    }

    createStartModal(ctx, {
        message: 'Pinch both hands to adjust the scene.',
        onDismiss: placeContainerAtHeadOnDismiss,
    });

    function isStartModalKeepAlive(obj) {
        return obj === ctx.startModalRoot
            || obj === camera
            || obj.isLight
            || obj === ctx.hand1
            || obj === ctx.hand2
            || obj === ctx.lThumbObj
            || obj === ctx.lIndexObj
            || obj === ctx.rThumbObj
            || obj === ctx.rIndexObj;
    }

    function syncSceneBehindModal() {
        const show = !ctx.startModalActive;
        if (!show) {
            for (const child of scene.children) {
                if (isStartModalKeepAlive(child)) continue;
                if (child.visible) child.userData._hiddenByStartModal = true;
                if (child.userData._hiddenByStartModal) child.visible = false;
            }
        } else {
            for (const child of scene.children) {
                if (child.userData._hiddenByStartModal) {
                    child.visible = true;
                    child.userData._hiddenByStartModal = false;
                }
            }
        }
    }

    syncSceneBehindModal();

    const clock = new THREE.Clock();

    ctx.syncABCSlidersFromState();
    for (const key in ctx.sliders) {
        ctx.updateSliderTrackDotFromValue(key);
        ctx.updateSliderGrabDotPosition(key);
        ctx.updateSliderText(key);
    }

    const xrHeadPlacement = bindHeadRelativePlacementOnSessionStart({
        renderer,
        camera,
        placements: [{
            object: ctx.containerGroup,
            offset: ctx.HEAD_OFFSET,
            options: { yawOnly: true },
        }],
        onPlaced: () => {
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
            ctx.updateHeaderPlaneTransform();
            ctx.updateUIRoot();
        },
        onSessionEnd: () => {
            ctx.containerGroup.position.copy(ctx.DESKTOP_CONTAINER_POS);
            ctx.containerGroup.quaternion.identity();
            ctx.containerGroup.scale.setScalar(1);
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
            ctx.updateHeaderPlaneTransform();
            ctx.updateUIRoot();
        },
    });
    ctx.xrHeadPlacement = xrHeadPlacement;

    const _dirty = {
        containerPos: new THREE.Vector3().copy(ctx.containerGroup.position),
        containerQuat: new THREE.Quaternion().copy(ctx.containerGroup.quaternion),
        containerScale: ctx.containerGroup.scale.x,
        cameraPos: new THREE.Vector3(),
        lIndex: new THREE.Vector3().copy(ctx.lIndexObj.position),
        rIndex: new THREE.Vector3().copy(ctx.rIndexObj.position),
        lThumb: new THREE.Vector3().copy(ctx.lThumbObj.position),
        rThumb: new THREE.Vector3().copy(ctx.rThumbObj.position),
        focusKey: '',
        cameraSampled: false,
    };

    const DIRTY_CONTAINER_POS_EPS_SQ = 1e-8;
    const DIRTY_CONTAINER_SCALE_EPS = 1e-5;
    const DIRTY_HAND_POS_EPS_SQ = 1e-6;
    const DIRTY_CAMERA_POS_EPS_SQ = 2.5e-5;
    const DIRTY_QUAT_DOT_MIN = 0.999999;

    function _vecMovedSq(a, b, epsSq) {
        return a.distanceToSquared(b) > epsSq;
    }

    renderer.xr.addEventListener('sessionstart', () => {
        setTimeout(() => {
            ctx.buttonState.xrReady = true;
        }, ctx.buttonState.xrStartupDelay * 1000);
    });

    renderer.xr.addEventListener('sessionend', () => {
        ctx.buttonState.xrReady = false;
        if (ctx.UIPanelOn) ctx.hideUIPanel();
    });

    function tick() {
        const delta = clock.getDelta();
        ctx.delta = delta;
        gsap.ticker.tick(delta);

        ctx.xrHeadPlacement.update();

        ctx.handTracking();
        ctx.updateStartModal();

        const leftPinchActive = ctx.pinchState.left;
        const rightPinchActive = ctx.pinchState.right;
        let leftDraggingPlane = false;
        let rightDraggingPlane = false;
        let anySliderDragging = false;

        if (!ctx.startModalActive) {
            leftDraggingPlane = ctx.updatePlaneHandleGrabForHand('left', leftPinchActive, ctx.lPinchSphere.position);
            rightDraggingPlane = ctx.updatePlaneHandleGrabForHand('right', rightPinchActive, ctx.rPinchSphere.position);
            ctx.checkSliderGrab();
            anySliderDragging = ctx.isUISliderBeingDriven();
        }
        const anyPlaneDragging = leftDraggingPlane || rightDraggingPlane;

        if (ctx.isUIPanelFullyOpen() && !anySliderDragging) {
            ctx.updateAllSliderGrabDots();
        }

        camera.getWorldPosition(ctx._uiCameraWorldPos);

        const containerPosChanged = _vecMovedSq(ctx.containerGroup.position, _dirty.containerPos, DIRTY_CONTAINER_POS_EPS_SQ);
        const containerQuatChanged = Math.abs(ctx.containerGroup.quaternion.dot(_dirty.containerQuat)) < DIRTY_QUAT_DOT_MIN;
        const containerScaleChanged = Math.abs(ctx.containerGroup.scale.x - _dirty.containerScale) > DIRTY_CONTAINER_SCALE_EPS;
        const containerChanged = containerPosChanged || containerQuatChanged || containerScaleChanged;

        const cameraChanged = !_dirty.cameraSampled
            || _vecMovedSq(ctx._uiCameraWorldPos, _dirty.cameraPos, DIRTY_CAMERA_POS_EPS_SQ);

        const handsChanged =
            _vecMovedSq(ctx.lIndexObj.position, _dirty.lIndex, DIRTY_HAND_POS_EPS_SQ) ||
            _vecMovedSq(ctx.rIndexObj.position, _dirty.rIndex, DIRTY_HAND_POS_EPS_SQ) ||
            _vecMovedSq(ctx.lThumbObj.position, _dirty.lThumb, DIRTY_HAND_POS_EPS_SQ) ||
            _vecMovedSq(ctx.rThumbObj.position, _dirty.rThumb, DIRTY_HAND_POS_EPS_SQ);

        const focusKey = ctx.getActiveGrabAxesKey();
        if (focusKey !== _dirty.focusKey) {
            _dirty.focusKey = focusKey;
            ctx.applyPlaneFocusState(ctx.getActiveGrabAxes());
        }

        if (containerChanged || cameraChanged) {
            ctx.updateHeaderPlaneTransform();
            ctx.updateUIRoot();
            ctx.updateAxisLabelOrientation();
        }

        if (ctx.buttonState.cooldown > 0) {
            ctx.buttonState.cooldown -= delta;
        }
        if (!ctx.startModalActive && (handsChanged || containerChanged || cameraChanged)) {
            ctx.checkMenuButtonPress();
            ctx.checkCloseButtonPress();
            ctx.checkPrevButtonPress();
            ctx.checkNextButtonPress();
            ctx.checkPanelDistance();
        }

        if (!ctx.startModalActive) {
            if (anyPlaneDragging || anySliderDragging || !leftPinchActive || !rightPinchActive) {
                ctx.twoHandedManip.isActive = false;
                ctx.leftPinchJumpGuard.reset();
                ctx.rightPinchJumpGuard.reset();
            } else {
                ctx.applyTwoHandedContainerManip(ctx.containerGroup);
            }
        }

        const containerPosChangedNow = _vecMovedSq(ctx.containerGroup.position, _dirty.containerPos, DIRTY_CONTAINER_POS_EPS_SQ);
        const containerQuatChangedNow = Math.abs(ctx.containerGroup.quaternion.dot(_dirty.containerQuat)) < DIRTY_QUAT_DOT_MIN;
        const containerScaleChangedNow = Math.abs(ctx.containerGroup.scale.x - _dirty.containerScale) > DIRTY_CONTAINER_SCALE_EPS;
        const containerChangedNow = containerPosChangedNow || containerQuatChangedNow || containerScaleChangedNow;

        if (containerChangedNow && !containerChanged) {
            ctx.updateHeaderPlaneTransform();
            ctx.updateUIRoot();
            ctx.updateAxisLabelOrientation();
        }

        if (containerScaleChangedNow) {
            ctx.slicePlaneManager.compensateHandleScale();
        }

        if (containerChangedNow || cameraChanged || handsChanged || anyPlaneDragging || anySliderDragging) {
            ctx.updateClosestHandleVisibility();
        }

        _dirty.containerPos.copy(ctx.containerGroup.position);
        _dirty.containerQuat.copy(ctx.containerGroup.quaternion);
        _dirty.containerScale = ctx.containerGroup.scale.x;
        _dirty.cameraPos.copy(ctx._uiCameraWorldPos);
        _dirty.cameraSampled = true;
        _dirty.lIndex.copy(ctx.lIndexObj.position);
        _dirty.rIndex.copy(ctx.rIndexObj.position);
        _dirty.lThumb.copy(ctx.lThumbObj.position);
        _dirty.rThumb.copy(ctx.rThumbObj.position);

        ctx.updateSliceHint();

        syncSceneBehindModal();
        renderer.render(scene, camera);
    }

    return {
        scene,
        camera,
        renderer,
        xrHeadPlacement: ctx.xrHeadPlacement,
        start() {
            renderer.setAnimationLoop(tick);
        }
    };
}

export function teardownExperience(exp) {
    if (!exp?.renderer) return;
    exp.renderer.setAnimationLoop(null);
    exp.renderer.dispose();
    exp.renderer.domElement.remove();
}

export async function beginExperience(exp, session) {
    document.documentElement.classList.add('xr-active');
    await exp.renderer.xr.setSession(session);
    exp.start();
    return exp;
}

export async function launchExperience({ session }) {
    const exp = createExperience({ session });
    return beginExperience(exp, session);
}
