import * as THREE from 'three';
import gsap from 'gsap';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export function createRevolution(deps) {
    const {
        containerGroup,
        solidGroup,
        containerConfig,
        CONTAINER_HALF,
        overlayDrawProps,
        updateHeaderPlane,
    } = deps;
// ==========================================
// PROFILE CURVE (Phase 1 — Solids of Revolution)
// Y = revolution axis, profile lives in X–Y plane (z = 0)
// ==========================================

const PROFILE_CURVE_SAMPLES = 64;
const PROFILE_CURVE_LINE_WIDTH = 0.003;
const MIN_PROFILE_RADIUS = 0.02;
const AXIS_RADIUS_EPSILON = 1e-4;
const GRAB_RADIUS = 0.03;
const CURVE_ADD_RADIUS = 0.03;
const MERGE_SNAP_DISTANCE = 0.015;
const MIN_CONTROL_POINTS = 2;
const MAX_CONTROL_POINTS = 12;

const profileGroup = new THREE.Group();
containerGroup.add(profileGroup);

const controlPoints = [
    new THREE.Vector3(0, -0.18, 0),
    new THREE.Vector3(0.14, -0.06, 0),
    new THREE.Vector3(0.08, 0.06, 0),
    new THREE.Vector3(0, 0.18, 0),
];

const profileCurve = new THREE.CatmullRomCurve3(controlPoints);
profileCurve.curveType = 'centripetal';

const INTERACTION_KNOB_RADIUS = 0.008;

const handleGeometry = new THREE.SphereGeometry(0.0065, 12, 12);
const circleHandleGeometry = new THREE.SphereGeometry(INTERACTION_KNOB_RADIUS, 12, 12);
const handleMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, ...overlayDrawProps });
const handleGrabMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, ...overlayDrawProps });
const handleMergeTargetMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, ...overlayDrawProps });

// handleMaterial is shared, never mutated per-instance (highlight state is applied
// by swapping .material to one of the 3 shared materials below), so every handle
// can reference the same material object directly — no .clone() needed. Sharing
// the exact material instance also lets three.js skip redundant uniform re-binds
// between consecutively-rendered handles.
const handles = controlPoints.map((pt) => {
    const mesh = new THREE.Mesh(handleGeometry, handleMaterial);
    mesh.position.copy(pt);
    mesh.renderOrder = deps.HANDLE_RENDER_ORDER;
    mesh.frustumCulled = false;
    profileGroup.add(mesh);
    return mesh;
});

// Fixed-capacity curve line geometry, rewritten in place on every profile
// update. Capacity: custom mode produces PROFILE_CURVE_SAMPLES + 1 points
// (getPoints(n) semantics); analytic presets produce exactly
// PROFILE_CURVE_SAMPLES. Writing into the existing interleaved buffer
// (6 floats per segment: startXYZ, endXYZ) avoids the per-drag-frame
// dispose + LineGeometry realloc + GPU buffer re-upload the old code did.
const CURVE_LINE_MAX_POINTS = PROFILE_CURVE_SAMPLES + 1;
const curveLineGeometry = new LineGeometry();
curveLineGeometry.setPositions(new Float32Array(CURVE_LINE_MAX_POINTS * 3));
curveLineGeometry.instanceCount = 0;

function writeCurveLinePositions(samples) {
    const instanceStart = curveLineGeometry.attributes.instanceStart;
    const buffer = instanceStart.array;
    const count = Math.min(samples.length, CURVE_LINE_MAX_POINTS);
    const segmentCount = Math.max(0, count - 1);

    for (let i = 0; i < segmentCount; i++) {
        const a = samples[i];
        const b = samples[i + 1];
        const base = i * 6;
        buffer[base] = a.x;
        buffer[base + 1] = a.y;
        buffer[base + 2] = a.z;
        buffer[base + 3] = b.x;
        buffer[base + 4] = b.y;
        buffer[base + 5] = b.z;
    }

    instanceStart.needsUpdate = true;
    curveLineGeometry.instanceCount = segmentCount;
}

const curveLineMaterial = new LineMaterial({
    color: 0xffff00,
    linewidth: PROFILE_CURVE_LINE_WIDTH,
    worldUnits: true,
    ...overlayDrawProps,
});
curveLineMaterial.resolution.set(window.innerWidth, window.innerHeight);

const curveLine = new Line2(curveLineGeometry, curveLineMaterial);
curveLine.frustumCulled = false;
curveLine.renderOrder = deps.OVERLAY_RENDER_ORDER;
profileGroup.add(curveLine);

// ==========================================
// REVOLUTION SOLID (Phase 2 — performant lathe)
// Pre-allocated buffers; profile updates rewrite attributes in place.
// Angle changes use setDrawRange only (no geometry rebuild).
// ==========================================

const TAU = Math.PI * 2;
const REVOLUTION_ANGLE_SNAP = THREE.MathUtils.degToRad(8);
const SWEEP_REVEAL_DURATION = 1.35;
const REVOLUTION_RADIAL_SEGMENTS = 40;
const REVOLUTION_GRID_LINE_STEP = 5;
const REVOLUTION_OPEN_EDGE_LINE_WIDTH = 0.001;
const REVOLUTION_OPEN_EDGE_COLOR = 0xffb200;
const REVOLUTION_GRADIENT_LOW = 0xff6600;
const REVOLUTION_GRADIENT_HIGH = 0xffee00;

const DISK_METHOD_MAX_DISKS = 32;
const DISK_METHOD_RADIAL_SEGMENTS = 24;
const DISK_HEIGHT_GAP = 0.92;
const DISK_CAP_COLOR_SCALE = 1.22;
const DISK_SIDE_COLOR_SCALE = 0.84;
const DISK_RENDER_ORDER = deps.SOLID_RENDER_ORDER + 2;
const DISK_RIM_RADIAL_SEGMENTS = 48;
const DISK_RIM_OPACITY = 0.85;
const DISK_RIM_DEPTH_OFFSET = 0.00015;

const BOTTOM_CIRCLE_SEGMENTS = 64;
const BOTTOM_CIRCLE_Y = -containerConfig.containerSize * 0.5;
const MAX_BOTTOM_CIRCLE_RADIUS = containerConfig.containerSize * 0.5;
const BOTTOM_CIRCLE_LINE_WIDTH = 0.005;
const CIRCLE_HANDLE_THICKNESS_MARGIN = 1.1;
const BOTTOM_CIRCLE_TRACK_OPACITY = 0.35;

function computeProfileMaxRadius(samples) {
    let maxRadius = 0;
    for (let i = 0; i < samples.length; i++) {
        maxRadius = Math.max(maxRadius, samples[i].x);
    }
    return Math.min(maxRadius, MAX_BOTTOM_CIRCLE_RADIUS);
}

// Pre-allocated ring buffers: BOTTOM_CIRCLE_SEGMENTS (theta) x 1 (phi) is fixed,
// so index/normal counts never change — only vertex positions need rewriting
// when radius/angle/direction change. This avoids disposing + reallocating a
// new RingGeometry (and its GPU buffers) every frame while dragging.
const BOTTOM_CIRCLE_RING_VERT_COUNT = (BOTTOM_CIRCLE_SEGMENTS + 1) * 2;

function buildBottomCircleRingIndices() {
    const indices = new Uint16Array(BOTTOM_CIRCLE_SEGMENTS * 6);
    let offset = 0;
    for (let i = 0; i < BOTTOM_CIRCLE_SEGMENTS; i++) {
        const a = i;
        const b = i + BOTTOM_CIRCLE_SEGMENTS + 1;
        const c = i + BOTTOM_CIRCLE_SEGMENTS + 2;
        const d = i + 1;
        indices[offset++] = a;
        indices[offset++] = b;
        indices[offset++] = d;
        indices[offset++] = b;
        indices[offset++] = c;
        indices[offset++] = d;
    }
    return indices;
}

const bottomCircleRingIndices = buildBottomCircleRingIndices();

function createBottomCircleRingGeometry() {
    const positions = new Float32Array(BOTTOM_CIRCLE_RING_VERT_COUNT * 3);
    const normals = new Float32Array(BOTTOM_CIRCLE_RING_VERT_COUNT * 3);
    for (let i = 0; i < BOTTOM_CIRCLE_RING_VERT_COUNT; i++) {
        normals[i * 3 + 2] = 1;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(bottomCircleRingIndices, 1));
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    return geometry;
}

/** Rewrites an existing ring geometry's vertex positions in place (no realloc). */
function writeBottomCircleRingGeometry(geometry, radius, sweepAngle, direction) {
    const halfWidth = BOTTOM_CIRCLE_LINE_WIDTH * 0.5;
    const inner = Math.max(0.001, radius - halfWidth);
    const outer = radius + halfWidth;
    const thetaLength = sweepAngle >= TAU ? TAU : direction * sweepAngle;

    const positions = geometry.attributes.position.array;
    let idx = 0;
    for (let i = 0; i <= BOTTOM_CIRCLE_SEGMENTS; i++) {
        const segment = (i / BOTTOM_CIRCLE_SEGMENTS) * thetaLength;
        positions[idx++] = inner * Math.cos(segment);
        positions[idx++] = inner * Math.sin(segment);
        positions[idx++] = 0;
    }
    for (let i = 0; i <= BOTTOM_CIRCLE_SEGMENTS; i++) {
        const segment = (i / BOTTOM_CIRCLE_SEGMENTS) * thetaLength;
        positions[idx++] = outer * Math.cos(segment);
        positions[idx++] = outer * Math.sin(segment);
        positions[idx++] = 0;
    }
    geometry.attributes.position.needsUpdate = true;
}

const bottomCircleTrackMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: BOTTOM_CIRCLE_TRACK_OPACITY,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
});

const bottomCircleProgressMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    ...overlayDrawProps,
});

const bottomCircleTrack = new THREE.Mesh(
    createBottomCircleRingGeometry(),
    bottomCircleTrackMaterial
);
writeBottomCircleRingGeometry(bottomCircleTrack.geometry, MAX_BOTTOM_CIRCLE_RADIUS, TAU, 1);
bottomCircleTrack.rotation.x = Math.PI / 2;
bottomCircleTrack.position.y = BOTTOM_CIRCLE_Y;
bottomCircleTrack.frustumCulled = false;
bottomCircleTrack.renderOrder = deps.OVERLAY_RENDER_ORDER;
containerGroup.add(bottomCircleTrack);

