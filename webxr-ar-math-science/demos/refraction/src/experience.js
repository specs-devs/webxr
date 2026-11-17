import * as THREE from 'three';
import gsap from 'gsap';
import { createSceneSetup } from './SceneSetup.js';
import { createHandTracking } from './HandTracking.js';
import { createOpticalObjects } from './OpticalObjects.js';
import { createObjectManipulation } from './ObjectManipulation.js';
import { createSnellsLawTracer } from './SnellsLawTracer.js';
import { createTwoHandedManip } from './TwoHandedManip.js';
import { createMenuUI } from './MenuUI.js';
import { createStartModal } from './StartModal.js';
import { placeObjectAtHeadOffset } from './XRHeadPlacement.js';

export function createExperience({ session = null, showXRButton = false } = {}) {
    const { scene, camera, renderer } = createSceneSetup({ session, showXRButton });

    const ctx = { scene, camera, renderer, session };

    createHandTracking(ctx);
    createOpticalObjects(ctx);
    createObjectManipulation(ctx);
    createSnellsLawTracer(ctx);
    createTwoHandedManip(ctx);
    createMenuUI(ctx);

    function placeContainerAtHeadOnDismiss() {
        if (!renderer.xr.isPresenting) return;
        camera.updateMatrixWorld(true);
        placeObjectAtHeadOffset(ctx.containerGroup, camera, ctx.containerConfig.headOffset, { yawOnly: true, matchYaw: true });
        ctx.twoHandedManip.isActive = false;
        ctx.leftPinchJumpGuard.reset();
        ctx.rightPinchJumpGuard.reset();
        ctx.applyPointerRestPose();
        ctx.updateUIReferencePositions();
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
    let delta = 0;

    function tick() {
        delta = clock.getDelta();
        ctx.delta = delta;
        gsap.ticker.tick(delta);

        ctx.xrHeadPlacement.update();
        ctx.handTracking();
        ctx.updateStartModal();

        if (ctx.grabReleaseCooldown > 0) ctx.grabReleaseCooldown -= delta;

        const leftPinchActive = ctx.pinchState.left;
        const rightPinchActive = ctx.pinchState.right;
        const anyGrabBeforeStart = ctx.objectGrab.left.active || ctx.objectGrab.right.active || ctx.pointerGrab.active;
        const sceneGestureLock = leftPinchActive && rightPinchActive && !anyGrabBeforeStart;

        if (!ctx.startModalActive && !sceneGestureLock) {
            ctx.checkMenuSliderGrab();
            if (!ctx.menuSlider.state.isGrabbed) {
                ctx.checkButtonPress(delta);
                ctx.checkCloseButtonPress();
                ctx.checkPrevNextButtonPress();
                ctx.checkStepperNavButtonPress();
                ctx.checkResetButtonPress(delta);
                ctx.checkPointerMenuButtonPress(delta);
                ctx.checkPointerMenuChildButtonsPress(delta);
            }
        }
        ctx.updateUIReferencePositions();
        ctx.updateUIRoot();

        if (ctx.objectGrab.left.active && !leftPinchActive) {
            const releasedLeft = ctx.objectGrab.left.object;
            const leftHadLeftUI = ctx.objectGrab.left.hasLeftUIArea;
            ctx.stopObjectGrab('left');
            if (releasedLeft && leftHadLeftUI && ctx.isReleasedNearUI(releasedLeft)) {
                ctx.returnObjectToSlot(releasedLeft);
            }
        }
        if (ctx.objectGrab.right.active && !rightPinchActive) {
            const releasedRight = ctx.objectGrab.right.object;
            const rightHadLeftUI = ctx.objectGrab.right.hasLeftUIArea;
            ctx.stopObjectGrab('right');
            if (releasedRight && rightHadLeftUI && ctx.isReleasedNearUI(releasedRight)) {
                ctx.returnObjectToSlot(releasedRight);
            }
        }

        if (ctx.pointerGrab.active) {
            const grabHandPinching = ctx.pointerGrab.hand === 'left' ? leftPinchActive : rightPinchActive;
            if (!grabHandPinching) {
                ctx.pointerGrab.active = false;
                ctx.pointerGrab.hand = null;
            }
        }

        const leftSliderBusy = ctx.menuSlider.state.isGrabbed && ctx.menuSlider.state.grabbingHand === 'left';
        const rightSliderBusy = ctx.menuSlider.state.isGrabbed && ctx.menuSlider.state.grabbingHand === 'right';
        const leftHandFree  = !ctx.objectGrab.left.active  && !(ctx.pointerGrab.active && ctx.pointerGrab.hand === 'left') && !leftSliderBusy;
        const rightHandFree = !ctx.objectGrab.right.active && !(ctx.pointerGrab.active && ctx.pointerGrab.hand === 'right') && !rightSliderBusy;

        if (!ctx.startModalActive && !sceneGestureLock && leftPinchActive && leftHandFree) {
            if (!ctx.startObjectGrab('left')) {
                ctx.tryStartPointerGrab('left');
            }
        }
        if (!ctx.startModalActive && !sceneGestureLock && rightPinchActive && rightHandFree) {
            if (!ctx.startObjectGrab('right')) {
                ctx.tryStartPointerGrab('right');
            }
        }

        ctx.objectGrab.left.active  && ctx.applyObjectGrab('left');
        ctx.objectGrab.right.active && ctx.applyObjectGrab('right');
        ctx.pointerGrab.active      && ctx.applyPointerGrab();

        ctx.pointerObj.updateMatrixWorld(true);
        ctx._pointerObjWorldCenter.set(0, 0, ctx.pointerDims.pivotOffsetZ + ctx.pointerDims.barrelLenZ * 0.5);
        ctx.pointerObj.localToWorld(ctx._pointerObjWorldCenter);

        ctx.pointerMenuButton.position.copy(ctx._pointerTipLocal);
        ctx.pointerObj.localToWorld(ctx.pointerMenuButton.position);
        if (ctx.pointerGrab.active) {
            ctx.pointerMenuButton.position.addScaledVector(ctx._grabPointerDir, ctx.POINTER_TIP_DOT_GAP);
        } else {
            ctx._pointerTipGapDir.set(0, 0, 1).applyQuaternion(ctx.pointerObj.quaternion).normalize();
            ctx.pointerMenuButton.position.addScaledVector(ctx._pointerTipGapDir, ctx.POINTER_TIP_DOT_GAP);
        }
        camera.getWorldPosition(ctx._pmCamWorldPos);
        ctx._pmOffsetDir.subVectors(ctx._pmCamWorldPos, ctx.pointerMenuButton.position).normalize();
        ctx.pointerMenuButton.position.addScaledVector(ctx._pmOffsetDir, ctx.POINTER_MENU_BUTTON_Z_POP);
        ctx._pmButtonBaseWorldPos.copy(ctx.pointerMenuButton.position);
        ctx.pointerMenuButton.position.addScaledVector(ctx._pmOffsetDir, ctx.pointerMenuButtonPressAnim.depthOffset);
        ctx.pointerMenuButton.lookAt(ctx._pmCamWorldPos);

        if (!ctx.pointerHintState.rayModeDismissed && !ctx.pointerMenuState.isOpen && ctx.pointerMenuPanel.scale.x < 1e-4 && ctx.pointerMenuButton.scale.x > 0.5) {
            ctx.pointerRayModeHint.visible = true;
            ctx.pointerRayModeHint.position.copy(ctx._pmButtonBaseWorldPos);
            camera.getWorldPosition(ctx._pmCamWorldPos);
            ctx._pmOffsetDir.subVectors(ctx._pmCamWorldPos, ctx.pointerRayModeHint.position).normalize();
            ctx.pointerRayModeHint.position.addScaledVector(ctx._pmOffsetDir, ctx.POINTER_MENU_BUTTON_Z_POP * 0.5);
            ctx.pointerRayModeHint.lookAt(ctx._pmCamWorldPos);
        } else if (!ctx.pointerHintState.rayModeDismissed) {
            ctx.pointerRayModeHint.visible = false;
        }

        if (!ctx.pointerHintState.grabDismissed && !ctx.pointerGrab.active && !ctx.pointerMenuState.isOpen && ctx.pointerMenuPanel.scale.x < 1e-4) {
            ctx.pointerGrabHint.visible = true;
            ctx.pointerGrabHint.position.copy(ctx._pointerObjWorldCenter);
            camera.getWorldPosition(ctx._pmCamWorldPos);
            ctx._pmOffsetDir.subVectors(ctx._pmCamWorldPos, ctx.pointerGrabHint.position).normalize();
            ctx.pointerGrabHint.position.addScaledVector(ctx._pmOffsetDir, ctx.POINTER_MENU_BUTTON_Z_POP * 0.5);
            ctx.pointerGrabHint.lookAt(ctx._pmCamWorldPos);
            if (ctx.laserMode === '3-ray') {
                ctx.pointerGrabHint.position.addScaledVector(ctx.pointerGrabHint.up, ctx.POINTER_GRAB_HINT_3RAY_Y_OFFSET);
            }
        } else if (!ctx.pointerHintState.grabDismissed) {
            ctx.pointerGrabHint.visible = false;
        }

        if (ctx.pointerMenuState.isOpen || ctx.pointerMenuPanel.scale.x > 1e-4) {
            ctx.pointerMenuPanel.position.copy(ctx._pmButtonBaseWorldPos);
            ctx.pointerMenuPanel.position.y += ctx.POINTER_MENU_PANEL_OFFSET_Y;
            camera.getWorldPosition(ctx._pmCamWorldPos);
            ctx._pmOffsetDir.subVectors(ctx._pmCamWorldPos, ctx.pointerMenuPanel.position).normalize();
            ctx.pointerMenuPanel.position.addScaledVector(ctx._pmOffsetDir, ctx.POINTER_MENU_PANEL_Z_POP);
            ctx.pointerMenuPanel.lookAt(ctx._pmCamWorldPos);
        }

        if (!ctx.startModalActive && sceneGestureLock) {
            ctx.applyTwoHandedContainerManip(ctx.containerGroup);
        } else {
            ctx.twoHandedManip.isActive = false;
        }

        ctx.updatePointerLaser();

        ctx.updateContainerHeaderBillboard();
        ctx.updateAngleLabelBillboards();
        ctx.updateObjectNameLabels();
        ctx.updateSphereOutlines();
        ctx.updateMenuSliderGrabDotResting();

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
