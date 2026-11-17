import * as THREE from 'three';
import gsap from 'gsap';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';

export function createSpringConfig(deps) {
    const { scene } = deps;

const springConfig = {
    /** Inset (m) between bob bottom and cube bottom at max stretch; cube height is derived from travel */
    containerVisualBottomPad: 0.006,
    /** Back wireframe square (width × height); synced to containerVisualSize after init */
    backPlaneSize: 0.38,
    /** Cube center X/Z; world Y comes from springAttachWorldY − containerVisualSize/2 */
    containerPosition: new THREE.Vector3(0, 0, -1.1),
    /**
     * Uniform scale of the whole comp at launch (same as two-hand pinch on containerGroup).
     * 1 = default size; two-hand scaling multiplies from this value at runtime.
     */
    compositionScale: 0.65,
    /** World Y of the spring attachment (top interior of the visual cube) */
    springAttachWorldY: 1.7,
    mass: 1.0,
    /** Equilibrium distance from anchor to mass center along −Y (m) */
    restLength: 0.22,
    /** Spring constant k (m·u'' = −k·u − c·v); u = stretch past equilibrium */
    springStiffness: 32,
    /**
     * Damping ratio ζ = c / (2√(km)). ζ = 0 undamped, ζ = 1 critical, ζ > 1 overdamped.
     * Drives linearDamping via syncSpringLinearDamping().
     */
    dampingRatio: 0,
    /** Linear damping c (N·s/m); synced from dampingRatio — do not set directly. */
    linearDamping: 0,
    /** Yellow mass cylinder: radius = diameter/2, height along spring axis */
    massRadius: 0.0225,
    massHeight: 0.02,
    /** Root / anchor ball (visual only) */
    pivotRadius: 0.005,
    /** Helix radius and turns (visual); > massRadius + springWireRadius so coils clear the mass */
    springHelixRadius: 0.022,
    springTurns: 9,
    /** Tube cross-section radius for the coil wire (m) */
    springWireRadius: 0.0014,
    /** Simulation speed vs wall clock: 1 = real-time, >1 faster, <1 slower */
    timeScale: 0.75,
    /** Scales hand-derived velocity while dragging / on release */
    throwVelocityGain: 0.9,
    /** Max |velocity| (m/s) along spring from hand throw */
    maxThrowVelocity: 2.2,
    throwVelocitySmoothing: 0.3,
    /** Minimum dt (s) when estimating du/dt */
    throwMinDt: 1 / 90,
    /** Extra distance (m) past the box back face (−Z) for the reference wireframe (positive = further back) */
    backPlaneDrop: 0.22,
    /** Extra distance (m) past the box left face (−X) for the left reference frame (positive = further left) */
    leftPlaneDrop: 0.22,
    /** Extra distance (m) past the box bottom face (−Y) for the ground frame (positive = further down) */
    bottomPlaneDrop: 0.12,
    /** Inset from top / bottom edge of back plane for phase plot at max pull up / down (m) */
    backPlaneDotEdgeGap: 0.012,
    /** Tube cross-section radius of the phase-circle mesh (m); controls visual thickness */
    phaseCircleTubeRadius: 0.0018,
    /** Max extra stretch below equilibrium (m), measured to the lowest point of the bob (bottom of cylinder), not its center */
    maxStretchDown: 0.22,
    /** Max compression above equilibrium (m); set ≥ backPlaneSize/2 − backPlaneDotEdgeGap so dot can reach top inset */
    maxCompressionUp: 0.18
};

/** c = 2ζ√(km); critical damping coefficient for current m, k. */
function springDampingCritical() {
    const { mass: m, springStiffness: k } = springConfig;
    return 2 * Math.sqrt(m * k);
}

function syncSpringLinearDamping() {
    springConfig.linearDamping = springConfig.dampingRatio * springDampingCritical();
}

function isSpringUndamped() {
    return springConfig.dampingRatio < 1e-6;
}

function getPhaseOmega() {
    return Math.sqrt(springConfig.springStiffness / springConfig.mass);
}

/** √(u²+(v/ω)²) in phase-plane coords — matches the undamped phase circle radius. */
function getUndampedPhaseAmplitude(u, v, omega) {
    if (omega < 1e-9) return 0;
    return Math.hypot(v / omega, u);
}

syncSpringLinearDamping();

/**
 * Allowed u = displacement. Back plane is at equilibrium → phase plot vertical axis uses −u.
 */
function springDisplacementURange() {
    const bobHalfH = springConfig.massHeight * 0.5;
    const halfPlane = springConfig.backPlaneSize * 0.5;
    const gap = springConfig.backPlaneDotEdgeGap;

    const uMaxSpring = Math.max(0, springConfig.maxStretchDown - bobHalfH);
    const uMinSpring = -springConfig.maxCompressionUp;

    const uMaxPlane = halfPlane - gap;
    const uMinPlane = gap - halfPlane;

    let uMax = Math.min(uMaxSpring, uMaxPlane);
    let uMin = Math.max(uMinSpring, uMinPlane);
    if (uMin > uMax) {
        const m = (uMin + uMax) * 0.5;
        uMin = m;
        uMax = m;
    }
    return { uMin, uMax };
}

/** Cube height: anchor on +Y top face → bob bottom reaches −H/2 + pad at max stretch. */
function computeContainerVisualSize() {
    const bobHalfH = springConfig.massHeight * 0.5;
    const { uMax } = springDisplacementURange();
    return (
        springConfig.restLength +
        uMax +
        bobHalfH +
        springConfig.containerVisualBottomPad
    );
}

springConfig.containerVisualSize = computeContainerVisualSize();
springConfig.backPlaneSize = springConfig.containerVisualSize;
springConfig.containerVisualSize = computeContainerVisualSize();

/** Spring anchor at the top face of the visual cube (container local +Y). */
function containerAnchorLocalY() {
    return springConfig.containerVisualSize * 0.5;
}

const springState = {
    displacement: 0,
    velocity: 0
};

const grabState = {
    isGrabbed: false,
    handKey: null,
    lastDisplacement: null,
    lastTime: null
};

/**
 * First-time pull hint: fades on first mass grab, hidden for rest of session.
 * needsReset lives on this object (not a standalone let) because it's a primitive
 * mutated from both Spring and MenuUI via `deps` — destructuring it as a bare
 * `const` from deps would make reassignment throw, so it's kept as an object
 * property instead, which can be mutated in place through any reference.
 */
const pullHintState = { dismissed: false, fading: false, needsReset: true };

    const api = {
        springConfig, springState, springDampingCritical, syncSpringLinearDamping,
        isSpringUndamped, getPhaseOmega,
        getUndampedPhaseAmplitude, springDisplacementURange,
        computeContainerVisualSize, containerAnchorLocalY,
        grabState, pullHintState,
    };
    Object.assign(deps, api);
    return api;
}