const bottomCircleProgress = new THREE.Mesh(
    createBottomCircleRingGeometry(),
    bottomCircleProgressMaterial
);
bottomCircleProgress.rotation.x = Math.PI / 2;
bottomCircleProgress.position.y = BOTTOM_CIRCLE_Y;
bottomCircleProgress.frustumCulled = false;
bottomCircleProgress.renderOrder = deps.OVERLAY_RENDER_ORDER + 1;
bottomCircleProgress.visible = false;
containerGroup.add(bottomCircleProgress);

const planeUiTextureLoader = new THREE.TextureLoader();
const arrowPlaneTexture = planeUiTextureLoader.load('./static/ui-arrow-test.png');
arrowPlaneTexture.colorSpace = THREE.SRGBColorSpace;

const ARROW_PLANE_SIZE = 0.58; // sized for MAX_BOTTOM_CIRCLE_RADIUS
const ARROW_PLANE_OPACITY = 0.6;
const ARROW_PLANE_FADE_OUT_DURATION = 0.4;
const ARROW_PLANE_MIN_VISIBLE_SCALE = 0.4;
const arrowPlaneFadeState = { opacity: ARROW_PLANE_OPACITY };
let arrowPlaneDismissed = false;
const planeUiBottomPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(ARROW_PLANE_SIZE, ARROW_PLANE_SIZE),
    new THREE.MeshBasicMaterial({
        map: arrowPlaneTexture,
        transparent: true,
        side: THREE.DoubleSide,
        ...overlayDrawProps,
        opacity: ARROW_PLANE_OPACITY,
    })
);
planeUiBottomPlane.rotation.x = Math.PI / 2;
planeUiBottomPlane.position.y = BOTTOM_CIRCLE_Y + 0.0002;
planeUiBottomPlane.frustumCulled = false;
planeUiBottomPlane.renderOrder = deps.OVERLAY_RENDER_ORDER + 2;
containerGroup.add(planeUiBottomPlane);

function updateArrowPlaneScale() {
    const scale = bottomCircleState.radius / MAX_BOTTOM_CIRCLE_RADIUS;
    planeUiBottomPlane.scale.set(scale, scale, 1);
}

function syncArrowPlaneThresholdVisibility() {
    if (arrowPlaneDismissed) return;

    const scale = bottomCircleState.radius / MAX_BOTTOM_CIRCLE_RADIUS;
    const shouldShow = scale >= ARROW_PLANE_MIN_VISIBLE_SCALE;
    if (shouldShow) {
        planeUiBottomPlane.visible = true;
        planeUiBottomPlane.material.opacity = ARROW_PLANE_OPACITY;
        return;
    }
    planeUiBottomPlane.visible = false;
}

function fadeArrowPlane(opacity, duration) {
    gsap.killTweensOf(arrowPlaneFadeState);
    gsap.to(arrowPlaneFadeState, {
        opacity,
        duration,
        ease: 'power2.inOut',
        onUpdate: () => {
            planeUiBottomPlane.material.opacity = arrowPlaneFadeState.opacity;
        },
        onComplete: () => {
            if (opacity <= 0) {
                planeUiBottomPlane.visible = false;
            }
        },
    });
}

function fadeOutArrowPlane() {
    if (arrowPlaneDismissed) return;
    arrowPlaneDismissed = true;
    fadeArrowPlane(0, ARROW_PLANE_FADE_OUT_DURATION);
}

const bottomCircleState = {
    radius: MAX_BOTTOM_CIRCLE_RADIUS,
    handleAngle: 0,
};

const circleHandleMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    ...overlayDrawProps,
});
const circleHandleGrabMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    ...overlayDrawProps,
});

const circleHandle = new THREE.Mesh(circleHandleGeometry, circleHandleMaterial);
circleHandle.renderOrder = deps.HANDLE_RENDER_ORDER;
circleHandle.frustumCulled = false;
containerGroup.add(circleHandle);

// ==========================================
// VIEW MODE (Surface vs Disk)
// Both modes share the bottom-circle sweep control (0 → 1).
// Surface: angular sweep of the lathe mesh.
// Disk: whole disks revealed bottom-to-top (not partial pie slices).
// ==========================================

const revolutionMode = {
    mode: 'surface',
};

let menuToggleActiveOption = 'surface';
let menuToggleUiReady = false;

function isSurfaceMode() {
    return revolutionMode.mode === 'surface';
}

function isDiskMode() {
    return revolutionMode.mode === 'disk';
}

function setRevolutionMode(mode, { syncToggle = true, animateToggle = false } = {}) {
    const normalized = mode === 'disk' ? 'disk' : 'surface';
    revolutionMode.mode = normalized;

    if (syncToggle && menuToggleUiReady && menuToggleActiveOption !== normalized) {
        menuToggleActiveOption = normalized;
        if (typeof deps.applyMenuToggleVisuals === 'function') {
            deps.applyMenuToggleVisuals(animateToggle);
        }
    }

    if (isDiskMode() && diskMethod.lastSamples) {
        updateDiskMethod(diskMethod.lastSamples);
    }
    // Returning to surface mode: rebuild the lathe rings if the profile (or
    // sweep direction) changed while it was hidden. Must run before
    // applyRevolutionDrawRange() so the grid/open edge read fresh positions.
    if (isSurfaceMode() && revolutionSolid.profileDirty) {
        revolutionSolid.profileDirty = false;
        writeRevolutionRingPositions(revolutionSolid.activeProfileCount);
    }
    cancelSweepRevealAnimation();
    applyRevolutionDrawRange();
    applyDiskSweepFilter();
    syncDiskMethodView();
    updateBottomCircleVisuals();
    if (typeof deps.syncSliderTwo === 'function') deps.syncSliderTwo();
    updateHeaderPlane();
}

function updateBottomCircleHandlePosition() {
    const { radius, handleAngle } = bottomCircleState;
    circleHandle.position.set(
        radius * Math.cos(handleAngle),
        BOTTOM_CIRCLE_Y,
        radius * Math.sin(handleAngle)
    );
}

function syncCircleHandleScale() {
    const containerScale = containerGroup.scale.x;
    if (containerScale <= 1e-8) {
        circleHandle.scale.setScalar(1);
        return;
    }

    const inverseScale = 1 / containerScale;
    const ringWorldThickness = BOTTOM_CIRCLE_LINE_WIDTH * containerScale;
    const minWorldRadius = ringWorldThickness * CIRCLE_HANDLE_THICKNESS_MARGIN;
    const targetWorldRadius = Math.max(INTERACTION_KNOB_RADIUS, minWorldRadius);
    const localScale = (targetWorldRadius / INTERACTION_KNOB_RADIUS) * inverseScale;
    circleHandle.scale.setScalar(localScale);
}

function updateBottomCircle(samples) {
    bottomCircleState.radius = computeProfileMaxRadius(samples);
    updateBottomCircleVisuals();
}

const _gradientColorLow = new THREE.Color();
const _gradientColorHigh = new THREE.Color();
const _gradientColorTmp = new THREE.Color();

const revolutionSolid = {
    radialSegments: REVOLUTION_RADIAL_SEGMENTS,
    profileCount: PROFILE_CURVE_SAMPLES,
    angle: 0,
    direction: -1,
    activeProfileCount: PROFILE_CURVE_SAMPLES,
    /** Ring buffers are stale (profile/direction changed while lathe was hidden in disk mode). */
    profileDirty: false,
    mesh: null,
    geometry: null,
    material: null,
    positions: null,
    normals: null,
    colors: null,
    initNormals: null,
    indices: null,
    profile2D: Array.from({ length: PROFILE_CURVE_SAMPLES }, () => new THREE.Vector2()),
};

const revolutionGrid = {
    lines: null,
    geometry: null,
    indices: null,
    indexCount: 0,
};

const revolutionOpenEdge = {
    line: null,
    geometry: null,
};

function computeProfileNormals2D(profile2D, count, out) {
    const prev = new THREE.Vector2();
    const cur = new THREE.Vector2();
    const normal = new THREE.Vector2();

    for (let j = 0; j < count; j++) {
        if (j === 0) {
            normal.set(
                profile2D[1].y - profile2D[0].y,
                -(profile2D[1].x - profile2D[0].x)
            );
            prev.copy(normal);
        } else if (j === count - 1) {
            normal.copy(prev);
        } else {
            normal.set(
                profile2D[j + 1].y - profile2D[j].y,
                -(profile2D[j + 1].x - profile2D[j].x)
            );
            cur.copy(normal);
            normal.x += prev.x;
            normal.y += prev.y;
            prev.copy(cur);
        }

        const len = normal.length();
        const invLen = len > 0 ? 1 / len : 0;
        out[j * 3] = normal.x * invLen;
        out[j * 3 + 1] = normal.y * invLen;
        out[j * 3 + 2] = 0;
    }
}

function buildRevolutionIndexBuffer(profileCount, radialSegments) {
    const indexCount = radialSegments * (profileCount - 1) * 6;
    const indices = new Uint16Array(indexCount);
    let offset = 0;

    for (let i = 0; i < radialSegments; i++) {
        for (let j = 0; j < profileCount - 1; j++) {
            const base = j + i * profileCount;
            const a = base;
            const b = base + profileCount;
            const c = base + profileCount + 1;
            const d = base + 1;
            indices[offset++] = a;
            indices[offset++] = b;
            indices[offset++] = d;
            indices[offset++] = c;
            indices[offset++] = d;
            indices[offset++] = b;
        }
    }

    return indices;
}

function estimateMaxGridIndexCount(radialSegments, profileCount, lineStep) {
    const step = Math.max(1, Math.floor(lineStep));
    const profileLineCount = (Math.floor(radialSegments / step) + 1) * (profileCount - 1);
    const ringLineCount = (Math.floor((profileCount - 1) / step) + 1) * radialSegments;
    return (profileLineCount + ringLineCount) * 2;
}

function getVisibleRadialSegments() {
    const { radialSegments, angle } = revolutionSolid;
    if (angle <= 0) return 0;
    if (angle >= TAU) return radialSegments;
    return Math.ceil((angle / TAU) * radialSegments);
}

