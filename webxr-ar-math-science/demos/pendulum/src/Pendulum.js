import * as THREE from 'three';
import gsap from 'gsap';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import helvetikerBold from 'three/examples/fonts/helvetiker_bold.typeface.json';

export function createPendulum(deps) {
    const { scene, camera, renderer, containerGroup, containerSize } = deps;

const pendulumConfig = {
    containerSize, // from Container
    /** Pivot offset inside the container (center of box is 0,0,0); +Y is up */
    pendulumOriginOffset: new THREE.Vector3(0, 0.32, 0),
    mass1: 1.0,
    mass2: 1.0,
    length1: 0.32,
    length2: 0.32,
    /** SI gravity (m/s²) — matches textbook PE = mgy and weight mg */
    gravity: 9.81,
    sphereRadius1: 0.025,
    sphereRadius2: 0.025,
    /** Extra reach beyond ball radius for pinch grab (world units); grab if dist < sphereRadius + this */
    grabMargin: 0.1,
    /** Root / pivot ball (visual only) */
    pivotRadius: 0.01,
    /** Visual rod thickness (cylinder radius) */
    rodRadius: 0.003,
    /** 1 = no explicit damping; <1 scales velocity each substep (loses energy) */
    damping: 1,
    /** More substeps → smaller RK4 step h → higher integration accuracy (error O(h⁴)) */
    physicsSubsteps: 12,
    /** 1 = wall-clock time matches sim time (textbook m/s); >1 faster, <1 slower */
    timeScale: 1,
    trailLength: 200,
    /** Record a trail point every this many meters of mass-2 travel — uniform point
     *  spacing keeps the tube smooth at any speed (per-frame sampling went low-poly
     *  when the ball was fast). 200 pts × 6 mm ≈ 1.2 m of visible path. */
    trailSampleSpacing: 0.006,
    /** Trail tube cross-section radius (world units; MeshBasicMaterial — reliable in WebXR) */
    trailTubeRadius: 0.0025,
    /** Past ball surface along screen-right; scaled with rig (and overscale damp below) */
    massLabelGap: 0.0025,
    /** Sprite half-width along offset (1 = full; lower pulls label closer to ball) */
    massLabelOffsetHalfWidthFactor: 0.72,
    /** World scale above ref uses damp = (S/ref)^-exponent on label size + gap so huge scale-ups stay readable */
    massLabelOverscaleRef: 1,
    massLabelOverscaleExponent: 0.52
};

const PENDULUM_DEFAULTS = {
	length1: pendulumConfig.length1,
	length2: pendulumConfig.length2,
	mass1: pendulumConfig.mass1,
	mass2: pendulumConfig.mass2
};

const pendulumAnchor = new THREE.Group();
pendulumAnchor.position.copy(pendulumConfig.pendulumOriginOffset);
containerGroup.add(pendulumAnchor);

const pendulumState = {
    pos1: new THREE.Vector3(),
    pos2: new THREE.Vector3(),
    vel1: new THREE.Vector3(),
    vel2: new THREE.Vector3(),
};

/**
 * Per-hand grab tracking — supports simultaneous two-handed manipulation
 */
const grabInfo = {
    left:  { target: null, history: [] },
    right: { target: null, history: [] }
};

const _upVector = new THREE.Vector3(0, 1, 0);
const _pendulumLocalScratch = new THREE.Vector3();
const _rodOrigin = new THREE.Vector3();
const _rodDir = new THREE.Vector3();
const _rodMid = new THREE.Vector3();
const _labelBallWorld = new THREE.Vector3();
const _labelCamWorld = new THREE.Vector3();
const _labelCamQuat = new THREE.Quaternion();
const _labelViewDir = new THREE.Vector3();
const _labelCamRight = new THREE.Vector3();
const _labelScreenRight = new THREE.Vector3();
const _labelWorldPos = new THREE.Vector3();
const _labelMassWorldScale = new THREE.Vector3();
const _enforceConstraintDelta = new THREE.Vector3();
const _grabRod2 = new THREE.Vector3();
const _grabRelPos = new THREE.Vector3();
const _throwV1 = new THREE.Vector3();
const _throwV2 = new THREE.Vector3();
const _throwDiff = new THREE.Vector3();
const _throwN1 = new THREE.Vector3();
const _throwRod2Dir = new THREE.Vector3();
const _throwRelV = new THREE.Vector3();
const _throwRadial = new THREE.Vector3();
const _dragHintCamWorld = new THREE.Vector3();
const _dragHintWorld = new THREE.Vector3();
const _dragHintYAxis = new THREE.Vector3(0, 1, 0);
const _dragHintWorldYawQuat = new THREE.Quaternion();
const _dragHintParentWorldQuat = new THREE.Quaternion();

function isAnyGrabbed() {
    return grabInfo.left.target !== null || grabInfo.right.target !== null;
}

function recordPositionHistory(handState, time) {
    handState.history.push({
        time,
        pos1: pendulumState.pos1.clone(),
        pos2: pendulumState.pos2.clone()
    });
    if (handState.history.length > 10) handState.history.shift();
}

/**
 * Compute throw velocities from Cartesian position history.
 * Uses weighted finite-differences biased towards the most recent samples,
 * clamps to a sane max speed, and projects tangent to the constraint surface.
 */
function computeThrowVelocities(handKey) {
    const handState = grabInfo[handKey];
    const otherState = grabInfo[handKey === 'left' ? 'right' : 'left'];
    const history = handState.history;
    if (history.length < 2) return;

    const n = Math.min(history.length, 6);
    const recent = history.slice(-n);

    const v1 = _throwV1;
    const v2 = _throwV2;
    v1.set(0, 0, 0);
    v2.set(0, 0, 0);
    let totalWeight = 0;

    for (let i = 1; i < recent.length; i++) {
        const dt = recent[i].time - recent[i - 1].time;
        if (dt < 0.0001) continue;
        const w = i;
        v1.addScaledVector(_throwDiff.subVectors(recent[i].pos1, recent[i - 1].pos1), w / dt);
        v2.addScaledVector(_throwDiff.subVectors(recent[i].pos2, recent[i - 1].pos2), w / dt);
        totalWeight += w;
    }

    if (totalWeight <= 0) return;
    v1.divideScalar(totalWeight);
    v2.divideScalar(totalWeight);

    const maxSpeed = 2.0;
    if (v1.length() > maxSpeed) v1.setLength(maxSpeed);
    if (v2.length() > maxSpeed) v2.setLength(maxSpeed);

    // Project velocities tangent to constraints (no energy wasted on radial stretch)
    _throwN1.copy(pendulumState.pos1).normalize();
    v1.addScaledVector(_throwN1, -v1.dot(_throwN1));

    _throwRod2Dir.subVectors(pendulumState.pos2, pendulumState.pos1).normalize();
    _throwRelV.subVectors(v2, v1);
    _throwRadial.copy(_throwRod2Dir).multiplyScalar(_throwRelV.dot(_throwRod2Dir));
    v2.sub(_throwRadial);

    if (handState.target === 'mass1') {
        pendulumState.vel1.copy(v1);
        if (!otherState.target) pendulumState.vel2.copy(v2);
    } else if (handState.target === 'mass2') {
        pendulumState.vel2.copy(v2);
        if (otherState.target !== 'mass1') pendulumState.vel1.copy(v1);
    }
}

/**
 * Spherical to Cartesian conversion
 */
function sphericalToCartesian(theta, phi, length) {
    return new THREE.Vector3(
        length * Math.sin(theta) * Math.cos(phi),
        -length * Math.cos(theta),
        length * Math.sin(theta) * Math.sin(phi)
    );
}

/**
 * Cartesian to Spherical conversion
 */
function cartesianToSpherical(pos, length) {
    const r = pos.length();
    const theta = Math.acos(THREE.MathUtils.clamp(-pos.y / r, -1, 1));
    const phi = Math.atan2(pos.z, pos.x);
    return { theta, phi };
}

/**
 * Inverse Kinematics for 2-link chain
 * Given target position for mass2, solve for both joint angles
 */
function solveIK(targetPos) {
    const L1 = pendulumConfig.length1;
    const L2 = pendulumConfig.length2;
    
    // Distance from pivot to target
    const targetDist = targetPos.length();
    
    // Clamp target to reachable space
    const maxReach = L1 + L2;
    const minReach = Math.abs(L1 - L2);
    
    let reachableTarget = targetPos.clone();
    if (targetDist > maxReach) {
        reachableTarget.normalize().multiplyScalar(maxReach * 0.95);
    } else if (targetDist < minReach) {
        reachableTarget.normalize().multiplyScalar(minReach * 1.05);
    }
    
    const d = reachableTarget.length();
    
    // Use law of cosines to find the "elbow" angle
    // This gives us the angle between the two links
    const cosElbow = (L1 * L1 + L2 * L2 - d * d) / (2 * L1 * L2);
    const elbowAngle = Math.acos(THREE.MathUtils.clamp(cosElbow, -1, 1));
    
    // Find position of mass1 (elbow) using the elbow angle
    // First, work in 2D plane containing pivot and target
    const targetDir = reachableTarget.clone().normalize();
    
    // Angle for first link in the plane
    const cosTheta1 = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const theta1Offset = Math.acos(THREE.MathUtils.clamp(cosTheta1, -1, 1));
    
    // Position of mass1 in direction rotated from target direction
    const mass1Dist = L1;
    
    // Create rotation axis perpendicular to target direction and up
    const up = new THREE.Vector3(0, 1, 0);
    const rotAxis = new THREE.Vector3().crossVectors(targetDir, up).normalize();
    if (rotAxis.lengthSq() < 0.01) {
        rotAxis.set(1, 0, 0); // Fallback if target is vertical
    }
    
    // Rotate target direction by theta1Offset around rotation axis
    const mass1Dir = targetDir.clone();
    mass1Dir.applyAxisAngle(rotAxis, -theta1Offset);
    
    const mass1Pos = mass1Dir.multiplyScalar(mass1Dist);
    
    // Convert to spherical coordinates
    const spherical1 = cartesianToSpherical(mass1Pos, L1);
    
    // Mass 2 is relative to mass 1
    const mass2Relative = reachableTarget.clone().sub(mass1Pos);
    const spherical2 = cartesianToSpherical(mass2Relative, L2);
    
    return {
        theta1: spherical1.theta,
        phi1: spherical1.phi,
        theta2: spherical2.theta,
        phi2: spherical2.phi
    };
}

/**
 * Iterative Gauss-Seidel constraint projection for the two-link chain.
 * Each constraint is solved independently and they converge through iteration.
 * No carry-along — the pivot force reaches mass2 only through rod2 tension.
 */
function enforceConstraints(pos1, pos2, m1, m2, L1, L2) {
    const w1 = 1.0 / m1;
    const w2 = 1.0 / m2;
    const wSum = w1 + w2;
    const delta = _enforceConstraintDelta;
    const tol = 5e-6;

    for (let i = 0; i < 20; i++) {
        // Constraint 1: |pos1| = L1 (pivot has infinite mass — only pos1 moves)
        const d1 = pos1.length();
        if (d1 > 0.0001) {
            pos1.multiplyScalar(L1 / d1);
        }

        // Constraint 2: |pos2 - pos1| = L2 (mass-weighted correction)
        delta.subVectors(pos2, pos1);
        const d2 = delta.length();
        if (d2 > 0.0001) {
            const s = (d2 - L2) / (d2 * wSum);
            pos1.addScaledVector(delta, s * w1);
            pos2.addScaledVector(delta, -s * w2);
        }

        const err1 = Math.abs(pos1.length() - L1);
        delta.subVectors(pos2, pos1);
        const err2 = Math.abs(delta.length() - L2);
        if (err1 < tol && err2 < tol) break;
    }
}

/**
 * Constrained-dynamics integrator (Lagrange multipliers + RK4).
 * • Singularity-free (no spherical coordinates in the dynamics)
 * • Rod tensions solved exactly each evaluation (2×2 linear system) — no
 *   position-projection dissipation, so chaotic motion persists indefinitely
 * • enforceConstraints/velocity projection only mop up tiny numerical drift
 */
const PHYSICS_SUBSTEP_MIN = 6;
const PHYSICS_SUBSTEP_MAX = 48;
const PHYSICS_SUBSTEP_REF_DELTA = 0.02;
/** Max m_heavy/m_light before extra substeps + accel clamps kick in hard. */
const MASS_RATIO_STIFF_THRESHOLD = 8;
/** Hard ceiling vs freefall-from-chain scale — stops runaway before rods can visually detach. */
const PENDULUM_SPEED_CEILING_FACTOR = 5;

function getPendulumMassRatio() {
    const m1 = Math.max(pendulumConfig.mass1, 1e-9);
    const m2 = Math.max(pendulumConfig.mass2, 1e-9);
    return Math.max(m1, m2) / Math.min(m1, m2);
}

function getPendulumMaxSpeed() {
    const L = Math.max(pendulumConfig.length1 + pendulumConfig.length2, 0.05);
    const g = Math.max(Math.abs(pendulumConfig.gravity), 0.1);
    return Math.sqrt(2 * g * L) * PENDULUM_SPEED_CEILING_FACTOR;
}

function getPendulumMaxAccel() {
    const Lmin = Math.max(Math.min(pendulumConfig.length1, pendulumConfig.length2), 0.05);
    const g = Math.max(Math.abs(pendulumConfig.gravity), 0.1);
    const vMax = getPendulumMaxSpeed();
    // Bound centripetal + tension spikes from extreme mass ratios
    return g + (vMax * vMax) / Lmin * 2;
}

function clampVecLength(v, maxLen) {
    const lenSq = v.lengthSq();
    if (lenSq > maxLen * maxLen && lenSq > 1e-24) {
        v.multiplyScalar(maxLen / Math.sqrt(lenSq));
    }
}

/**
 * Keep positions on the rods and kill insane speeds (extreme m1≪m2 stiffens the
 * Lagrange system so one RK4 step can otherwise jump masses off the constraint).
 */
function stabilizePendulumState(state) {
    const { length1: L1, length2: L2, mass1: m1, mass2: m2 } = pendulumConfig;
    enforceConstraints(state.pos1, state.pos2, m1, m2, L1, L2);
    projectVelocitiesToConstraints(state, m1, m2);
    const vMax = getPendulumMaxSpeed();
    clampVecLength(state.vel1, vMax);
    clampVecLength(state.vel2, vMax);
    projectVelocitiesToConstraints(state, m1, m2);
}

function getAdaptivePhysicsSubsteps(delta, interactionBoost) {
    const base = pendulumConfig.physicsSubsteps;
    let n = base;
    if (delta > PHYSICS_SUBSTEP_REF_DELTA) {
        n = Math.max(PHYSICS_SUBSTEP_MIN, Math.round(base * PHYSICS_SUBSTEP_REF_DELTA / delta));
    }
    if (interactionBoost) {
        n = Math.min(base, n + 2);
    }
    // Extreme mass ratios → stiff elbow dynamics; need smaller RK4 steps
    const ratio = getPendulumMassRatio();
    if (ratio > MASS_RATIO_STIFF_THRESHOLD) {
        const boost = Math.min(4, 1 + (ratio - MASS_RATIO_STIFF_THRESHOLD) / MASS_RATIO_STIFF_THRESHOLD);
        n = Math.round(n * boost);
    }
    const speed = Math.max(pendulumState.vel1.length(), pendulumState.vel2.length());
    const vMax = getPendulumMaxSpeed();
    if (speed > vMax * 0.55) {
        n = Math.round(n * 1.5);
    }
    return Math.min(PHYSICS_SUBSTEP_MAX, Math.max(PHYSICS_SUBSTEP_MIN, n));
}

const _accelN1 = new THREE.Vector3();
const _accelU = new THREE.Vector3();

/**
 * Exact rod tensions via Lagrange multipliers (2×2 linear system), then
 * accelerations. Rod 1: pivot↔mass1 (pivot has infinite mass). Rod 2: mass1↔mass2.
 */
function computeAccelerations(p1, p2, v1, v2, outA1, outA2) {
    const { gravity: g, mass1: m1, mass2: m2 } = pendulumConfig;
    const w1 = 1 / m1;
    const w2 = 1 / m2;

    const d1 = p1.length();
    const d2 = _accelU.subVectors(p2, p1).length();
    if (d1 < 1e-9 || d2 < 1e-9) {
        outA1.set(0, -g, 0);
        outA2.set(0, -g, 0);
        return;
    }
    _accelN1.copy(p1).multiplyScalar(1 / d1);
    _accelU.multiplyScalar(1 / d2);

    // Acceleration-level constraints: n1·a1 = -|v1|²/d1 ; u·(a2−a1) = -|v2−v1|²/d2
    const c = _accelN1.dot(_accelU);
    const b1 = -g * _accelN1.y + v1.lengthSq() / d1;
    const b2 = v1.distanceToSquared(v2) / d2;

    // [ w1     -c·w1  ][T1]   [b1]
    // [ -c·w1  w1+w2  ][T2] = [b2]   (det > 0 always: reduces to w1·w2 when |c|=1)
    const det = w1 * (w1 + w2 - c * c * w1);
    if ( !Number.isFinite(det) || Math.abs(det) < 1e-18 ) {
        outA1.set(0, -g, 0);
        outA2.set(0, -g, 0);
        return;
    }
    const T1 = (b1 * (w1 + w2) + b2 * c * w1) / det;
    const T2 = w1 * (b2 + c * b1) / det;

    outA1.set(0, -g, 0).addScaledVector(_accelN1, -T1 * w1).addScaledVector(_accelU, T2 * w1);
    outA2.set(0, -g, 0).addScaledVector(_accelU, -T2 * w2);

    // Cap runaway a from nearly-massless elbow (T/m₁) before RK4 integrates it
    const aMax = getPendulumMaxAccel();
    clampVecLength(outA1, aMax);
    clampVecLength(outA2, aMax);
}

// RK4 scratch (module-level to avoid per-step allocation)
const _rkP1 = new THREE.Vector3(), _rkP2 = new THREE.Vector3();
const _rkV1 = new THREE.Vector3(), _rkV2 = new THREE.Vector3();
const _rkKv1 = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _rkKv2 = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _rkKa1 = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const _rkKa2 = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
const RK4_STAGE_OFFSET = [0, 0.5, 0.5, 1];
const RK4_COMBINE_WEIGHT = [1 / 6, 1 / 3, 1 / 3, 1 / 6];

function integratePhysics(state, dt) {
    if (isAnyGrabbed()) return;

    // Classic RK4 on the 12-dim state (p1, p2, v1, v2) with exact constraint forces
    for (let s = 0; s < 4; s++) {
        if (s === 0) {
            _rkP1.copy(state.pos1);
            _rkP2.copy(state.pos2);
            _rkV1.copy(state.vel1);
            _rkV2.copy(state.vel2);
        } else {
            const hs = RK4_STAGE_OFFSET[s] * dt;
            _rkP1.copy(state.pos1).addScaledVector(_rkKv1[s - 1], hs);
            _rkP2.copy(state.pos2).addScaledVector(_rkKv2[s - 1], hs);
            _rkV1.copy(state.vel1).addScaledVector(_rkKa1[s - 1], hs);
            _rkV2.copy(state.vel2).addScaledVector(_rkKa2[s - 1], hs);
        }
        _rkKv1[s].copy(_rkV1);
        _rkKv2[s].copy(_rkV2);
        computeAccelerations(_rkP1, _rkP2, _rkV1, _rkV2, _rkKa1[s], _rkKa2[s]);
    }

    for (let s = 0; s < 4; s++) {
        const w = RK4_COMBINE_WEIGHT[s] * dt;
        state.pos1.addScaledVector(_rkKv1[s], w);
        state.pos2.addScaledVector(_rkKv2[s], w);
        state.vel1.addScaledVector(_rkKa1[s], w);
        state.vel2.addScaledVector(_rkKa2[s], w);
    }

    // Mop up tiny numerical drift (O(dt⁵) per step — corrections are negligible,
    // unlike PBD projection which absorbed the whole integration error and
    // dissipated the chaotic motion into a simple orbit)
    stabilizePendulumState(state);

    // Damping (explicit user option; 1 = frictionless)
    if (pendulumConfig.damping !== 1) {
        state.vel1.multiplyScalar(pendulumConfig.damping);
        state.vel2.multiplyScalar(pendulumConfig.damping);
    }
}

/**
 * Remove radial (constraint-violating) velocity components so drift doesn't
 * accumulate. Tangential motion is untouched → no artificial damping.
 */
function projectVelocitiesToConstraints(state, m1, m2) {
    const w1 = 1 / m1;
    const w2 = 1 / m2;

    // Rod 1: pivot is immovable — remove v1's radial component
    const d1 = _accelN1.copy(state.pos1).length();
    if (d1 > 1e-9) {
        _accelN1.multiplyScalar(1 / d1);
        state.vel1.addScaledVector(_accelN1, -state.vel1.dot(_accelN1));
    }

    // Rod 2: mass-weighted removal of relative radial velocity
    const d2 = _accelU.subVectors(state.pos2, state.pos1).length();
    if (d2 > 1e-9) {
        _accelU.multiplyScalar(1 / d2);
        const relRadial = (state.vel2.dot(_accelU) - state.vel1.dot(_accelU)) / (w1 + w2);
        state.vel1.addScaledVector(_accelU, relRadial * w1);
        state.vel2.addScaledVector(_accelU, -relRadial * w2);
    }
}

/**
 * SI energies: KE = ½m|v|²; PE = m g y (+Y up, y from pivot; same g as integratePhysics).
 */
function computePendulumEnergies( state ) {
	const { mass1: m1, mass2: m2, gravity: g } = pendulumConfig;
	const ke = 0.5 * m1 * state.vel1.lengthSq() + 0.5 * m2 * state.vel2.lengthSq();
	const pe = m1 * g * state.pos1.y + m2 * g * state.pos2.y;
	return { ke, pe, total: ke + pe };
}

/**
 * Energy renormalization — bleed excess only.
 * Never scale velocities *up* (that was ratcheting insane speeds when PE/mass
 * edits inflated _energyTarget). Slow positive drift from RK4 is negligible.
 */
let _energyTarget = null;

function setEnergyTarget() {
	const { total } = computePendulumEnergies( pendulumState );
	const { mass1: m1, mass2: m2, gravity: g, length1: L1, length2: L2 } = pendulumConfig;
	const vMax = getPendulumMaxSpeed();
	// Plausible ceiling: KE at speed cap + PE if both masses were at max height (+L)
	const peCeil = m1 * g * L1 + m2 * g * ( L1 + L2 );
	const keCeil = 0.5 * m1 * vMax * vMax + 0.5 * m2 * vMax * vMax;
	_energyTarget = Math.min( total, peCeil + keCeil );
}

function renormalizeEnergy( state ) {
	if ( _energyTarget === null ) { setEnergyTarget(); return; }
	const { ke, pe } = computePendulumEnergies( state );
	const targetKE = _energyTarget - pe;
	if ( ke < 1e-10 ) return;
	if ( targetKE <= 0 ) {
		state.vel1.set( 0, 0, 0 );
		state.vel2.set( 0, 0, 0 );
		return;
	}
	const scale = Math.sqrt( targetKE / ke );
	// Bleed excess only — never pump energy back in
	if ( scale >= 1 ) return;
	state.vel1.multiplyScalar( scale );
	state.vel2.multiplyScalar( scale );
}

/**
 * Visual Elements
 */
function createMassLabelSprite( label, sphereRadius ) {
	const size = 256;
	const canvas = document.createElement( 'canvas' );
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext( '2d' );
	ctx.clearRect( 0, 0, size, size );
	ctx.fillStyle = '#ffffff';
	ctx.font = 'bold 128px system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.fillText( label, size / 2, size / 2 );
	const map = new THREE.CanvasTexture( canvas );
	map.colorSpace = THREE.SRGBColorSpace;
	const mat = new THREE.SpriteMaterial( {
		map,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false
	} );
	const sprite = new THREE.Sprite( mat );
	sprite.renderOrder = 999;
	const w = sphereRadius * 3.4;
	sprite.userData.baseSize = w;
	sprite.scale.set( w, w, 1 );
	sprite.position.set( 0, 0, 0 );
	return sprite;
}

function getViewCameraWorld( outPos, outQuat ) {
	if ( renderer.xr.isPresenting ) {
		const xrCam = renderer.xr.getCamera();
		xrCam.getWorldPosition( outPos );
		xrCam.getWorldQuaternion( outQuat );
	} else {
		camera.getWorldPosition( outPos );
		camera.getWorldQuaternion( outQuat );
	}
}

/** Keep label on camera-right of ball; parent must be the mass mesh (worldToLocal). */
function updateMassLabelSpritePosition( sprite, massMesh, sphereRadius ) {
	massMesh.getWorldPosition( _labelBallWorld );
	getViewCameraWorld( _labelCamWorld, _labelCamQuat );
	_labelViewDir.subVectors( _labelCamWorld, _labelBallWorld );
	const dist = _labelViewDir.length();
	if ( dist < 1e-6 ) return;
	_labelViewDir.multiplyScalar( 1 / dist );
	_labelCamRight.set( 1, 0, 0 ).applyQuaternion( _labelCamQuat );
	_labelScreenRight.copy( _labelCamRight ).addScaledVector( _labelViewDir, -_labelCamRight.dot( _labelViewDir ) );
	if ( _labelScreenRight.lengthSq() < 1e-10 ) {
		_labelScreenRight.crossVectors( _upVector, _labelViewDir );
		if ( _labelScreenRight.lengthSq() < 1e-10 ) _labelScreenRight.set( 0, 0, 1 );
	}
	_labelScreenRight.normalize();
	massMesh.getWorldScale( _labelMassWorldScale );
	const worldS = Math.max(
		_labelMassWorldScale.x,
		_labelMassWorldScale.y,
		_labelMassWorldScale.z
	);
	const localMassS = Math.max( massMesh.scale.x, massMesh.scale.y, massMesh.scale.z, 1e-6 );
	// Exclude mass-only scaling so text size stays constant when mass sliders resize the ball.
	const nonMassWorldS = worldS / localMassS;
	const cfg = pendulumConfig;
	const ref = cfg.massLabelOverscaleRef;
	const exp = cfg.massLabelOverscaleExponent;
	const damp = Math.pow( Math.max( 1, nonMassWorldS / ref ), -exp );
	const baseW = sprite.userData.baseSize ?? ( sphereRadius * 3.4 );
	sprite.scale.set( ( baseW * nonMassWorldS * damp ) / worldS, ( baseW * nonMassWorldS * damp ) / worldS, 1 );
	const hw = cfg.massLabelOffsetHalfWidthFactor;
	const halfW = sprite.scale.x * 0.5;
	// `sphereRadius` already tracks mass scaling; use baked geometry radius with world scale to avoid double-counting.
	const worldSphereRadius = massMesh.geometry.parameters.radius * worldS;
	const worldHalfW = halfW * worldS;
	const gap = cfg.massLabelGap * nonMassWorldS * damp;
	const offset = worldSphereRadius + gap + worldHalfW * hw;
	_labelWorldPos.copy( _labelBallWorld ).addScaledVector( _labelScreenRight, offset );
	massMesh.worldToLocal( sprite.position.copy( _labelWorldPos ) );
}

// Pivot point
const pivotGeometry = new THREE.SphereGeometry(pendulumConfig.pivotRadius, 16, 16);
const pivotMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const pivot = new THREE.Mesh(pivotGeometry, pivotMaterial);
pivot.frustumCulled = false;
pendulumAnchor.add(pivot);

// Mass 1
const mass1Geometry = new THREE.SphereGeometry(pendulumConfig.sphereRadius1, 16, 16);
const mass1Material = new THREE.MeshBasicMaterial({
    color: 0xff8800 // orange for middle ball
});
const mass1BaseColor = 0xff8800;
const mass1GrabColor = 0xffaa55;
const mass1 = new THREE.Mesh(mass1Geometry, mass1Material);
mass1.frustumCulled = false;
pendulumAnchor.add(mass1);
const mass1Label = createMassLabelSprite( 'M\u2081', pendulumConfig.sphereRadius1 );
mass1.add( mass1Label );

// Mass 2
const mass2Geometry = new THREE.SphereGeometry(pendulumConfig.sphereRadius2, 16, 16);
const mass2Material = new THREE.MeshBasicMaterial({
    color: 0xffdd44
});
const mass2BaseColor = 0xffdd44;
const mass2GrabColor = 0xffffaa;
const mass2 = new THREE.Mesh(mass2Geometry, mass2Material);
mass2.frustumCulled = false;
pendulumAnchor.add(mass2);
const mass2Label = createMassLabelSprite( 'M\u2082', pendulumConfig.sphereRadius2 );
mass2.add( mass2Label );

/** First-open hint to the right of the end mass (matches Chladni Tune / Refraction Ray Mode). */
const DRAG_HINT_TEXT = 'Drag';
const DRAG_HINT_TEXT_SIZE = 0.00864;
const DRAG_HINT_ARROW_W = 0.0072;
const DRAG_HINT_ARROW_H = 0.0048;
const DRAG_HINT_ARROW_X = 0.021;
/** Local scale: 1.44 world at default container scale, then inherits two-hand scale like M₁/M₂. */
const DRAG_HINT_SCALE = 1.44 / (containerGroup.scale.x || 1);
const DRAG_HINT_X_NUDGE = -0.006;
const DRAG_HINT_FADE_DURATION = 0.4;

const dragHintFont = new FontLoader().parse(helvetikerBold);

function buildDragHintTextGeometry(text) {
    const geometry = new THREE.ShapeGeometry(dragHintFont.generateShapes(text, DRAG_HINT_TEXT_SIZE));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    geometry.translate(
        -(box.max.x + box.min.x) * 0.5,
        -(box.max.y + box.min.y) * 0.5,
        0
    );
    return geometry;
}

const dragHintMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
});

