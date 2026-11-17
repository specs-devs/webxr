import * as THREE from 'three';
import gsap from 'gsap';
import { createSceneSetup } from './SceneSetup.js';
import { createContainer } from './Container.js';
import { createAttractors } from './Attractors.js';
import { createMenuUI } from './MenuUI.js';
import { createHandTracking } from './HandTracking.js';
import { createTwoHandedManip } from './TwoHandedManip.js';
import { createStartModal } from './StartModal.js';
import { bindHeadRelativePlacementOnSessionStart, placeObjectAtHeadOffset } from './XRHeadPlacement.js';

export function createExperience({ session = null, showXRButton = false } = {}) {
    const { scene, camera, renderer, syncRendererPixelRatio } = createSceneSetup({ session, showXRButton });

    /** Shared runtime context — modules read/write exports here via Object.assign. */
    const ctx = { scene, camera, renderer, syncRendererPixelRatio, session };

    createContainer(ctx);
    createAttractors(ctx);
    createMenuUI(ctx);
    createHandTracking(ctx);
    createTwoHandedManip(ctx);

    function placeContainerAtHeadOnDismiss() {
        if (!renderer.xr.isPresenting) return;
        camera.updateMatrixWorld(true);
        placeObjectAtHeadOffset(ctx.containerGroup, camera, ctx.HEAD_OFFSET, { yawOnly: true, matchYaw: true });
        ctx.containerGroup.rotateY(ctx.DESKTOP_CONTAINER_ROTATION_Y);
        ctx.twoHandedManip.isActive = false;
        ctx.leftPinchJumpGuard.reset();
        ctx.rightPinchJumpGuard.reset();
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
    ctx.clock = clock;

    ctx.initAttractor();
    ctx.syncAttractorEquationPlane();

    const xrHeadPlacement = bindHeadRelativePlacementOnSessionStart({
        renderer,
        camera,
        placements: [{
            object: ctx.containerGroup,
            offset: ctx.HEAD_OFFSET,
            options: { yawOnly: true },
        }],
        onSessionEnd: () => {
            ctx.containerGroup.position.copy(ctx.DESKTOP_CONTAINER_POS);
            ctx.containerGroup.rotation.set(0, ctx.DESKTOP_CONTAINER_ROTATION_Y, 0);
            ctx.containerGroup.scale.setScalar(ctx.containerConfig.initialScale);
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
        },
    });
    ctx.xrHeadPlacement = xrHeadPlacement;

    function GSAPAnims() {
        // Runs after render each XR frame (WebXR GSAP convention)
    }

    function tick() {
        ctx.delta = clock.getDelta();
        gsap.ticker.tick(ctx.delta);

        ctx.xrHeadPlacement.update();
        ctx.handTracking();
        ctx.updateStartModal();

        if (!ctx.startModalActive) {
            ctx.applyTwoHandedContainerManip();
            ctx.checkNavButtonsPress();
        }

        ctx.updateAttractor();

        if (ctx.shouldRefreshViewDependentUI()) {
            ctx.updateContainerWireframeVisibility();
            if (!ctx.shouldFreezeTempRefByFingerProximity()) {
                ctx.updateTempRefTowardUserSphere();
                ctx.updateTempRefUiPlaneYaw();
            }
            ctx.updateContainerAttractorLabelYaw();
            ctx.updateBuildProgressLabelYaw();
            ctx.updateTempRefContainerCenterSphereYaw();
            ctx.updateTempRefContainerRightSpherePlaneYaw();
        }

        // Progress label only while building / drawing, or once more to hide when done.
        if (ctx._buildState.active || ctx.visualMode === 'draw' || ctx.buildProgressGroup?.visible) {
            ctx.syncBuildProgressLabel();
        }

        syncSceneBehindModal();
        renderer.render(scene, camera);

        GSAPAnims();
    }

    return {
        scene,
        camera,
        renderer,
        xrHeadPlacement,
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