function updateRevolutionGridIndices() {
    const { radialSegments, profileCount } = revolutionSolid;
    const visibleSegments = getVisibleRadialSegments();
    const step = REVOLUTION_GRID_LINE_STEP;
    const indices = revolutionGrid.indices;
    let offset = 0;

    for (let ring = 0; ring <= radialSegments; ring += step) {
        if (ring > visibleSegments) break;
        for (let j = 0; j < profileCount - 1; j++) {
            const a = j + ring * profileCount;
            indices[offset++] = a;
            indices[offset++] = a + 1;
        }
    }

    for (let j = 0; j < profileCount; j += step) {
        for (let ring = 0; ring < visibleSegments; ring++) {
            const a = j + ring * profileCount;
            indices[offset++] = a;
            indices[offset++] = a + profileCount;
        }
    }

    revolutionGrid.indexCount = offset;
    revolutionGrid.geometry.setDrawRange(0, offset);
    revolutionGrid.geometry.index.needsUpdate = true;
}

function initRevolutionOpenEdge() {
    const geometry = new LineGeometry();
    geometry.setPositions(new Float32Array(PROFILE_CURVE_SAMPLES * 3));

    const material = new LineMaterial({
        color: REVOLUTION_OPEN_EDGE_COLOR,
        linewidth: REVOLUTION_OPEN_EDGE_LINE_WIDTH,
        worldUnits: true,
        ...overlayDrawProps,
    });
    material.resolution.set(window.innerWidth, window.innerHeight);

    const line = new Line2(geometry, material);
    line.frustumCulled = false;
    line.renderOrder = deps.OVERLAY_RENDER_ORDER;
    line.visible = false;

    revolutionOpenEdge.geometry = geometry;
    revolutionOpenEdge.line = line;
    solidGroup.add(line);
}

/**
 * Writes segment start/end pairs directly into the open-edge line's existing
 * interleaved buffer (same layout LineGeometry.setPositions() would produce:
 * stride 6 floats per segment — startXYZ, endXYZ) and bumps its version via
 * needsUpdate. This avoids calling setPositions() every frame during a drag,
 * which would allocate a new Float32Array *and* a new GPU buffer every call.
 */
function updateRevolutionOpenEdgeGeometry() {
    const { angle, positions, profileCount, activeProfileCount } = revolutionSolid;
    const line = revolutionOpenEdge.line;
    if (!line) return;

    const isPartial = angle > 0 && angle < TAU;
    if (!isPartial) return;

    const geometry = revolutionOpenEdge.geometry;
    const instanceStart = geometry.attributes.instanceStart;
    if (!instanceStart) return;

    const buffer = instanceStart.array;
    const ringIndex = getVisibleRadialSegments();
    const count = activeProfileCount;
    const ringOffset = ringIndex * profileCount;
    const segmentCount = Math.max(0, count - 1);

    for (let j = 0; j < segmentCount; j++) {
        const aIndex = (ringOffset + j) * 3;
        const bIndex = (ringOffset + j + 1) * 3;
        const base = j * 6;
        buffer[base] = positions[aIndex];
        buffer[base + 1] = positions[aIndex + 1];
        buffer[base + 2] = positions[aIndex + 2];
        buffer[base + 3] = positions[bIndex];
        buffer[base + 4] = positions[bIndex + 1];
        buffer[base + 5] = positions[bIndex + 2];
    }

    instanceStart.needsUpdate = true;
    geometry.instanceCount = segmentCount;
}

function initRevolutionSolid() {
    const { radialSegments, profileCount } = revolutionSolid;
    const ringCount = radialSegments + 1;
    const vertexCount = ringCount * profileCount;

    revolutionSolid.positions = new Float32Array(vertexCount * 3);
    revolutionSolid.normals = new Float32Array(vertexCount * 3);
    revolutionSolid.colors = new Float32Array(vertexCount * 3);
    revolutionSolid.initNormals = new Float32Array(profileCount * 3);
    revolutionSolid.indices = buildRevolutionIndexBuffer(profileCount, radialSegments);

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(revolutionSolid.indices, 1));
    geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(revolutionSolid.positions, 3)
    );
    geometry.setAttribute(
        'normal',
        new THREE.BufferAttribute(revolutionSolid.normals, 3)
    );
    geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(revolutionSolid.colors, 3)
    );

    const material = new THREE.MeshPhongMaterial({
        vertexColors: true,
        color: 0xffffff,
        specular: 0x442200,
        shininess: 80,
        side: THREE.DoubleSide,
        transparent: false,
        opacity: 1.0,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = deps.SOLID_RENDER_ORDER;

    const gridIndexCount = estimateMaxGridIndexCount(radialSegments, profileCount, REVOLUTION_GRID_LINE_STEP);
    revolutionGrid.indices = new Uint32Array(gridIndexCount);
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(revolutionSolid.positions, 3)
    );
    gridGeometry.setIndex(new THREE.BufferAttribute(revolutionGrid.indices, 1));

    const gridMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.8,
    });

    const gridLines = new THREE.LineSegments(gridGeometry, gridMaterial);
    gridLines.frustumCulled = false;
    gridLines.renderOrder = deps.SOLID_RENDER_ORDER + 1;

    revolutionSolid.geometry = geometry;
    revolutionSolid.material = material;
    revolutionSolid.mesh = mesh;
    revolutionGrid.geometry = gridGeometry;
    revolutionGrid.lines = gridLines;

    solidGroup.add(mesh);
    solidGroup.add(gridLines);
    initRevolutionOpenEdge();
}

/**
 * Y (and thus color) depends only on the profile index j — every ring shares
 * the exact same Y per j, since revolution only changes X/Z. So the gradient
 * only needs computing once per profile column (profileCount lerps) instead
 * of once per vertex (vertexCount lerps, ~ringCount times more); the result
 * is then broadcast to every other ring via cheap typed-array copies.
 */
function updateRevolutionVertexColors(positions, colors, vertexCount, profileCount) {
    let minY = Infinity;
    let maxY = -Infinity;

    for (let j = 0; j < profileCount; j++) {
        const y = positions[j * 3 + 1];
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
    }

    const rangeY = maxY - minY || 1;
    _gradientColorLow.set(REVOLUTION_GRADIENT_LOW);
    _gradientColorHigh.set(REVOLUTION_GRADIENT_HIGH);

    for (let j = 0; j < profileCount; j++) {
        const t = (positions[j * 3 + 1] - minY) / rangeY;
        _gradientColorTmp.lerpColors(_gradientColorLow, _gradientColorHigh, t);
        const colorIndex = j * 3;
        colors[colorIndex] = _gradientColorTmp.r;
        colors[colorIndex + 1] = _gradientColorTmp.g;
        colors[colorIndex + 2] = _gradientColorTmp.b;
    }

    const ringStride = profileCount * 3;
    const totalLength = vertexCount * 3;
    for (let offset = ringStride; offset < totalLength; offset += ringStride) {
        colors.copyWithin(offset, 0, ringStride);
    }
}

function setRevolutionSolidOpacity(opacity) {
    const material = revolutionSolid.material;
    if (!material) return;

    const o = THREE.MathUtils.clamp(opacity, 0, 1);
    material.opacity = o;
    material.transparent = o < 1.0;

    if (o < 1.0) {
        material.vertexColors = false;
        material.color.set(0xffffff);
    } else {
        material.vertexColors = true;
        material.color.set(0xffffff);
    }

    material.needsUpdate = true;
}

function applyRevolutionDrawRange() {
    const { geometry, profileCount } = revolutionSolid;
    const segmentsToShow = getVisibleRadialSegments();
    const indexCount = segmentsToShow * (profileCount - 1) * 6;
    const showSurface = segmentsToShow > 0 && isSurfaceMode();

    geometry.setDrawRange(0, showSurface ? indexCount : 0);

    if (revolutionGrid.lines) {
        if (showSurface) {
            updateRevolutionGridIndices();
        } else {
            revolutionGrid.geometry.setDrawRange(0, 0);
        }
    }

    updateRevolutionOpenEdgeGeometry();
    syncDiskMethodView();
}

// ==========================================
// DISK METHOD (Phase 3 — merged buffer, single draw call)
// Pre-allocated vertices/indices; profile updates rewrite in place.
// Partial sweep uses setDrawRange only (no geometry rebuild).
// ==========================================

function diskVertsPerDisk(radialSegments) {
    return radialSegments * 2 + 4;
}

function diskIndicesPerDisk(radialSegments) {
    return radialSegments * 12;
}

function buildDiskMethodIndexBuffer(maxDisks, radialSegments) {
    const vertsPerDisk = diskVertsPerDisk(radialSegments);
    const indicesPerDisk = diskIndicesPerDisk(radialSegments);
    const indices = new Uint16Array(maxDisks * indicesPerDisk);
    let offset = 0;

    for (let d = 0; d < maxDisks; d++) {
        const O = d * vertsPerDisk;
        const topRing = O + radialSegments + 1;
        const topCenter = O + radialSegments * 2 + 2;
        const bottomCenter = topCenter + 1;

        for (let i = 0; i < radialSegments; i++) {
            const b0 = O + i;
            const b1 = O + i + 1;
            const t0 = topRing + i;
            const t1 = topRing + i + 1;
            indices[offset++] = b0;
            indices[offset++] = t0;
            indices[offset++] = b1;
            indices[offset++] = b1;
            indices[offset++] = t0;
            indices[offset++] = t1;
        }

        for (let i = 0; i < radialSegments; i++) {
            indices[offset++] = topCenter;
            indices[offset++] = topRing + i + 1;
            indices[offset++] = topRing + i;
        }

        for (let i = 0; i < radialSegments; i++) {
            indices[offset++] = bottomCenter;
            indices[offset++] = O + i;
            indices[offset++] = O + i + 1;
        }
    }

    return indices;
}

function radiusAtY(samples, y) {
    const count = samples.length;
    if (count === 0) return 0;
    if (y <= samples[0].y) return samples[0].x;
    if (y >= samples[count - 1].y) return samples[count - 1].x;

    let lo = 0;
    let hi = count - 1;
    while (lo < hi - 1) {
        const mid = (lo + hi) >> 1;
        if (samples[mid].y <= y) lo = mid;
        else hi = mid;
    }

    const y0 = samples[lo].y;
    const y1 = samples[hi].y;
    const span = y1 - y0;
    const t = span > 0 ? (y - y0) / span : 0;
    return samples[lo].x + t * (samples[hi].x - samples[lo].x);
}