const dragHint = new THREE.Group();
dragHint.frustumCulled = false;
dragHint.scale.setScalar(DRAG_HINT_SCALE);
pendulumAnchor.add(dragHint);

const dragHintContent = new THREE.Group();
dragHintContent.position.set(
    (pendulumConfig.sphereRadius2 + DRAG_HINT_X_NUDGE) / DRAG_HINT_SCALE,
    0,
    0.003
);
dragHint.add(dragHintContent);

const dragHintArrowShape = new THREE.Shape();
dragHintArrowShape.moveTo(-DRAG_HINT_ARROW_H * 0.5, 0);
dragHintArrowShape.lineTo(DRAG_HINT_ARROW_H * 0.5, DRAG_HINT_ARROW_W * 0.5);
dragHintArrowShape.lineTo(DRAG_HINT_ARROW_H * 0.5, -DRAG_HINT_ARROW_W * 0.5);
dragHintArrowShape.closePath();

const dragHintArrow = new THREE.Mesh(
    new THREE.ShapeGeometry(dragHintArrowShape),
    dragHintMaterial
);
dragHintArrow.position.set(DRAG_HINT_ARROW_X, 0, 0);
dragHintArrow.renderOrder = 6;
dragHintArrow.frustumCulled = false;
dragHintContent.add(dragHintArrow);

