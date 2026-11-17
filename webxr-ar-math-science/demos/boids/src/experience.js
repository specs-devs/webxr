import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import gsap from 'gsap';
import { createSceneSetup } from './SceneSetup.js';
import { createContainer } from './Container.js';
import { createHandTracking } from './HandTracking.js';
import { createBoids } from './Boids.js';
import { createMenuUI } from './MenuUI.js';
import { createTwoHandedManip } from './TwoHandedManip.js';
import { createStartModal } from './StartModal.js';
import { placeObjectAtHeadOffset } from './XRHeadPlacement.js';

export function createExperience({ session = null, showXRButton = false } = {}) {
    const { scene, camera, renderer } = createSceneSetup({ session, showXRButton });

    const ctx = { scene, camera, renderer, session };

    createContainer(ctx);
    createHandTracking(ctx);
    createBoids(ctx);
    createTwoHandedManip(ctx);
    createMenuUI(ctx);

    /** XR only: place the volume at the current head pose (same offset as session start). */
    function placeContainerAtHeadOnDismiss() {
        if (!renderer.xr.isPresenting) return;
        camera.updateMatrixWorld(true);
        placeObjectAtHeadOffset(ctx.containerCube, camera, ctx.HEAD_OFFSET, { yawOnly: true, matchYaw: true });
        ctx.syncBoidsGroupToContainer();
        ctx.updateUIReferencePositions();
        ctx.updateUIHeaderRefPosition();
        ctx.updateUIHeaderRoot();
        ctx.updateUIRoot();
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
        const show = !ctx.startModalActive;
        ctx.containerCube.visible = show;
        ctx.boidsGroup.visible = show;
        ctx.UIHeaderRoot.visible = show;
        if (!show) ctx.UIRoot.visible = false;
    }

    syncSceneBehindModal();

    /** First-open interaction hint inside the cube (size matches Voronoi). */
    const HINT_TEXT = 'Reach in to scatter the boids';
    const HINT_TEXT_SIZE = (0.5 * 1.15) * (176 / 634) * (55 / 528) * 0.9;
    const HINT_TEXT_OPACITY = 0.6;
    const HINT_FADE_DURATION = 0.4;

    let hintMesh = null;
    let hintDismissed = false;
    const _hintCamWorld = new THREE.Vector3();
    const _hintWorld = new THREE.Vector3();
    const _hintYAxis = new THREE.Vector3(0, 1, 0);
    const _hintWorldYawQuat = new THREE.Quaternion();
    const _hintParentWorldQuat = new THREE.Quaternion();

    function dismissInteractionHint() {
        if (hintDismissed) return;
        hintDismissed = true;

        if (!hintMesh) return;

        gsap.to(hintMesh.material, {
            opacity: 0,
            duration: HINT_FADE_DURATION,
            ease: 'power2.out',
            onComplete: () => {
                hintMesh.visible = false;
            },
        });
    }

    function isIndexInsideCube(hand, localPos, active) {
        if (!active) return false;
        const joint = hand?.joints?.['index-finger-tip'];
        if (!joint?.visible) return false;
        const h = ctx.containerSize * 0.5;
        return Math.abs(localPos.x) < h && Math.abs(localPos.y) < h && Math.abs(localPos.z) < h;
    }

    function updateInteractionHint() {
        if (hintDismissed && (!hintMesh || !hintMesh.visible)) return;

        if (!hintDismissed) {
            const hands = ctx.handPositions;
            if (
                isIndexInsideCube(ctx.hand1, hands.left, hands.leftActive) ||
                isIndexInsideCube(ctx.hand2, hands.right, hands.rightActive)
            ) {
                dismissInteractionHint();
            }
        }

        if (!hintMesh || !hintMesh.visible) return;

        camera.getWorldPosition(_hintCamWorld);
        hintMesh.getWorldPosition(_hintWorld);
        const dx = _hintCamWorld.x - _hintWorld.x;
        const dz = _hintCamWorld.z - _hintWorld.z;
        if (dx * dx + dz * dz < 1e-10) return;

        _hintWorldYawQuat.setFromAxisAngle(_hintYAxis, Math.atan2(dx, dz));
        hintMesh.parent.getWorldQuaternion(_hintParentWorldQuat);
        hintMesh.quaternion.copy(_hintParentWorldQuat.invert()).multiply(_hintWorldYawQuat);
    }

    if (!hintDismissed) {
        new FontLoader().load('./static/fonts/helvetiker_bold.typeface.json', (font) => {
            if (hintDismissed) return;

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

            hintMesh = new THREE.Mesh(
                geometry,
                new THREE.MeshBasicMaterial({
                    color: 0xffffff,
                    transparent: true,
                    opacity: HINT_TEXT_OPACITY,
                    side: THREE.DoubleSide,
                    depthTest: false,
                }),
            );
            hintMesh.frustumCulled = false;
            ctx.containerCube.add(hintMesh);
        });
    }

    const clock = new THREE.Clock();

    function tick() {
        ctx.delta = clock.getDelta();
        gsap.ticker.tick(ctx.delta);

        // Head-relative container placement (runs once shortly after sessionstart)
        ctx.xrHeadPlacement.update();

        // Track hands FIRST so boids / modal poke have current positions
        ctx.handTracking();
        ctx.updateStartModal();

        if (!ctx.startModalActive) {
            ctx.applyTwoHandedContainerManip();

            // Always: open-panel button + trails toggle (and cooldown tick inside checkButtonPress)
            ctx.checkButtonPress();
            ctx.checkTogglePress();

            // Panel-only interactions — skip when closed
            if (ctx.UIPanelOn) {
                ctx.checkCloseButtonPress();
                ctx.checkPlusButtonPress();
                ctx.checkMinusButtonPress();
                ctx.checkNextButtonPress();
                ctx.checkPrevButtonPress();
                ctx.checkSliderGrab();
                ctx.updateAllSliderGrabDots();
                ctx.checkPanelDistance();
            }
        }

        updateInteractionHint();

        // Update boids simulation
        ctx.updateBoids(ctx.delta);

        // Update white trails (throttled for performance)
        if (ctx.trailConfig.enabled) {
            ctx.trailUpdateCounter++;
            if (ctx.trailUpdateCounter >= ctx.trailConfig.updateInterval) {
                ctx.updateTrails();
                ctx.trailUpdateCounter = 0;
            }
        }

        // Container-derived layout only when cube moved/scaled/rotated
        if (ctx.containerTransformChanged()) {
            ctx.updateUIHeaderRefPosition();
            ctx.updateUIReferencePositions();
        }

        // Camera-facing header + edge pick (still needed every frame while outside)
        ctx.updateUIRoot();
        if (!ctx.UIHeaderState.isInsideCube) {
            ctx.updateUIHeaderRoot();
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