function computeDiskApproxVolume(samples, diskCount, visibleDiskCount) {
    if (!samples || samples.length < 2 || diskCount < 1) return 0;

    const yMin = samples[0].y;
    const yMax = samples[samples.length - 1].y;
    const dy = (yMax - yMin) / diskCount;
    const count = Math.min(diskCount, visibleDiskCount);
    let volume = 0;

    for (let k = 0; k < count; k++) {
        const yCenter = yMin + (k + 0.5) * dy;
        const r = radiusAtY(samples, yCenter);
        volume += Math.PI * r * r * dy;
    }

    return volume;
}

function getVisibleDiskCountFromSweep() {
    const { activeCount } = diskMethod;
    const angle = revolutionSolid.angle;
    if (activeCount <= 0 || angle <= 0) return 0;
    if (angle >= TAU) return activeCount;
    return Math.min(activeCount, Math.ceil((angle / TAU) * activeCount));
}

const diskMethod = {
    diskCount: 10,
    activeCount: 0,
    radialSegments: DISK_METHOD_RADIAL_SEGMENTS,
    approxVolume: 0,
    visibleDiskCount: 0,
    visibleIndexCount: 0,
    lastSamples: null,
    mesh: null,
    geometry: null,
    material: null,
    positions: null,
    normals: null,
    colors: null,
    indices: null,
    filteredIndices: null,
    rimRadialSegments: DISK_RIM_RADIAL_SEGMENTS,
    rimPositions: null,
    rimGeometry: null,
    rimLine: null,
    rimMaterial: null,
};

function rebuildDiskFilteredIndices() {
    const { indices, filteredIndices, radialSegments, geometry } = diskMethod;
    if (!indices || !filteredIndices || !geometry) return;

    const visibleDiskCount = isDiskMode() ? getVisibleDiskCountFromSweep() : 0;
    const indicesPerDisk = diskIndicesPerDisk(radialSegments);
    let dstOffset = 0;

    for (let k = 0; k < visibleDiskCount; k++) {
        const srcOffset = k * indicesPerDisk;
        for (let i = 0; i < indicesPerDisk; i++) {
            filteredIndices[dstOffset++] = indices[srcOffset + i];
        }
    }

    diskMethod.visibleDiskCount = visibleDiskCount;
    diskMethod.visibleIndexCount = dstOffset;
    geometry.setDrawRange(0, dstOffset);
    geometry.index.needsUpdate = true;
}

function applyDiskSweepFilter() {
    rebuildDiskFilteredIndices();

    if (diskMethod.lastSamples) {
        diskMethod.approxVolume = computeDiskApproxVolume(
            diskMethod.lastSamples,
            diskMethod.activeCount,
            diskMethod.visibleDiskCount
        );
    }

    applyDiskDrawRange();
    applyDiskRimDrawRange();
}

function writeDiskRimLoop(loopIndex, y, radius, radialSegments, direction, yOffset) {
    const positions = diskMethod.rimPositions;
    const r = Math.max(radius, 0.0005);
    const yLine = y + yOffset;
    const base = loopIndex * radialSegments * 3;

    for (let seg = 0; seg < radialSegments; seg++) {
        const phi = direction * (seg / radialSegments) * TAU;
        const vi = base + seg * 3;
        positions[vi] = r * Math.cos(phi);
        positions[vi + 1] = yLine;
        positions[vi + 2] = r * Math.sin(phi);
    }
}

function writeDiskRimPositions() {
    const { rimGeometry, activeCount, lastSamples } = diskMethod;
    if (!rimGeometry || !lastSamples || activeCount <= 0) return;

    const rimRadialSegments = diskMethod.rimRadialSegments;
    const yMin = lastSamples[0].y;
    const yMax = lastSamples[lastSamples.length - 1].y;
    const dy = (yMax - yMin) / activeCount;
    const halfHeight = dy * DISK_HEIGHT_GAP * 0.5;

    for (let k = 0; k < activeCount; k++) {
        const yCenter = yMin + (k + 0.5) * dy;
        const radius = radiusAtY(lastSamples, yCenter);
        const yBot = yCenter - halfHeight;
        const yTop = yCenter + halfHeight;

        writeDiskRimLoop(k * 2, yBot, radius, rimRadialSegments, 1, -DISK_RIM_DEPTH_OFFSET);
        writeDiskRimLoop(k * 2 + 1, yTop, radius, rimRadialSegments, 1, DISK_RIM_DEPTH_OFFSET);
    }

    rimGeometry.attributes.position.needsUpdate = true;
}

function applyDiskRimDrawRange() {
    const { rimLine, rimGeometry, rimRadialSegments, visibleDiskCount } = diskMethod;
    if (!rimLine || !rimGeometry) return;

    const showRims =
        isDiskMode() && visibleDiskCount > 0 && diskMethod.activeCount > 0;
    const visibleLoopCount = visibleDiskCount * 2;

    rimLine.visible = showRims;
    rimGeometry.setDrawRange(0, showRims ? visibleLoopCount * rimRadialSegments * 2 : 0);
}

function writeSingleDiskVertices(
    diskIndex,
    yCenter,
    radius,
    halfHeight,
    direction,
    radialSegments,
    yMin,
    yMax
) {
    const { positions, normals, colors } = diskMethod;
    const O = diskIndex * diskVertsPerDisk(radialSegments);
    const topRing = O + radialSegments + 1;
    const topCenter = O + radialSegments * 2 + 2;
    const bottomCenter = topCenter + 1;
    const r = Math.max(radius, 0.0005);
    const yBot = yCenter - halfHeight;
    const yTop = yCenter + halfHeight;

    for (let seg = 0; seg <= radialSegments; seg++) {
        const phi = direction * (seg / radialSegments) * TAU;
        const sin = Math.sin(phi);
        const cos = Math.cos(phi);
        const x = r * cos;
        const z = r * sin;

        let vi = (O + seg) * 3;
        positions[vi] = x;
        positions[vi + 1] = yBot;
        positions[vi + 2] = z;
        normals[vi] = cos;
        normals[vi + 1] = 0;
        normals[vi + 2] = sin;

        vi = (topRing + seg) * 3;
        positions[vi] = x;
        positions[vi + 1] = yTop;
        positions[vi + 2] = z;
        normals[vi] = cos;
        normals[vi + 1] = 0;
        normals[vi + 2] = sin;
    }

    let vi = topCenter * 3;
    positions[vi] = 0;
    positions[vi + 1] = yTop;
    positions[vi + 2] = 0;
    normals[vi] = 0;
    normals[vi + 1] = 1;
    normals[vi + 2] = 0;

    vi = bottomCenter * 3;
    positions[vi] = 0;
    positions[vi + 1] = yBot;
    positions[vi + 2] = 0;
    normals[vi] = 0;
    normals[vi + 1] = -1;
    normals[vi + 2] = 0;

    const rangeY = yMax - yMin || 1;
    const t = (yCenter - yMin) / rangeY;
    _gradientColorLow.set(REVOLUTION_GRADIENT_LOW);
    _gradientColorHigh.set(REVOLUTION_GRADIENT_HIGH);
    _gradientColorTmp.lerpColors(_gradientColorLow, _gradientColorHigh, t);

    for (let seg = 0; seg <= radialSegments; seg++) {
        writeDiskShadedVertexColor(O + seg, DISK_SIDE_COLOR_SCALE);
        writeDiskShadedVertexColor(topRing + seg, DISK_CAP_COLOR_SCALE);
    }
    writeDiskShadedVertexColor(topCenter, DISK_CAP_COLOR_SCALE);
    writeDiskShadedVertexColor(bottomCenter, DISK_SIDE_COLOR_SCALE);
}

function writeDiskShadedVertexColor(vertexIndex, scale) {
    const { colors } = diskMethod;
    const ci = vertexIndex * 3;
    colors[ci] = Math.min(1, _gradientColorTmp.r * scale);
    colors[ci + 1] = Math.min(1, _gradientColorTmp.g * scale);
    colors[ci + 2] = Math.min(1, _gradientColorTmp.b * scale);
}

function updateDiskMethod(samples) {
    if (!samples || samples.length < 2 || !diskMethod.positions) return;

    diskMethod.lastSamples = samples;

    // Surface mode: the disk mesh isn't rendered, so skip the full rewrite
    // (32 disks × positions/normals/colors + rims + GPU uploads) that would
    // otherwise run on every profile-edit frame. setRevolutionMode() always
    // re-invokes this with lastSamples when entering disk mode, so geometry
    // is rebuilt from the latest samples exactly when it becomes visible.
    if (!isDiskMode()) return;

    const count = THREE.MathUtils.clamp(
        diskMethod.diskCount,
        1,
        DISK_METHOD_MAX_DISKS
    );
    diskMethod.activeCount = count;

    const yMin = samples[0].y;
    const yMax = samples[samples.length - 1].y;
    const dy = (yMax - yMin) / count;
    const halfHeight = dy * DISK_HEIGHT_GAP * 0.5;
    const radialSegments = diskMethod.radialSegments;

    for (let k = 0; k < count; k++) {
        const yCenter = yMin + (k + 0.5) * dy;
        const radius = radiusAtY(samples, yCenter);
        writeSingleDiskVertices(
            k,
            yCenter,
            radius,
            halfHeight,
            1,
            radialSegments,
            yMin,
            yMax
        );
    }

    diskMethod.geometry.attributes.position.needsUpdate = true;
    diskMethod.geometry.attributes.normal.needsUpdate = true;
    diskMethod.geometry.attributes.color.needsUpdate = true;

    writeDiskRimPositions();
    applyDiskSweepFilter();
}

function applyDiskDrawRange() {
    const { mesh } = diskMethod;
    if (!mesh) return;

    const showDisks =
        isDiskMode() &&
        diskMethod.activeCount > 0 &&
        diskMethod.visibleIndexCount > 0;
    mesh.visible = showDisks;
}