const dragHintLabelGeometry = buildDragHintTextGeometry(DRAG_HINT_TEXT);
const dragHintLabelWidth = dragHintLabelGeometry.boundingBox.max.x - dragHintLabelGeometry.boundingBox.min.x;
const dragHintLabel = new THREE.Mesh(dragHintLabelGeometry, dragHintMaterial);
dragHintLabel.position.set(
    DRAG_HINT_ARROW_X + DRAG_HINT_ARROW_H * 0.5 + 0.006 + dragHintLabelWidth * 0.5,
    0,
    0
);
dragHintLabel.renderOrder = 6;
dragHintLabel.frustumCulled = false;
dragHintContent.add(dragHintLabel);

let dragHintDismissed = false;

function dismissDragHint() {
    if (dragHintDismissed) return;
    dragHintDismissed = true;

    gsap.to(dragHintMaterial, {
        opacity: 0,
        duration: DRAG_HINT_FADE_DURATION,
        ease: 'power2.out',
        onComplete: () => {
            dragHint.visible = false;
        },
    });
}

function updateDragHint() {
    if (dragHintDismissed && !dragHint.visible) return;

    if (!dragHintDismissed && simFlags.infoUIEnabled) {
        dismissDragHint();
    }

    if (!dragHint.visible) return;

    dragHint.position.set(0, -(pendulumConfig.length1 + pendulumConfig.length2), 0);
    dragHintContent.position.x = (pendulumConfig.sphereRadius2 + DRAG_HINT_X_NUDGE) / DRAG_HINT_SCALE;

    getViewCameraWorld(_dragHintCamWorld, _labelCamQuat);
    dragHint.getWorldPosition(_dragHintWorld);
    const dx = _dragHintCamWorld.x - _dragHintWorld.x;
    const dz = _dragHintCamWorld.z - _dragHintWorld.z;
    if (dx * dx + dz * dz < 1e-10) return;

    _dragHintWorldYawQuat.setFromAxisAngle(_dragHintYAxis, Math.atan2(dx, dz));
    dragHint.parent.getWorldQuaternion(_dragHintParentWorldQuat);
    dragHint.quaternion.copy(_dragHintParentWorldQuat.invert()).multiply(_dragHintWorldYawQuat);
}

