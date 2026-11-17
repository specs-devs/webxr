import * as THREE from 'three';
import gsap from 'gsap';
import { createSceneSetup } from './SceneSetup.js';
import { createSpringConfig, createSpring } from './Spring.js';
import { createContainer } from './Container.js';
import { createHandTracking } from './HandTracking.js';
import { createTwoHandedManip } from './TwoHandedManip.js';
import { createMenuUI } from './MenuUI.js';
import { createStartModal } from './StartModal.js';
import { placeObjectAtHeadOffset } from './XRHeadPlacement.js';

export function createExperience({ session = null, showXRButton = false } = {}) {
    const { scene, camera, renderer } = createSceneSetup({ session, showXRButton });

    /** Shared runtime context — modules read/write exports here via Object.assign. */
    const ctx = { scene, camera, renderer, session };

    createSpringConfig(ctx);
    createContainer(ctx);
    createHandTracking(ctx);
    createTwoHandedManip(ctx);
    createSpring(ctx);
    createMenuUI(ctx);

    function placeContainerAtHeadOnDismiss() {
        if (!renderer.xr.isPresenting) return;
        camera.updateMatrixWorld(true);
        placeObjectAtHeadOffset(ctx.containerGroup, camera, ctx.HEAD_OFFSET, {
            yawOnly: true,
            matchYaw: true,
        });
        ctx.containerGroup.rotateY(ctx.CONTAINER_DEFAULT_YAW);
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

    /** Disable frustum culling on every Object3D. */
    function setSceneFrustumCulledFalse(root) {
        root.traverse((obj) => {
            obj.frustumCulled = false;
        });
    }
    setSceneFrustumCulledFalse(scene);
    let frustumCullWarmupFrames = 90;

    const clock = new THREE.Clock();

    const _grabPinchPosLeft = new THREE.Vector3();
    const _grabPinchPosRight = new THREE.Vector3();
    const _grabLocalPos = new THREE.Vector3();
    const _grabBobLocal = new THREE.Vector3();

    function tick() {
        if (frustumCullWarmupFrames > 0) {
            setSceneFrustumCulledFalse(scene);
            frustumCullWarmupFrames--;
        }
        let delta = clock.getDelta();
        if (delta <= 0) delta = 0.016;
        delta = Math.min(delta, 0.05);
        const elapsedTime = clock.getElapsedTime();
        ctx.delta = delta;

        ctx.xrHeadPlacement.update();

        ctx.handTracking();
        ctx.updateStartModal();

        const leftPinchActive = ctx.pinchState.left;
        const rightPinchActive = ctx.pinchState.right;
        const leftPinchPos = leftPinchActive ? _grabPinchPosLeft.copy(ctx.lPinchSphere.position) : null;
        const rightPinchPos = rightPinchActive ? _grabPinchPosRight.copy(ctx.rPinchSphere.position) : null;

        if (!ctx.startModalActive) {
            ctx.checkMenuButtonPress(delta);
            ctx.checkHeaderTogglePress();
            ctx.checkMenuPrevButtonPress();
            ctx.checkMenuNextButtonPress();
            ctx.checkMenuCloseButtonPress();
            ctx.checkMenuSliderGrab();
        }
        ctx.updateAllMenuSliderGrabDots();

        const grabRadius = ctx.springConfig.massRadius + 0.08;
        const anyPinchActive = leftPinchActive || rightPinchActive;
        const restLen = ctx.springConfig.restLength;

        if (ctx.grabState.isGrabbed) {
            const activePos = ctx.grabState.handKey === 'left' ? leftPinchPos : rightPinchPos;
            const stillPinching = ctx.grabState.handKey === 'left' ? leftPinchActive : rightPinchActive;

            if (!stillPinching || !activePos) {
                const v = ctx.springState.velocity;
                const cap = ctx.springConfig.maxThrowVelocity;
                ctx.springState.velocity = THREE.MathUtils.clamp(v, -cap, cap);
                ctx.grabState.isGrabbed = false;
                ctx.grabState.handKey = null;
                ctx.grabState.lastDisplacement = null;
                ctx.grabState.lastTime = null;
                ctx.resetSimulationTime();
            } else {
                ctx.springAnchor.updateMatrixWorld(true);
                const local = _grabLocalPos.copy(activePos);
                ctx.springAnchor.worldToLocal(local);

                const { yLo, yHi } = ctx.springBobCenterYBounds(restLen);
                const yClamped = THREE.MathUtils.clamp(local.y, yLo, yHi);
                const newU = -yClamped - restLen;

                if (ctx.grabState.lastDisplacement != null) {
                    const dtRaw = elapsedTime - ctx.grabState.lastTime;
                    const dt = Math.max(dtRaw, ctx.springConfig.throwMinDt);
                    if (dtRaw > 0.0005) {
                        const du = newU - ctx.grabState.lastDisplacement;
                        const rawV = (du / dt) * ctx.springConfig.throwVelocityGain;
                        const cap = ctx.springConfig.maxThrowVelocity;
                        const clamped = THREE.MathUtils.clamp(rawV, -cap, cap);
                        const s = ctx.springConfig.throwVelocitySmoothing;
                        ctx.springState.velocity += (clamped - ctx.springState.velocity) * s;
                    }
                }

                ctx.springState.displacement = newU;
                ctx.clampSpringDisplacement(ctx.springState);
                ctx.grabState.lastDisplacement = ctx.springState.displacement;
                ctx.grabState.lastTime = elapsedTime;
            }
        }

        if (!ctx.startModalActive && anyPinchActive && !ctx.activeMenuSliderKey && !ctx.grabState.isGrabbed) {
            ctx.springAnchor.updateMatrixWorld(true);
            const yMass = -(restLen + ctx.springState.displacement);
            const bobLocalNow = _grabBobLocal.set(0, yMass, 0);

            const pinchCandidates = [];
            if (leftPinchPos) pinchCandidates.push({ key: 'left', pos: leftPinchPos });
            if (rightPinchPos) pinchCandidates.push({ key: 'right', pos: rightPinchPos });

            for (const c of pinchCandidates) {
                const local = _grabLocalPos.copy(c.pos);
                ctx.springAnchor.worldToLocal(local);
                const distBob = local.distanceTo(bobLocalNow);
                if (distBob > grabRadius) continue;

                ctx.grabState.isGrabbed = true;
                ctx.grabState.handKey = c.key;
                const { yLo, yHi } = ctx.springBobCenterYBounds(restLen);
                const yClamped = THREE.MathUtils.clamp(local.y, yLo, yHi);
                ctx.springState.displacement = -yClamped - restLen;
                ctx.clampSpringDisplacement(ctx.springState);
                ctx.springState.velocity = 0;
                ctx.grabState.lastDisplacement = ctx.springState.displacement;
                ctx.grabState.lastTime = elapsedTime;
                ctx.resetSimulationTime();
                ctx.dismissPullHint();
                break;
            }
        }

        if (!ctx.startModalActive && !ctx.grabState.isGrabbed && !ctx.activeMenuSliderKey && leftPinchActive && rightPinchActive) {
            ctx.applyTwoHandedContainerManip();
        } else {
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
        }

        const substeps = 4;
        const physicsDelta = delta * ctx.springConfig.timeScale;
        if (!ctx.grabState.isGrabbed) {
            ctx.simulationElapsed += physicsDelta;
            for (let i = 0; i < substeps; i++) {
                ctx.integrateSpring(ctx.springState, physicsDelta / substeps);
                ctx.clampSpringDisplacement(ctx.springState);
            }
        }

        ctx.updateSpringVisual(delta);
        ctx.updateMenuPlaceholder();
        ctx.updateHeaderRef();
        ctx.updateHeaderStats(delta);

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