function syncDiskMethodView() {
    const sweepVisible = getVisibleRadialSegments() > 0;
    const showDisks =
        isDiskMode() &&
        diskMethod.activeCount > 0 &&
        diskMethod.visibleIndexCount > 0;
    const showSurface = isSurfaceMode() && sweepVisible;
    const isPartial =
        revolutionSolid.angle > 0 && revolutionSolid.angle < TAU;

    if (diskMethod.mesh) {
        diskMethod.mesh.visible = showDisks;
    }
    if (diskMethod.rimLine) {
        applyDiskRimDrawRange();
    }
    if (revolutionSolid.mesh) {
        revolutionSolid.mesh.visible = showSurface;
        setRevolutionSolidOpacity(1);
    }
    if (revolutionGrid.lines) {
        revolutionGrid.lines.visible = showSurface;
    }
    if (revolutionOpenEdge.line) {
        revolutionOpenEdge.line.visible = showSurface && isPartial;
    }
}

function initDiskMethod() {
    const maxDisks = DISK_METHOD_MAX_DISKS;
    const radialSegments = DISK_METHOD_RADIAL_SEGMENTS;
    const vertexCount = maxDisks * diskVertsPerDisk(radialSegments);

    diskMethod.positions = new Float32Array(vertexCount * 3);
    diskMethod.normals = new Float32Array(vertexCount * 3);
    diskMethod.colors = new Float32Array(vertexCount * 3);
    diskMethod.indices = buildDiskMethodIndexBuffer(maxDisks, radialSegments);
    diskMethod.filteredIndices = new Uint16Array(
        maxDisks * diskIndicesPerDisk(radialSegments)
    );
    diskMethod.radialSegments = radialSegments;

    const geometry = new THREE.BufferGeometry();
    geometry.setIndex(new THREE.BufferAttribute(diskMethod.filteredIndices, 1));
    geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(diskMethod.positions, 3)
    );
    geometry.setAttribute(
        'normal',
        new THREE.BufferAttribute(diskMethod.normals, 3)
    );
    geometry.setAttribute(
        'color',
        new THREE.BufferAttribute(diskMethod.colors, 3)
    );

    const material = new THREE.MeshPhongMaterial({
        vertexColors: true,
        color: 0xffffff,
        specular: 0x442200,
        shininess: 80,
        side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = DISK_RENDER_ORDER;
    mesh.visible = false;

    diskMethod.geometry = geometry;
    diskMethod.material = material;
    diskMethod.mesh = mesh;
    solidGroup.add(mesh);

    const rimRadialSegments = DISK_RIM_RADIAL_SEGMENTS;
    const rimMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: DISK_RIM_OPACITY,
        depthTest: true,
        depthWrite: false,
    });

    // All rim loops (up to maxDisks * 2, bottom+top per disk) merged into a single
    // indexed LineSegments — one draw call instead of up to 64 separate LineLoop
    // objects. Each loop occupies a fixed rimRadialSegments-vertex block; index
    // pairs connect consecutive vertices within a block (wrapping, since LineLoop
    // auto-closed the loop back to its first point). Visible range is controlled
    // via setDrawRange, same pattern used elsewhere in this file.
    const rimLoopCount = maxDisks * 2;
    const rimPositions = new Float32Array(rimLoopCount * rimRadialSegments * 3);
    const rimIndices = new Uint16Array(rimLoopCount * rimRadialSegments * 2);
    let rimIndexOffset = 0;
    for (let loop = 0; loop < rimLoopCount; loop++) {
        const base = loop * rimRadialSegments;
        for (let seg = 0; seg < rimRadialSegments; seg++) {
            rimIndices[rimIndexOffset++] = base + seg;
            rimIndices[rimIndexOffset++] = base + ((seg + 1) % rimRadialSegments);
        }
    }

    const rimGeometry = new THREE.BufferGeometry();
    rimGeometry.setIndex(new THREE.BufferAttribute(rimIndices, 1));
    rimGeometry.setAttribute('position', new THREE.BufferAttribute(rimPositions, 3));
    rimGeometry.setDrawRange(0, 0);

    const rimLine = new THREE.LineSegments(rimGeometry, rimMaterial);
    rimLine.frustumCulled = false;
    rimLine.renderOrder = DISK_RENDER_ORDER;
    rimLine.visible = false;
    solidGroup.add(rimLine);

    diskMethod.rimRadialSegments = rimRadialSegments;
    diskMethod.rimMaterial = rimMaterial;
    diskMethod.rimPositions = rimPositions;
    diskMethod.rimGeometry = rimGeometry;
    diskMethod.rimLine = rimLine;
}

const profileParams = {
    size: 0.14,
};

const profileState = {
    mode: 'custom',
    activePreset: 'Custom',
};

let profilePresetApplying = false;

function handleAngleFromSweep(angle, direction) {
    if (angle <= 0) return 0;
    if (angle >= TAU) return 0;
    return direction > 0 ? angle : -angle;
}

function updateBottomCircleVisuals() {
    const radius = bottomCircleState.radius;

    writeBottomCircleRingGeometry(bottomCircleTrack.geometry, radius, TAU, 1);

    const { angle, direction } = revolutionSolid;
    if (angle <= 0) {
        bottomCircleProgress.visible = false;
    } else {
        bottomCircleProgress.visible = true;
        writeBottomCircleRingGeometry(bottomCircleProgress.geometry, radius, angle, direction);
    }

    bottomCircleState.handleAngle = handleAngleFromSweep(angle, direction);
    updateBottomCircleHandlePosition();
    updateArrowPlaneScale();
    syncArrowPlaneThresholdVisibility();
}

function getPinchAngleOnCirclePlane(hand) {
    const pinchWorld = getPinchWorldPosition(hand);
    containerGroup.worldToLocal(_pinchLocal.copy(pinchWorld));
    return Math.atan2(_pinchLocal.z, _pinchLocal.x);
}

function applyCircleHandleDelta(delta) {
    if (Math.abs(delta) < 1e-6) return;

    const motionDir = delta > 0 ? 1 : -1;
    const deltaMag = Math.abs(delta);
    let angle = revolutionSolid.angle;
    let direction = revolutionSolid.direction;

    if (motionDir === direction) {
        angle += deltaMag;
    } else {
        angle -= deltaMag;
        if (angle < 0) {
            angle = -angle;
            direction = motionDir;
        }
    }

    setRevolutionSweep(angle, direction);
}

function writeRevolutionRingPositions(count) {
    const { radialSegments, profileCount, profile2D, positions, normals, colors, initNormals, direction } = revolutionSolid;
    const ringCount = radialSegments + 1;
    const vertexCount = ringCount * profileCount;

    for (let ring = 0; ring <= radialSegments; ring++) {
        const phi = direction * (ring / radialSegments) * TAU;
        const sin = Math.sin(phi);
        const cos = Math.cos(phi);
        const ringOffset = ring * profileCount;

        for (let j = 0; j < count; j++) {
            const radius = profile2D[j].x;
            const vertIndex = (ringOffset + j) * 3;
            positions[vertIndex] = radius * cos;
            positions[vertIndex + 1] = profile2D[j].y;
            positions[vertIndex + 2] = radius * sin;

            const nx = initNormals[j * 3] * cos;
            const ny = initNormals[j * 3 + 1];
            const nz = initNormals[j * 3] * sin;
            normals[vertIndex] = nx;
            normals[vertIndex + 1] = ny;
            normals[vertIndex + 2] = nz;
        }
    }

    updateRevolutionVertexColors(positions, colors, vertexCount, profileCount);

    revolutionSolid.geometry.attributes.position.needsUpdate = true;
    revolutionSolid.geometry.attributes.normal.needsUpdate = true;
    revolutionSolid.geometry.attributes.color.needsUpdate = true;
    if (revolutionGrid.geometry) {
        revolutionGrid.geometry.attributes.position.needsUpdate = true;
    }
}

function setRevolutionSweep(angle, direction, { allowSubSnap = false } = {}) {
    const prevDirection = revolutionSolid.direction;
    if (!allowSubSnap && angle < REVOLUTION_ANGLE_SNAP) {
        angle = 0;
    }
    revolutionSolid.angle = THREE.MathUtils.clamp(angle, 0, TAU);
    revolutionSolid.direction = direction < 0 ? -1 : 1;

    if (prevDirection !== revolutionSolid.direction) {
        // Direction flips mirror the ring positions; only pay for the rewrite
        // when the lathe is actually visible (surface mode), otherwise defer.
        if (isSurfaceMode()) {
            writeRevolutionRingPositions(revolutionSolid.activeProfileCount);
        } else {
            revolutionSolid.profileDirty = true;
        }
        if (diskMethod.lastSamples) {
            updateDiskMethod(diskMethod.lastSamples);
        }
    }

    applyRevolutionDrawRange();
    applyDiskSweepFilter();
    updateBottomCircleVisuals();
}

const sweepRevealAnim = {
    active: false,
    angle: 0,
};

function isRevolutionSweepHidden() {
    return revolutionSolid.angle < REVOLUTION_ANGLE_SNAP;
}

function cancelSweepRevealAnimation() {
    if (!sweepRevealAnim.active) return;
    gsap.killTweensOf(sweepRevealAnim);
    sweepRevealAnim.active = false;
}

function beginSweepRevealAnimation() {
    if (sweepRevealAnim.active || !isDiskMode() || !isRevolutionSweepHidden()) return;

    sweepRevealAnim.active = true;
    sweepRevealAnim.angle = revolutionSolid.angle;
    const direction = revolutionSolid.direction;

    gsap.killTweensOf(sweepRevealAnim);
    gsap.to(sweepRevealAnim, {
        angle: TAU,
        duration: SWEEP_REVEAL_DURATION,
        ease: 'sine.inOut',
        onUpdate: () => {
            setRevolutionSweep(sweepRevealAnim.angle, direction, { allowSubSnap: true });
        },
        onComplete: () => {
            setRevolutionSweep(TAU, direction);
            sweepRevealAnim.active = false;
        }
    });
}


