import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import gsap from 'gsap';
import { createSceneSetup } from './SceneSetup.js';
import { createContainer } from './Container.js';
import { createRevolution } from './Revolution.js';
import { createHandTracking } from './HandTracking.js';
import { createTwoHandedManip } from './TwoHandedManip.js';
import { createMenuUI } from './MenuUI.js';
import { createStartModal } from './StartModal.js';
import { bindHeadRelativePlacementOnSessionStart, placeObjectAtHeadOffset } from './XRHeadPlacement.js';

export function createExperience({ session = null, showXRButton = false } = {}) {
    const { scene, camera, renderer } = createSceneSetup({ session, showXRButton });

    /** Shared runtime context — modules read/write exports here via Object.assign. */
    const ctx = { scene, camera, renderer, session };

    createContainer(ctx);
    createRevolution(ctx);
    createHandTracking(ctx);
    createTwoHandedManip(ctx);
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

    // After deps wiring — header reads profileState / isDiskMode from Revolution.
    ctx.updateProfileCurve();
    ctx.updateHeaderPlane();
    ctx.syncSliderOne();
    ctx.syncSliderTwo();
    ctx.updateMenuPresetLabel(ctx.getProfileStepperLabel());

    /** First-open hint: yaw around volume Y (not the text center), down + toward the user. */
    const HINT_TEXT = 'Drag or add points';
    const HINT_TEXT_SIZE = (0.5 * 1.15) * (176 / 634) * (55 / 528);
    const HINT_TEXT_OPACITY = 0.6;
    const HINT_FADE_DURATION = 0.4;
    const HINT_LOCAL_Y = -0.08;
    const HINT_LOCAL_Z = 0.10;

    const hintPivot = new THREE.Group();
    hintPivot.frustumCulled = false;
    ctx.containerGroup.add(hintPivot);

    let hintMesh = null;
    let hintConsumed = false;
    let hintWanted = true;
    const _hintCamWorld = new THREE.Vector3();
    const _hintCamLocal = new THREE.Vector3();

    function isFreeformMode() {
        return ctx.profileState?.mode === 'custom';
    }

    function fadeHint(visible) {
        if (!hintMesh) return;

        gsap.killTweensOf(hintMesh.material);

        if (visible) {
            hintPivot.visible = true;
            hintMesh.visible = true;
            gsap.to(hintMesh.material, {
                opacity: HINT_TEXT_OPACITY,
                duration: HINT_FADE_DURATION,
                ease: 'power2.out',
            });
            return;
        }

        gsap.to(hintMesh.material, {
            opacity: 0,
            duration: HINT_FADE_DURATION,
            ease: 'power2.out',
            onComplete: () => {
                if (hintWanted) return;
                hintMesh.visible = false;
                hintPivot.visible = false;
            },
        });
    }

    function updateInteractionHint() {
        if (!hintConsumed && ctx.pointDrag?.active) {
            hintConsumed = true;
        }

        const wanted = !hintConsumed && isFreeformMode();
        if (wanted !== hintWanted) {
            hintWanted = wanted;
            fadeHint(wanted);
        }

        if (!hintMesh || !hintMesh.visible) return;

        renderer.xr.getCamera().getWorldPosition(_hintCamWorld);
        _hintCamLocal.copy(_hintCamWorld);
        ctx.containerGroup.worldToLocal(_hintCamLocal);
        const dx = _hintCamLocal.x;
        const dz = _hintCamLocal.z;
        if (dx * dx + dz * dz < 1e-10) return;
        hintPivot.rotation.y = Math.atan2(dx, dz);
    }

    new FontLoader().load('./static/fonts/helvetiker_bold.typeface.json', (font) => {
        const geometry = new TextGeometry(HINT_TEXT, {
            font,
            size: HINT_TEXT_SIZE,
            height: 0,
            curveSegments: 4,
        });
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        geometry.translate(
            -(box.min.x + box.max.x) * 0.5,
            -(box.min.y + box.max.y) * 0.5,
            0,
        );

        hintWanted = !hintConsumed && isFreeformMode();

        hintMesh = new THREE.Mesh(
            geometry,
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: hintWanted ? HINT_TEXT_OPACITY : 0,
                side: THREE.DoubleSide,
                depthTest: false,
            }),
        );
        hintMesh.position.set(0, HINT_LOCAL_Y, HINT_LOCAL_Z);
        hintMesh.frustumCulled = false;
        hintMesh.renderOrder = ctx.OVERLAY_RENDER_ORDER;
        hintMesh.visible = hintWanted;
        hintPivot.visible = hintWanted;
        hintPivot.add(hintMesh);
    });

    const xrHeadPlacement = bindHeadRelativePlacementOnSessionStart({
        renderer,
        camera,
        placements: [{
            object: ctx.containerGroup,
            offset: ctx.HEAD_OFFSET,
            options: { yawOnly: true, matchYaw: true },
        }],
        onPlaced: () => {
            ctx.containerGroup.rotateY(ctx.CONTAINER_DEFAULT_YAW);
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
        },
        onSessionEnd: () => {
            ctx.containerGroup.position.copy(ctx.DESKTOP_CONTAINER_POS);
            ctx.containerGroup.rotation.set(0, ctx.CONTAINER_DEFAULT_YAW, 0);
            ctx.containerGroup.scale.setScalar(ctx.containerConfig.initialScale);
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
        },
    });
    ctx.xrHeadPlacement = xrHeadPlacement;

    const clock = new THREE.Clock();

    function tick() {
        let delta = clock.getDelta();
        if (delta <= 0) delta = 0.016;
        delta = Math.min(delta, 0.05);
        ctx.delta = delta;

        ctx.xrHeadPlacement.update();
        ctx.handTracking();
        ctx.updateStartModal();

        if (!ctx.startModalActive) {
            ctx.checkMenuButtonPress(delta);
            ctx.checkMenuPanelButtonsPress();
            ctx.checkMenuSlidersGrab();
        }
        ctx.updateAllMenuSliderGrabDots();

        ctx.updateMenuPlaceholder();
        ctx.updatePlaneUiHeaderOrientation();
        ctx.syncCircleHandleScale();
        ctx.updateAxisLabelOrientation();
        ctx.updateContainerFaceVisibility();

        const leftPinchActive = ctx.pinchState.left;
        const rightPinchActive = ctx.pinchState.right;
        const bothPinching = leftPinchActive && rightPinchActive;

        if (!ctx.startModalActive) {
            if (bothPinching) {
                if (ctx.pointDrag.active) {
                    ctx.endPointDrag();
                }
                if (ctx.circleHandleDrag.active) {
                    ctx.endCircleHandleDrag();
                }
                ctx.applyTwoHandedContainerManip();
            } else {
                ctx.twoHandedManip.isActive = false;
                ctx.leftPinchJumpGuard.reset();
                ctx.rightPinchJumpGuard.reset();

                if (ctx.interactionState.wasBothPinching && ctx.twoHandedManip.hadActiveManip) {
                    if (leftPinchActive) {
                        ctx.interactionState.suppressGrabUntilRelease.left = true;
                    }
                    if (rightPinchActive) {
                        ctx.interactionState.suppressGrabUntilRelease.right = true;
                    }
                    ctx.twoHandedManip.hadActiveManip = false;
                }

                if (!leftPinchActive) {
                    ctx.interactionState.suppressGrabUntilRelease.left = false;
                }
                if (!rightPinchActive) {
                    ctx.interactionState.suppressGrabUntilRelease.right = false;
                }

                ctx.applySingleHandInteractions();
            }

            ctx.interactionState.wasBothPinching = bothPinching;
        } else {
            ctx.twoHandedManip.isActive = false;
            ctx.leftPinchJumpGuard.reset();
            ctx.rightPinchJumpGuard.reset();
        }

        updateInteractionHint();

        gsap.ticker.tick();
        gsap.ticker.sleep();

        syncSceneBehindModal();
        renderer.render(scene, camera);
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