/** Baked SphereGeometry radius; mesh scale matches `pendulumConfig.sphereRadius*`. */
const mass1SphereGeomRefRadius = mass1Geometry.parameters.radius;
const mass2SphereGeomRefRadius = mass2Geometry.parameters.radius;

// Rods (cylinder meshes, unlit white)
const rodGeometry = new THREE.CylinderGeometry(
    pendulumConfig.rodRadius,
    pendulumConfig.rodRadius,
    1,
    8,
    1
);
const rodMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
const rod1 = new THREE.Mesh(rodGeometry, rodMaterial);
const rod2 = new THREE.Mesh(rodGeometry, rodMaterial);
pendulumAnchor.add(rod1);
pendulumAnchor.add(rod2);

function updateRodCylinder(mesh, start, end) {
    _rodDir.subVectors(end, start);
    const len = _rodDir.length();
    if (len < 1e-6) {
        mesh.visible = false;
        return;
    }
    mesh.visible = true;
    _rodDir.multiplyScalar(1 / len);
    _rodMid.addVectors(start, end).multiplyScalar(0.5);
    mesh.position.copy(_rodMid);
    mesh.quaternion.setFromUnitVectors(_upVector, _rodDir);
    mesh.scale.set(1, len, 1);
}

/** Shared flags — MenuUI toggles these; Pendulum reads them each frame */
const simFlags = {
    /** Mass-2 trail accumulation (checkbox on floating header) */
    trailsEnabled: true,
    /** Mass ball labels + stats panel visibility (STATS checkbox on header) */
    infoUIEnabled: false
};