export function createSpring(deps) {
    const {
        scene, camera, renderer,
        containerGroup, springConfig, springState,
        backPhaseVizGroup, leftPlaneVizGroup,
        helvetikerFont, grabState, pullHintState,
        getPhaseOmega, getUndampedPhaseAmplitude, springDisplacementURange,
        isSpringUndamped, syncSpringLinearDamping, containerAnchorLocalY,
        equilibriumLocalY, containerHalf, frameHalfExtent, LEFT_PLANE_Z_EPS,
        backPlaneEdges, backPlaneWireMaterial,
    } = deps;

    const _camWorldPos = new THREE.Vector3();

function buildTubeIndexArray(tubularSegments, radialSegments) {
    const quadCount = tubularSegments * radialSegments;
    const maxVertexIndex = (tubularSegments + 1) * (radialSegments + 1) - 1;
    const indices = maxVertexIndex > 65535 ? new Uint32Array(quadCount * 6) : new Uint16Array(quadCount * 6);
    let idx = 0;
    for (let j = 1; j <= tubularSegments; j++) {
        for (let i = 1; i <= radialSegments; i++) {
            const a = (radialSegments + 1) * (j - 1) + (i - 1);
            const b = (radialSegments + 1) * j + (i - 1);
            const c = (radialSegments + 1) * j + i;
            const d = (radialSegments + 1) * (j - 1) + i;
            indices[idx++] = a; indices[idx++] = b; indices[idx++] = d;
            indices[idx++] = b; indices[idx++] = c; indices[idx++] = d;
        }
    }
    return indices;
}

const _tubeFramePt = new THREE.Vector3();
const _tubeFrameP1 = new THREE.Vector3();
const _tubeFrameP2 = new THREE.Vector3();
const _tubeFrameTangent = new THREE.Vector3();
const _tubeFrameNormal = new THREE.Vector3();
const TUBE_FRAME_DELTA = 0.0001;

/**
 * Per-radialSegments cache of the tube cross-section angle table (cos/sin of
 * v = 2π·j/radialSegments). This grid never depends on the curve, radius, or
 * tubular segment count, only on radialSegments — which is fixed per mesh —
 * so it's computed once per distinct radialSegments value instead of every
 * vertex of every ring on every call to writePlanarTubeGeometry().
 */
const _tubeRadialTrigCache = new Map();
function getTubeRadialTrig(radialSegments) {
    let table = _tubeRadialTrigCache.get(radialSegments);
    if (!table) {
        const cos = new Float32Array(radialSegments + 1);
        const sin = new Float32Array(radialSegments + 1);
        for (let j = 0; j <= radialSegments; j++) {
            const v = (j / radialSegments) * Math.PI * 2;
            cos[j] = -Math.cos(v);
            sin[j] = Math.sin(v);
        }
        table = { cos, sin };
        _tubeRadialTrigCache.set(radialSegments, table);
    }
    return table;
}

/**
 * Writes `tubularSegments + 1` rings of `radialSegments + 1` vertices around
 * a planar (constant-Z) curve directly into preallocated position/normal
 * typed arrays. Tangent/normal frame is derived analytically (perpendicular
 * in-plane rotation of the tangent) instead of via Frenet-frame propagation,
 * which is only valid because the curve never leaves its Z-plane.
 */
function writePlanarTubeGeometry(curve, tubularSegments, radius, radialSegments, positions, normals) {
    const { cos: cosTable, sin: sinTable } = getTubeRadialTrig(radialSegments);
    let vi = 0, ni = 0;
    for (let i = 0; i <= tubularSegments; i++) {
        const t = i / tubularSegments;
        curve.getPoint(t, _tubeFramePt);

        let t1 = t - TUBE_FRAME_DELTA;
        let t2 = t + TUBE_FRAME_DELTA;
        if (t1 < 0) t1 = 0;
        if (t2 > 1) t2 = 1;
        curve.getPoint(t1, _tubeFrameP1);
        curve.getPoint(t2, _tubeFrameP2);
        _tubeFrameTangent.copy(_tubeFrameP2).sub(_tubeFrameP1).normalize();
        // Curve is planar (constant Z) → binormal is world +Z, so
        // normal = tangent × (0,0,1) = (tangent.y, -tangent.x, 0).
        _tubeFrameNormal.set(_tubeFrameTangent.y, -_tubeFrameTangent.x, 0);

        for (let j = 0; j <= radialSegments; j++) {
            const cos = cosTable[j];
            const sin = sinTable[j];
            const nx = cos * _tubeFrameNormal.x;
            const ny = cos * _tubeFrameNormal.y;
            const nz = sin;

            positions[vi++] = _tubeFramePt.x + radius * nx;
            positions[vi++] = _tubeFramePt.y + radius * ny;
            positions[vi++] = _tubeFramePt.z + radius * nz;

            normals[ni++] = nx;
            normals[ni++] = ny;
            normals[ni++] = nz;
        }
    }
}

/** Left-frame traveling wave: dynamic trace driven by projected spring endpoint motion. */
const leftWaveDotGeom = new THREE.SphereGeometry(0.008, 8, 8);
const leftWaveDotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const leftWaveDot = new THREE.Mesh(leftWaveDotGeom, leftWaveDotMat);
leftWaveDot.position.set(0, 0, LEFT_PLANE_Z_EPS);
leftPlaneVizGroup.add(leftWaveDot);

const LEFT_WAVE_SAMPLES = 80;
const leftWaveHalfSpan = springConfig.containerVisualSize * 0.5;
/** Wavelength at launch (k, m); used only to calibrate fixed scroll speed below. */
const leftWaveReferenceWavelength = springConfig.containerVisualSize * 0.5;
/**
 * Fixed s↔time mapping: dt = −s / vScroll. λ on the strip = vScroll·T scales with √(m/k)
 * instead of changing scroll speed when k or m changes.
 */
const leftWaveScrollSpeed =
    leftWaveReferenceWavelength *
    Math.sqrt(springConfig.springStiffness / springConfig.mass) /
    (2 * Math.PI);
/** Fixed sim-time half-window mapped linearly onto horizontal s (time axis). */
const LEFT_WAVE_TIME_HALF_WINDOW = leftWaveHalfSpan / leftWaveScrollSpeed;
const leftWaveStrengthSmoothing = 4.5;
const leftWaveDispIdle = 0.0025;
const leftWaveVelIdle = 0.02;
const leftWaveTubeRadius = springConfig.phaseCircleTubeRadius;
const leftWaveTubularSegments = (LEFT_WAVE_SAMPLES - 1) * 2;
const leftWaveRadialSegments = 4;
const LEFT_WAVE_MAX_STEP = 1 / 120;
const leftFrameHalfY = springConfig.containerVisualSize * 0.5 - springConfig.backPlaneDotEdgeGap;
const leftWaveViz = { waveStrength: 0 };
const _leftWaveProbeState = { displacement: 0, velocity: 0 };
const _leftWavePoint = new THREE.Vector3();
const leftWaveCurvePoints = [];
for (let i = 0; i < LEFT_WAVE_SAMPLES; i++) {
    leftWaveCurvePoints.push(new THREE.Vector3());
}
for (let i = 0; i < LEFT_WAVE_SAMPLES; i++) {
    const u = i / (LEFT_WAVE_SAMPLES - 1);
    const s = -leftWaveHalfSpan + (leftWaveHalfSpan - (-leftWaveHalfSpan)) * u;
    _leftWavePoint.set(s, equilibriumLocalY, LEFT_PLANE_Z_EPS);
    leftWaveCurvePoints[i].copy(_leftWavePoint);
}
const leftWaveMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    opacity: 1.0,
    transparent: false
});
/** Persistent curve + buffers for the traveling wave tube (rewritten in place each frame). */
const leftWaveCurve = new THREE.CatmullRomCurve3(leftWaveCurvePoints);
leftWaveCurve.curveType = 'catmullrom';
leftWaveCurve.tension = 0;
const leftWaveVertexCount = (leftWaveTubularSegments + 1) * (leftWaveRadialSegments + 1);
const leftWavePositions = new Float32Array(leftWaveVertexCount * 3);
const leftWaveNormals = new Float32Array(leftWaveVertexCount * 3);
const leftWaveGeom = new THREE.BufferGeometry();
leftWaveGeom.setIndex(new THREE.BufferAttribute(buildTubeIndexArray(leftWaveTubularSegments, leftWaveRadialSegments), 1));
leftWaveGeom.setAttribute('position', new THREE.BufferAttribute(leftWavePositions, 3));
leftWaveGeom.setAttribute('normal', new THREE.BufferAttribute(leftWaveNormals, 3));
writePlanarTubeGeometry(leftWaveCurve, leftWaveTubularSegments, leftWaveTubeRadius, leftWaveRadialSegments, leftWavePositions, leftWaveNormals);
const leftTravelingWaveLine = new THREE.Mesh(leftWaveGeom, leftWaveMaterial);
leftTravelingWaveLine.frustumCulled = false;
leftPlaneVizGroup.add(leftTravelingWaveLine);


