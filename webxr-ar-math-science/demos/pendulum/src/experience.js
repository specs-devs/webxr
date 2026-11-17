import * as THREE from 'three';
import gsap from 'gsap';
import { createSceneSetup } from './SceneSetup.js';
import { createContainer } from './Container.js';
import { createHandTracking } from './HandTracking.js';
import { createPendulum } from './Pendulum.js';
import { createTwoHandedManip } from './TwoHandedManip.js';
import { createMenuUI } from './MenuUI.js';
import { createStartModal } from './StartModal.js';
import { placeObjectAtHeadOffset } from './XRHeadPlacement.js';

export function createExperience({ session = null, showXRButton = false } = {}) {
    const { scene, camera, renderer } = createSceneSetup({ session, showXRButton });

    /** Shared runtime context — modules read/write exports here via Object.assign. */
    const ctx = { scene, camera, renderer, session };

    createContainer(ctx);
    createHandTracking(ctx);
    createPendulum(ctx);
    createTwoHandedManip(ctx);
    createMenuUI(ctx);

    function placeContainerAtHeadOnDismiss() {
        if (!renderer.xr.isPresenting) return;
        camera.updateMatrixWorld(true);
        placeObjectAtHeadOffset(ctx.containerGroup, camera, ctx.HEAD_OFFSET, { yawOnly: true, matchYaw: true });
        ctx.twoHandedManip.isActive = false;
        ctx.leftPinchJumpGuard.reset();
        ctx.rightPinchJumpGuard.reset();
        ctx.updateMenuUIReferencePositions();
        ctx.updateUIHeaderRefPosition();
        ctx.updateUIHeaderRoot();
        ctx.updateMenuUIRoot();
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

    function tick() {
        // ONE Clock.getDelta() per frame (getElapsedTime() also calls getDelta — would zero the 2nd call)
        let delta = clock.getDelta();
        if (delta <= 0) delta = 0.016;
        delta = Math.min(delta, 0.05);
        const elapsedTime = clock.elapsedTime;
        ctx.menuFrameDelta = delta;
        ctx.delta = delta;
        gsap.ticker.tick(delta);

        // Head-relative container placement (runs once shortly after sessionstart)
        ctx.xrHeadPlacement.update();

        // Hands first, then move UI to this frame’s cube, then hit-tests
        ctx.handTracking();
        ctx.updateStartModal();

        const camInsideCube = ctx.isCameraInsideMenuCube();
        if (!camInsideCube) {
            ctx.updateMenuUIReferencePositions();
            ctx.updateMenuUIRoot(false);
            if (!ctx.startModalActive) {
                ctx.checkMenuButtonPress();
                // Panel controls only while open (button open-press stays above)
                if (ctx.menuUIPanelOn) {
                    ctx.checkMenuSliderGrab();
                    ctx.checkMenuCloseButtonPress();
                    ctx.checkMenuPrevButtonPress();
                    ctx.checkMenuNextButtonPress();
                    ctx.checkMenuPausePlayButtonPress();
                    ctx.checkMenuSpeedButtonPress();
                    ctx.checkMenuResetButtonPress();
                    ctx.checkMenuPanelDistance();
                }
            }
        } else {
            // Same as original: hide edge menu while camera is inside the cube
            ctx.updateMenuUIRoot(true);
            if (ctx.menuButtonState.xrReady && ctx.menuButtonState.cooldown > 0) {
                ctx.menuButtonState.cooldown -= ctx.menuFrameDelta;
            }
        }

        // Get pinch states
        const leftPinchActive = ctx.pinchState.left;
        const rightPinchActive = ctx.pinchState.right;
        const leftPinchPos = leftPinchActive ? ctx.lPinchSphere.position : null;
        const rightPinchPos = rightPinchActive ? ctx.rPinchSphere.position : null;

        if (!ctx.startModalActive) {
            // Mass grab first — if either hand holds a ball, two-handed container must not run
            ctx.handlePendulumGrab(leftPinchActive, rightPinchActive, leftPinchPos, rightPinchPos, delta, elapsedTime);

            if (!leftPinchActive || !rightPinchActive) {
                ctx.twoHandedManip.isActive = false;
                ctx.leftPinchJumpGuard.reset();
                ctx.rightPinchJumpGuard.reset();
            } else if (ctx.isAnyGrabbed() || ctx.isAnyMenuSliderGrabbed()) {
                ctx.twoHandedManip.isActive = false;
                ctx.leftPinchJumpGuard.reset();
                ctx.rightPinchJumpGuard.reset();
            } else {
                ctx.applyTwoHandedContainerManip();
            }
        }

        ctx.updateContainerOverscaleUI();

        ctx.updateUIHeaderRefPosition();
        ctx.updateUIHeaderInsideCube(camInsideCube);
        if (ctx.simFlags.infoUIEnabled) {
            ctx.updateInfoPanelWorldScale();
            ctx.updateInfoPanelPivot();
        }
        // Skip billboard + toggle hit-test while header is fully scaled away
        if (ctx.UIHeader.scale.x >= 0.01) {
            ctx.updateUIHeaderRoot();
            if (!camInsideCube && !ctx.startModalActive) ctx.checkTogglePress();
        }

        // Physics integration (substeps keep the RK4 step small for accuracy)
        if (ctx.menuPausePlayState.isPause && !ctx.resetTransitionState.active) {
            const twoHandManipFrame =
                ctx.pinchState.left && ctx.pinchState.right && !ctx.isAnyGrabbed() && !ctx.isAnyMenuSliderGrabbed();
            const substeps = ctx.getAdaptivePhysicsSubsteps(delta, ctx.isAnyGrabbed() || twoHandManipFrame);
            const physicsDelta = delta * ctx.pendulumConfig.timeScale;
            const h = physicsDelta / substeps;
            for (let i = 0; i < substeps; i++) {
                ctx.integratePhysics(ctx.pendulumState, h);
                ctx.sampleMass2Trail();
            }
            ctx.stabilizePendulumState(ctx.pendulumState);
            // Skip while menu sliders are grabbed — otherwise PE/KE snaps from
            // live length/mass edits get defended as a rising energy budget.
            if (!ctx.isAnyGrabbed() && !ctx.isAnyMenuSliderGrabbed())
                ctx.renormalizeEnergy(ctx.pendulumState);
        }

        // Update visualization
        ctx.updatePendulum();

        if (ctx.simFlags.infoUIEnabled) {
            const str1 = ctx.formatInfoPanelSpeed(ctx.pendulumState.vel1.length());
            const str2 = ctx.formatInfoPanelSpeed(ctx.pendulumState.vel2.length());
            const { ke, pe, total } = ctx.computePendulumEnergies(ctx.pendulumState);
            const eKe = ctx.formatInfoPanelEnergyJoules(ke);
            const ePe = ctx.formatInfoPanelEnergyJoules(pe);
            const eTot = ctx.formatInfoPanelEnergyJoules(total);
            if (
                str1 !== ctx.infoPanelValues.speedM1 ||
                str2 !== ctx.infoPanelValues.speedM2 ||
                eKe !== ctx.infoPanelValues.energyKE ||
                ePe !== ctx.infoPanelValues.energyPE ||
                eTot !== ctx.infoPanelValues.energyTotal
            ) {
                ctx.setInfoPanelValues({
                    speedM1: str1,
                    speedM2: str2,
                    energyKE: eKe,
                    energyPE: ePe,
                    energyTotal: eTot
                });
            }
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