// Trail: tube mesh along sampled path (Line2/LineMaterial is unreliable in WebXR)
const trail2Points = [];
let trail2Dirty = false;

// Preallocated tube geometry, rewritten in place each update (no per-frame
// TubeGeometry allocation/dispose → no GC churn, stable XR frame pacing).
// MeshBasicMaterial needs no normals/UVs, so rings share seam vertices.
const TRAIL_RADIAL_SEGMENTS = 6;
const TRAIL_MAX_TUBULAR_SEGMENTS = 400;
const TRAIL_MAX_RINGS = TRAIL_MAX_TUBULAR_SEGMENTS + 1;

const trailPositions = new Float32Array(TRAIL_MAX_RINGS * TRAIL_RADIAL_SEGMENTS * 3);
const trailPositionAttr = new THREE.BufferAttribute(trailPositions, 3);
trailPositionAttr.setUsage(THREE.DynamicDrawUsage);

// Static index for the full-size tube; setDrawRange trims it while the trail grows
const trailIndex = new Uint16Array(TRAIL_MAX_TUBULAR_SEGMENTS * TRAIL_RADIAL_SEGMENTS * 6);
{
    let o = 0;
    for (let s = 0; s < TRAIL_MAX_TUBULAR_SEGMENTS; s++) {
        for (let r = 0; r < TRAIL_RADIAL_SEGMENTS; r++) {
            const rNext = (r + 1) % TRAIL_RADIAL_SEGMENTS;
            const a = s * TRAIL_RADIAL_SEGMENTS + r;
            const b = s * TRAIL_RADIAL_SEGMENTS + rNext;
            const c = (s + 1) * TRAIL_RADIAL_SEGMENTS + r;
            const d = (s + 1) * TRAIL_RADIAL_SEGMENTS + rNext;
            trailIndex[o++] = a; trailIndex[o++] = c; trailIndex[o++] = d;
            trailIndex[o++] = a; trailIndex[o++] = d; trailIndex[o++] = b;
        }
    }
}

