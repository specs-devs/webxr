import * as THREE from 'three';
import gsap from 'gsap';
import { createSceneSetup } from './SceneSetup.js';
import { createContainer } from './Container.js';
import { createMenuUI } from './MenuUI.js';
import { createGravity } from './Gravity.js';
import { createHandTracking } from './HandTracking.js';
import { createTwoHandedManip } from './TwoHandedManip.js';
import { createStartModal } from './StartModal.js';
import { bindHeadRelativePlacementOnSessionStart, placeObjectAtHeadOffset } from './XRHeadPlacement.js';

export function createExperience({ session = null, showXRButton = false } = {}) {
    const { scene, camera, renderer, syncRendererPixelRatio } = createSceneSetup({ session, showXRButton });

    /** Shared runtime context — modules read/write exports here via Object.assign. */
    const ctx = { scene, camera, renderer, syncRendererPixelRatio, session };

    createContainer(ctx);
    createMenuUI(ctx);
    createGravity(ctx);
    createHandTracking(ctx);
    createTwoHandedManip(ctx);

    function placeContainerAtHeadOnDismiss() {
        if (!renderer.xr.isPresenting) return;
        camera.updateMatrixWorld(true);
        placeObjectAtHeadOffset(ctx.containerGroup, camera, ctx.HEAD_OFFSET, { yawOnly: true, matchYaw: true });
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

    ctx.updateGravityVisuals({ force: true });
    ctx.applyGravityViewMode(false);
    ctx.updatePlanetHeights();
    ctx.syncGridOpacityWithForceField();
    ctx.syncForceCheckboxInnerVisual();

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
        },
        onSessionEnd: () => {
            ctx.containerGroup.position.copy(ctx.DESKTOP_CONTAINER_POS);
            ctx.containerGroup.quaternion.identity();
            ctx.containerGroup.scale.setScalar(ctx.INITIAL_CONTAINER_SCALE);
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
        },
    });
    ctx.xrHeadPlacement = xrHeadPlacement;

    const clock = new THREE.Clock();

    function tick() {
        ctx.delta = clock.getDelta();
        gsap.ticker.tick(ctx.delta);

        ctx.xrHeadPlacement.update();
        ctx.handTracking();
        ctx.updateStartModal();

        const leftPinchActive = ctx.pinchState.left;
        const rightPinchActive = ctx.pinchState.right;

        if (!ctx.startModalActive) {
            ctx.updatePlanetDrag(leftPinchActive, rightPinchActive);

            if (ctx.isAnyPlanetDragging() || !leftPinchActive || !rightPinchActive) {
                ctx.twoHandedManip.isActive = false;
                ctx.leftPinchJumpGuard.reset();
                ctx.rightPinchJumpGuard.reset();
            } else {
                ctx.applyTwoHandedContainerManip();
            }
        } else {
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
        }

        ctx.updateOrbitMode(ctx.delta);
        ctx.updateEditModeHeights();
        ctx.updateGravityVisuals();
        ctx.updateComets(ctx.delta);
        ctx.updateUIScaleVisibility();
        ctx.updateHeaderPlane();
        ctx.updateLabels();
        ctx.updateMenuButton();
        if (!ctx.startModalActive) {
            ctx.checkMenuButtonPress();
            ctx.checkShootButtonPress();
            ctx.checkHeaderSwitchPress();
            ctx.checkForceCheckboxPress();
        }

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
