import * as THREE from 'three';
import gsap from 'gsap';
import { createSceneSetup } from './SceneSetup.js';
import { createContainer } from './Container.js';
import { createHandTracking } from './HandTracking.js';
import { createChladni } from './Chladni.js';
import { createTwoHandedManip } from './TwoHandedManip.js';
import { createMenuUI } from './MenuUI.js';
import { createPlateAudio } from './PlateAudio.js';
import { createStartModal } from './StartModal.js';
import { bindHeadRelativePlacementOnSessionStart, placeObjectAtHeadOffset } from './XRHeadPlacement.js';

export function createExperience({ session = null, showXRButton = false } = {}) {
    const { scene, camera, renderer } = createSceneSetup({ session, showXRButton });

    /** Shared runtime context — modules read/write exports here via Object.assign. */
    const ctx = { scene, camera, renderer, session };

    createContainer(ctx);
    createHandTracking(ctx);
    createChladni(ctx);
    createTwoHandedManip(ctx);
    createMenuUI(ctx);
    createPlateAudio(ctx);

    /** XR only: place the volume at the current head pose (same offset as session start). */
    function placeContainerAtHeadOnDismiss() {
        if (!renderer.xr.isPresenting) return;
        camera.updateMatrixWorld(true);
        placeObjectAtHeadOffset(ctx.containerGroup, camera, ctx.HEAD_OFFSET, {
            yawOnly: true,
            matchYaw: true,
        });
        ctx.twoHandedManip.isActive = false;
        ctx.leftPinchJumpGuard.reset();
        ctx.rightPinchJumpGuard.reset();
    }

    createStartModal(ctx, {
        message: 'Pinch both hands to adjust the scene.',
        onDismiss: placeContainerAtHeadOnDismiss,
    });

    /** Hide the experience while the start panel is up; reveal on dismiss. */
    function syncSceneBehindModal() {
        ctx.containerGroup.visible = !ctx.startModalActive;
    }

    syncSceneBehindModal();

    const xrHeadPlacement = bindHeadRelativePlacementOnSessionStart({
        renderer,
        camera,
        placements: [{
            object: ctx.containerGroup,
            offset: ctx.HEAD_OFFSET,
            options: { yawOnly: true, matchYaw: true },
        }],
        onPlaced: () => {
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
        },
        onSessionEnd: () => {
            ctx.containerGroup.position.copy(ctx.DESKTOP_CONTAINER_POS);
            ctx.containerGroup.rotation.set(0, 0, 0);
            ctx.containerGroup.scale.setScalar(ctx.containerConfig.initialScale);
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
        },
    });
    ctx.xrHeadPlacement = xrHeadPlacement;

    const clock = new THREE.Clock();
    let lastTime = 0;

    function tick() {
        ctx.xrHeadPlacement.update();

        const elapsedTime = clock.getElapsedTime();
        const deltaTime = Math.min(elapsedTime - lastTime, 0.05);
        lastTime = elapsedTime;
        ctx.delta = deltaTime;

        ctx.handTracking();
        ctx.updateStartModal();

        if (!ctx.startModalActive) {
            ctx.checkMenuButtonPress(deltaTime);
            ctx.checkAudioCheckboxPress();
            if (ctx.menuPanelOpen) {
                ctx.checkMenuPanelButtonsPress();
                ctx.checkMenuSlidersGrab();
                for (const slider of ctx.menuSliders) {
                    ctx.updateMenuSliderGrabDotPosition(slider);
                }
            }
            ctx.checkFrequencyKnobInteraction();
            ctx.updateFrequencyKnobGrabPosition();
        }

        ctx.cacheCameraWorldPos();
        ctx.updateMenuPlaceholder();
        ctx.updateHeaderPlaneBillboard();
        ctx.updateReferenceSecondaryOrbit();
        if (!ctx.startModalActive && ctx.frequencyKnobState.isGrabbed) {
            ctx.updateFrequencyKnobRadialConnector();
        }
        ctx.updateFrequencyPlaneText();

        ctx.updateResonance();
        ctx.applyResonanceToVisuals();
        ctx.updatePlateAudio();

        if (ctx.currentViewMode === ctx.VIEW_MODES.PARTICLES) ctx.updateChladniParticles(deltaTime);

        if (!ctx.startModalActive) {
            ctx.updateViewModeEdgeButtons();

            const leftPinchActive = ctx.pinchState.left;
            const rightPinchActive = ctx.pinchState.right;

            if (ctx.frequencyKnobState.isGrabbed) {
                ctx.twoHandedManip.isActive = false;
                ctx.leftPinchJumpGuard.reset();
                ctx.rightPinchJumpGuard.reset();
            } else if (!leftPinchActive || !rightPinchActive) {
                ctx.twoHandedManip.isActive = false;
                ctx.leftPinchJumpGuard.reset();
                ctx.rightPinchJumpGuard.reset();
            } else {
                ctx.applyTwoHandedContainerManip(ctx.containerGroup);
            }
        }

        gsap.ticker.tick();
        gsap.ticker.sleep();

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
