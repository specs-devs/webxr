import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

export function createAttractors(deps) {
    const { scene, camera, renderer } = deps;
let visualMode = 'ghost';

const simConfig = {
    dt: 0.005,
    warmupSteps: 2500,
    maxPoints: 30000,
    stepsPerFrame: 6,
};

// Reusable output object — avoids allocating {x,y,z} on every step() call.
const _stepOut = { x: 0, y: 0, z: 0 };

const ATTRACTOR_TYPES = {
    lorenz: {
        label: 'Lorenz',
        initial: { x: 0.1, y: 0, z: 27 },
        scale: 0.0082,
        center: { x: 0, y: 0, z: 25 },
        linewidth: 0.0018,
        ghostSpeed: 4,
        step(x, y, z, dt, out) {
            const sigma = 10;
            const rho = 28;
            const beta = 8 / 3;
            const dx = sigma * (y - x);
            const dy = x * (rho - z) - y;
            const dz = x * y - beta * z;
            out.x = x + dx * dt;
            out.y = y + dy * dt;
            out.z = z + dz * dt;
        },
    },
    rossler: {
        label: 'Rössler',
        initial: { x: 0.1, y: 0.1, z: 0.1 },
        scale: 0.018,
        center: { x: 0, y: 0, z: 12 },
        warmupSteps: 3000,
        maxPoints: 400000,
        dt: 0.005,
        strands: 18,
        strandJitter: 0.5,
        stepsPerFrame: 14,
        linewidth: 0.0025,
        ghostSpeed: 12,
        step(x, y, z, dt, out) {
            const a = 0.2;
            const b = 0.2;
            const c = 5.7;
            const dx = -y - z;
            const dy = x + a * y;
            const dz = b + z * (x - c);
            out.x = x + dx * dt;
            out.y = y + dy * dt;
            out.z = z + dz * dt;
        },
    },
    aizawa: {
        label: 'Aizawa',
        initial: { x: 0.1, y: 0, z: 0 },
        scale: 0.135,
        center: { x: 0, y: 0.1, z: 0.6 },
        warmupSteps: 4000,
        maxPoints: 520000,
        dt: 0.004,
        strands: 24,
        strandJitter: 0.3,
        stepsPerFrame: 14,
        linewidth: 0.0025,
        ghostSpeed: 18,
        step(x, y, z, dt, out) {
            const a = 0.95;
            const b = 0.7;
            const c = 0.6;
            const d = 3.5;
            const e = 0.25;
            const f = 0.1;
            const dx = (z - b) * x - d * y;
            const dy = d * x + (z - b) * y;
            const dz = c + a * z - (z ** 3) / 3 - (x * x + y * y) * (1 + e * z) + f * z * x ** 3;
            out.x = x + dx * dt;
            out.y = y + dy * dt;
            out.z = z + dz * dt;
        },
    },
    thomas: {
        label: 'Thomas',
        initial: { x: 2.1, y: 2.0, z: 1.8 },
        scale: 0.075 * 1.05,
        center: { x: 1.5, y: 1.5, z: 1.5 },
        rotation: { y: -Math.PI / 2 },
        warmupSteps: 5000,
        maxPoints: 900000,
        dt: 0.01,
        strands: 32,
        strandJitter: 0.3,
        stepsPerFrame: 20,
        linewidth: 0.0025,
        step(x, y, z, dt, out) {
            const b = 0.208186;
            const dx = Math.sin(y) - b * x;
            const dy = Math.sin(z) - b * y;
            const dz = Math.sin(x) - b * z;
            out.x = x + dx * dt;
            out.y = y + dy * dt;
            out.z = z + dz * dt;
        },
    },
    dadras: {
        label: 'Dadras',
        initial: { x: 1, y: 1, z: 1 },
        scale: 0.0150,
        center: { x: 1.5, y: 0, z: 0.3 },
        warmupSteps: 4000,
        maxPoints: 520000,
        dt: 0.005,
        strands: 20,
        strandJitter: 0.35,
        stepsPerFrame: 14,
        linewidth: 0.0025,
        ghostSpeed: 14,
        step(x, y, z, dt, out) {
            const a = 3;
            const b = 2.7;
            const c = 1.7;
            const d = 2;
            const h = 9;
            const dx = y - a * x + b * y * z;
            const dy = c * y - x * z + z;
            const dz = d * x * y - h * z;
            out.x = x + dx * dt;
            out.y = y + dy * dt;
            out.z = z + dz * dt;
        },
    },
    halvorsen: {
        label: 'Halvorsen',
        initial: { x: -1.48, y: -0.96, z: 0.92 },
        scale: 0.022 * 0.98,
        center: { x: -3, y: -3, z: -3 },
        rotation: { y: -Math.PI / 2 },
        warmupSteps: 5000,
        maxPoints: 700000,
        dt: 0.002,
        strands: 28,
        strandJitter: 0.4,
        stepsPerFrame: 16,
        linewidth: 0.0025,
        ghostSpeed: 16,
        step(x, y, z, dt, out) {
            const a = 1.4;
            const dx = -a * x - 4 * y - 4 * z - y * y;
            const dy = -a * y - 4 * z - 4 * x - z * z;
            const dz = -a * z - 4 * x - 4 * y - x * x;
            out.x = x + dx * dt;
            out.y = y + dy * dt;
            out.z = z + dz * dt;
        },
    },
    chen: {
        label: 'Chen',
        hidden: true,
        initial: { x: 0.1, y: 0, z: 27 },
        scale: 0.0075,
        center: { x: 0, y: 0, z: 24 },
        warmupSteps: 4000,
        maxPoints: 480000,
        dt: 0.002,
        strands: 18,
        strandJitter: 0.4,
        stepsPerFrame: 14,
        linewidth: 0.0018,
        ghostSpeed: 4,
        step(x, y, z, dt, out) {
            const a = 35;
            const b = 3;
            const c = 28;
            const dx = a * (y - x);
            const dy = (c - a) * x - x * z + c * y;
            const dz = x * y - b * z;
            out.x = x + dx * dt;
            out.y = y + dy * dt;
            out.z = z + dz * dt;
        },
    },
    dequanLi: {
        label: 'Dequan Li',
        initial: { x: 0.349, y: 0, z: -0.16 },
        scale: 0.0012 * 0.99,
        center: { x: 0, y: 0, z: 94 },
        warmupSteps: 5000,
        maxPoints: 600000,
        dt: 0.0003,
        strands: 26,
        strandJitter: 0.35,
        stepsPerFrame: 22,
        linewidth: 0.0025,
        ghostSpeed: 14,
        step(x, y, z, dt, out) {
            const a = 40;
            const c = 11 / 6;
            const d = 0.16;
            const e = 0.65;
            const k = 55;
            const f = 20;
            const dx = a * (y - x) + d * x * z;
            const dy = k * x + f * y - x * z;
            const dz = c * z + x * y - e * x * x;
            out.x = x + dx * dt;
            out.y = y + dy * dt;
            out.z = z + dz * dt;
        },
    },
};

const ATTRACTOR_KEYS = Object.keys(ATTRACTOR_TYPES).filter((key) => !ATTRACTOR_TYPES[key].hidden);

const maxTrailBuffer = Math.max(
    simConfig.maxPoints,
    ...Object.values(ATTRACTOR_TYPES).map((def) => def.maxPoints ?? 0)
);

// Pre-allocated segment-pair buffers for rebuildTrailMesh() — avoids GC pressure
// from repeated Float32Array allocations. Max segments = maxTrailBuffer - 1.
const _meshPosPairs = new Float32Array(maxTrailBuffer * 6);
const _meshColPairs = new Float32Array(maxTrailBuffer * 6);

// Accumulated 0-1 gradient offset for ghost mode — driven by ghostSpeed so
// faster attractors cycle faster. Reset on attractor switch.
let _ghostGradOffset = 0;
// path-index-units of ghost movement per full gradient cycle.
// Lower = faster cycling. Tuned so lorenz (~speed 4) cycles in ~5 s at 60 fps.
const GHOST_GRAD_CYCLE = 1200;


let currentAttractorKey = 'lorenz';
const attractorState = { x: 0.1, y: 0, z: 27 };
let attractorPointCount = 0;

const trailPositions = new Float32Array(maxTrailBuffer * 3);
const trailColors = new Float32Array(maxTrailBuffer * 3);

const trailGeometry = new THREE.BufferGeometry();
trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3));
trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColors, 3));
trailGeometry.setDrawRange(0, 0);

const trailMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
});

const trailLine = new THREE.Line(trailGeometry, trailMaterial);
deps.containerGroup.add(trailLine);

const trailMeshGeometry = new LineGeometry();
const trailMeshResolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
const trailMeshMaterial = new LineMaterial({
    color: 0xffffff,
    linewidth: 0.003,
    worldUnits: true,
    vertexColors: true,
    transparent: false,
    opacity: 1,
    depthWrite: true,
    linecap: 'butt',
    linejoin: 'bevel',
});
trailMeshMaterial.defines.USE_COLOR = '';
trailMeshMaterial.blending = THREE.NormalBlending;
trailMeshMaterial.resolution = trailMeshResolution;

window.addEventListener('resize', () => {
    trailMeshResolution.set(window.innerWidth, window.innerHeight);
    trailMeshMaterial.resolution.copy(trailMeshResolution);
});

// Inject a GPU-side gradient mapper so the cyclic shift in ghost mode costs
// only one uniform write per frame — no CPU loops, no buffer re-uploads.
// The mesh vertex colors store the raw gradient t (0-1) as grayscale;
// the shader maps t -> RGB and applies uGradientOffset at draw time.
trailMeshMaterial.uniforms.uGradientOffset = { value: 0.0 };
// Prepend the declaration so the GLSL compiler sees it.
trailMeshMaterial.fragmentShader = 'uniform float uGradientOffset;\n' +
    trailMeshMaterial.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
    {
        float gradT = mod(vColor.r + uGradientOffset, 1.0);
        diffuseColor.rgb = vec3(1.0, 0.92 - 0.52 * gradT, 0.18 - 0.13 * gradT);
    }`
    );
trailMeshMaterial.needsUpdate = true;

const trailMesh = new Line2(trailMeshGeometry, trailMeshMaterial);
trailMesh.visible = false;
trailMesh.frustumCulled = false;
deps.containerGroup.add(trailMesh);

const headMarker = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 12),
    new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    })
);
deps.containerGroup.add(headMarker);

const _attractorPos = new THREE.Vector3();
const _attractorLocalRot = new THREE.Euler(0, 0, 0, 'XYZ');
const _trailColor = new THREE.Color();

// ==========================================
// GHOST MODE — racing heads + dim ghost line
// ==========================================

const GHOST_HEAD_COUNT = 5;
const GHOST_TAIL_LEN = 120;
const GHOST_SPEED = 30; // path-indices advanced per frame per head

const ghostHeadMeshes = [];
const ghostTailLines = [];
const ghostTailData = [];   // { positions, colors, geo }
const ghostHeadIdx = [];    // current index into trailPositions buffer

for (let _h = 0; _h < GHOST_HEAD_COUNT; _h++) {
    const hMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.003, 8, 8),
        new THREE.MeshBasicMaterial({
            color: 0xffff00,
            transparent: true,
            opacity: 1.0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
        })
    );
    hMesh.renderOrder = 2;
    deps.containerGroup.add(hMesh);
    hMesh.visible = false;
    ghostHeadMeshes.push(hMesh);

    const tailPos = new Float32Array(GHOST_TAIL_LEN * 3);
    const tailCol = new Float32Array(GHOST_TAIL_LEN * 3);
    const tailGeo = new THREE.BufferGeometry();
    tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPos, 3));
    tailGeo.setAttribute('color', new THREE.BufferAttribute(tailCol, 3));
    tailGeo.setDrawRange(0, 0);
    const tailLine = new THREE.Line(tailGeo, new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
    }));
    tailLine.visible = false;
    // Render after the mesh so the additive glow composites on top and
    // never gets occluded by the mesh's normal-blend pass.
    tailLine.renderOrder = 1;
    deps.containerGroup.add(tailLine);
    ghostTailLines.push(tailLine);
    ghostTailData.push({ positions: tailPos, colors: tailCol, geo: tailGeo });
    ghostHeadIdx.push(0);
}

// ==========================================
// PARTICLE MODE — crystallisation from noise
// ==========================================

const MAX_PARTICLES = 6000;
const PARTICLE_LERP = 0.035;       // convergence speed per frame (0–1)
const PARTICLE_DRIFT_AMP = 0.003;  // world-units of idle oscillation after convergence
const PARTICLE_DRIFT_SPEED = 0.7;  // Hz of idle oscillation

const particlePosBuf = new Float32Array(MAX_PARTICLES * 3); // GPU positions
const particleColBuf = new Float32Array(MAX_PARTICLES * 3);
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePosBuf, 3));
particleGeo.setAttribute('color',    new THREE.BufferAttribute(particleColBuf, 3));
particleGeo.setDrawRange(0, 0);

const particleMat = new THREE.PointsMaterial({
    size: 0.0008,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
});

const particleMesh = new THREE.Points(particleGeo, particleMat);
particleMesh.visible = false;
particleMesh.frustumCulled = false;
deps.containerGroup.add(particleMesh);

const particleCurPos  = new Float32Array(MAX_PARTICLES * 3); // live interpolated positions
const particleTgtPos  = new Float32Array(MAX_PARTICLES * 3); // attractor targets
const particlePhases  = new Float32Array(MAX_PARTICLES);     // per-particle random drift phase
let   particleCount   = 0;

const TRAIL_COLOR_MODE_OPTIONS = {
    path: 'Path (time)',
    height: 'Height (Y)',
    depth: 'Depth (Z)',
    width: 'Width (X)',
    distance: 'From center',
    radial: 'Angle (XY)',
};
let trailColorMode = 'path';
let _strandPointCount = 0; // 0 = single strand
let _displayModeDirty = true;  // triggers syncTrailDisplayMode on next frame
let _headMarkerDirty = true;   // triggers syncHeadMarkerVisibility on next frame
const _containerHalf = deps.containerConfig.containerSize * 0.5;
const _containerDiagonal = _containerHalf * Math.sqrt(3);

function getCurrentAttractor() {
    return ATTRACTOR_TYPES[currentAttractorKey];
}

function getAttractorSimParam(key) {
    const def = getCurrentAttractor();
    return def[key] !== undefined ? def[key] : simConfig[key];
}

function attractorStep(x, y, z) {
    getCurrentAttractor().step(x, y, z, getAttractorSimParam('dt'), _stepOut);
    return _stepOut;
}

function attractorToLocal(x, y, z, target) {
    const { scale, center, rotation } = getCurrentAttractor();
    target.set(
        (x - center.x) * scale,
        (y - center.y) * scale,
        (z - center.z) * scale
    );
    if (rotation) {
        _attractorLocalRot.set(rotation.x ?? 0, rotation.y ?? 0, rotation.z ?? 0);
        target.applyEuler(_attractorLocalRot);
    }
    return target;
}

function resetAttractorStateFromDefinition() {
    const { initial } = getCurrentAttractor();
    attractorState.x = initial.x;
    attractorState.y = initial.y;
    attractorState.z = initial.z;
}

function setAttractorKey(key) {
    if (!ATTRACTOR_TYPES[key]) return;
    currentAttractorKey = key;
    deps.currentAttractorKey = key;
    resetAttractorStateFromDefinition();
    initAttractor();
    deps.syncAttractorEquationPlane();
    if (deps.containerAttractorLabelFont) {
        deps.buildContainerAttractorLabel(deps.containerAttractorLabelFont);
        if (typeof deps.buildUiRowPanelLabel === 'function') {
            deps.buildUiRowPanelLabel(deps.containerAttractorLabelFont);
        }
        if (typeof deps.updateUiRowPanelListHighlight === 'function') {
            deps.updateUiRowPanelListHighlight();
        }
    }
    if (typeof attractorGuiState !== 'undefined') {
        attractorGuiState.type = getCurrentAttractor().label;
    }
}

function cycleAttractor(step) {
    const idx = ATTRACTOR_KEYS.indexOf(currentAttractorKey);
    if (idx < 0) return;
    const nextIdx = (idx + step + ATTRACTOR_KEYS.length) % ATTRACTOR_KEYS.length;
    setAttractorKey(ATTRACTOR_KEYS[nextIdx]);
}

function cycleAttractorPrev() {
    cycleAttractor(-1);
}

function cycleAttractorNext() {
    cycleAttractor(1);
}

function trailGradientT(index, localPos) {
    switch (trailColorMode) {
        case 'height':
            return THREE.MathUtils.clamp((localPos.y + _containerHalf) / deps.containerConfig.containerSize, 0, 1);
        case 'depth':
            return THREE.MathUtils.clamp((localPos.z + _containerHalf) / deps.containerConfig.containerSize, 0, 1);
        case 'width':
            return THREE.MathUtils.clamp((localPos.x + _containerHalf) / deps.containerConfig.containerSize, 0, 1);
        case 'distance':
            return THREE.MathUtils.clamp(localPos.length() / _containerDiagonal, 0, 1);
        case 'radial':
            return Math.atan2(localPos.y, localPos.x) / (Math.PI * 2) + 0.5;
        case 'path':
        default: {
            if (_strandPointCount > 1) {
                return (index % _strandPointCount) / (_strandPointCount - 1);
            }
            // Use maxPoints as fixed denominator so each point's color is stable
            // once written — avoids a full O(n) recolor every frame in draw mode.
            return index / Math.max(1, getAttractorSimParam('maxPoints') - 1);
        }
    }
}

function applyTrailGradientColor(t) {
    _trailColor.setRGB(1.0, 0.92 - t * 0.52, 0.18 - t * 0.13, THREE.SRGBColorSpace);
}

function setTrailVertexColor(index, localPos) {
    applyTrailGradientColor(trailGradientT(index, localPos));
    const i3 = index * 3;
    trailColors[i3] = _trailColor.r;
    trailColors[i3 + 1] = _trailColor.g;
    trailColors[i3 + 2] = _trailColor.b;
}

function recolorEntireTrail() {
    for (let i = 0; i < attractorPointCount; i++) {
        const i3 = i * 3;
        _attractorPos.set(trailPositions[i3], trailPositions[i3 + 1], trailPositions[i3 + 2]);
        setTrailVertexColor(i, _attractorPos);
    }

    if (attractorPointCount >= 2) {
        trailGeometry.attributes.color.needsUpdate = true;
        if (visualMode === 'mesh') rebuildTrailMesh();
        if (visualMode === 'particles') recolorParticles();
    }
}

function runAttractorWarmup() {
    const warmupSteps = getAttractorSimParam('warmupSteps');
    let x = attractorState.x;
    let y = attractorState.y;
    let z = attractorState.z;

    for (let i = 0; i < warmupSteps; i++) {
        const next = attractorStep(x, y, z);
        x = next.x;
        y = next.y;
        z = next.z;
    }

    attractorState.x = x;
    attractorState.y = y;
    attractorState.z = z;
}

function appendTrailPoint(index, x, y, z) {
    attractorToLocal(x, y, z, _attractorPos);

    const i3 = index * 3;
    trailPositions[i3] = _attractorPos.x;
    trailPositions[i3 + 1] = _attractorPos.y;
    trailPositions[i3 + 2] = _attractorPos.z;
    setTrailVertexColor(index, _attractorPos);
}

function syncTrailGeometry() {
    if (attractorPointCount < 2) {
        trailGeometry.setDrawRange(0, 0);
    } else {
        trailGeometry.setDrawRange(0, attractorPointCount);
    }

    trailGeometry.attributes.position.needsUpdate = true;
    trailGeometry.attributes.color.needsUpdate = true;
}

function rebuildTrailMesh() {
    if (attractorPointCount < 2) return;

    const strandSize = _strandPointCount > 1 ? _strandPointCount : attractorPointCount;
    const numStrands = _strandPointCount > 1 ? Math.floor(attractorPointCount / strandSize) : 1;
    const segsPerStrand = strandSize - 1;
    const totalSegs = numStrands * segsPerStrand;

    const posPairs = _meshPosPairs;
    const colPairs = _meshColPairs;

    for (let s = 0; s < numStrands; s++) {
        const strandOff = s * strandSize;
        for (let i = 0; i < segsPerStrand; i++) {
            const a = (strandOff + i) * 3;
            const b = (strandOff + i + 1) * 3;
            const out = (s * segsPerStrand + i) * 6;

            posPairs[out]     = trailPositions[a];
            posPairs[out + 1] = trailPositions[a + 1];
            posPairs[out + 2] = trailPositions[a + 2];
            posPairs[out + 3] = trailPositions[b];
            posPairs[out + 4] = trailPositions[b + 1];
            posPairs[out + 5] = trailPositions[b + 2];

            // Store gradient t (0-1) as grayscale — the shader applies the
            // actual color mapping plus any cyclic offset at draw time.
            _attractorPos.set(trailPositions[a], trailPositions[a + 1], trailPositions[a + 2]);
            const tA = trailGradientT(strandOff + i, _attractorPos);
            colPairs[out]     = tA;
            colPairs[out + 1] = tA;
            colPairs[out + 2] = tA;

            _attractorPos.set(trailPositions[b], trailPositions[b + 1], trailPositions[b + 2]);
            const tB = trailGradientT(strandOff + i + 1, _attractorPos);
            colPairs[out + 3] = tB;
            colPairs[out + 4] = tB;
            colPairs[out + 5] = tB;
        }
    }

    const validLen = totalSegs * 6;
    LineSegmentsGeometry.prototype.setPositions.call(trailMeshGeometry, posPairs.subarray(0, validLen));
    LineSegmentsGeometry.prototype.setColors.call(trailMeshGeometry, colPairs.subarray(0, validLen));
}


function syncGhostVisibility() {
    const isGhost = visualMode === 'ghost';
    const isCombo = visualMode === 'combo';
    const headsOn = isGhost && attractorGuiState.ghostHeads;
    for (let h = 0; h < GHOST_HEAD_COUNT; h++) {
        ghostHeadMeshes[h].visible = headsOn;
        ghostTailLines[h].visible  = headsOn;
    }
    // Ghost / Combo both use the thick mesh — segment pairs avoid cross-strand connections.
    const isDimmed = isGhost || isCombo;
    const nextOpacity = isGhost ? 0.3 : isCombo ? 0.15 : 1.0;
    const nextDepthWrite = !isDimmed;
    if (
        trailMeshMaterial.transparent !== isDimmed ||
        trailMeshMaterial.opacity !== nextOpacity ||
        trailMeshMaterial.depthWrite !== nextDepthWrite
    ) {
        trailMeshMaterial.transparent = isDimmed;
        trailMeshMaterial.opacity = nextOpacity;
        trailMeshMaterial.depthWrite = nextDepthWrite;
        trailMeshMaterial.blending = THREE.NormalBlending;
        trailMeshMaterial.needsUpdate = true;
    }
}

function initGhostHeads() {
    if (attractorPointCount < 2) return;
    for (let h = 0; h < GHOST_HEAD_COUNT; h++) {
        ghostHeadIdx[h] = Math.floor(h * attractorPointCount / GHOST_HEAD_COUNT);
        ghostTailData[h].geo.setDrawRange(0, 0);
    }
}

function updateGhostHeads() {
    if (attractorPointCount < 2) return;
    const speed = getAttractorSimParam('ghostSpeed') ?? GHOST_SPEED;

    // Always advance the shader gradient offset — visible even with heads off.
    _ghostGradOffset = (_ghostGradOffset + speed / GHOST_GRAD_CYCLE) % 1.0;
    trailMeshMaterial.uniforms.uGradientOffset.value = _ghostGradOffset;

    // Skip the per-head CPU work entirely when heads+trails are hidden.
    if (!attractorGuiState.ghostHeads) return;

    const step = Math.max(1, Math.floor(speed / GHOST_TAIL_LEN));
    for (let h = 0; h < GHOST_HEAD_COUNT; h++) {
        ghostHeadIdx[h] = (ghostHeadIdx[h] + speed) % attractorPointCount;
        const headIdx = ghostHeadIdx[h];

        const i3 = headIdx * 3;
        ghostHeadMeshes[h].position.set(
            trailPositions[i3],
            trailPositions[i3 + 1],
            trailPositions[i3 + 2]
        );

        const { positions, colors, geo } = ghostTailData[h];
        for (let t = 0; t < GHOST_TAIL_LEN; t++) {
            const srcIdx = ((headIdx - t * step) % attractorPointCount + attractorPointCount) % attractorPointCount;
            const s3 = srcIdx * 3;
            const d3 = t * 3;
            positions[d3]     = trailPositions[s3];
            positions[d3 + 1] = trailPositions[s3 + 1];
            positions[d3 + 2] = trailPositions[s3 + 2];
            const f = 1.0 - t / GHOST_TAIL_LEN;
            const fade = f * f;
            colors[d3]     = fade * 1.0;
            colors[d3 + 1] = fade * 0.55;
            colors[d3 + 2] = fade * 0.15;
        }
        geo.setDrawRange(0, GHOST_TAIL_LEN);
        geo.attributes.position.needsUpdate = true;
        geo.attributes.color.needsUpdate = true;
    }
}

function updatePulseWave() {
    if (attractorPointCount < 2) return;
    const t = deps.clock.getElapsedTime();
    const waveFreq = 5.0;
    const waveSpeed = 0.6;

    for (let i = 0; i < attractorPointCount; i++) {
        const pathT = i / (attractorPointCount - 1);
        const wave = 0.5 + 0.5 * Math.sin(pathT * Math.PI * 2 * waveFreq - t * Math.PI * 2 * waveSpeed);
        const brightness = 0.25 + 0.75 * wave;
        applyTrailGradientColor(pathT);
        const i3 = i * 3;
        trailColors[i3]     = _trailColor.r * brightness;
        trailColors[i3 + 1] = _trailColor.g * brightness;
        trailColors[i3 + 2] = _trailColor.b * brightness;
    }
    trailGeometry.attributes.color.needsUpdate = true;
}

function initParticleMode() {
    if (attractorPointCount < 2) return;

    particleCount = Math.min(MAX_PARTICLES, attractorPointCount);
    const stride = attractorPointCount / particleCount;
    const h = deps.containerConfig.containerSize * 0.5;

    for (let i = 0; i < particleCount; i++) {
        const srcIdx = Math.floor(i * stride);
        const s3 = srcIdx * 3;
        const d3 = i * 3;

        particleTgtPos[d3]     = trailPositions[s3];
        particleTgtPos[d3 + 1] = trailPositions[s3 + 1];
        particleTgtPos[d3 + 2] = trailPositions[s3 + 2];

        // start scattered randomly inside container box
        particleCurPos[d3]     = (Math.random() - 0.5) * h * 2;
        particleCurPos[d3 + 1] = (Math.random() - 0.5) * h * 2;
        particleCurPos[d3 + 2] = (Math.random() - 0.5) * h * 2;

        particlePhases[i] = Math.random() * Math.PI * 2;
    }

    recolorParticles();
    particleGeo.setDrawRange(0, particleCount);
}

function recolorParticles() {
    for (let i = 0; i < particleCount; i++) {
        const pathT = particleCount > 1 ? i / (particleCount - 1) : 0;
        applyTrailGradientColor(pathT);
        const i3 = i * 3;
        particleColBuf[i3]     = _trailColor.r;
        particleColBuf[i3 + 1] = _trailColor.g;
        particleColBuf[i3 + 2] = _trailColor.b;
    }
    particleGeo.attributes.color.needsUpdate = true;
}

function updateParticles() {
    if (particleCount < 2) return;
    const t = deps.clock.getElapsedTime();

    for (let i = 0; i < particleCount; i++) {
        const i3 = i * 3;
        const phase = particlePhases[i];

        particleCurPos[i3]     += (particleTgtPos[i3]     - particleCurPos[i3])     * PARTICLE_LERP;
        particleCurPos[i3 + 1] += (particleTgtPos[i3 + 1] - particleCurPos[i3 + 1]) * PARTICLE_LERP;
        particleCurPos[i3 + 2] += (particleTgtPos[i3 + 2] - particleCurPos[i3 + 2]) * PARTICLE_LERP;

        const dx = Math.sin(t * PARTICLE_DRIFT_SPEED       + phase)        * PARTICLE_DRIFT_AMP;
        const dy = Math.sin(t * PARTICLE_DRIFT_SPEED * 1.3 + phase * 1.7)  * PARTICLE_DRIFT_AMP;
        const dz = Math.sin(t * PARTICLE_DRIFT_SPEED * 0.8 + phase * 2.3)  * PARTICLE_DRIFT_AMP;

        particlePosBuf[i3]     = particleCurPos[i3]     + dx;
        particlePosBuf[i3 + 1] = particleCurPos[i3 + 1] + dy;
        particlePosBuf[i3 + 2] = particleCurPos[i3 + 2] + dz;
    }

    particleGeo.attributes.position.needsUpdate = true;
}

function syncTrailDisplayMode() {
    if (!_displayModeDirty) return;
    _displayModeDirty = false;
    const hasTrail = attractorPointCount >= 2;
    trailLine.visible    = (visualMode === 'draw' || visualMode === 'pulse') && hasTrail;
    trailMesh.visible    = (visualMode === 'mesh' || visualMode === 'ghost' || visualMode === 'combo') && hasTrail;
    particleMesh.visible = (visualMode === 'particles' || visualMode === 'combo');
}

function setHeadFromTrailIndex(index) {
    const i3 = index * 3;
    headMarker.position.set(
        trailPositions[i3],
        trailPositions[i3 + 1],
        trailPositions[i3 + 2]
    );
}

function syncHeadMarkerVisibility() {
    if (!_headMarkerDirty) return;
    _headMarkerDirty = false;
    headMarker.visible = visualMode === 'draw' && attractorPointCount > 0;
}

function getAttractorBuildTargetCount() {
    const strands = getAttractorSimParam('strands') ?? 1;
    const maxPoints = getAttractorSimParam('maxPoints');
    const pointsPerStrand = strands > 1 ? Math.floor(maxPoints / strands) : maxPoints;
    return pointsPerStrand * strands;
}

/** 0–1 while sim/build is in progress; null when idle or complete. */
function getAttractorBuildProgress() {
    const target = getAttractorBuildTargetCount();
    if (target <= 0) return null;

    if (_buildState.active) {
        return Math.min(1, _buildState.pointsWritten / target);
    }
    if (visualMode === 'draw' && attractorPointCount < target) {
        return attractorPointCount / target;
    }
    return null;
}

// Chunked build state — spreads buildCompleteAttractor across frames
// to avoid a single-frame freeze on large attractors (up to 900k steps).
const _buildState = {
    active: false,
    strandIndex: 0,
    strandCount: 1,
    pointsPerStrand: 0,
    pointsWritten: 0,
    x: 0, y: 0, z: 0,
    // Keep spare frame time on Spectacles; final mesh is identical (upload on finalize).
    budgetMs: 4,
    /** Check performance.now() every N steps — cheaper than timing each iteration. */
    timeCheckEvery: 32,
};

function _startChunkedBuild() {
    const strands = getAttractorSimParam('strands') ?? 1;
    const maxPoints = getAttractorSimParam('maxPoints');
    const jitter = getAttractorSimParam('strandJitter') ?? 0.25;
    const { initial } = getCurrentAttractor();

    // Clear the trail immediately so nothing stale shows
    attractorPointCount = 0;
    _strandPointCount = 0;
    _ghostGradOffset = 0;
    _displayModeDirty = true;
    _headMarkerDirty = true;
    syncTrailGeometry();
    syncTrailDisplayMode();
    syncHeadMarkerVisibility();

    _buildState.active = true;
    _buildState.strandCount = strands;
    _buildState.pointsPerStrand = strands > 1 ? Math.floor(maxPoints / strands) : maxPoints;
    _buildState.strandIndex = 0;
    _buildState.pointsWritten = 0;

    if (strands > 1) {
        _strandPointCount = _buildState.pointsPerStrand;
        attractorState.x = initial.x + (Math.random() - 0.5) * 2 * jitter;
        attractorState.y = initial.y + (Math.random() - 0.5) * 2 * jitter;
        attractorState.z = initial.z + (Math.random() - 0.5) * 2 * jitter;
    } else {
        resetAttractorStateFromDefinition();
    }
    runAttractorWarmup();
    _buildState.x = attractorState.x;
    _buildState.y = attractorState.y;
    _buildState.z = attractorState.z;
}

function _continueBuild() {
    if (!_buildState.active) return;

    const jitter = getAttractorSimParam('strandJitter') ?? 0.25;
    const { initial } = getCurrentAttractor();
    const pointsPerStrand = _buildState.pointsPerStrand;
    const strandCount = _buildState.strandCount;
    const maxPoints = pointsPerStrand * strandCount;
    const timeCheckEvery = _buildState.timeCheckEvery;

    const t0 = performance.now();
    let x = _buildState.x;
    let y = _buildState.y;
    let z = _buildState.z;
    let stepsThisFrame = 0;

    while (true) {
        // Check if current strand is done (multi-strand only)
        if (strandCount > 1) {
            const strandStart = _buildState.strandIndex * pointsPerStrand;
            if (_buildState.pointsWritten - strandStart >= pointsPerStrand) {
                _buildState.strandIndex++;
                if (_buildState.strandIndex >= strandCount) {
                    _finalizeBuild(x, y, z);
                    return;
                }
                attractorState.x = initial.x + (Math.random() - 0.5) * 2 * jitter;
                attractorState.y = initial.y + (Math.random() - 0.5) * 2 * jitter;
                attractorState.z = initial.z + (Math.random() - 0.5) * 2 * jitter;
                runAttractorWarmup();
                x = attractorState.x;
                y = attractorState.y;
                z = attractorState.z;
                continue;
            }
        }

        if (_buildState.pointsWritten >= maxPoints) {
            _finalizeBuild(x, y, z);
            return;
        }

        const next = attractorStep(x, y, z);
        x = next.x; y = next.y; z = next.z;
        appendTrailPoint(_buildState.pointsWritten, x, y, z);
        _buildState.pointsWritten++;
        attractorPointCount = _buildState.pointsWritten;
        stepsThisFrame++;

        if ((stepsThisFrame & (timeCheckEvery - 1)) === 0 &&
            performance.now() - t0 >= _buildState.budgetMs) {
            break;
        }
    }

    _buildState.x = x;
    _buildState.y = y;
    _buildState.z = z;

    // No mid-build GPU upload — trailMesh is rebuilt on finalize; progress UI covers wait.
    if (_displayModeDirty) { _displayModeDirty = false; syncTrailDisplayMode(); }
    if (_headMarkerDirty)  { _headMarkerDirty  = false; syncHeadMarkerVisibility(); }
}

function _finalizeBuild(x, y, z) {
    _buildState.active = false;
    attractorState.x = x;
    attractorState.y = y;
    attractorState.z = z;
    attractorPointCount = _buildState.pointsWritten;
    syncTrailGeometry();
    rebuildTrailMesh();
    _displayModeDirty = true;
    _headMarkerDirty  = true;
    syncTrailDisplayMode();
    syncHeadMarkerVisibility();
    deps.syncBuildProgressLabel();
}

function resetProgressiveAttractor() {
    attractorPointCount = 0;
    _ghostGradOffset = 0;
    _displayModeDirty = true;
    _headMarkerDirty = true;
    syncTrailGeometry();
    syncTrailDisplayMode();
    syncHeadMarkerVisibility();
}

function initAttractor() {
    if (visualMode === 'draw') {
        resetAttractorStateFromDefinition();
        runAttractorWarmup();
        resetProgressiveAttractor();
    } else {
        _startChunkedBuild();
    }
    const lw = getAttractorSimParam('linewidth') ?? 0.0016;
    trailMeshMaterial.linewidth = lw;
    trailMeshMaterial.needsUpdate = true;
    headMarker.scale.setScalar(lw * 1.2);
    syncGhostVisibility();
    if (visualMode === 'ghost') initGhostHeads();
    if (visualMode === 'particles' || visualMode === 'combo') initParticleMode();
    deps.syncBuildProgressLabel();
}

function applyVisualMode() {
    initAttractor();
}

function updateProgressiveAttractor() {
    const stepsPerFrame = getAttractorSimParam('stepsPerFrame');
    const maxPoints = getAttractorSimParam('maxPoints');
    const prevCount = attractorPointCount;

    for (let s = 0; s < stepsPerFrame; s++) {
        if (attractorPointCount >= maxPoints) break;

        const next = attractorStep(attractorState.x, attractorState.y, attractorState.z);
        attractorState.x = next.x;
        attractorState.y = next.y;
        attractorState.z = next.z;

        appendTrailPoint(attractorPointCount, attractorState.x, attractorState.y, attractorState.z);
        attractorPointCount++;
    }

    // Mark dirty when count crosses the thresholds that change visibility.
    if (prevCount < 1 && attractorPointCount >= 1) _headMarkerDirty = true;
    if (prevCount < 2 && attractorPointCount >= 2) _displayModeDirty = true;

    syncTrailGeometry();
    syncTrailDisplayMode();
    setHeadFromTrailIndex(Math.max(0, attractorPointCount - 1));
    syncHeadMarkerVisibility();

    // In 'path' mode the color is purely index-based and never changes for
    // existing points — only the newly appended vertices need coloring.
    // All other color modes use spatial data written by appendTrailPoint already.
    if (trailColorMode === 'path' && attractorPointCount > prevCount) {
        trailGeometry.attributes.color.needsUpdate = true;
    }
}

function updateAttractor() {
    if (_buildState.active) {
        _continueBuild();
        return;
    }
    if (visualMode === 'draw') {
        updateProgressiveAttractor();
    } else if (visualMode === 'pulse') {
        updatePulseWave();
    } else if (visualMode === 'ghost') {
        updateGhostHeads();
    } else if (visualMode === 'particles' || visualMode === 'combo') {
        updateParticles();
    }
}

const attractorGuiState = {
    type: ATTRACTOR_TYPES.lorenz.label,
    viewMode: 'Ghost',
    colorMode: TRAIL_COLOR_MODE_OPTIONS.path,
    ghostHeads: false,
};

    const api = {
        visualMode,
        simConfig,
        ATTRACTOR_TYPES,
        ATTRACTOR_KEYS,
        currentAttractorKey,
        attractorState,
        attractorPointCount,
        attractorGuiState,
        getCurrentAttractor,
        getAttractorBuildProgress,
        setAttractorKey,
        cycleAttractorPrev,
        cycleAttractorNext,
        initAttractor,
        updateAttractor,
        _buildState
    };
    Object.assign(deps, api);
    Object.defineProperty(deps, 'currentAttractorKey', {
        configurable: true,
        enumerable: true,
        get: () => currentAttractorKey,
        set: (v) => { currentAttractorKey = v; },
    });
    Object.defineProperty(deps, 'visualMode', {
        configurable: true,
        enumerable: true,
        get: () => visualMode,
        set: (v) => { visualMode = v; },
    });
    return api;
}