const trailGeometry = new THREE.BufferGeometry();
trailGeometry.setAttribute('position', trailPositionAttr);
trailGeometry.setIndex(new THREE.BufferAttribute(trailIndex, 1));
trailGeometry.setDrawRange(0, 0);

const trail2Material = new THREE.MeshBasicMaterial({
    color: 0xffdd44,
    transparent: true,
    opacity: 0.8
});
const trail2 = new THREE.Mesh(trailGeometry, trail2Material);
trail2.frustumCulled = false;
trail2.visible = false;
pendulumAnchor.add(trail2);

// Reusable curve + sampling scratch (curve reads trail2Points live)
const trailCurve = new THREE.CatmullRomCurve3(trail2Points);
const trailRingCenters = [];
for (let i = 0; i < TRAIL_MAX_RINGS; i++) trailRingCenters.push(new THREE.Vector3());
const TRAIL_RADIAL_COS = [];
const TRAIL_RADIAL_SIN = [];
for (let r = 0; r < TRAIL_RADIAL_SEGMENTS; r++) {
    const a = (r / TRAIL_RADIAL_SEGMENTS) * Math.PI * 2;
    TRAIL_RADIAL_COS.push(Math.cos(a));
    TRAIL_RADIAL_SIN.push(Math.sin(a));
}
const _trailTangent = new THREE.Vector3();
const _trailNormal = new THREE.Vector3();
const _trailBinormal = new THREE.Vector3();