/** Vertical position-only shadow: plane origin at equilibrium → local Y = −u (meters). */
const projectDotGeom = new THREE.SphereGeometry(0.004, 8, 8);
const projectDotMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    opacity: 0.6,
    transparent: true
});
const projectDot = new THREE.Mesh(projectDotGeom, projectDotMat);
projectDot.position.z = 0.003;
backPhaseVizGroup.add(projectDot);

    const springAnchor = new THREE.Group();
    springAnchor.position.set(0, containerAnchorLocalY(), 0);
    containerGroup.add(springAnchor);

/** Semi-implicit Euler: m·u'' = −k·u − c·u′ (u = stretch past equilibrium along −Y). */
function integrateSpring(state, dt) {
    const { mass: m, springStiffness: k, linearDamping: c } = springConfig;
    const accel = -(k / m) * state.displacement - (c / m) * state.velocity;
    state.velocity += accel * dt;
    state.displacement += state.velocity * dt;
}

/** ω = √(k/m); phase coordinates (v/ω, u) trace a circle for undamped SHM. */
const phaseURange = springDisplacementURange();
const phaseUMaxAbs = Math.max(Math.abs(phaseURange.uMin), Math.abs(phaseURange.uMax));
const vOverOmegaMax = springConfig.maxThrowVelocity / getPhaseOmega();
/** Upper bound on √(u²+(v/ω)²) for clamping the dynamic phase circle to the back square. */
const phaseRadiusCapPhys = Math.hypot(phaseUMaxAbs, vOverOmegaMax);

const PHASE_RING_SEG = 48;
const PHASE_TUBE_RADIAL = 6;
const _phaseRingVertCount = (PHASE_RING_SEG + 1) * (PHASE_TUBE_RADIAL + 1);
const _phaseRingPositions = new Float32Array(_phaseRingVertCount * 3);
const _phaseRingNormals   = new Float32Array(_phaseRingVertCount * 3);
const _phaseRingIndices   = new Uint16Array(PHASE_RING_SEG * PHASE_TUBE_RADIAL * 6);
{
    let idx = 0;
    for (let i = 0; i < PHASE_RING_SEG; i++) {
        for (let j = 0; j < PHASE_TUBE_RADIAL; j++) {
            const a = i * (PHASE_TUBE_RADIAL + 1) + j;
            const b = a + (PHASE_TUBE_RADIAL + 1);
            _phaseRingIndices[idx++] = a;     _phaseRingIndices[idx++] = a + 1; _phaseRingIndices[idx++] = b;
            _phaseRingIndices[idx++] = b;     _phaseRingIndices[idx++] = a + 1; _phaseRingIndices[idx++] = b + 1;
        }
    }
}
/**
 * The phase-circle ring/tube grid (spine angle T, cross-section angle phi) is fixed —
 * only the ring radius R changes frame to frame. So the per-vertex normal (independent
 * of R) and the R-independent part of each position are precomputed once here; the only
 * per-frame work left in rebuildPhaseCircleMesh() is an R·cos/R·sin multiply-add.
 */
const _phaseCosT = new Float32Array(PHASE_RING_SEG + 1);
const _phaseSinT = new Float32Array(PHASE_RING_SEG + 1);
for (let i = 0; i <= PHASE_RING_SEG; i++) {
    const t = (i / PHASE_RING_SEG) * Math.PI * 2;
    _phaseCosT[i] = Math.cos(t);
    _phaseSinT[i] = Math.sin(t);
}
const _phaseRingOffsetX = new Float32Array(_phaseRingVertCount);
const _phaseRingOffsetY = new Float32Array(_phaseRingVertCount);
{
    const wr = springConfig.phaseCircleTubeRadius;
    let vi = 0, ni = 0, k = 0;
    for (let i = 0; i <= PHASE_RING_SEG; i++) {
        const cosT = _phaseCosT[i];
        const sinT = _phaseSinT[i];
        for (let j = 0; j <= PHASE_TUBE_RADIAL; j++) {
            const phi = (j / PHASE_TUBE_RADIAL) * Math.PI * 2;
            const cosPhi = Math.cos(phi);
            const sinPhi = Math.sin(phi);
            const nx = cosPhi * cosT;
            const ny = cosPhi * sinT;
            const nz = -sinPhi;
            _phaseRingOffsetX[k] = wr * nx;
            _phaseRingOffsetY[k] = wr * ny;
            _phaseRingPositions[vi++] = 0; // x, y filled in per-frame by rebuildPhaseCircleMesh(R)
            _phaseRingPositions[vi++] = 0;
            _phaseRingPositions[vi++] = wr * nz; // z never changes — written once here
            _phaseRingNormals[ni++] = nx;
            _phaseRingNormals[ni++] = ny;
            _phaseRingNormals[ni++] = nz;
            k++;
        }
    }
}
const phaseCircleGeom = new THREE.BufferGeometry();
phaseCircleGeom.setIndex(new THREE.BufferAttribute(_phaseRingIndices, 1));
phaseCircleGeom.setAttribute('position', new THREE.BufferAttribute(_phaseRingPositions, 3));
phaseCircleGeom.setAttribute('normal',   new THREE.BufferAttribute(_phaseRingNormals,   3));
const phaseCircleMat = new THREE.MeshBasicMaterial({ color: 0xffff00 });
const phaseCircle = new THREE.Mesh(phaseCircleGeom, phaseCircleMat);
phaseCircle.position.set(0, 0, 0);
phaseCircle.frustumCulled = false;
backPhaseVizGroup.add(phaseCircle);

/** Damped phase space: history trail (spiral inward) instead of shrinking circle. */
const PHASE_SPIRAL_MAX_POINTS = 512;
const PHASE_SPIRAL_MIN_STEP_SQ = 0.000004;
const PHASE_SPIRAL_Z = 0;
const PHASE_SPIRAL_RADIAL_SEGMENTS = 4;
const PHASE_SPIRAL_MAX_TUBULAR_SEGMENTS = (PHASE_SPIRAL_MAX_POINTS - 1) * 2;
const phaseSpiralPoints = [];
/** Persistent curve + max-capacity buffers for the spiral tube (rewritten in place, drawRange-limited). */
const phaseSpiralCurve = new THREE.CatmullRomCurve3(phaseSpiralPoints);
phaseSpiralCurve.curveType = 'centripetal';
const phaseSpiralMaxVertexCount = (PHASE_SPIRAL_MAX_TUBULAR_SEGMENTS + 1) * (PHASE_SPIRAL_RADIAL_SEGMENTS + 1);
const phaseSpiralPositions = new Float32Array(phaseSpiralMaxVertexCount * 3);
const phaseSpiralNormals = new Float32Array(phaseSpiralMaxVertexCount * 3);
const phaseSpiralGeom = new THREE.BufferGeometry();
phaseSpiralGeom.setIndex(new THREE.BufferAttribute(buildTubeIndexArray(PHASE_SPIRAL_MAX_TUBULAR_SEGMENTS, PHASE_SPIRAL_RADIAL_SEGMENTS), 1));
phaseSpiralGeom.setAttribute('position', new THREE.BufferAttribute(phaseSpiralPositions, 3));
phaseSpiralGeom.setAttribute('normal', new THREE.BufferAttribute(phaseSpiralNormals, 3));
phaseSpiralGeom.setDrawRange(0, 0);
const phaseSpiralMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 });
const phaseSpiralLine = new THREE.Mesh(
    phaseSpiralGeom,
    phaseSpiralMaterial
);
phaseSpiralLine.frustumCulled = false;
phaseSpiralLine.visible = false;
backPhaseVizGroup.add(phaseSpiralLine);

