import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import gsap from 'gsap';
import { createSceneSetup } from './SceneSetup.js';
import { VoronoiPlane } from './VoronoiPlane.js';
import { VoronoiPlaneInteraction } from './VoronoiPlaneInteraction.js';
import { VoronoiCube, SEED_CENTER_Z } from './VoronoiCube.js';
import { VoronoiCubeInteraction } from './VoronoiCubeInteraction.js';
import { VoronoiCubePlaneInteraction } from './VoronoiCubePlaneInteraction.js';
import { MergeDeleteHighlightManager } from './MergeDeleteHighlight.js';
import { OrbitingMenu } from './OrbitingMenu.js';
import { createPinchTracker, createJumpGuard } from './HandPinch.js';
import { DEFAULT_HEAD_OFFSET, bindHeadRelativePlacementOnSessionStart, getHeadYawQuaternion, placeObjectAtHeadOffset } from './XRHeadPlacement.js';
import { createStartModal } from './StartModal.js';

export function createExperience({ session = null, showXRButton = false } = {}) {
    const { scene, camera, renderer } = createSceneSetup({ session, showXRButton });

    // ==========================================
    // CONTAINER
    // ==========================================

    const containerConfig = {
        containerSize: 0.45,
        containerPosition: new THREE.Vector3(0, 1.3, -1.1),
        /** Startup scale via two-hand pinch transform (not geometry size). */
        initialScale: 0.8,
    };

    const containerViewOffset = new THREE.Group();
    scene.add(containerViewOffset);

    const containerGroup = new THREE.Group();
    containerGroup.position.copy(containerConfig.containerPosition);
    containerGroup.scale.setScalar(containerConfig.initialScale);
    containerViewOffset.add(containerGroup);

    /** Desktop / pre-XR preview — fixed world position (floor-relative). */
    const DESKTOP_CONTAINER_POS = containerGroup.position.clone();
    /** Head-local offset applied when an immersive session starts. */
    const HEAD_OFFSET = { ...DEFAULT_HEAD_OFFSET };

    const MAX_POINTS = 8;

    const INITIAL_SEEDS = [
        { x: -0.1, y: 0.1, z: 0 },
        { x: 0.12, y: 0.05, z: 0 },
        { x: -0.05, y: -0.12, z: 0 },
        { x: 0.08, y: -0.08, z: 0 },
        { x: 0.0, y: 0.0, z: 0 },
    ];

    const VIEW_TRANSITION = {
        duration: 0.5,
        alignDuration: 0.4,
        deExplodeDuration: 0.45,
        minScaleZ: 0.04,
        /** Skip reorient slerp when already within this angle (radians). */
        reorientEpsilon: 0.02,
    };

    const _reorientStartQuat = new THREE.Quaternion();
    const _reorientEndQuat = new THREE.Quaternion();

    // Manhattan-only 2D diagram (separate metric — not the collapsed 3D structure)
    const voronoiConfig = {
        manhattanSpace: false,
        viewMode: '2D',
        showDelaunay: false,
        explodeAmount: 0,
    };

    const voronoiPlane = new VoronoiPlane({
        planeSize: containerConfig.containerSize,
        manhattanSpace: voronoiConfig.manhattanSpace,
        maxPoints: MAX_POINTS,
        initialPoints: INITIAL_SEEDS.map((p) => ({ x: p.x, y: p.y })),
    });
    voronoiPlane.object3D.visible = false;
    containerGroup.add(voronoiPlane.object3D);

    /** Unified seeds + dual wire meshes: proper 2D edges crossfade to proper 3D edges on transition. */
    const voronoiCube = new VoronoiCube({
        cubeSize: containerConfig.containerSize,
        maxPoints: MAX_POINTS,
        initialPoints: INITIAL_SEEDS,
    });
    voronoiCube.getDiagramGroup().scale.set(1, 1, VIEW_TRANSITION.minScaleZ);
    voronoiCube.setWireViewBlend(0);
    containerGroup.add(voronoiCube.object3D);

    /** First-open interaction hint on the Voronoi plane (size / Y / Z are tweakable). */
    const HINT_TEXT = 'Pinch to move or add points';
    /** Matches header description cap height (~55px on 528px ui-header texture → world via HEADER_PLANE_HEIGHT). */
    const HINT_TEXT_SIZE = (0.5 * 1.15) * (176 / 634) * (55 / 528);
    const HINT_TEXT_Y = -0.16;
    const HINT_TEXT_Z = 0.04;
    const HINT_TEXT_OPACITY = 0.6;
    const HINT_FADE_DURATION = 0.4;

    let hintMesh = null;
    let hintDismissed = false;

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
            hintMesh.position.set(0, HINT_TEXT_Y, HINT_TEXT_Z);
            hintMesh.frustumCulled = false;
            containerGroup.add(hintMesh);
        });
    }

    const wireViewBlend = { t: 0 };

    let activeViewMode = '2D';
    let viewTransitionActive = false;
    let viewTransitionTween = null;
    let pendingDiagramMetricIndex = null;
    let orbitingMenu = null;
    let planeUiHeaderPlane = null;

    const EXPLODE_SNAP_THRESHOLD = 0.08;

    function normalizeExplodeAmount(value) {
        return value < EXPLODE_SNAP_THRESHOLD ? 0 : value;
    }

    function syncExplodeAmount(value, { updateSlider = true } = {}) {
        voronoiConfig.explodeAmount = value;
        voronoiCube.setExplodeAmount(value);
        if (updateSlider) {
            orbitingMenu?.setMenuSliderValue(value);
        }
        syncHeaderForExplodeAmount(value);
        return value;
    }

    function snapExplodeAmountOnRelease() {
        const snapped = normalizeExplodeAmount(voronoiConfig.explodeAmount);
        if (snapped === voronoiConfig.explodeAmount) return snapped;
        syncExplodeAmount(snapped);
        return snapped;
    }

    function resetExplode() {
        if (voronoiConfig.explodeAmount === 0) return;
        syncExplodeAmount(0);
    }

    applyViewModeSettings();

    function isView3D() {
        return activeViewMode === '3D';
    }

    function getDiagramScaleZ() {
        return isView3D() ? 1 : VIEW_TRANSITION.minScaleZ;
    }

    function usesManhattanDiagram() {
        return voronoiConfig.manhattanSpace && !isView3D();
    }

    function syncPlaneFromCubeXY() {
        voronoiPlane.setPoints(voronoiCube.getPoints().map((p) => ({ x: p.x, y: p.y })));
    }

    function syncCubeXYFromPlane() {
        const planePoints = voronoiPlane.getPoints();
        const cubePoints = voronoiCube.getPoints();

        if (planePoints.length === cubePoints.length) {
            let unchanged = true;
            for (let i = 0; i < planePoints.length; i++) {
                if (
                    planePoints[i].x !== cubePoints[i].x
                    || planePoints[i].y !== cubePoints[i].y
                ) {
                    unchanged = false;
                    break;
                }
            }
            if (unchanged) return;
        }

        // One rebuild (not N movePointXY rebuilds). Preserve Z when counts match.
        voronoiCube.setPoints(planePoints.map((p, i) => ({
            x: p.x,
            y: p.y,
            z: cubePoints[i]?.z ?? SEED_CENTER_Z,
        })));
    }

    function applyDelaunayVisibility() {
        const show = voronoiConfig.showDelaunay
            && !usesManhattanDiagram()
            && !isView3D()
            && !viewTransitionActive;
        voronoiCube.setDelaunayVisible(show);
    }

    function resetDelaunayOverlay() {
        if (!voronoiConfig.showDelaunay) return;
        voronoiConfig.showDelaunay = false;
        applyDelaunayVisibility();
    }

    function applyDiagramVisibility() {
        if (usesManhattanDiagram()) {
            syncPlaneFromCubeXY();
            voronoiPlane.object3D.visible = true;
            voronoiPlane.object3D.scale.set(1, 1, 1);
            voronoiCube.object3D.visible = false;
            applyDelaunayVisibility();
            return;
        }

        voronoiPlane.object3D.visible = false;
        voronoiCube.object3D.visible = true;
        if (!viewTransitionActive) {
            voronoiCube.getDiagramGroup().scale.set(1, 1, getDiagramScaleZ());
            voronoiCube.setWireViewBlend(isView3D() ? 1 : 0);
            wireViewBlend.t = isView3D() ? 1 : 0;
        }
        applyDelaunayVisibility();
    }

    function getDiagramMetricIndex() {
        if (isView3D()) return 0;
        if (voronoiConfig.manhattanSpace) return 1;
        if (voronoiConfig.showDelaunay) return 2;
        return 0;
    }

    function syncOrbitingMenuMetricCheckbox() {
        if (orbitingMenu) {
            orbitingMenu.setActiveCheckbox(getDiagramMetricIndex());
        }
    }

    function applyDiagramMetric(index) {
        if (viewTransitionActive || isView3D()) return false;

        if (index === 0) {
            if (voronoiConfig.manhattanSpace) {
                voronoiConfig.manhattanSpace = false;
                voronoiPlane.setManhattanSpace(false);
                syncCubeXYFromPlane();
            }
            if (voronoiConfig.showDelaunay) {
                voronoiConfig.showDelaunay = false;
            }
        } else if (index === 1) {
            if (voronoiConfig.showDelaunay) {
                voronoiConfig.showDelaunay = false;
            }
            if (!voronoiConfig.manhattanSpace) {
                voronoiConfig.manhattanSpace = true;
                voronoiPlane.setManhattanSpace(true);
                syncPlaneFromCubeXY();
            }
        } else if (index === 2) {
            if (voronoiConfig.manhattanSpace) {
                voronoiConfig.manhattanSpace = false;
                voronoiPlane.setManhattanSpace(false);
                syncCubeXYFromPlane();
            }
            if (!voronoiConfig.showDelaunay) {
                voronoiConfig.showDelaunay = true;
            }
        }

        applyViewModeSettings();
        return true;
    }

    function applyViewModeSettings() {
        if (isView3D()) {
            orbitingMenu?.syncMenuRowForViewMode('3D');
            orbitingMenu?.setMenuSliderValue(voronoiConfig.explodeAmount);
            if (voronoiConfig.manhattanSpace) {
                syncCubeXYFromPlane();
                voronoiConfig.manhattanSpace = false;
                voronoiPlane.setManhattanSpace(false);
            }
        } else {
            orbitingMenu?.syncMenuRowForViewMode('2D');
        }
        applyDiagramVisibility();
        syncOrbitingMenuMetricCheckbox();
        syncHeaderPlaneTexture();
    }

    function seedsNeedCenterAlign() {
        return voronoiCube.getPoints().some((p) => Math.abs(p.z - SEED_CENTER_Z) > 1e-5);
    }

    function appendScaleTransitionPhase(timeline, targetScaleZ, startAt) {
        timeline.to(voronoiCube.getDiagramGroup().scale, {
            z: targetScaleZ,
            duration: VIEW_TRANSITION.duration,
            ease: 'power2.inOut',
        }, startAt);
    }

    /** Face-user (XR) or identity (desktop) orientation for the 2D plane. */
    function getCanonicalContainerQuaternion(target = _reorientEndQuat) {
        if (renderer.xr.isPresenting) {
            camera.updateMatrixWorld(true);
            return getHeadYawQuaternion(camera, target);
        }
        return target.identity();
    }

    /**
     * Smoothly turn the container to face the user while collapsing 3D → 2D.
     * Runs in parallel with align/scale so the plane settles upright with the morph.
     */
    function appendContainerReorientPhase(timeline, startAt, duration) {
        getCanonicalContainerQuaternion(_reorientEndQuat);
        _reorientStartQuat.copy(containerGroup.quaternion);

        if (_reorientStartQuat.dot(_reorientEndQuat) < 0) {
            _reorientEndQuat.x *= -1;
            _reorientEndQuat.y *= -1;
            _reorientEndQuat.z *= -1;
            _reorientEndQuat.w *= -1;
        }

        if (_reorientStartQuat.angleTo(_reorientEndQuat) < VIEW_TRANSITION.reorientEpsilon) {
            return;
        }

        const startQuat = _reorientStartQuat.clone();
        const endQuat = _reorientEndQuat.clone();
        const proxy = { t: 0 };
        timeline.to(proxy, {
            t: 1,
            duration,
            ease: 'power2.inOut',
            onUpdate: () => {
                containerGroup.quaternion.slerpQuaternions(startQuat, endQuat, proxy.t);
            },
            onComplete: () => {
                containerGroup.quaternion.copy(endQuat);
            },
        }, startAt);
    }

    function getDeExplodeDuration(amount) {
        const maxExplode = 3;
        const t = THREE.MathUtils.clamp(amount / maxExplode, 0, 1);
        return Math.max(0.2, VIEW_TRANSITION.deExplodeDuration * t);
    }

    function animateDeExplode(onComplete) {
        viewTransitionTween?.kill();
        viewTransitionActive = true;
        voronoiCubeInteraction.releaseAllHands();
        mergeDeleteHighlight.hideAll();

        const startAmount = voronoiConfig.explodeAmount;
        if (startAmount <= 0) {
            onComplete();
            return;
        }

        const proxy = { amount: startAmount };
        viewTransitionTween = gsap.to(proxy, {
            amount: 0,
            duration: getDeExplodeDuration(startAmount),
            ease: 'power2.inOut',
            onUpdate: () => {
                syncExplodeAmount(proxy.amount, { updateSlider: false });
            },
            onComplete: () => {
                syncExplodeAmount(0);
                viewTransitionTween = null;
                onComplete();
            },
        });
    }

    function setViewMode(mode) {
        if (mode === activeViewMode || viewTransitionActive) return;

        syncHeaderPlaneTexture(mode);

        const going3D = mode === '3D';
        if (!going3D && voronoiConfig.explodeAmount > 0) {
            animateDeExplode(() => beginViewModeTransition(mode));
            return;
        }

        beginViewModeTransition(mode);
    }

    function beginViewModeTransition(mode) {
        if (mode === activeViewMode) {
            viewTransitionActive = false;
            return;
        }

        const going3D = mode === '3D';
        const targetScaleZ = going3D ? 1 : VIEW_TRANSITION.minScaleZ;
        const targetWireBlend = going3D ? 1 : 0;

        viewTransitionTween?.kill();
        viewTransitionActive = true;
        applyDelaunayVisibility();

        voronoiPlane.object3D.visible = false;
        voronoiCube.object3D.visible = true;

        if (going3D) {
            if (voronoiConfig.manhattanSpace) {
                syncCubeXYFromPlane();
                voronoiConfig.manhattanSpace = false;
                voronoiPlane.setManhattanSpace(false);
            }
            voronoiCube.flattenToCenterPlane(SEED_CENTER_Z);
            // Hard cut to 3D wire at z=0, then extrude.
            voronoiCube.setWireViewBlend(1);
            wireViewBlend.t = 1;
        } else {
            // 3D→2D: return to plain Euclidean Voronoi (Delaunay off even if it was on before).
            resetDelaunayOverlay();
            // Keep 3D wire through align + collapse; cut to 2D at the end.
            voronoiCube.setWireViewBlend(1);
            wireViewBlend.t = 1;
        }

        viewTransitionTween = gsap.timeline({
            onComplete: () => {
                activeViewMode = mode;
                voronoiCube.getDiagramGroup().scale.set(1, 1, targetScaleZ);
                voronoiCube.flattenToCenterPlane(SEED_CENTER_Z);
                voronoiCube.setWireViewBlend(targetWireBlend);
                wireViewBlend.t = targetWireBlend;
                viewTransitionActive = false;
                viewTransitionTween = null;
                applyViewModeSettings();
                if (pendingDiagramMetricIndex !== null) {
                    const metricIndex = pendingDiagramMetricIndex;
                    pendingDiagramMetricIndex = null;
                    applyDiagramMetric(metricIndex);
                }
            },
        });

        if (going3D) {
            appendScaleTransitionPhase(viewTransitionTween, targetScaleZ, 0);
            return;
        }

        // 3D → 2D: align seeds to center plane, then collapse, then hard cut to 2D wire.
        let scalePhaseStart = 0;

        if (seedsNeedCenterAlign()) {
            const zProxies = voronoiCube.getPoints().map((p) => ({ z: p.z }));
            const zValues = zProxies.map((p) => p.z);
            const applyAlignedZs = () => {
                for (let i = 0; i < zProxies.length; i++) {
                    zValues[i] = zProxies[i].z;
                }
                voronoiCube.setPointZs(zValues);
            };

            viewTransitionTween.to(zProxies, {
                z: SEED_CENTER_Z,
                duration: VIEW_TRANSITION.alignDuration,
                ease: 'power2.inOut',
                onUpdate: applyAlignedZs,
                onComplete: applyAlignedZs,
            }, 0);

            scalePhaseStart = VIEW_TRANSITION.alignDuration;
        } else {
            voronoiCube.flattenToCenterPlane(SEED_CENTER_Z);
        }

        appendScaleTransitionPhase(viewTransitionTween, targetScaleZ, scalePhaseStart);

        // Turn the plane to face the user while seeds align / volume collapses.
        const collapseEnd = scalePhaseStart + VIEW_TRANSITION.duration;
        appendContainerReorientPhase(viewTransitionTween, 0, collapseEnd);

        viewTransitionTween.call(() => {
            voronoiCube.setWireViewBlend(0);
            wireViewBlend.t = 0;
        }, null, collapseEnd);
    }

    function getActiveVoronoiDiagram() {
        if (usesManhattanDiagram()) return voronoiPlane;
        return voronoiCube;
    }

    function updateMergeDeleteHighlight(spatialManipActive) {
        if (viewTransitionActive || spatialManipActive) {
            mergeDeleteHighlight.hideAll();
            return;
        }

        if (isView3D() && voronoiCube.isExploded()) {
            mergeDeleteHighlight.hideAll();
            return;
        }

        const interaction = getActiveVoronoiInteraction();
        const voronoi = getActiveVoronoiDiagram();

        for (const side of ['left', 'right']) {
            const highlight = mergeDeleteHighlight.get(side);
            const hand = interaction.hands[side];

            if (highlight.confirming) {
                continue;
            }

            if (!hand.dragging || hand.draggedPointIndex < 0) {
                highlight.hide();
                continue;
            }

            const preview = voronoi.getMergePreview(hand.draggedPointIndex);
            if (!preview || preview.fade <= 0) {
                highlight.hide();
                continue;
            }

            highlight.updateHover(
                voronoi,
                hand.draggedPointIndex,
                preview.targetIndex,
                preview.fade,
            );
        }
    }

    function getActiveVoronoiInteraction() {
        if (isView3D()) return voronoiCubeInteraction;
        if (usesManhattanDiagram()) return voronoiInteraction;
        return voronoiCubePlaneInteraction;
    }

    /** Pinch is on/near the diagram — point add/move, not container spatial manip. */
    function isHandInPointInteractionZone(ctx) {
        if (!ctx.hasJoints) return false;

        const interaction = getActiveVoronoiInteraction();
        const { localX: x, localY: y, localZ: z } = ctx;
        const pickRadius = interaction.pickRadius;
        const planeZTolerance = interaction.spawnZTolerance ?? pickRadius;

        if (isView3D()) {
            if (voronoiCube.isExploded()) return false;
            if (voronoiCube.isInsideBounds(x, y, z)) return true;
            return voronoiCube.findNearestPointIndex(x, y, z, pickRadius) >= 0;
        }

        if (usesManhattanDiagram()) {
            if (voronoiPlane.isOnPlaneForSpawn(x, y, z, planeZTolerance)) return true;
            return voronoiPlane.findNearestPointIndex(x, y, pickRadius, z) >= 0;
        }

        if (voronoiCube.isOnCenterPlaneForSpawn(x, y, z, planeZTolerance)) return true;
        return voronoiCube.findNearestPointIndex(x, y, z, pickRadius) >= 0;
    }

    /** Two-hand pinch away from the diagram → translate / scale / rotate the container. */
    function shouldUseTwoHandedSpatialManip(leftPinching, rightPinching) {
        if (!leftPinching || !rightPinching) return false;

        const interaction = getActiveVoronoiInteraction();
        if (interaction.isAnyHandDragging()) return false;

        return !isHandInPointInteractionZone(handContext.left)
            && !isHandInPointInteractionZone(handContext.right);
    }

    function collectControlSphereHighlights(interaction) {
        const indices = new Set();
        const sides = [
            { hand: interaction.hands.left, ctx: handContext.left },
            { hand: interaction.hands.right, ctx: handContext.right },
        ];

        for (const { hand, ctx } of sides) {
            if (!ctx.hasJoints) continue;

            if (hand.dragging && hand.draggedPointIndex >= 0) {
                indices.add(hand.draggedPointIndex);
                continue;
            }

            let nearest = -1;
            if (isView3D()) {
                if (voronoiCube.isExploded()) continue;
                nearest = voronoiCube.findNearestPointIndex(
                    ctx.localX,
                    ctx.localY,
                    ctx.localZ,
                    interaction.pickRadius
                );
            } else if (usesManhattanDiagram()) {
                nearest = voronoiPlane.findNearestPointIndex(
                    ctx.localX,
                    ctx.localY,
                    interaction.pickRadius,
                    ctx.localZ
                );
            } else {
                nearest = voronoiCube.findNearestPointIndex(
                    ctx.localX,
                    ctx.localY,
                    ctx.localZ,
                    interaction.pickRadius
                );
            }

            if (nearest >= 0) indices.add(nearest);
        }

        return [...indices];
    }

    function updateControlSphereHighlights() {
        if (viewTransitionActive || (isView3D() && voronoiCube.isExploded())) {
            voronoiCube.setPointHighlights([]);
            voronoiPlane.setPointHighlights([]);
            return;
        }

        const interaction = getActiveVoronoiInteraction();
        const indices = collectControlSphereHighlights(interaction);

        if (usesManhattanDiagram()) {
            voronoiPlane.setPointHighlights(indices);
            voronoiCube.setPointHighlights([]);
        } else {
            voronoiCube.setPointHighlights(indices);
        }
    }

    // ==========================================
    // VORONOI INTERACTION
    // ==========================================

    const mergeDeleteHighlight = new MergeDeleteHighlightManager(containerGroup);

    const planeInteractionConfig = {
        /** Container-local distance to grab an existing seed. */
        pickRadius: 0.045,
        /** Container-local distance to merge a dragged seed into another. */
        mergeThreshold: 0.04,
    };

    const voronoiInteraction = new VoronoiPlaneInteraction(voronoiPlane, {
        pickRadius: planeInteractionConfig.pickRadius,
        mergeThreshold: planeInteractionConfig.mergeThreshold,
        mergeDeleteHighlight,
    });

    const voronoiCubePlaneInteraction = new VoronoiCubePlaneInteraction(voronoiCube, {
        pickRadius: planeInteractionConfig.pickRadius,
        mergeThreshold: planeInteractionConfig.mergeThreshold,
        mergeDeleteHighlight,
    });

    const cubeInteractionConfig = {
        pickRadius: 0.045,
        mergeThreshold: 0.05,
    };

    const voronoiCubeInteraction = new VoronoiCubeInteraction(voronoiCube, {
        pickRadius: cubeInteractionConfig.pickRadius,
        mergeThreshold: cubeInteractionConfig.mergeThreshold,
        mergeDeleteHighlight,
    });

    const handContext = {
        left: { localX: 0, localY: 0, localZ: 0, hasJoints: false },
        right: { localX: 0, localY: 0, localZ: 0, hasJoints: false },
    };

    const prevPinchState = { left: false, right: false };

    const _handMidpointWorld = new THREE.Vector3();
    const _pinchLocal = new THREE.Vector3();

    function updateHandContext(thumbPos, indexPos, hasJoints, ctx) {
        ctx.hasJoints = hasJoints;

        if (!hasJoints) {
            return;
        }

        _handMidpointWorld.addVectors(thumbPos, indexPos).multiplyScalar(0.5);
        _pinchLocal.copy(_handMidpointWorld);
        containerGroup.worldToLocal(_pinchLocal);
        ctx.localX = _pinchLocal.x;
        ctx.localY = _pinchLocal.y;
        ctx.localZ = _pinchLocal.z;
    }

    // ==========================================
    // TWO-HANDED CONTAINER MANIPULATION
    // ==========================================

    const _upVector = new THREE.Vector3(0, 1, 0);

    const twoHandedManip = {
        isActive: false,
        initialHandDistance: 0,
        initialScale: 1.0,
        initialMidpoint: new THREE.Vector3(),
        initialContainerPos: new THREE.Vector3(),
        initialHandAxis: new THREE.Vector3(),
        initialContainerQuat: new THREE.Quaternion(),
        minScale: 0.8,
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
    /** Extra settle after both hands are pinching before capturing the two-hand baseline. */
    const TWO_HAND_SETTLE_MS = 20;
    const MAX_HAND_JUMP_PER_FRAME = 0.08;

    const pinchTracker = createPinchTracker({
        pinchClose: 0.028,
        pinchOpen: 0.04,
        settleMs: 10,
    });
    const leftPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);
    const rightPinchJumpGuard = createJumpGuard(MAX_HAND_JUMP_PER_FRAME);

    const xrHeadPlacement = bindHeadRelativePlacementOnSessionStart({
        renderer,
        camera,
        placements: [{
            object: containerGroup,
            offset: HEAD_OFFSET,
            options: { yawOnly: true, matchYaw: true },
        }],
        onPlaced: () => {
            twoHandedManip.isActive = false;
            leftPinchJumpGuard.reset();
            rightPinchJumpGuard.reset();
        },
        onSessionEnd: () => {
            containerGroup.position.copy(DESKTOP_CONTAINER_POS);
            containerGroup.rotation.set(0, 0, 0);
            containerGroup.scale.setScalar(containerConfig.initialScale);
            twoHandedManip.isActive = false;
            leftPinchJumpGuard.reset();
            rightPinchJumpGuard.reset();
        },
    });

    function captureTwoHandedBaseline(handDistance) {
        twoHandedManip.isActive = true;
        twoHandedManip.initialHandDistance = handDistance;
        twoHandedManip.initialScale = containerGroup.scale.x;
        twoHandedManip.initialMidpoint.copy(_handMidpoint);
        twoHandedManip.initialContainerPos.copy(containerGroup.position);
        twoHandedManip.initialHandAxis.copy(_rightPinchPos).sub(_leftPinchPos);
        twoHandedManip.initialContainerQuat.copy(containerGroup.quaternion);
    }

    function applyTwoHandedContainerManip(containerGroup) {
        const leftPinching = pinchTracker.left.pinching && pinchTracker.left.tracked;
        const rightPinching = pinchTracker.right.pinching && pinchTracker.right.tracked;

        if (!leftPinching || !rightPinching) {
            twoHandedManip.isActive = false;
            leftPinchJumpGuard.reset();
            rightPinchJumpGuard.reset();
            return false;
        }

        _leftPinchPos.copy(lThumbObj.position);
        _rightPinchPos.copy(rThumbObj.position);

        const leftJumped = leftPinchJumpGuard.check(_leftPinchPos);
        const rightJumped = rightPinchJumpGuard.check(_rightPinchPos);
        const discontinuity = leftJumped || rightJumped;

        _handMidpoint.addVectors(_leftPinchPos, _rightPinchPos).multiplyScalar(0.5);
        const handDistance = _leftPinchPos.distanceTo(_rightPinchPos);

        if (handDistance <= MIN_TWO_HAND_DISTANCE) {
            return false;
        }

        if (!twoHandedManip.isActive) {
            if (pinchTracker.bothPinchStable(performance.now(), TWO_HAND_SETTLE_MS)) {
                captureTwoHandedBaseline(handDistance);
            }
            return false;
        }

        if (discontinuity) {
            captureTwoHandedBaseline(handDistance);
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

    // ==========================================
    // HAND TRACKING
    // ==========================================

    // Pinch state: derived from pinchTracker each frame (tracking-gated, hysteresis, settle).
    const pinchState = { left: false, right: false };

    /**
     * Joint References — empty transforms (no mesh geometry to avoid depth/UI occlusion).
     */
    const lThumbObj = new THREE.Object3D();
    const lIndexObj = new THREE.Object3D();
    const rThumbObj = new THREE.Object3D();
    const rIndexObj = new THREE.Object3D();

    const CONTAINER_HALF = containerConfig.containerSize * 0.5;

    // Header UI — reference anchor + billboarding header plane
    const PLANE_UI_REF_Y_OFFSET = 0.38;
    const HEADER_PLANE_TEX_W = 634;
    const HEADER_PLANE_TEX_H = 176;
    const HEADER_PLANE_SCALE = 1.15;
    const HEADER_PLANE_WIDTH = 0.5 * HEADER_PLANE_SCALE;
    const HEADER_PLANE_HEIGHT = HEADER_PLANE_WIDTH * (HEADER_PLANE_TEX_H / HEADER_PLANE_TEX_W);

    const planeUiRefSphere = new THREE.Object3D();
    planeUiRefSphere.position.set(0, PLANE_UI_REF_Y_OFFSET, 0);
    containerGroup.add(planeUiRefSphere);

    const planeUiHeaderPivot = new THREE.Object3D();
    planeUiRefSphere.add(planeUiHeaderPivot);

    const HEADER_TEXTURE_PATHS = [
        './static/ui-header-1.png', // Euclidean
        './static/ui-header-2.png', // Manhattan
        './static/ui-header-3.png', // Delaunay
        './static/ui-header-4.png', // 3D
    ];

    const headerTextureLoader = new THREE.TextureLoader();
    const headerPlaneTextures = HEADER_TEXTURE_PATHS.map((path) => {
        const texture = headerTextureLoader.load(path);
        texture.colorSpace = THREE.SRGBColorSpace;
        return texture;
    });

    const headerPlaneMaterial = new THREE.MeshBasicMaterial({
        map: headerPlaneTextures[0],
        transparent: true,
        side: THREE.FrontSide,
        alphaTest: 0.01,
        depthTest: true,
        depthWrite: false,
    });

    planeUiHeaderPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(HEADER_PLANE_WIDTH, HEADER_PLANE_HEIGHT),
        headerPlaneMaterial,
    );
    planeUiHeaderPlane.frustumCulled = false;
    planeUiHeaderPivot.add(planeUiHeaderPlane);

    /** Header checkbox: off = hide seed ABC labels, on = show (ui-checkbox / ui-checkbox-in). */
    const LABELS_CHECKBOX_SIZE = 0.0216 * 1.1;
    const LABELS_CHECKBOX_X = -0.215;
    const LABELS_CHECKBOX_Y = -0.085;
    const LABELS_CHECKBOX_Z = 0.001;

    const LABELS_CHECKBOX_LABEL_HEIGHT = 0.023 * 1.1;
    const LABELS_CHECKBOX_LABEL_X = -0.155;
    const LABELS_CHECKBOX_LABEL_Y = -0.0861;
    const LABELS_CHECKBOX_LABEL_Z = 0.001;
    const LABELS_CHECKBOX_LABEL_FONT_PX = Math.round(49 * 1.1);

    const labelsCheckboxTexture = headerTextureLoader.load('./static/ui-checkbox.png');
    labelsCheckboxTexture.colorSpace = THREE.SRGBColorSpace;
    const labelsCheckbox = new THREE.Mesh(
        new THREE.PlaneGeometry(LABELS_CHECKBOX_SIZE, LABELS_CHECKBOX_SIZE),
        new THREE.MeshBasicMaterial({
            map: labelsCheckboxTexture,
            transparent: true,
            side: THREE.FrontSide,
            depthTest: false,
        }),
    );
    labelsCheckbox.position.set(LABELS_CHECKBOX_X, LABELS_CHECKBOX_Y, LABELS_CHECKBOX_Z);
    labelsCheckbox.frustumCulled = false;
    labelsCheckbox.renderOrder = 5;
    planeUiHeaderPlane.add(labelsCheckbox);

    const labelsCheckboxInTexture = headerTextureLoader.load('./static/ui-checkbox-in.png');
    labelsCheckboxInTexture.colorSpace = THREE.SRGBColorSpace;
    const labelsCheckboxIn = new THREE.Mesh(
        new THREE.PlaneGeometry(LABELS_CHECKBOX_SIZE * 0.5, LABELS_CHECKBOX_SIZE * 0.5),
        new THREE.MeshBasicMaterial({
            map: labelsCheckboxInTexture,
            transparent: true,
            side: THREE.FrontSide,
            depthTest: false,
        }),
    );
    labelsCheckboxIn.position.set(0, 0, 0.001);
    labelsCheckboxIn.visible = true;
    labelsCheckboxIn.frustumCulled = false;
    labelsCheckboxIn.renderOrder = 6;
    labelsCheckbox.add(labelsCheckboxIn);

    const labelsCheckboxLabelCanvas = document.createElement('canvas');
    const labelsCheckboxLabelFont = `bold ${LABELS_CHECKBOX_LABEL_FONT_PX}px Helvetica, Arial, sans-serif`;
    const labelsCheckboxLabelCtx = labelsCheckboxLabelCanvas.getContext('2d');
    labelsCheckboxLabelCtx.font = labelsCheckboxLabelFont;
    const labelsCheckboxLabelTextWidth = labelsCheckboxLabelCtx.measureText('LABELS').width;
    const labelsCheckboxLabelCanvasPadding = 12;
    labelsCheckboxLabelCanvas.width = Math.ceil(
        labelsCheckboxLabelTextWidth + labelsCheckboxLabelCanvasPadding * 2,
    );
    labelsCheckboxLabelCanvas.height = 64;
    labelsCheckboxLabelCtx.fillStyle = '#ffffff';
    labelsCheckboxLabelCtx.font = labelsCheckboxLabelFont;
    labelsCheckboxLabelCtx.textAlign = 'center';
    labelsCheckboxLabelCtx.textBaseline = 'middle';
    labelsCheckboxLabelCtx.fillText(
        'LABELS',
        labelsCheckboxLabelCanvas.width / 2,
        labelsCheckboxLabelCanvas.height / 2,
    );
    const labelsCheckboxLabelTexture = new THREE.CanvasTexture(labelsCheckboxLabelCanvas);
    labelsCheckboxLabelTexture.colorSpace = THREE.SRGBColorSpace;
    const labelsCheckboxLabelPlaneWidth =
        LABELS_CHECKBOX_LABEL_HEIGHT * (labelsCheckboxLabelCanvas.width / labelsCheckboxLabelCanvas.height);
    const labelsCheckboxLabel = new THREE.Mesh(
        new THREE.PlaneGeometry(labelsCheckboxLabelPlaneWidth, LABELS_CHECKBOX_LABEL_HEIGHT),
        new THREE.MeshBasicMaterial({
            map: labelsCheckboxLabelTexture,
            transparent: true,
            side: THREE.FrontSide,
            depthTest: false,
        }),
    );
    labelsCheckboxLabel.position.set(
        LABELS_CHECKBOX_LABEL_X,
        LABELS_CHECKBOX_LABEL_Y,
        LABELS_CHECKBOX_LABEL_Z,
    );
    labelsCheckboxLabel.frustumCulled = false;
    labelsCheckboxLabel.renderOrder = 5;
    planeUiHeaderPlane.add(labelsCheckboxLabel);

    let seedPointLabelsEnabled = true;

    function setSeedPointLabelsEnabled(enabled) {
        seedPointLabelsEnabled = enabled;
        labelsCheckboxIn.visible = enabled;
        voronoiPlane.seedLabels.setVisible(enabled);
        voronoiCube.seedLabels.setVisible(enabled);
    }

    const headerUiFadeMaterials = [
        headerPlaneMaterial,
        labelsCheckbox.material,
        labelsCheckboxIn.material,
        labelsCheckboxLabel.material,
    ];

    const HEADER_EXPLODE_FADE = { duration: 0.3, ease: 'power2.out' };
    let headerExplodeFadeTween = null;
    let headerHiddenByExplode = false;

    /** Fade header out while exploded (amount > 0); fade back in when closed. */
    function syncHeaderForExplodeAmount(amount = voronoiConfig.explodeAmount) {
        if (!planeUiHeaderPlane) return;

        const shouldHide = amount > 0;
        if (shouldHide === headerHiddenByExplode) return;
        headerHiddenByExplode = shouldHide;

        const targetOpacity = shouldHide ? 0 : 1;
        headerExplodeFadeTween?.kill();
        if (!shouldHide) planeUiHeaderPlane.visible = true;

        headerExplodeFadeTween = gsap.to(headerUiFadeMaterials, {
            opacity: targetOpacity,
            duration: HEADER_EXPLODE_FADE.duration,
            ease: HEADER_EXPLODE_FADE.ease,
            onComplete: () => {
                headerExplodeFadeTween = null;
                if (shouldHide) planeUiHeaderPlane.visible = false;
            },
        });
    }

    function getHeaderTextureIndex(viewModeOverride = null) {
        const mode = viewModeOverride ?? activeViewMode;
        if (mode === '3D') return 3;
        if (voronoiConfig.manhattanSpace) return 1;
        if (voronoiConfig.showDelaunay) return 2;
        return 0;
    }

    function syncHeaderPlaneTexture(viewModeOverride = null) {
        if (!planeUiHeaderPlane) return;
        const index = getHeaderTextureIndex(viewModeOverride);
        if (planeUiHeaderPlane.material.map !== headerPlaneTextures[index]) {
            planeUiHeaderPlane.material.map = headerPlaneTextures[index];
        }
    }

    syncHeaderPlaneTexture();

    const _headerCamWorldPos = new THREE.Vector3();
    const _headerCamContainerLocal = new THREE.Vector3();

    function updatePlaneUiHeaderOrientation() {
        // Counter container scale so the header keeps a constant world size.
        const containerScale = containerGroup.scale.x;
        if (containerScale > 1e-8) {
            planeUiHeaderPlane.scale.setScalar(containerConfig.initialScale / containerScale);
        }

        renderer.xr.getCamera().getWorldPosition(_headerCamWorldPos);
        _headerCamContainerLocal.copy(_headerCamWorldPos);
        containerGroup.worldToLocal(_headerCamContainerLocal);

        const dx = _headerCamContainerLocal.x - planeUiRefSphere.position.x;
        const dz = _headerCamContainerLocal.z - planeUiRefSphere.position.z;
        const horizLenSq = dx * dx + dz * dz;
        if (horizLenSq > 1e-8) {
            planeUiHeaderPivot.rotation.y = Math.atan2(dx, dz);
        }
    }

    orbitingMenu = new OrbitingMenu(containerGroup, renderer, {
        scene,
        leftIndex: lIndexObj,
        rightIndex: rIndexObj,
        leftThumb: lThumbObj,
        rightThumb: rThumbObj,
        pinchState,
        containerHalf: CONTAINER_HALF,
        containerViewOffset,
        orbitOutset2D: -0.05,
        orbitOutset3D: 0.16,
        viewMode: activeViewMode,
        menuSlider: {
            label: 'Explode',
            min: 0,
            max: 3,
            initialValue: voronoiConfig.explodeAmount,
            valueDecimals: 2,
            onUpdate: (value) => {
                syncExplodeAmount(value, { updateSlider: false });
                if (value > 0) {
                    voronoiCubeInteraction.releaseAllHands();
                    mergeDeleteHighlight.hideAll();
                    voronoiCube.setPointHighlights([]);
                }
            },
            onRelease: () => {
                snapExplodeAmountOnRelease();
            },
        },
        isInteractionLocked: () => viewTransitionActive,
        onViewModeChange: (mode) => {
            if (mode === activeViewMode || viewTransitionActive) return false;
            voronoiConfig.viewMode = mode;
            setViewMode(mode);
            return true;
        },
        activeCheckboxIndex: getDiagramMetricIndex(),
        onCheckboxChange: (index) => {
            if (viewTransitionActive) return false;
            if (!isView3D() && index === getDiagramMetricIndex()) return true;

            if (isView3D()) {
                pendingDiagramMetricIndex = index;
                voronoiConfig.viewMode = '2D';
                orbitingMenu.setViewMode('2D', true);
                setViewMode('2D');
                return true;
            }

            return applyDiagramMetric(index);
        },
        getViewScaleBlend: () => {
            const scaleZ = voronoiCube.getDiagramGroup().scale.z;
            const minZ = VIEW_TRANSITION.minScaleZ;
            return THREE.MathUtils.clamp((scaleZ - minZ) / (1 - minZ), 0, 1);
        },
    });

    syncOrbitingMenuMetricCheckbox();

    const _labelsCheckboxWorldPos = new THREE.Vector3();

    function checkLabelsCheckboxPress() {
        const state = orbitingMenu.menuButtonState;
        if (!state.xrReady) return;
        if (state.cooldown > 0) return;
        if (pinchState.left || pinchState.right) return;
        if (!planeUiHeaderPlane.visible || headerHiddenByExplode) return;
        if (typeof orbitingMenu.isInteractionLocked === 'function' && orbitingMenu.isInteractionLocked()) return;

        labelsCheckbox.getWorldPosition(_labelsCheckboxWorldPos);

        if (lIndexObj.position.distanceTo(_labelsCheckboxWorldPos) < state.pressDistance) {
            onLabelsCheckboxPressed();
            return;
        }
        if (rIndexObj.position.distanceTo(_labelsCheckboxWorldPos) < state.pressDistance) {
            onLabelsCheckboxPressed();
        }
    }

    function onLabelsCheckboxPressed() {
        orbitingMenu.menuButtonState.cooldown = orbitingMenu.menuButtonState.cooldownDuration;
        orbitingMenu.animateMenuButtonPress(labelsCheckbox);
        setSeedPointLabelsEnabled(!seedPointLabelsEnabled);
    }

    scene.add(lThumbObj)
    scene.add(lIndexObj)
    scene.add(rThumbObj)
    scene.add(rIndexObj)

    /**
     * Pinch References
     */
    const sphere2 = new THREE.SphereGeometry(0.006, 32, 32)
    const defaultMat2 = new THREE.MeshLambertMaterial({ 
        color: 0xffffff,
    })

    const lPinchSphere = new THREE.Mesh(sphere2, defaultMat2)
    lPinchSphere.frustumCulled = false;
    scene.add(lPinchSphere)
    lPinchSphere.visible = false;

    const rPinchSphere = new THREE.Mesh(sphere2, defaultMat2)
    rPinchSphere.frustumCulled = false;
    scene.add(rPinchSphere)
    rPinchSphere.visible = false;

    /** Drag grab: white box line from control point to pinch midpoint. */
    const DRAG_CONNECTOR_THICKNESS = 0.002;
    const DRAG_CONNECTOR_OPACITY = 0.6;
    const dragConnectorGeometry = new THREE.BoxGeometry(DRAG_CONNECTOR_THICKNESS, 1, DRAG_CONNECTOR_THICKNESS);
    const dragConnectorMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: DRAG_CONNECTOR_OPACITY,
    });

    const lDragConnector = new THREE.Mesh(dragConnectorGeometry, dragConnectorMaterial);
    lDragConnector.visible = false;
    scene.add(lDragConnector);

    const rDragConnector = new THREE.Mesh(dragConnectorGeometry, dragConnectorMaterial);
    rDragConnector.visible = false;
    scene.add(rDragConnector);

    const _dragConnectorStart = new THREE.Vector3();
    const _dragConnectorEnd = new THREE.Vector3();
    const _dragConnectorDir = new THREE.Vector3();
    const _dragConnectorMid = new THREE.Vector3();
    const _dragConnectorUp = new THREE.Vector3(0, 1, 0);
    const _dragConnectorQuat = new THREE.Quaternion();
    const _controlPointWorld = new THREE.Vector3();

    function updateScaledBoxLine(mesh, start, end) {
        _dragConnectorDir.subVectors(end, start);
        const length = _dragConnectorDir.length();
        if (length < 1e-6) {
            mesh.visible = false;
            return;
        }

        _dragConnectorMid.copy(start).addScaledVector(_dragConnectorDir, 0.5);
        mesh.position.copy(_dragConnectorMid);
        mesh.scale.set(1, length, 1);
        _dragConnectorQuat.setFromUnitVectors(_dragConnectorUp, _dragConnectorDir.normalize());
        mesh.quaternion.copy(_dragConnectorQuat);
        mesh.visible = true;
    }

    function getControlPointWorldPosition(index) {
        if (index < 0) return null;

        const mesh = isView3D()
            ? voronoiCube.pointMeshes[index]
            : (usesManhattanDiagram()
                ? voronoiPlane.pointMeshes[index]
                : voronoiCube.pointMeshes[index]);

        if (!mesh) return null;
        return mesh.getWorldPosition(_controlPointWorld);
    }

    function updateHandDragGrabVisual(hand, pinchSphere, connectorMesh, thumbPos, indexPos, pinching) {
        if (viewTransitionActive || !pinching || !hand.dragging || hand.draggedPointIndex < 0) {
            pinchSphere.visible = false;
            connectorMesh.visible = false;
            return;
        }

        if (isView3D() && voronoiCube.isExploded()) {
            pinchSphere.visible = false;
            connectorMesh.visible = false;
            return;
        }

        _handMidpointWorld.addVectors(thumbPos, indexPos).multiplyScalar(0.5);
        pinchSphere.position.copy(_handMidpointWorld);
        pinchSphere.visible = true;

        const pointWorld = getControlPointWorldPosition(hand.draggedPointIndex);
        if (!pointWorld) {
            connectorMesh.visible = false;
            return;
        }

        updateScaledBoxLine(connectorMesh, pointWorld, _handMidpointWorld);
    }

    function updateDragGrabVisuals() {
        if (viewTransitionActive) {
            lPinchSphere.visible = false;
            rPinchSphere.visible = false;
            lDragConnector.visible = false;
            rDragConnector.visible = false;
            return;
        }

        const interaction = getActiveVoronoiInteraction();
        updateHandDragGrabVisual(
            interaction.hands.left,
            lPinchSphere,
            lDragConnector,
            lThumbObj.position,
            lIndexObj.position,
            pinchState.left
        );
        updateHandDragGrabVisual(
            interaction.hands.right,
            rPinchSphere,
            rDragConnector,
            rThumbObj.position,
            rIndexObj.position,
            pinchState.right
        );
    }

    /** Spawn hover: ghost control sphere before pinch-create (2D plane or 3D cube volume). */
    const SPAWN_GHOST_SCALE_TRANSITION = { duration: 0.18, ease: 'power2.out' };
    const spawnGhostGeometry = new THREE.SphereGeometry(voronoiCube.pointRadius, 16, 16);
    const spawnGhostMaterial = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
    });

    function createSpawnGhostState() {
        const mesh = new THREE.Mesh(spawnGhostGeometry, spawnGhostMaterial.clone());
        mesh.scale.setScalar(0);
        mesh.visible = false;
        containerGroup.add(mesh);
        return { mesh, tween: null, active: false };
    }

    const lSpawnGhost = createSpawnGhostState();
    const rSpawnGhost = createSpawnGhostState();

    function canSpawnMorePoints() {
        if (usesManhattanDiagram()) {
            return voronoiPlane.canAddPoint();
        }
        return voronoiCube.canAddPoint();
    }

    function getSpawnGhostPosition(ctx, interaction) {
        if (!canSpawnMorePoints()) {
            return null;
        }

        const { localX, localY, localZ } = ctx;
        const pickRadius = interaction.pickRadius;

        if (isView3D()) {
            if (voronoiCube.isExploded()) {
                return null;
            }

            if (!voronoiCube.isInsideBounds(localX, localY, localZ)) {
                return null;
            }

            const clamped = voronoiCube.clampToBounds(localX, localY, localZ);
            if (voronoiCube.findNearestPointIndex(clamped.x, clamped.y, clamped.z, pickRadius) >= 0) {
                return null;
            }

            return clamped;
        }

        const planeZTolerance = interaction.spawnZTolerance ?? pickRadius;

        if (usesManhattanDiagram()) {
            if (!voronoiPlane.isOnPlaneForSpawn(localX, localY, localZ, planeZTolerance)) {
                return null;
            }

            const clamped = voronoiPlane.clampToBounds(localX, localY);
            if (voronoiPlane.findNearestPointIndex(clamped.x, clamped.y, pickRadius, localZ) >= 0) {
                return null;
            }

            return {
                x: clamped.x,
                y: clamped.y,
                z: voronoiPlane.pointsGroup.position.z,
            };
        }

        if (!voronoiCube.isOnCenterPlaneForSpawn(localX, localY, localZ, planeZTolerance)) {
            return null;
        }

        const clamped = voronoiCube.clampToBoundsXY(localX, localY);
        if (voronoiCube.findNearestPointIndex(clamped.x, clamped.y, localZ, pickRadius) >= 0) {
            return null;
        }

        return {
            x: clamped.x,
            y: clamped.y,
            z: SEED_CENTER_Z,
        };
    }

    function tweenSpawnGhostScale(ghostState, target, onComplete) {
        ghostState.tween?.kill();

        const mesh = ghostState.mesh;
        const start = mesh.scale.x;
        if (Math.abs(start - target) < 0.001) {
            mesh.scale.setScalar(target);
            ghostState.tween = null;
            onComplete?.();
            return;
        }

        const proxy = { s: start };
        ghostState.tween = gsap.to(proxy, {
            s: target,
            ...SPAWN_GHOST_SCALE_TRANSITION,
            onUpdate: () => {
                mesh.scale.setScalar(proxy.s);
            },
            onComplete: () => {
                mesh.scale.setScalar(target);
                ghostState.tween = null;
                onComplete?.();
            },
        });
    }

    function setSpawnGhostVisible(ghostState, position) {
        ghostState.mesh.position.set(position.x, position.y, position.z);

        if (ghostState.active) return;

        ghostState.active = true;
        ghostState.mesh.visible = true;
        tweenSpawnGhostScale(ghostState, 1);
    }

    function hideSpawnGhost(ghostState) {
        if (!ghostState.active) {
            ghostState.tween?.kill();
            ghostState.tween = null;
            ghostState.mesh.scale.setScalar(0);
            ghostState.mesh.visible = false;
            return;
        }

        ghostState.active = false;
        tweenSpawnGhostScale(ghostState, 0, () => {
            ghostState.mesh.visible = false;
        });
    }

    function updateHandSpawnGhost(ghostState, hand, ctx, interaction, pinching) {
        if (pinching || hand.dragging || !ctx.hasJoints) {
            hideSpawnGhost(ghostState);
            return;
        }

        const position = getSpawnGhostPosition(ctx, interaction);
        if (!position) {
            hideSpawnGhost(ghostState);
            return;
        }

        setSpawnGhostVisible(ghostState, position);
    }

    function updateSpawnGhostVisuals(spatialManipActive) {
        if (viewTransitionActive || spatialManipActive) {
            hideSpawnGhost(lSpawnGhost);
            hideSpawnGhost(rSpawnGhost);
            return;
        }

        const interaction = getActiveVoronoiInteraction();
        updateHandSpawnGhost(
            lSpawnGhost,
            interaction.hands.left,
            handContext.left,
            interaction,
            pinchState.left
        );
        updateHandSpawnGhost(
            rSpawnGhost,
            interaction.hands.right,
            handContext.right,
            interaction,
            pinchState.right
        );
    }

    /**
     * Hands — XR joint sources only (no OculusHandModel mesh).
     */
    var hand1, hand2;

    hand1 = renderer.xr.getHand( 0 );
    scene.add( hand1 );

    hand2 = renderer.xr.getHand( 1 );
    scene.add( hand2 );

    const startModal = {
        scene,
        camera,
        renderer,
        session,
        lIndexObj,
        rIndexObj,
        pinchTracker,
        TWO_HAND_SETTLE_MS,
    };

    function placeContainerAtHeadOnDismiss() {
        if (!renderer.xr.isPresenting) return;
        camera.updateMatrixWorld(true);
        placeObjectAtHeadOffset(containerGroup, camera, HEAD_OFFSET, {
            yawOnly: true,
            matchYaw: true,
        });
        twoHandedManip.isActive = false;
        leftPinchJumpGuard.reset();
        rightPinchJumpGuard.reset();
    }

    createStartModal(startModal, {
        message: 'Pinch both hands to adjust the scene.',
        onDismiss: placeContainerAtHeadOnDismiss,
    });

    function isStartModalKeepAlive(obj) {
        return obj === startModal.startModalRoot
            || obj === camera
            || obj.isLight
            || obj === hand1
            || obj === hand2
            || obj === lThumbObj
            || obj === lIndexObj
            || obj === rThumbObj
            || obj === rIndexObj;
    }

    function syncSceneBehindModal() {
        const show = !startModal.startModalActive;
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

    // ==========================================
    // ANIMATION LOOP
    // ==========================================

    // Drive GSAP from the WebXR render loop (not window rAF).
    gsap.ticker.lagSmoothing(0);

    const clock = new THREE.Clock();

    function tick() {
        const delta = clock.getDelta();
        startModal.delta = delta;
        gsap.ticker.tick(delta);

        xrHeadPlacement.update();
        handTracking();
        startModal.updateStartModal();
        orbitingMenu.update(delta, { skipInteractions: startModal.startModalActive });
        if (!startModal.startModalActive) {
            checkLabelsCheckboxPress();
        }
        updatePlaneUiHeaderOrientation();
        updateControlSphereHighlights();

        const leftPinchActive = pinchState.left;
        const rightPinchActive = pinchState.right;
        const menuSliderGrabbed = orbitingMenu?.isMenuSliderGrabbed ?? false;
        const spatialManipActive = !startModal.startModalActive
            && !viewTransitionActive
            && !menuSliderGrabbed
            && shouldUseTwoHandedSpatialManip(leftPinchActive, rightPinchActive);

        if (!startModal.startModalActive && !viewTransitionActive && !spatialManipActive && !menuSliderGrabbed && isView3D()) {
            voronoiCubeInteraction.updateHand('left', {
                cubeX: handContext.left.localX,
                cubeY: handContext.left.localY,
                cubeZ: handContext.left.localZ,
                pinching: pinchState.left,
                prevPinching: prevPinchState.left,
                hasJoints: handContext.left.hasJoints,
            });
            voronoiCubeInteraction.updateHand('right', {
                cubeX: handContext.right.localX,
                cubeY: handContext.right.localY,
                cubeZ: handContext.right.localZ,
                pinching: pinchState.right,
                prevPinching: prevPinchState.right,
                hasJoints: handContext.right.hasJoints,
            });
        } else if (!startModal.startModalActive && !viewTransitionActive && !spatialManipActive && !menuSliderGrabbed) {
            const planeInteraction = usesManhattanDiagram()
                ? voronoiInteraction
                : voronoiCubePlaneInteraction;

            planeInteraction.updateHand('left', {
                planeX: handContext.left.localX,
                planeY: handContext.left.localY,
                planeZ: handContext.left.localZ,
                pinching: pinchState.left,
                prevPinching: prevPinchState.left,
                hasJoints: handContext.left.hasJoints,
            });
            planeInteraction.updateHand('right', {
                planeX: handContext.right.localX,
                planeY: handContext.right.localY,
                planeZ: handContext.right.localZ,
                pinching: pinchState.right,
                prevPinching: prevPinchState.right,
                hasJoints: handContext.right.hasJoints,
            });
        }

        if (!hintDismissed && getActiveVoronoiInteraction().isAnyHandDragging()) {
            dismissInteractionHint();
        }

        prevPinchState.left = pinchState.left;
        prevPinchState.right = pinchState.right;

        if (spatialManipActive) {
            getActiveVoronoiInteraction().releaseAllHands();
            applyTwoHandedContainerManip(containerGroup);
        } else {
            twoHandedManip.isActive = false;
            leftPinchJumpGuard.reset();
            rightPinchJumpGuard.reset();
        }

        updateDragGrabVisuals();
        updateSpawnGhostVisuals(spatialManipActive || startModal.startModalActive);
        updateMergeDeleteHighlight(spatialManipActive || startModal.startModalActive);

        voronoiCube.update(renderer.xr.getCamera());
        if (usesManhattanDiagram()) {
            voronoiPlane.update(renderer.xr.getCamera());
        }

        syncSceneBehindModal();
        renderer.render( scene, camera );
    }

    function handTracking() {
        if (hand1?.joints?.['thumb-tip']?.visible) {
            const j = hand1.joints['thumb-tip'];
            lThumbObj.position.copy(j.position);
            lThumbObj.rotation.copy(j.rotation);
        }

        if (hand1?.joints?.['index-finger-tip']?.visible) {
            const j = hand1.joints['index-finger-tip'];
            lIndexObj.position.copy(j.position);
            lIndexObj.rotation.copy(j.rotation);
        }

        if (hand2?.joints?.['thumb-tip']?.visible) {
            const j = hand2.joints['thumb-tip'];
            rThumbObj.position.copy(j.position);
            rThumbObj.rotation.copy(j.rotation);
        }

        if (hand2?.joints?.['index-finger-tip']?.visible) {
            const j = hand2.joints['index-finger-tip'];
            rIndexObj.position.copy(j.position);
            rIndexObj.rotation.copy(j.rotation);
        }

        pinchTracker.update({ left: hand1, right: hand2 });
        pinchState.left = pinchTracker.left.pinching;
        pinchState.right = pinchTracker.right.pinching;

        updateHandContext(
            lThumbObj.position,
            lIndexObj.position,
            pinchTracker.left.tracked,
            handContext.left
        );
        updateHandContext(
            rThumbObj.position,
            rIndexObj.position,
            pinchTracker.right.tracked,
            handContext.right
        );
    }

    return {
        scene,
        camera,
        renderer,
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