function seedTrailNormalPerpTo(tangent, outNormal) {
    const ax = Math.abs(tangent.x), ay = Math.abs(tangent.y), az = Math.abs(tangent.z);
    if (ax <= ay && ax <= az) outNormal.set(1, 0, 0);
    else if (ay <= az) outNormal.set(0, 1, 0);
    else outNormal.set(0, 0, 1);
    outNormal.addScaledVector(tangent, -outNormal.dot(tangent)).normalize();
}

/**
 * Rewrite the preallocated tube in place: sample the Catmull-Rom curve into ring
 * centers, sweep a hexagon along it using parallel-transported frames (finite-
 * difference tangents; the normal is carried ring to ring → no twisting).
 */
function rebuildTrailTube() {
    const tn = trail2Points.length;
    const tubularSegments = Math.min(Math.max(tn * 2, 8), TRAIL_MAX_TUBULAR_SEGMENTS);
    const radius = pendulumConfig.trailTubeRadius;

    for (let i = 0; i <= tubularSegments; i++) {
        trailCurve.getPoint(i / tubularSegments, trailRingCenters[i]);
    }

    let w = 0;
    for (let i = 0; i <= tubularSegments; i++) {
        const prev = trailRingCenters[i > 0 ? i - 1 : 0];
        const next = trailRingCenters[i < tubularSegments ? i + 1 : tubularSegments];
        _trailTangent.subVectors(next, prev);
        const tl = _trailTangent.length();
        if (tl > 1e-9) _trailTangent.multiplyScalar(1 / tl);

        if (i === 0) {
            seedTrailNormalPerpTo(_trailTangent, _trailNormal);
        } else {
            _trailNormal.addScaledVector(_trailTangent, -_trailNormal.dot(_trailTangent));
            if (_trailNormal.lengthSq() < 1e-12) seedTrailNormalPerpTo(_trailTangent, _trailNormal);
            else _trailNormal.normalize();
        }
        _trailBinormal.crossVectors(_trailTangent, _trailNormal);

        const c = trailRingCenters[i];
        for (let r = 0; r < TRAIL_RADIAL_SEGMENTS; r++) {
            const cos = TRAIL_RADIAL_COS[r], sin = TRAIL_RADIAL_SIN[r];
            trailPositions[w++] = c.x + radius * (cos * _trailNormal.x + sin * _trailBinormal.x);
            trailPositions[w++] = c.y + radius * (cos * _trailNormal.y + sin * _trailBinormal.y);
            trailPositions[w++] = c.z + radius * (cos * _trailNormal.z + sin * _trailBinormal.z);
        }
    }

    trailPositionAttr.needsUpdate = true;
    trailGeometry.setDrawRange(0, tubularSegments * TRAIL_RADIAL_SEGMENTS * 6);
}

function clearMass2Trail() {
    trail2Points.length = 0;
    trail2Dirty = false;
    trail2.visible = false;
    trailGeometry.setDrawRange(0, 0);
}

/**
 * Push a trail point once mass2 has traveled trailSampleSpacing from the last one.
 * Called after every physics substep (dense sampling at high speed) and once per
 * frame from updatePendulum (covers grab-dragging). The distance gate makes the
 * point spacing uniform, so the Catmull-Rom tube stays smooth at any speed.
 */
function sampleMass2Trail() {
    if (!simFlags.trailsEnabled || resetTransitionState.active) return;
    const pos2 = pendulumState.pos2;
    const spacing = pendulumConfig.trailSampleSpacing;
    const last = trail2Points[trail2Points.length - 1];
    if (last && last.distanceToSquared(pos2) < spacing * spacing) return;
    trail2Points.push(pos2.clone());
    if (trail2Points.length > pendulumConfig.trailLength) trail2Points.shift();
    trail2Dirty = true;
}

/**
 * Update Pendulum Visualization
 */
function updatePendulum() {
    const pos1 = pendulumState.pos1;
    const pos2 = pendulumState.pos2;

    mass1.position.copy(pos1);
    mass2.position.copy(pos2);
    updateDragHint();

    if ( simFlags.infoUIEnabled ) {
        updateMassLabelSpritePosition( mass1Label, mass1, pendulumConfig.sphereRadius1 );
        updateMassLabelSpritePosition( mass2Label, mass2, pendulumConfig.sphereRadius2 );
    }

    updateRodCylinder(rod1, _rodOrigin, pos1);
    updateRodCylinder(rod2, pos1, pos2);

    sampleMass2Trail();

    const tn = simFlags.trailsEnabled ? trail2Points.length : 0;
    const shouldShowTrail = tn >= 2;
    if ( ! trail2Dirty && trail2.visible === shouldShowTrail ) return;
    trail2Dirty = false;

    trail2.visible = shouldShowTrail;
    if (shouldShowTrail) rebuildTrailTube();
    else trailGeometry.setDrawRange(0, 0);
}

/**
 * Hand Interaction with Pendulum
 * Supports independent per-hand grab, two-handed manipulation, and throw velocity.
 */