function clearPhaseSpiralTrail() {
    phaseSpiralPoints.length = 0;
    phaseSpiralLine.visible = false;
}

/** Half-size of the phase plot, inset by tube radius so strokes stay inside the wireframe. */
function getPhasePlotInsetHalf() {
    return springConfig.backPlaneSize * 0.5
        - springConfig.backPlaneDotEdgeGap
        - springConfig.phaseCircleTubeRadius;
}

const _phasePlotClamped = { x: 0, y: 0 };

function clampPhasePlotXY(x, y) {
    const lim = getPhasePlotInsetHalf();
    _phasePlotClamped.x = THREE.MathUtils.clamp(x, -lim, lim);
    _phasePlotClamped.y = THREE.MathUtils.clamp(y, -lim, lim);
    return _phasePlotClamped;
}

/** Max phase-Y reach (top/bottom rails): min of stretch uMax and compression |uMin|. */
function phasePlotPosReach(uL, uH) {
    return Math.min(uH, -uL);
}

function syncUndampedPhaseCircleRadius() {
    if (!isSpringUndamped()) return;
    const omega = getPhaseOmega();
    const { uMin: uL, uMax: uH } = springDisplacementURange();
    const amp = getUndampedPhaseAmplitude(
        springState.displacement,
        springState.velocity,
        omega
    );
    const maxR = Math.min(getPhasePlotInsetHalf(), phasePlotPosReach(uL, uH));
    phaseOscAmp = Math.min(Math.max(amp, 0.0025), maxR);
}

/**
 * Undamped amplitude A = √(u² + (v/ω)²). When k or m changes, ω changes but (u, v) is left
 * as-is unless v is scaled by ω_new/ω_old so A stays constant (only period / wavelength change).
 */
function preserveOscillationAmplitudeOnOmegaChange(prevOmega) {
    const nextOmega = getPhaseOmega();
    if (prevOmega < 1e-9 || nextOmega < 1e-9) return;
    const ratio = nextOmega / prevOmega;
    if (Math.abs(ratio - 1) < 1e-9) return;
    springState.velocity *= ratio;
    syncUndampedPhaseCircleRadius();
}

/**
 * Undamped phase dot on the latched circle — always radial projection to radius R.
 */
function computePhaseDotOnCircle(phaseX, phaseY, R) {
    const hypo = Math.hypot(phaseX, phaseY);
    if (hypo < 1e-9 || R < 1e-9) return { x: 0, y: 0 };
    return clampPhasePlotXY(phaseX * R / hypo, phaseY * R / hypo);
}

/** Ideal v on the latched phase circle when u is pinned at a hard rail (avoids physics v=0 kinks). */
function idealOnCircleVelocity(u, vSign, A, omega) {
    const phaseXMag = Math.sqrt(Math.max(0, A * A - u * u));
    const sign = Math.abs(vSign) < 1e-9 ? 1 : Math.sign(vSign);
    return sign * phaseXMag * omega;
}

/** Seed (u, v) for wave / phase propagation while undamped and latched. */
function waveSeedFromState(uNow, vNow, uMin, uMax, omega) {
    const u = THREE.MathUtils.clamp(uNow, uMin, uMax);
    if (!isSpringUndamped() || grabState.isGrabbed || phaseOscAmp <= 0) {
        return { u, v: vNow };
    }
    const atTop = u <= uMin + PHASE_LIMIT_TOL;
    const atBot = u >= uMax - PHASE_LIMIT_TOL;
    if (atTop || atBot) {
        return { u, v: idealOnCircleVelocity(u, vNow, phaseOscAmp, omega) };
    }
    return { u, v: vNow };
}

/** Predict displacement Δt into the past/future; analytic when undamped, else substepped Euler. */
function predictSpringDisplacement(u0, v0, dt, uMin, uMax, forWaveViz = false) {
    if (Math.abs(dt) < 1e-9) return u0;

    if (isSpringUndamped()) {
        const w = getPhaseOmega();
        const u = u0 * Math.cos(w * dt) + (v0 / w) * Math.sin(w * dt);
        return forWaveViz ? u : THREE.MathUtils.clamp(u, uMin, uMax);
    }

    _leftWaveProbeState.displacement = u0;
    _leftWaveProbeState.velocity = v0;
    const nSteps = Math.max(1, Math.ceil(Math.abs(dt) / LEFT_WAVE_MAX_STEP));
    const h = dt / nSteps;
    for (let k = 0; k < nSteps; k++) {
        integrateSpring(_leftWaveProbeState, h);
        clampSpringDisplacement(_leftWaveProbeState);
    }
    return THREE.MathUtils.clamp(_leftWaveProbeState.displacement, uMin, uMax);
}

function clampPhaseSpiralPointsInPlace() {
    const lim = getPhasePlotInsetHalf();
    for (const p of phaseSpiralPoints) {
        p.x = THREE.MathUtils.clamp(p.x, -lim, lim);
        p.y = THREE.MathUtils.clamp(p.y, -lim, lim);
    }
}

/** @returns {boolean} true if a new point was appended (i.e. the trail actually changed). */
function appendPhaseSpiralPoint(x, y) {
    const c = clampPhasePlotXY(x, y);
    const n = phaseSpiralPoints.length;
    if (n > 0) {
        const last = phaseSpiralPoints[n - 1];
        const dx = c.x - last.x;
        const dy = c.y - last.y;
        if (dx * dx + dy * dy < PHASE_SPIRAL_MIN_STEP_SQ) return false;
    }
    phaseSpiralPoints.push(new THREE.Vector3(c.x, c.y, PHASE_SPIRAL_Z));
    if (phaseSpiralPoints.length > PHASE_SPIRAL_MAX_POINTS) {
        phaseSpiralPoints.shift();
    }
    return true;
}

function rebuildPhaseSpiralMesh() {
    if (phaseSpiralPoints.length < 2) {
        phaseSpiralLine.visible = false;
        return;
    }
    clampPhaseSpiralPointsInPlace();
    // phaseSpiralCurve.points === phaseSpiralPoints (same array); re-sampling it here
    // already reflects the latest trail contents (mutated via push/shift above).
    const tubularSegments = Math.max(2, (phaseSpiralPoints.length - 1) * 2);
    writePlanarTubeGeometry(
        phaseSpiralCurve,
        tubularSegments,
        springConfig.phaseCircleTubeRadius,
        PHASE_SPIRAL_RADIAL_SEGMENTS,
        phaseSpiralPositions,
        phaseSpiralNormals
    );
    phaseSpiralGeom.attributes.position.needsUpdate = true;
    phaseSpiralGeom.attributes.normal.needsUpdate = true;
    phaseSpiralGeom.setDrawRange(0, tubularSegments * PHASE_SPIRAL_RADIAL_SEGMENTS * 6);
    phaseSpiralLine.visible = true;
}

const phaseDotGeom = new THREE.SphereGeometry(0.008, 8, 8);
const phaseDotMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const phaseDot = new THREE.Mesh(phaseDotGeom, phaseDotMat);
phaseDot.position.z = 0;
backPhaseVizGroup.add(phaseDot);

/** Equilibrium / origin marker at the center of the phase circle */
const phaseCenterDotGeom = new THREE.SphereGeometry(0.004, 8, 8);
const phaseCenterDotMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    opacity: 0.6,
    transparent: true
});
const phaseCenterDot = new THREE.Mesh(phaseCenterDotGeom, phaseCenterDotMat);
phaseCenterDot.position.set(0, 0, 0);
backPhaseVizGroup.add(phaseCenterDot);