function updateRevolutionSolidProfile(samples) {
    const { profileCount, profile2D, initNormals } = revolutionSolid;
    const count = Math.min(samples.length, profileCount);
    revolutionSolid.activeProfileCount = count;

    // Always keep profile2D + normals current (cheap: one pass over ~64
    // samples) so a deferred ring rebuild only needs writeRevolutionRingPositions.
    for (let i = 0; i < count; i++) {
        profile2D[i].set(samples[i].x, samples[i].y);
    }
    computeProfileNormals2D(profile2D, count, initNormals);

    // Disk mode: the lathe mesh, grid, and open edge are all hidden — skip
    // the full ring rewrite (41 rings × 64 points × pos/normal/color + GPU
    // uploads) per edit frame. setRevolutionMode() rebuilds on returning to
    // surface mode via the profileDirty flag.
    if (!isSurfaceMode()) {
        revolutionSolid.profileDirty = true;
        return;
    }

    revolutionSolid.profileDirty = false;
    writeRevolutionRingPositions(count);
    applyRevolutionDrawRange();
}

initRevolutionSolid();
initDiskMethod();

const AXIS_ENDPOINT_MIN_GAP = 0.04;

function isAxisLockedEndpoint(index) {
    return index === 0 || index === controlPoints.length - 1;
}

function clampAxisEndpoint(point, index) {
    if (index === 0) {
        const maxY = controlPoints[controlPoints.length - 1].y - AXIS_ENDPOINT_MIN_GAP;
        point.y = Math.min(maxY, point.y);
    } else if (index === controlPoints.length - 1) {
        const minY = controlPoints[0].y + AXIS_ENDPOINT_MIN_GAP;
        point.y = Math.max(minY, point.y);
    }

    point.x = 0;
    point.z = 0;
    return point;
}

function clampProfilePoint(point, index = -1) {
    if (index >= 0 && isAxisLockedEndpoint(index)) {
        return clampAxisEndpoint(point, index);
    }

    point.x = Math.max(MIN_PROFILE_RADIUS, point.x);
    point.z = 0;
    return point;
}

function enforceAxisEndpoints() {
    clampAxisEndpoint(controlPoints[0], 0);
    clampAxisEndpoint(controlPoints[controlPoints.length - 1], controlPoints.length - 1);
}

const curveSampleLocal = [];
const _curveHitLocal = new THREE.Vector3();

// Reused sample vectors for custom mode. profileCurve.getPoints() allocates
// a fresh Vector3 per sample (65 allocs per call) and runs on every drag
// frame; sampling with getPoint(t, target) into these instead is alloc-free.
const _customCurveSamples = Array.from(
    { length: PROFILE_CURVE_SAMPLES + 1 },
    () => new THREE.Vector3()
);

function updateProfileCurve() {
    if (profileState.mode === 'custom') {
        enforceAxisEndpoints();
        for (let i = 0; i <= PROFILE_CURVE_SAMPLES; i++) {
            profileCurve.getPoint(i / PROFILE_CURVE_SAMPLES, _customCurveSamples[i]);
        }
        for (let i = 0; i < handles.length; i++) {
            handles[i].visible = true;
            handles[i].position.copy(controlPoints[i]);
        }
        applyProfileSamples(_customCurveSamples);
        return;
    }

    const preset = ANALYTIC_PROFILE_PRESETS[profileState.activePreset];
    if (!preset) {
        return;
    }

    for (let i = 0; i < handles.length; i++) {
        handles[i].visible = false;
    }

    const size = clampAnalyticProfileSize(
        profileParams.size,
        profileState.activePreset
    );
    const samples = preset.sample(PROFILE_CURVE_SAMPLES, { size });
    applyProfileSamples(clampAnalyticProfileSamples(samples));
}

function applyProfileSamples(samples) {
    curveSampleLocal.length = 0;
    curveSampleLocal.push(...samples);

    writeCurveLinePositions(curveSampleLocal);

    updateBottomCircle(curveSampleLocal);
    updateRevolutionSolidProfile(curveSampleLocal);
    updateDiskMethod(curveSampleLocal);
}

const ANALYTIC_Y0 = -0.18;
const ANALYTIC_Y1 = 0.18;
const ANALYTIC_R = 0.14;
const ANALYTIC_SPHERE_R = 0.18;
const ANALYTIC_HYP_A = 0.05;
const ANALYTIC_HYP_B = 0.65;
const ANALYTIC_H = ANALYTIC_Y1 - ANALYTIC_Y0;
const ANALYTIC_Y_MID = (ANALYTIC_Y0 + ANALYTIC_Y1) * 0.5;
const PROFILE_SIZE_MIN = 0.03;
const PROFILE_SIZE_STEP = 0.005;
const SPHERE_R_SCALE = ANALYTIC_SPHERE_R / ANALYTIC_R;
const HYP_A_SCALE = ANALYTIC_HYP_A / ANALYTIC_R;
const PARABOLOID_EXPONENT = 0.5;
const _analyticSampleVec = new THREE.Vector3();

function clampProfileSampleRadius(r) {
    const clamped = Math.min(deps.PROFILE_RADIUS_LIMIT, Math.max(0, r));
    return clamped <= AXIS_RADIUS_EPSILON ? 0 : clamped;
}

function samplePolylineProfile(vertices, sampleCount) {
    const segmentLengths = [];
    let totalLength = 0;

    for (let i = 0; i < vertices.length - 1; i++) {
        const dr = vertices[i + 1][0] - vertices[i][0];
        const dy = vertices[i + 1][1] - vertices[i][1];
        const len = Math.hypot(dr, dy);
        segmentLengths.push(len);
        totalLength += len;
    }

    const samples = [];
    const lastIndex = sampleCount - 1;

    for (let s = 0; s < sampleCount; s++) {
        const target = lastIndex === 0 ? 0 : (s / lastIndex) * totalLength;
        let walked = 0;

        for (let i = 0; i < segmentLengths.length; i++) {
            const segLen = segmentLengths[i];
            if (i === segmentLengths.length - 1 || walked + segLen >= target) {
                const t = segLen > 0 ? (target - walked) / segLen : 0;
                const r = vertices[i][0] + t * (vertices[i + 1][0] - vertices[i][0]);
                const y = vertices[i][1] + t * (vertices[i + 1][1] - vertices[i][1]);
                _analyticSampleVec.set(clampProfileSampleRadius(r), y, 0);
                samples.push(_analyticSampleVec.clone());
                break;
            }
            walked += segLen;
        }
    }

    if (samples.length > 0) {
        samples[0].set(
            clampProfileSampleRadius(vertices[0][0]),
            vertices[0][1],
            0
        );
        const lastVertex = vertices[vertices.length - 1];
        samples[samples.length - 1].set(
            clampProfileSampleRadius(lastVertex[0]),
            lastVertex[1],
            0
        );
    }

    return samples;
}

function sampleSemicircleProfile(radius, sampleCount) {
    const samples = [];
    const lastIndex = sampleCount - 1;

    for (let i = 0; i < sampleCount; i++) {
        const theta = -Math.PI / 2 + (i / lastIndex) * Math.PI;
        samples.push(new THREE.Vector3(
            clampProfileSampleRadius(radius * Math.cos(theta)),
            radius * Math.sin(theta),
            0
        ));
    }

    return samples;
}

function sampleFunctionProfile(rAtY, yStart, yEnd, sampleCount) {
    const samples = [];
    const lastIndex = sampleCount - 1;

    for (let i = 0; i < sampleCount; i++) {
        const t = lastIndex === 0 ? 0 : i / lastIndex;
        const y = yStart + t * (yEnd - yStart);
        const r = rAtY(y);
        samples.push(new THREE.Vector3(clampProfileSampleRadius(r), y, 0));
    }

    if (samples.length > 0) {
        samples[0].set(clampProfileSampleRadius(rAtY(yStart)), yStart, 0);
        samples[samples.length - 1].set(clampProfileSampleRadius(rAtY(yEnd)), yEnd, 0);
    }

    return samples;
}

const ANALYTIC_PROFILE_PRESETS = {
    // Cylinder: r = R
    'r = R': {
        sample(sampleCount, p = {}) {
            const R = p.size ?? ANALYTIC_R;
            return samplePolylineProfile([
                [0, ANALYTIC_Y0],
                [R, ANALYTIC_Y0],
                [R, ANALYTIC_Y1],
                [0, ANALYTIC_Y1],
            ], sampleCount);
        },
    },
    // Cone: r = R * (y1 - y) / h
    'r = R*(y1-y)/h': {
        sample(sampleCount, p = {}) {
            const R = p.size ?? ANALYTIC_R;
            return samplePolylineProfile([
                [0, ANALYTIC_Y0],
                [R, ANALYTIC_Y0],
                [0, ANALYTIC_Y1],
            ], sampleCount);
        },
    },
    // Sphere: r = sqrt(R^2 - y^2)
    'r = sqrt(R^2 - y^2)': {
        sample(sampleCount, p = {}) {
            const R = (p.size ?? ANALYTIC_R) * SPHERE_R_SCALE;
            return sampleSemicircleProfile(R, sampleCount);
        },
    },
    // Hyperboloid of one sheet: r = sqrt(a² + b²*(y-c)²)
    'r = sqrt(a² + b²*(y-c)²)': {
        sample(sampleCount, p = {}) {
            const size = p.size ?? ANALYTIC_R;
            const a = size * HYP_A_SCALE;
            const b = ANALYTIC_HYP_B;
            return sampleFunctionProfile(
                (y) => {
                    const dy = y - ANALYTIC_Y_MID;
                    return Math.sqrt(a * a + b * b * dy * dy);
                },
                ANALYTIC_Y0,
                ANALYTIC_Y1,
                sampleCount
            );
        },
    },
    // Paraboloid-ish: r = c*sqrt(y - y0)
    'r = c*sqrt(y - y0)': {
        sample(sampleCount, p = {}) {
            const c = p.size ?? ANALYTIC_R;
            const exponent = PARABOLOID_EXPONENT;
            return sampleFunctionProfile(
                (y) => {
                    const t = Math.max(0, (y - ANALYTIC_Y0) / ANALYTIC_H);
                    return c * Math.pow(t, exponent);
                },
                ANALYTIC_Y0,
                ANALYTIC_Y1,
                sampleCount
            );
        },
    },
};

const ANALYTIC_PRESET_NAMES = Object.keys(ANALYTIC_PROFILE_PRESETS);

const PROFILE_STEPPER_MODES = [
    { label: 'Freeform Edit', preset: 'Custom' },
    { label: 'Cylinder', preset: 'r = R' },
    { label: 'Cone', preset: 'r = R*(y1-y)/h' },
    { label: 'Sphere', preset: 'r = sqrt(R^2 - y^2)' },
    { label: 'Hyperboloid', preset: 'r = sqrt(a² + b²*(y-c)²)' },
    { label: 'Paraboloid', preset: 'r = c*sqrt(y - y0)' },
];