function handlePendulumGrab(leftPinchActive, rightPinchActive, leftPinchPos, rightPinchPos, delta, elapsedTime) {
    const hands = [
        { active: leftPinchActive,  pos: leftPinchPos,  key: 'left'  },
        { active: rightPinchActive, pos: rightPinchPos, key: 'right' }
    ];

    if (leftPinchActive || rightPinchActive) {
        pendulumAnchor.updateMatrixWorld(true);
    }

    for (const hand of hands) {
        const state = grabInfo[hand.key];
        const otherKey = hand.key === 'left' ? 'right' : 'left';

        // --- Release detection ---
        if (!hand.active || !hand.pos) {
            if (state.target) {
                computeThrowVelocities(hand.key);
                state.target = null;
                state.history = [];
                clearMass2Trail();
                if ( !isAnyGrabbed() ) setEnergyTarget();
            }
            continue;
        }

        // World hand → pendulum anchor local (respects container move/rotate/scale)
        _pendulumLocalScratch.copy(hand.pos);
        pendulumAnchor.worldToLocal(_pendulumLocalScratch);
        const pendulumLocalPos = _pendulumLocalScratch;

        const pos1 = pendulumState.pos1;
        const pos2 = pendulumState.pos2;

        // --- Grab detection ---
        if (!state.target) {
            const dist1Sq = pendulumLocalPos.distanceToSquared(pos1);
            const dist2Sq = pendulumLocalPos.distanceToSquared(pos2);
            const otherState = grabInfo[otherKey];
            const m = pendulumConfig.grabMargin;
            const grabRadiusSq1 = (pendulumConfig.sphereRadius1 + m) ** 2;
            const grabRadiusSq2 = (pendulumConfig.sphereRadius2 + m) ** 2;

            const canGrab1 = dist1Sq < grabRadiusSq1 && otherState.target !== 'mass1';
            const canGrab2 = dist2Sq < grabRadiusSq2 && otherState.target !== 'mass2';

            if (canGrab1 && canGrab2) {
                state.target = dist1Sq < dist2Sq ? 'mass1' : 'mass2';
            } else if (canGrab2) {
                state.target = 'mass2';
            } else if (canGrab1) {
                state.target = 'mass1';
            }

            if (state.target) {
                state.history = [];
                pendulumState.vel1.set(0, 0, 0);
                pendulumState.vel2.set(0, 0, 0);
                dismissDragHint();
            }
        }

        // --- Update grabbed mass position (Cartesian, with constraint enforcement) ---
        if (state.target === 'mass1') {
            // Clamp hand to rod-1 sphere, carry mass2 along preserving rod-2 direction
            const rod2 = _grabRod2.subVectors(pos2, pos1);
            const rod2Len = rod2.length();
            if (rod2Len > 0.0001) rod2.multiplyScalar(pendulumConfig.length2 / rod2Len);

            const len = pendulumLocalPos.length();
            if (len > 0.0001) {
                pos1.copy(pendulumLocalPos).multiplyScalar(pendulumConfig.length1 / len);
            }
            pos2.copy(pos1).add(rod2);

        } else if (state.target === 'mass2') {
            const otherState = grabInfo[otherKey];
            if (otherState.target === 'mass1') {
                // Other hand holds mass1 — just constrain mass2 at rod-2 length from it
                const relPos = _grabRelPos.subVectors(pendulumLocalPos, pos1);
                const rLen = relPos.length();
                if (rLen > 0.0001) relPos.multiplyScalar(pendulumConfig.length2 / rLen);
                pos2.copy(pos1).add(relPos);
            } else {
                // IK to position both masses from target end-effector
                const ik = solveIK(pendulumLocalPos);
                const ikPos1 = sphericalToCartesian(ik.theta1, ik.phi1, pendulumConfig.length1);
                const ikRel2 = sphericalToCartesian(ik.theta2, ik.phi2, pendulumConfig.length2);
                pos1.copy(ikPos1);
                pos2.copy(ikPos1).add(ikRel2);
            }
        }

        // --- Record position history for throw velocity ---
        if (state.target) {
            recordPositionHistory(state, elapsedTime);
        }
    }

    // --- Visual feedback (MeshBasic — brighten color; no emissive) ---
    const m1Grabbed = grabInfo.left.target === 'mass1' || grabInfo.right.target === 'mass1';
    const m2Grabbed = grabInfo.left.target === 'mass2' || grabInfo.right.target === 'mass2';

    mass1Material.color.setHex( m1Grabbed ? mass1GrabColor : mass1BaseColor );
    mass2Material.color.setHex( m2Grabbed ? mass2GrabColor : mass2BaseColor );
}
function resetPendulumToVerticalRestPose() {
	pendulumState.pos1.set( 0, -pendulumConfig.length1, 0 );
	pendulumState.pos2.set( 0, -( pendulumConfig.length1 + pendulumConfig.length2 ), 0 );
	pendulumState.vel1.set( 0, 0, 0 );
	pendulumState.vel2.set( 0, 0, 0 );
}

function applyTinyResetSway() {
	const L1 = pendulumConfig.length1;
	const L2 = pendulumConfig.length2;
	const rand = () => Math.random() * 2 - 1;

	const p1x = rand() * 0.010;
	const p1z = rand() * 0.010;
	const p1y = -Math.sqrt( Math.max( L1 * L1 - p1x * p1x - p1z * p1z, 0 ) );
	pendulumState.pos1.set( p1x, p1y, p1z );

	const r2x = rand() * 0.013;
	const r2z = rand() * 0.013;
	const r2y = -Math.sqrt( Math.max( L2 * L2 - r2x * r2x - r2z * r2z, 0 ) );
	pendulumState.pos2.copy( pendulumState.pos1 ).add( new THREE.Vector3( r2x, r2y, r2z ) );

	pendulumState.vel1.set( rand() * 0.035, rand() * 0.008, rand() * 0.035 );
	pendulumState.vel2.set( rand() * 0.05, rand() * 0.01, rand() * 0.05 );
}

const resetTransitionState = {
	active: false,
	progress: 0
};

resetPendulumToVerticalRestPose();
applyTinyResetSway();


    const api = {
        pendulumConfig,
        PENDULUM_DEFAULTS,
        pendulumAnchor,
        pendulumState,
        grabInfo,
        isAnyGrabbed,
        simFlags,
        mass1,
        mass2,
        mass1Label,
        mass2Label,
        mass1SphereGeomRefRadius,
        mass2SphereGeomRefRadius,
        pivot,
        rod1,
        rod2,
        trail2,
        updatePendulum,
        handlePendulumGrab,
        getViewCameraWorld,
        computePendulumEnergies,
        setEnergyTarget,
        renormalizeEnergy,
        integratePhysics,
        stabilizePendulumState,
        getAdaptivePhysicsSubsteps,
        enforceConstraints,
        projectVelocitiesToConstraints,
        clearMass2Trail,
        sampleMass2Trail,
        resetPendulumToVerticalRestPose,
        applyTinyResetSway,
        resetTransitionState,
        _upVector
    };
    Object.assign(deps, api);
    return api;
}