/** Phase links: center → projectDot (vertical) → phaseDot (horizontal), plus center → phaseDot (diagonal); unit box along +X */
const phaseConnectorThickness = 0.0026;
const phaseConnectorGeom = new THREE.BoxGeometry(1, phaseConnectorThickness, phaseConnectorThickness);
const phaseConnectorMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    opacity: 0.6,
    transparent: true
});
const phaseConnectorSeg0 = new THREE.Mesh(phaseConnectorGeom, phaseConnectorMat);
const phaseConnectorSeg1 = new THREE.Mesh(phaseConnectorGeom, phaseConnectorMat);
const phaseConnectorSeg2 = new THREE.Mesh(phaseConnectorGeom, phaseConnectorMat);
backPhaseVizGroup.add(phaseConnectorSeg0);
backPhaseVizGroup.add(phaseConnectorSeg1);
backPhaseVizGroup.add(phaseConnectorSeg2);

/** Spring endpoint → projected dots (phase + wave): scaled box + dash shader. */
const springProjectionConnectorThickness = 0.002;
const springProjectionConnectorDashSize = 0.012;
const springProjectionConnectorGapSize = 0.008;
const springProjectionConnectorVert = /* glsl */ `
varying float vAlong;
void main() {
    vAlong = position.x + 0.5;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const springProjectionConnectorFrag = /* glsl */ `