function getProfileStepperIndex() {
    for (let i = 0; i < PROFILE_STEPPER_MODES.length; i++) {
        const mode = PROFILE_STEPPER_MODES[i];
        if (mode.preset === 'Custom') {
            if (profileState.mode === 'custom') return i;
        } else if (
            profileState.mode === 'analytic' &&
            profileState.activePreset === mode.preset
        ) {
            return i;
        }
    }
    return 0;
}

function getProfileStepperLabel() {
    return PROFILE_STEPPER_MODES[getProfileStepperIndex()].label;
}

function stepProfileMode(delta) {
    const count = PROFILE_STEPPER_MODES.length;
    const nextIndex = (getProfileStepperIndex() + delta + count) % count;
    applyProfilePreset(PROFILE_STEPPER_MODES[nextIndex].preset);
}

function getMaxAnalyticProfileSize(presetName) {
    switch (presetName) {
        case 'r = sqrt(R^2 - y^2)':
            return Math.min(deps.PROFILE_RADIUS_LIMIT, deps.PROFILE_Y_LIMIT) / SPHERE_R_SCALE;
        case 'r = sqrt(a² + b²*(y-c)²)': {
            const dy = Math.max(
                Math.abs(ANALYTIC_Y0 - ANALYTIC_Y_MID),
                Math.abs(ANALYTIC_Y1 - ANALYTIC_Y_MID)
            );
            const radialSq =
                deps.PROFILE_RADIUS_LIMIT * deps.PROFILE_RADIUS_LIMIT -
                ANALYTIC_HYP_B * ANALYTIC_HYP_B * dy * dy;
            if (radialSq <= 0) {
                return PROFILE_SIZE_MIN;
            }
            return Math.sqrt(radialSq) / HYP_A_SCALE;
        }
        default:
            return deps.PROFILE_RADIUS_LIMIT;
    }
}

function getGlobalMaxAnalyticProfileSize() {
    let maxSize = deps.PROFILE_RADIUS_LIMIT;
    for (let i = 0; i < ANALYTIC_PRESET_NAMES.length; i++) {
        maxSize = Math.min(maxSize, getMaxAnalyticProfileSize(ANALYTIC_PRESET_NAMES[i]));
    }
    return maxSize;
}

function clampAnalyticProfileSize(size, presetName = profileState.activePreset) {
    const maxSize = profileState.mode === 'analytic'
        ? getMaxAnalyticProfileSize(presetName)
        : getGlobalMaxAnalyticProfileSize();
    return THREE.MathUtils.clamp(size, PROFILE_SIZE_MIN, maxSize);
}

function clampAnalyticProfileSamples(samples) {
    for (let i = 0; i < samples.length; i++) {
        samples[i].x = clampProfileSampleRadius(samples[i].x);
        samples[i].y = THREE.MathUtils.clamp(
            samples[i].y,
            -deps.PROFILE_Y_LIMIT,
            deps.PROFILE_Y_LIMIT
        );
    }
    return samples;
}

function syncProfileSizeSlider() {
    profileParams.size = clampAnalyticProfileSize(profileParams.size);
    deps.syncSliderOne();
}

function isProfileCustomEditable() {
    return profileState.mode === 'custom';
}

function markProfileCustom() {
    if (profilePresetApplying || profileState.mode === 'custom') {
        return;
    }
    profileState.mode = 'custom';
    profileState.activePreset = 'Custom';
    for (let i = 0; i < handles.length; i++) {
        handles[i].visible = true;
    }
    profileCurve.points = controlPoints;
    if (typeof deps.updateMenuPresetLabel === 'function') {
        deps.updateMenuPresetLabel(getProfileStepperLabel());
    }
    if (typeof deps.syncSliderOne === 'function') deps.syncSliderOne();
    updateHeaderPlane();
}

function applyProfilePreset(presetName) {
    profilePresetApplying = true;

    if (presetName === 'Custom') {
        profileState.mode = 'custom';
        profileState.activePreset = 'Custom';
        for (let i = 0; i < handles.length; i++) {
            handles[i].visible = true;
        }
        profileCurve.points = controlPoints;
        updateProfileCurve();
    } else if (ANALYTIC_PROFILE_PRESETS[presetName]) {
        if (pointDrag.active) {
            endPointDrag();
        }
        profileState.mode = 'analytic';
        profileState.activePreset = presetName;
        syncProfileSizeSlider();
        updateProfileCurve();
    }

    profilePresetApplying = false;
    if (typeof deps.updateMenuPresetLabel === 'function') {
        deps.updateMenuPresetLabel(getProfileStepperLabel());
    }
    if (typeof deps.syncSliderOne === 'function') deps.syncSliderOne();
    updateHeaderPlane();
}


const pointDrag = {
    active: false,
    hand: null,
    pointIndex: -1,
    initialPinchLocal: new THREE.Vector3(),
    initialPointPos: new THREE.Vector3(),
};

const _pinchWorld = new THREE.Vector3();
const _pinchLocal = new THREE.Vector3();
const _handleWorld = new THREE.Vector3();
const _dragDelta = new THREE.Vector3();
const _thumbPos = new THREE.Vector3();
const _indexPos = new THREE.Vector3();
const _segA = new THREE.Vector3();
const _segB = new THREE.Vector3();
const _segClosest = new THREE.Vector3();
const _segAB = new THREE.Vector3();
const _segAP = new THREE.Vector3();
const _targetHandleWorld = new THREE.Vector3();

const interactionState = {
    prevLeftPinch: false,
    prevRightPinch: false,
    wasBothPinching: false,
    /** Per-hand: suppress new grabs until this hand fully opens (after merge or two-hand manip). */
    suppressGrabUntilRelease: { left: false, right: false },
};

function distancePointToSegmentSquared(point, a, b) {
    _segAB.subVectors(b, a);
    const lengthSq = _segAB.lengthSq();
    if (lengthSq === 0) {
        return point.distanceToSquared(a);
    }
    const t = Math.max(0, Math.min(1, _segAP.subVectors(point, a).dot(_segAB) / lengthSq));
    return point.distanceToSquared(_segClosest.copy(a).addScaledVector(_segAB, t));
}

function findClosestPointOnCurve(pinchWorld) {
    const addRadiusSq = CURVE_ADD_RADIUS * CURVE_ADD_RADIUS;
    let bestDistSq = addRadiusSq;
    let bestSegmentIndex = -1;

    for (let i = 0; i < curveSampleLocal.length - 1; i++) {
        profileGroup.localToWorld(_segA.copy(curveSampleLocal[i]));
        profileGroup.localToWorld(_segB.copy(curveSampleLocal[i + 1]));
        const distSq = distancePointToSegmentSquared(pinchWorld, _segA, _segB);
        if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestSegmentIndex = i;
            _segAB.subVectors(_segB, _segA);
            const lengthSq = _segAB.lengthSq();
            const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, _segAP.subVectors(pinchWorld, _segA).dot(_segAB) / lengthSq));
            containerGroup.worldToLocal(_curveHitLocal.copy(_segClosest.copy(_segA).addScaledVector(_segAB, t)));
        }
    }

    if (bestSegmentIndex < 0) {
        return null;
    }

    const tAlongCurve = bestSegmentIndex / (curveSampleLocal.length - 1);
    let insertIndex = 1;
    for (let i = 0; i < controlPoints.length - 1; i++) {
        const t0 = i / (controlPoints.length - 1);
        const t1 = (i + 1) / (controlPoints.length - 1);
        if (tAlongCurve >= t0 && tAlongCurve <= t1) {
            insertIndex = i + 1;
            break;
        }
    }

    insertIndex = Math.max(1, Math.min(controlPoints.length - 1, insertIndex));

    return {
        localPoint: clampProfilePoint(_curveHitLocal.clone()),
        insertIndex,
    };
}

function setHandleHighlight(index) {
    handles.forEach((handle, i) => {
        handle.material = i === index ? handleGrabMaterial : handleMaterial;
    });
}

function setHandleDragHighlight(draggedIndex, mergeTargetIndex) {
    handles.forEach((handle, i) => {
        if (i === draggedIndex) {
            handle.material = handleGrabMaterial;
        } else if (i === mergeTargetIndex) {
            handle.material = handleMergeTargetMaterial;
        } else {
            handle.material = handleMaterial;
        }
    });
}

function clearHandleHighlight() {
    handles.forEach((handle) => {
        handle.material = handleMaterial;
    });
}

function findMergeTargetIndex(draggedIndex) {
    if (isAxisLockedEndpoint(draggedIndex)) {
        return -1;
    }

    const mergeDistSq = MERGE_SNAP_DISTANCE * MERGE_SNAP_DISTANCE;
    handles[draggedIndex].getWorldPosition(_handleWorld);
    let targetIndex = -1;
    let nearestDistSq = mergeDistSq;

    for (let i = 0; i < handles.length; i++) {
        if (i === draggedIndex) {
            continue;
        }
        handles[i].getWorldPosition(_targetHandleWorld);
        const distSq = _handleWorld.distanceToSquared(_targetHandleWorld);
        if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            targetIndex = i;
        }
    }

    return targetIndex;
}

function mergePointIntoTarget(sourceIndex, targetIndex) {
    if (sourceIndex === targetIndex || isAxisLockedEndpoint(sourceIndex)) {
        return -1;
    }

    const lo = Math.min(sourceIndex, targetIndex);
    const hi = Math.max(sourceIndex, targetIndex);
    const indicesToRemove = [];

    for (let i = lo; i <= hi; i++) {
        if (i !== targetIndex && !isAxisLockedEndpoint(i)) {
            indicesToRemove.push(i);
        }
    }

    if (controlPoints.length - indicesToRemove.length < MIN_CONTROL_POINTS) {
        return -1;
    }

    indicesToRemove.sort((a, b) => b - a);
    for (const i of indicesToRemove) {
        profileGroup.remove(handles[i]);
        handles.splice(i, 1);
        controlPoints.splice(i, 1);
    }

    profileCurve.points = controlPoints;
    markProfileCustom();
    updateProfileCurve();

    // Target is never removed; its index shifts down by removals below it.
    return targetIndex - indicesToRemove.filter((i) => i < targetIndex).length;
}