uniform float uLineLength;
uniform float uDashSize;
uniform float uGapSize;
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlong;
void main() {
    float dist = vAlong * uLineLength;
    float period = uDashSize + uGapSize;
    if (mod(dist, period) > uDashSize) discard;
    gl_FragColor = vec4(uColor, uOpacity);
}
`;
function createSpringProjectionConnectorMesh() {
    const uniforms = {
        uLineLength: { value: 1 },
        uDashSize: { value: springProjectionConnectorDashSize },
        uGapSize: { value: springProjectionConnectorGapSize },
        uColor: { value: new THREE.Color(0xffffff) },
        uOpacity: { value: 0.5 }
    };
    const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: springProjectionConnectorVert,
        fragmentShader: springProjectionConnectorFrag,
        transparent: true
    });
    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(1, springProjectionConnectorThickness, springProjectionConnectorThickness),
        mat
    );
    mesh.frustumCulled = false;
    return mesh;
}
const springToPhaseProjConnector = createSpringProjectionConnectorMesh();
const springToWaveProjConnector = createSpringProjectionConnectorMesh();
scene.add(springToPhaseProjConnector);
scene.add(springToWaveProjConnector);

const _phaseSegDir = new THREE.Vector3();
const _phaseSegMid = new THREE.Vector3();
const _phaseSegAxisX = new THREE.Vector3(1, 0, 0);
const PHASE_CONNECTOR_LEN_EPS = 2e-4;
const _springProjDir = new THREE.Vector3();
const _springProjMid = new THREE.Vector3();
const _springProjAxisX = new THREE.Vector3(1, 0, 0);
const _springEndpointWorld = new THREE.Vector3();
const _phaseProjWorld = new THREE.Vector3();
const _waveProjWorld = new THREE.Vector3();

function placePhaseConnectorSegment(mesh, ax, ay, az, bx, by, bz, allowShow) {
    if (!allowShow) {
        mesh.visible = false;
        return;
    }
    _phaseSegDir.set(bx - ax, by - ay, bz - az);
    const len = _phaseSegDir.length();
    if (len < PHASE_CONNECTOR_LEN_EPS) {
        mesh.visible = false;
        return;
    }
    mesh.visible = true;
    _phaseSegDir.multiplyScalar(1 / len);
    _phaseSegMid.set((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
    mesh.position.copy(_phaseSegMid);
    mesh.quaternion.setFromUnitVectors(_phaseSegAxisX, _phaseSegDir);
    mesh.scale.set(len, 1, 1);
}

function placeWorldConnectorSegment(mesh, start, end, allowShow) {
    if (!allowShow) {
        mesh.visible = false;
        return;
    }
    _springProjDir.subVectors(end, start);
    const len = _springProjDir.length();
    if (len < PHASE_CONNECTOR_LEN_EPS) {
        mesh.visible = false;
        return;
    }
    mesh.visible = true;
    _springProjDir.multiplyScalar(1 / len);
    _springProjMid.addVectors(start, end).multiplyScalar(0.5);
    mesh.position.copy(_springProjMid);
    mesh.quaternion.setFromUnitVectors(_springProjAxisX, _springProjDir);
    mesh.scale.set(len, 1, 1);
    mesh.material.uniforms.uLineLength.value = len;
}

/** Display radius for phase circle (rail grab snaps; damped motion uses smoothing). */
let phaseRadiusDisplay = 0;
let phaseRadiusDisplayInited = false;
const PHASE_RADIUS_SMOOTH_TAU = 22;
const PHASE_LIMIT_TOL = 4e-5;
/** Undamped: orbit radius √(u²+(v/ω)²), synced each frame to match the drawn circle. */
let phaseOscAmp = -1;
let phaseWasGrabbed = false;
let phaseTrailWasDamped = false;

/** Allowed center-of-mass Y in springAnchor space (matches springDisplacementURange). */
function springBobCenterYBounds(restLen) {
    const { uMin, uMax } = springDisplacementURange();
    return {
        yLo: -(restLen + uMax),
        yHi: -(restLen + uMin),
    };
}

function clampSpringDisplacement(state) {
    const { uMin, uMax } = springDisplacementURange();
    if (state.displacement > uMax) {
        state.displacement = uMax;
        state.velocity = Math.min(0, state.velocity);
    } else if (state.displacement < uMin) {
        state.displacement = uMin;
        state.velocity = Math.max(0, state.velocity);
    }
}

/** Flip stored vertex normals (TubeGeometry often needs this for outward-facing fronts). */
function invertBufferGeometryNormals(geometry) {
    const n = geometry.getAttribute('normal');
    if (!n) return;
    const a = n.array;
    for (let i = 0; i < a.length; i++) a[i] = -a[i];
    n.needsUpdate = true;
}

/**
 * Visual Elements
 */
const pivotGeometry = new THREE.SphereGeometry(springConfig.pivotRadius, 8, 8);
const pivotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const pivot = new THREE.Mesh(pivotGeometry, pivotMaterial);
/** Sphere centered on anchor origin; connector runs in y=0 plane through center */
springAnchor.add(pivot);

/** Bob size at {@link springConfig.mass} === 1 kg (volume ∝ mass → linear scale ∝ m^(1/3)). */
const MASS_VISUAL_REF_MASS = 1.0;
const MASS_VISUAL_BASE_RADIUS = 0.0225;
const MASS_VISUAL_BASE_HEIGHT = 0.02;

function syncMassVisual() {
    const s = Math.cbrt(springConfig.mass / MASS_VISUAL_REF_MASS);
    springConfig.massRadius = MASS_VISUAL_BASE_RADIUS * s;
    springConfig.massHeight = MASS_VISUAL_BASE_HEIGHT * s;
    const prevGeom = mass1.geometry;
    mass1.geometry = new THREE.CylinderGeometry(
        springConfig.massRadius,
        springConfig.massRadius,
        springConfig.massHeight,
        12
    );
    prevGeom.dispose();
    syncPullHintVisual();
    rebuildSpringMesh();
}

const mass1Geometry = new THREE.CylinderGeometry(
    springConfig.massRadius,
    springConfig.massRadius,
    springConfig.massHeight,
    12
);
const mass1Material = new THREE.MeshBasicMaterial({ color: 0xffdd33 });
const mass1 = new THREE.Mesh(mass1Geometry, mass1Material);
springAnchor.add(mass1);

/** Pull hint under mass: white up-pointing triangle + Helvetiker bold "Pull" (Y-billboard, session-once). */
const PULL_HINT_WEIGHT_GAP = 0.014;
const PULL_HINT_TEXT_GAP = 0.007;
const PULL_HINT_TRI_SIDE = 0.0128;
const PULL_HINT_TEXT_SIZE = 0.018;
const PULL_HINT_FADE_DURATION = 0.35;
const pullHintMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 1
});
const pullHintGroup = new THREE.Group();
pullHintGroup.frustumCulled = false;
springAnchor.add(pullHintGroup);

const _pullHintCamLocal = new THREE.Vector3();

function makePullTriangleGeometry(side) {
    const halfBase = side * 0.5;
    const height = side * Math.sqrt(3) * 0.5;
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(-halfBase, -height);
    shape.lineTo(halfBase, -height);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
}

const pullTriangleMesh = new THREE.Mesh(
    makePullTriangleGeometry(PULL_HINT_TRI_SIDE),
    pullHintMaterial
);
pullTriangleMesh.frustumCulled = false;
pullHintGroup.add(pullTriangleMesh);

let pullTextMesh = null;

function resetPullHintForSession() {
    gsap.killTweensOf(pullHintMaterial);
    pullHintMaterial.opacity = 1;
    pullHintState.dismissed = false;
    pullHintState.fading = false;
    pullHintGroup.visible = true;
}

function dismissPullHint() {
    if (pullHintState.dismissed || pullHintState.fading) return;
    pullHintState.fading = true;
    gsap.killTweensOf(pullHintMaterial);
    gsap.to(pullHintMaterial, {
        opacity: 0,
        duration: PULL_HINT_FADE_DURATION,
        ease: 'power2.out',
        onComplete: () => {
            pullHintState.dismissed = true;
            pullHintState.fading = false;
            pullHintGroup.visible = false;
        }
    });
}

function syncPullHintVisual() {
    const s = Math.cbrt(springConfig.mass / MASS_VISUAL_REF_MASS);
    const triSide = PULL_HINT_TRI_SIDE * s;
    const triH = triSide * Math.sqrt(3) * 0.5;
    const textSize = PULL_HINT_TEXT_SIZE * s;
    const weightGap = PULL_HINT_WEIGHT_GAP * s;
    const textGap = PULL_HINT_TEXT_GAP * s;

    const prevTriGeom = pullTriangleMesh.geometry;
    pullTriangleMesh.geometry = makePullTriangleGeometry(triSide);
    prevTriGeom.dispose();
    pullTriangleMesh.position.set(0, -weightGap, 0);

    if (pullTextMesh) {
        pullHintGroup.remove(pullTextMesh);
        pullTextMesh.geometry.dispose();
    }

    const textGeom = new TextGeometry('Pull', {
        font: helvetikerFont,
        size: textSize,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false
    });
    textGeom.computeBoundingBox();
    const bb = textGeom.boundingBox;
    const textH = bb.max.y - bb.min.y;
    textGeom.translate(-(bb.min.x + bb.max.x) * 0.5, -(bb.min.y + bb.max.y) * 0.5, 0);

    pullTextMesh = new THREE.Mesh(textGeom, pullHintMaterial);
    pullTextMesh.frustumCulled = false;
    pullTextMesh.position.set(0, -weightGap - triH - textGap - textH * 0.5, 0);
    pullHintGroup.add(pullTextMesh);
}

function updatePullHint(yMassCenter) {
    if (pullHintState.needsReset) {
        pullHintState.needsReset = false;
        resetPullHintForSession();
    }

    if (pullHintState.dismissed) {
        pullHintGroup.visible = false;
        return;
    }

    const massBottomY = yMassCenter - springConfig.massHeight * 0.5;
    pullHintGroup.position.set(0, massBottomY, 0.003);

    const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
    activeCamera.getWorldPosition(_camWorldPos);
    _pullHintCamLocal.copy(_camWorldPos);
    springAnchor.worldToLocal(_pullHintCamLocal);
    const dx = _pullHintCamLocal.x;
    const dz = _pullHintCamLocal.z;
    const yaw = (dx * dx + dz * dz) > 1e-8 ? Math.atan2(dx, dz) : 0;
    pullHintGroup.rotation.set(0, yaw, 0);
    pullHintGroup.visible = true;
}

syncPullHintVisual();

/** Manual tube mesh: ring of TUBE_RADIAL verts at each of HELIX_SEG+1 spine points. */
const HELIX_SEG = 160;
const TUBE_RADIAL = 8;
const _tubeVertCount = (HELIX_SEG + 1) * (TUBE_RADIAL + 1);
const _tubePositions = new Float32Array(_tubeVertCount * 3);
const _tubeNormals = new Float32Array(_tubeVertCount * 3);
const _tubeIndices = new Uint16Array(HELIX_SEG * TUBE_RADIAL * 6);
{
    let idx = 0;
    for (let i = 0; i < HELIX_SEG; i++) {
        for (let j = 0; j < TUBE_RADIAL; j++) {
            const a = i * (TUBE_RADIAL + 1) + j;
            const b = a + (TUBE_RADIAL + 1);
            _tubeIndices[idx++] = a; _tubeIndices[idx++] = a + 1; _tubeIndices[idx++] = b;
            _tubeIndices[idx++] = b; _tubeIndices[idx++] = a + 1; _tubeIndices[idx++] = b + 1;
        }
    }
}
/**
 * Angle tables for the helix spine (cosA/sinA, indexed by spine step) and its
 * tube cross-section (cosPhi/sinPhi, indexed by radial step). Both depend only
 * on HELIX_SEG/TUBE_RADIAL/springTurns — all fixed at load time — so they're
 * computed once instead of re-evaluating sin/cos for every vertex every frame
 * in rebuildSpringMesh().
 */
const _helixCosA = new Float32Array(HELIX_SEG + 1);
const _helixSinA = new Float32Array(HELIX_SEG + 1);
{
    const omega = springConfig.springTurns * Math.PI * 2;
    for (let i = 0; i <= HELIX_SEG; i++) {
        const angle = (i / HELIX_SEG) * omega;
        _helixCosA[i] = Math.cos(angle);
        _helixSinA[i] = Math.sin(angle);
    }
}
const _helixCosPhi = new Float32Array(TUBE_RADIAL + 1);
const _helixSinPhi = new Float32Array(TUBE_RADIAL + 1);
for (let j = 0; j <= TUBE_RADIAL; j++) {
    const phi = (j / TUBE_RADIAL) * Math.PI * 2;
    _helixCosPhi[j] = Math.cos(phi);
    _helixSinPhi[j] = Math.sin(phi);
}
const springGeom = new THREE.BufferGeometry();
springGeom.setIndex(new THREE.BufferAttribute(_tubeIndices, 1));
springGeom.setAttribute('position', new THREE.BufferAttribute(_tubePositions, 3));
springGeom.setAttribute('normal', new THREE.BufferAttribute(_tubeNormals, 3));
const springMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide
});
/** Stub tubes overlap the helix/mass centerline slightly so open end caps do not leave a visible gap. */
const SPRING_STUB_HELIX_OVERLAP = 0.35;
const springMesh = new THREE.Mesh(springGeom, springMaterial);
springMesh.frustumCulled = false;
springAnchor.add(springMesh);

/** Radial stub in the horizontal plane through sphere center: surface +(pivotRadius) → helix (R) */
const _connectorStart = new THREE.Vector3(springConfig.pivotRadius, 0, 0);
const _connectorEnd = new THREE.Vector3(
    springConfig.springHelixRadius + springConfig.springWireRadius * SPRING_STUB_HELIX_OVERLAP,
    0,
    0
);
const springConnectorCurve = new THREE.LineCurve3(_connectorStart, _connectorEnd);
const springConnectorGeom = new THREE.TubeGeometry(
    springConnectorCurve,
    10,
    springConfig.springWireRadius,
    TUBE_RADIAL,
    false
);
invertBufferGeometryNormals(springConnectorGeom);
const springConnectorMesh = new THREE.Mesh(springConnectorGeom, springMaterial);
springConnectorMesh.frustumCulled = false;
springAnchor.add(springConnectorMesh);

/** Radial stub at mass attachment Y: helix (R) → mass surface (massRadius), same +X as helix ends. */
let _springBottomConnectorRadiiKey = '';
const springBottomConnectorMesh = new THREE.Mesh(undefined, springMaterial);
springBottomConnectorMesh.frustumCulled = false;
springAnchor.add(springBottomConnectorMesh);

function rebuildSpringBottomConnectorGeometry() {
    const startR = springConfig.springHelixRadius;
    const endR = springConfig.massRadius;
    const key = `${startR}:${endR}`;
    if (key === _springBottomConnectorRadiiKey && springBottomConnectorMesh.geometry) return;
    _springBottomConnectorRadiiKey = key;

    if (springBottomConnectorMesh.geometry) springBottomConnectorMesh.geometry.dispose();

    const overlap = springConfig.springWireRadius * SPRING_STUB_HELIX_OVERLAP;
    const bottomStart = new THREE.Vector3(startR + overlap, 0, 0);
    const bottomEnd = new THREE.Vector3(Math.max(0, endR - overlap), 0, 0);
    const bottomCurve = new THREE.LineCurve3(bottomStart, bottomEnd);
    const bottomGeom = new THREE.TubeGeometry(
        bottomCurve,
        10,
        springConfig.springWireRadius,
        TUBE_RADIAL,
        false
    );
    invertBufferGeometryNormals(bottomGeom);
    springBottomConnectorMesh.geometry = bottomGeom;
}

function updateSpringBottomConnector(yAttach) {
    rebuildSpringBottomConnectorGeometry();
    springBottomConnectorMesh.position.set(0, yAttach, 0);
}

const _tTangent = new THREE.Vector3();
const _tNormal = new THREE.Vector3();
const _tBinormal = new THREE.Vector3();

function rebuildSpringMesh() {
    const u = springState.displacement;
    const yBottom = -(springConfig.restLength + u);
    const yTop = 0;
    const massHalfH = springConfig.massHeight * 0.5;
    const yAttach = yBottom + massHalfH * 0.92;
    let h = yAttach - yTop;
    if (h > -0.018) h = -0.018;

    const { springHelixRadius: R, springTurns, springWireRadius: wr } = springConfig;
    const omega = springTurns * Math.PI * 2;

    let vi = 0, ni = 0;
    for (let i = 0; i <= HELIX_SEG; i++) {
        const t = i / HELIX_SEG;
        const cosA = _helixCosA[i];
        const sinA = _helixSinA[i];

        const px = R * cosA;
        const py = yTop + t * h;
        const pz = R * sinA;

        _tTangent.set(-R * omega * sinA, h, R * omega * cosA).normalize();
        _tNormal.set(cosA, 0, sinA);
        _tBinormal.crossVectors(_tTangent, _tNormal).normalize();
        _tNormal.crossVectors(_tBinormal, _tTangent).normalize();

        for (let j = 0; j <= TUBE_RADIAL; j++) {
            const cp = _helixCosPhi[j];
            const sp = _helixSinPhi[j];

            const nx = cp * _tNormal.x + sp * _tBinormal.x;
            const ny = cp * _tNormal.y + sp * _tBinormal.y;
            const nz = cp * _tNormal.z + sp * _tBinormal.z;

            _tubePositions[vi++] = px + wr * nx;
            _tubePositions[vi++] = py + wr * ny;
            _tubePositions[vi++] = pz + wr * nz;

            _tubeNormals[ni++] = nx;
            _tubeNormals[ni++] = ny;
            _tubeNormals[ni++] = nz;
        }
    }

    springGeom.attributes.position.needsUpdate = true;
    springGeom.attributes.normal.needsUpdate = true;
    springGeom.computeBoundingSphere();

    updateSpringBottomConnector(yAttach);
}

/** Y clamp for the left-plane wave: actual wireframe edges, not the dot inset. */
function getLeftWaveYClampBounds() {
    const tube = leftWaveTubeRadius;
    return {
        yLo: -frameHalfExtent + tube,
        yHi:  frameHalfExtent - tube
    };
}

/** Fixed position scale on the left plot (frame only), not bob-sized travel limits. */
function getLeftWavePlotURange() {
    const gap = springConfig.backPlaneDotEdgeGap;
    return {
        uMin: gap - frameHalfExtent,
        uMax: frameHalfExtent - gap
    };
}

function updateLeftTravelingWave(delta) {
    const physicsRange = springDisplacementURange();
    const plotRange = getLeftWavePlotURange();
    const uNow = springState.displacement;
    const vNow = springState.velocity;
    const canScroll = LEFT_WAVE_TIME_HALF_WINDOW > 1e-6;
    const omega0 = getPhaseOmega();
    const waveSeed = waveSeedFromState(
        uNow,
        vNow,
        physicsRange.uMin,
        physicsRange.uMax,
        omega0
    );
    const forWaveViz = isSpringUndamped();
    const waveYBounds = getLeftWaveYClampBounds();
    const uNowClamped = THREE.MathUtils.clamp(
        uNow,
        physicsRange.uMin,
        physicsRange.uMax
    );
    const yNow = THREE.MathUtils.clamp(
        equilibriumLocalY - uNowClamped,
        waveYBounds.yLo,
        waveYBounds.yHi
    );

    const motionOn =
        grabState.isGrabbed ||
        Math.abs(uNow) > leftWaveDispIdle ||
        Math.abs(vNow) > leftWaveVelIdle;
    const strengthTarget = motionOn ? 1 : 0;
    if (grabState.isGrabbed) {
        // Keep the projected dot welded to the curve from the first grabbed frame.
        leftWaveViz.waveStrength = 1;
    } else {
        leftWaveViz.waveStrength += (strengthTarget - leftWaveViz.waveStrength)
            * Math.min(1, delta * leftWaveStrengthSmoothing);
    }

    const n = LEFT_WAVE_SAMPLES;
    for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        // Horizontal = fixed sim-time window; vertical = position (m), not scaled with ω or m.
        const t = -LEFT_WAVE_TIME_HALF_WINDOW + 2 * LEFT_WAVE_TIME_HALF_WINDOW * u;
        const s = (t / LEFT_WAVE_TIME_HALF_WINDOW) * leftWaveHalfSpan;

        let predictedU;
        if (canScroll) {
            const dtTotal = -t;
            predictedU = predictSpringDisplacement(
                waveSeed.u,
                waveSeed.v,
                dtTotal,
                plotRange.uMin,
                plotRange.uMax,
                forWaveViz
            );
        } else {
            predictedU = waveSeed.u;
        }

        const ySample = THREE.MathUtils.clamp(
            equilibriumLocalY - leftWaveViz.waveStrength * predictedU,
            waveYBounds.yLo,
            waveYBounds.yHi
        );
        _leftWavePoint.set(s, ySample, LEFT_PLANE_Z_EPS);
        leftWaveCurvePoints[i].copy(_leftWavePoint);
    }

    // leftWaveCurve.points === leftWaveCurvePoints (same array, values just written above),
    // so re-sampling it here already reflects this frame's curve shape.
    writePlanarTubeGeometry(leftWaveCurve, leftWaveTubularSegments, leftWaveTubeRadius, leftWaveRadialSegments, leftWavePositions, leftWaveNormals);
    leftWaveGeom.attributes.position.needsUpdate = true;
    leftWaveGeom.attributes.normal.needsUpdate = true;

    // Perpendicular projection onto left plane: same endpoint height, on-plane depth.
    leftWaveDot.position.set(0, yNow, LEFT_PLANE_Z_EPS);
}

function rebuildPhaseCircleMesh(R) {
    // Normals and Z are constant (precomputed above) — only X/Y move with R, and the
    // per-vertex offset (wr·nx, wr·ny) is looked up rather than re-derived from trig.
    let vi = 0, k = 0;
    for (let i = 0; i <= PHASE_RING_SEG; i++) {
        const rCosT = R * _phaseCosT[i];
        const rSinT = R * _phaseSinT[i];
        for (let j = 0; j <= PHASE_TUBE_RADIAL; j++) {
            _phaseRingPositions[vi] = rCosT + _phaseRingOffsetX[k];
            _phaseRingPositions[vi + 1] = rSinT + _phaseRingOffsetY[k];
            vi += 3;
            k++;
        }
    }
    phaseCircleGeom.attributes.position.needsUpdate = true;
    phaseCircleGeom.computeBoundingSphere();
}

function updatePhaseSpaceVisual(delta) {
    const u = springState.displacement;
    const v = springState.velocity;
    const omega = getPhaseOmega();
    const phaseX = v / omega;
    const phaseY = -u;

    const phaseRadiusVisualMax = getPhasePlotInsetHalf();
    const { uMin: uL, uMax: uH } = springDisplacementURange();
    const posReach = phasePlotPosReach(uL, uH);
    const hasRange = uH > uL;
    const phaseVizOn = hasRange;
    const damped = !isSpringUndamped();
    const lim = phaseRadiusVisualMax;
    const projectY = THREE.MathUtils.clamp(-u, -lim, lim);

    if (damped !== phaseTrailWasDamped) {
        if (!damped) {
            clearPhaseSpiralTrail();
            syncUndampedPhaseCircleRadius();
        }
        phaseTrailWasDamped = damped;
    }

    if (grabState.isGrabbed && !phaseWasGrabbed) {
        clearPhaseSpiralTrail();
        phaseRadiusDisplayInited = false;
    }
    if (phaseWasGrabbed && !grabState.isGrabbed) {
        phaseOscAmp = Math.min(
            Math.max(phaseRadiusDisplay, 0.0025),
            phaseRadiusVisualMax,
            posReach
        );
    }
    phaseWasGrabbed = grabState.isGrabbed;

    let phaseXDraw = 0;
    let phaseYDraw = projectY;
    let R = 0.0025;

    if (damped) {
        phaseCircle.visible = false;
        const phaseDraw = clampPhasePlotXY(phaseX, phaseY);
        phaseXDraw = phaseDraw.x;
        phaseYDraw = phaseDraw.y;
        if (!grabState.isGrabbed && phaseVizOn) {
            // Only rebuild the trail mesh when a point was actually added — sub-threshold
            // motion leaves the trail unchanged, so re-tracing it would be wasted work.
            if (appendPhaseSpiralPoint(phaseXDraw, phaseYDraw)) {
                rebuildPhaseSpiralMesh();
            }
        }
    } else {
        phaseSpiralLine.visible = false;

        const atHigh = u >= uH - PHASE_LIMIT_TOL;
        const atLow = u <= uL + PHASE_LIMIT_TOL;

        if (grabState.isGrabbed) {
            const rTarget = Math.min(Math.abs(u), phaseRadiusVisualMax, posReach);
            if (!phaseRadiusDisplayInited || delta <= 0) {
                phaseRadiusDisplay = rTarget;
                phaseRadiusDisplayInited = true;
            } else {
                const a = 1 - Math.exp(-PHASE_RADIUS_SMOOTH_TAU * delta);
                phaseRadiusDisplay += (rTarget - phaseRadiusDisplay) * a;
            }
            phaseRadiusDisplay = Math.min(phaseRadiusDisplay, phaseRadiusVisualMax, posReach);
        } else {
            const ampNow = getUndampedPhaseAmplitude(u, v, omega);
            phaseOscAmp = Math.min(
                Math.max(ampNow, 0.0025),
                phaseRadiusVisualMax,
                posReach
            );
            phaseRadiusDisplay = phaseOscAmp;
        }

        R = Math.min(Math.max(phaseRadiusDisplay, 0.0025), phaseRadiusVisualMax, posReach);
        rebuildPhaseCircleMesh(R);
        phaseCircle.visible = phaseVizOn;

        let px = phaseX;
        let py = phaseY;
        if (!grabState.isGrabbed && phaseOscAmp > 0 && (atHigh || atLow)) {
            const uRail = THREE.MathUtils.clamp(u, uL, uH);
            px = idealOnCircleVelocity(uRail, v, phaseOscAmp, omega) / omega;
            py = -uRail;
        }
        const clamped = clampPhasePlotXY(px, py);
        const rClamped = Math.hypot(clamped.x, clamped.y);
        if (rClamped > R + 1e-6) {
            const onCircle = computePhaseDotOnCircle(px, py, R);
            phaseXDraw = onCircle.x;
            phaseYDraw = onCircle.y;
        } else {
            phaseXDraw = clamped.x;
            phaseYDraw = clamped.y;
        }
    }

    projectDot.position.set(0, projectY, projectDot.position.z);
    phaseDot.position.set(phaseXDraw, phaseYDraw, phaseDot.position.z);

    phaseCenterDot.visible = phaseVizOn;
    phaseDot.visible = hasRange && !grabState.isGrabbed;

    const cz = phaseCenterDot.position.z;
    const pz = projectDot.position.z;
    const fz = phaseDot.position.z;
    placePhaseConnectorSegment(phaseConnectorSeg0, 0, 0, cz, 0, projectY, pz, phaseVizOn);
    const showSecond = phaseVizOn && phaseDot.visible;
    placePhaseConnectorSegment(phaseConnectorSeg1, 0, projectY, pz, phaseXDraw, phaseYDraw, fz, showSecond);
    placePhaseConnectorSegment(phaseConnectorSeg2, 0, 0, cz, phaseXDraw, phaseYDraw, fz, showSecond);
}

function updateSpringVisual(delta) {
    const yBottom = -(springConfig.restLength + springState.displacement);
    mass1.position.set(0, yBottom, 0);
    updatePullHint(yBottom);
    rebuildSpringMesh();
    updateLeftTravelingWave(delta);
    updatePhaseSpaceVisual(delta);

    // Spring visual endpoint near the mass-side attachment point.
    _springEndpointWorld.set(0, yBottom + springConfig.massHeight * 0.92 * 0.5, 0);
    springAnchor.localToWorld(_springEndpointWorld);
    projectDot.getWorldPosition(_phaseProjWorld);
    leftWaveDot.getWorldPosition(_waveProjWorld);
    placeWorldConnectorSegment(springToPhaseProjConnector, _springEndpointWorld, _phaseProjWorld, true);
    placeWorldConnectorSegment(springToWaveProjConnector, _springEndpointWorld, _waveProjWorld, true);
}
updateSpringVisual(0.016);

let simulationElapsed = 0;

function resetSimulationTime() {
    simulationElapsed = 0;
}

    const api = {
        springAnchor, projectDot, mass1, integrateSpring, clampSpringDisplacement,
        springBobCenterYBounds, updateSpringVisual, dismissPullHint,
        resetPullHintForSession, syncMassVisual, clearPhaseSpiralTrail,
        resetSimulationTime, simulationElapsed,
        syncUndampedPhaseCircleRadius, preserveOscillationAmplitudeOnOmegaChange,
    };
    Object.assign(deps, api);
    return api;
}