function getPinchWorldPosition(hand) {
    if (hand === 'left') {
        _thumbPos.copy(deps.lThumbObj.position);
        _indexPos.copy(deps.lIndexObj.position);
    } else {
        _thumbPos.copy(deps.rThumbObj.position);
        _indexPos.copy(deps.rIndexObj.position);
    }
    return _pinchWorld.addVectors(_thumbPos, _indexPos).multiplyScalar(0.5);
}

function findNearestHandleIndex(pinchWorld) {
    const grabRadiusSq = GRAB_RADIUS * GRAB_RADIUS;
    let nearestIndex = -1;
    let nearestDistSq = grabRadiusSq;

    for (let i = 0; i < handles.length; i++) {
        handles[i].getWorldPosition(_handleWorld);
        const distSq = pinchWorld.distanceToSquared(_handleWorld);
        if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearestIndex = i;
        }
    }

    return nearestIndex;
}

function beginPointDrag(hand, { allowAddPoint = true } = {}) {
    if (!isProfileCustomEditable()) {
        return false;
    }

    const pinchWorld = getPinchWorldPosition(hand);
    containerGroup.worldToLocal(_pinchLocal.copy(pinchWorld));

    let pointIndex = findNearestHandleIndex(pinchWorld);

    if (pointIndex < 0 && allowAddPoint && controlPoints.length < MAX_CONTROL_POINTS) {
        const onCurve = findClosestPointOnCurve(pinchWorld);
        if (!onCurve) {
            return false;
        }

        controlPoints.splice(onCurve.insertIndex, 0, onCurve.localPoint);
        const newHandle = new THREE.Mesh(handleGeometry, handleMaterial);
        newHandle.renderOrder = deps.HANDLE_RENDER_ORDER;
        newHandle.frustumCulled = false;
        newHandle.position.copy(onCurve.localPoint);
        handles.splice(onCurve.insertIndex, 0, newHandle);
        profileGroup.add(newHandle);
        profileCurve.points = controlPoints;
        pointIndex = onCurve.insertIndex;
        markProfileCustom();
        updateProfileCurve();
    }

    if (pointIndex < 0) {
        return false;
    }

    pointDrag.active = true;
    pointDrag.hand = hand;
    pointDrag.pointIndex = pointIndex;
    pointDrag.initialPinchLocal.copy(_pinchLocal);
    pointDrag.initialPointPos.copy(controlPoints[pointIndex]);
    setHandleHighlight(pointIndex);
    return true;
}

function updatePointDrag(hand) {
    const pinchWorld = getPinchWorldPosition(hand);
    const pointIndex = pointDrag.pointIndex;
    containerGroup.worldToLocal(_pinchLocal.copy(pinchWorld));
    _dragDelta.copy(_pinchLocal).sub(pointDrag.initialPinchLocal);
    controlPoints[pointIndex].copy(pointDrag.initialPointPos);

    if (isAxisLockedEndpoint(pointIndex)) {
        controlPoints[pointIndex].y += _dragDelta.y;
        clampProfilePoint(controlPoints[pointIndex], pointIndex);
    } else {
        controlPoints[pointIndex].add(_dragDelta);
        clampProfilePoint(controlPoints[pointIndex], pointIndex);
    }

    markProfileCustom();
    updateProfileCurve();

    const mergeTarget = findMergeTargetIndex(pointDrag.pointIndex);
    if (mergeTarget >= 0) {
        setHandleDragHighlight(pointDrag.pointIndex, mergeTarget);
        const sourceIndex = pointDrag.pointIndex;
        const mergingHand = pointDrag.hand;
        const survivingIndex = mergePointIntoTarget(sourceIndex, mergeTarget);
        if (survivingIndex >= 0 && mergingHand) {
            // Keep dragging the surviving point — no suppress-until-release,
            // which forced the user to fully open their pinch before re-grabbing.
            const pinchWorld = getPinchWorldPosition(mergingHand);
            containerGroup.worldToLocal(_pinchLocal.copy(pinchWorld));
            pointDrag.active = true;
            pointDrag.hand = mergingHand;
            pointDrag.pointIndex = survivingIndex;
            pointDrag.initialPinchLocal.copy(_pinchLocal);
            pointDrag.initialPointPos.copy(controlPoints[survivingIndex]);
            setHandleHighlight(survivingIndex);
        }
        return;
    }

    setHandleHighlight(pointDrag.pointIndex);
}

function endPointDrag() {
    pointDrag.active = false;
    pointDrag.hand = null;
    pointDrag.pointIndex = -1;
    clearHandleHighlight();
}

const circleHandleDrag = {
    active: false,
    hand: null,
    prevPinchAngle: 0,
};

function isPinchNearCircleHandle(pinchWorld) {
    circleHandle.getWorldPosition(_handleWorld);
    return pinchWorld.distanceToSquared(_handleWorld) < GRAB_RADIUS * GRAB_RADIUS;
}

function setCircleHandleHighlight(active) {
    circleHandle.material = active ? circleHandleGrabMaterial : circleHandleMaterial;
}

function updateCircleHandleAngleFromPinch(hand) {
    const currentAngle = getPinchAngleOnCirclePlane(hand);

    if (
        Math.abs(currentAngle) < REVOLUTION_ANGLE_SNAP &&
        revolutionSolid.angle < REVOLUTION_ANGLE_SNAP * 2
    ) {
        setRevolutionSweep(0, revolutionSolid.direction);
        circleHandleDrag.prevPinchAngle = 0;
        return;
    }

    let delta = currentAngle - circleHandleDrag.prevPinchAngle;
    if (delta > Math.PI) delta -= TAU;
    if (delta < -Math.PI) delta += TAU;
    applyCircleHandleDelta(delta);
    circleHandleDrag.prevPinchAngle = currentAngle;
}

function beginCircleHandleDrag(hand) {
    cancelSweepRevealAnimation();
    circleHandleDrag.active = true;
    circleHandleDrag.hand = hand;
    circleHandleDrag.prevPinchAngle = getPinchAngleOnCirclePlane(hand);
    setCircleHandleHighlight(true);
}

function endCircleHandleDrag() {
    if (revolutionSolid.angle < REVOLUTION_ANGLE_SNAP) {
        setRevolutionSweep(0, revolutionSolid.direction);
    }
    circleHandleDrag.active = false;
    circleHandleDrag.hand = null;
    setCircleHandleHighlight(false);
    fadeOutArrowPlane();
}

/**
 * Attempt to start a circle-handle or point-handle drag.
 * allowAddPoint: only true on the pinch-start frame — adding a curve point
 * while continuously pinching would spam new control points.
 */
function tryBeginProfileInteraction(hand, { allowAddPoint = false } = {}) {
    if (interactionState.suppressGrabUntilRelease[hand]) {
        return false;
    }

    const pinchWorld = getPinchWorldPosition(hand);

    if (isPinchNearCircleHandle(pinchWorld)) {
        return beginCircleHandleDrag(hand);
    }

    return beginPointDrag(hand, { allowAddPoint });
}

function applySingleHandInteractions() {
    if (deps.activeMenuSlider) return;

    const leftOnly = deps.pinchState.left && !deps.pinchState.right;
    const rightOnly = deps.pinchState.right && !deps.pinchState.left;
    const activeHand = leftOnly ? 'left' : rightOnly ? 'right' : null;
    const leftPinchStarted = deps.pinchState.left && !interactionState.prevLeftPinch;
    const rightPinchStarted = deps.pinchState.right && !interactionState.prevRightPinch;

    if (!activeHand) {
        if (circleHandleDrag.active) {
            endCircleHandleDrag();
        }
        if (pointDrag.active) {
            endPointDrag();
        }
    } else if (circleHandleDrag.active) {
        if (circleHandleDrag.hand !== activeHand) {
            endCircleHandleDrag();
        } else {
            updateCircleHandleAngleFromPinch(activeHand);
        }
    } else if (pointDrag.active) {
        if (pointDrag.hand !== activeHand) {
            endPointDrag();
        } else {
            updatePointDrag(activeHand);
        }
    } else {
        const pinchJustStarted = activeHand === 'left' ? leftPinchStarted : rightPinchStarted;
        if (pinchJustStarted) {
            tryBeginProfileInteraction(activeHand, { allowAddPoint: true });
        } else {
            // Retry every frame while pinching — recovers from missed settle
            // windows and slightly-off first-frame grabs without requiring a
            // full release. Curve-point creation stays edge-triggered above.
            tryBeginProfileInteraction(activeHand, { allowAddPoint: false });
        }
    }

    interactionState.prevLeftPinch = deps.pinchState.left;
    interactionState.prevRightPinch = deps.pinchState.right;
}


    const api = {
        BOTTOM_CIRCLE_Y,
        INTERACTION_KNOB_RADIUS,
        revolutionMode,
        menuToggleActiveOption,
        menuToggleUiReady,
        profileState,
        profileParams,
        PROFILE_SIZE_MIN,
        PROFILE_SIZE_STEP,
        interactionState,
        pointDrag,
        circleHandleDrag,
        DISK_METHOD_MAX_DISKS,
        diskMethod,
        isSurfaceMode,
        isDiskMode,
        isRevolutionSweepHidden,
        setRevolutionMode,
        applyProfilePreset,
        stepProfileMode,
        getProfileStepperLabel,
        getMaxAnalyticProfileSize,
        getGlobalMaxAnalyticProfileSize,
        clampAnalyticProfileSize,
        beginSweepRevealAnimation,
        updateProfileCurve,
        updateDiskMethod,
        syncCircleHandleScale,
        applySingleHandInteractions,
        endPointDrag,
        endCircleHandleDrag
    };
    Object.assign(deps, api);
    Object.defineProperty(deps, 'menuToggleActiveOption', {
        configurable: true,
        enumerable: true,
        get: () => menuToggleActiveOption,
        set: (v) => { menuToggleActiveOption = v; },
    });
    Object.defineProperty(deps, 'menuToggleUiReady', {
        configurable: true,
        enumerable: true,
        get: () => menuToggleUiReady,
        set: (v) => { menuToggleUiReady = v; },
    });
    return api;
}
