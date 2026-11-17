import * as THREE from 'three';

export function createChladni(deps) {
    const {
        containerGroup, containerConfig, halfSize, plateY, plateCenterDisc,
        lIndexObj, lThumbObj, rIndexObj, rThumbObj,
    } = deps;
const chladni = {
    nf: 5.0,
    mf: 3.0,
    a: 1.0,
    b: 1.0,
    patternScale: 0.5,
    // Interleaved updates keep CPU ~half of a full pass at this count.
    particleCount: 20000,
    gradientStep: 0.001, // was 0.0005 — faster settle onto nodal lines
    vibration: 0.003,
    particleSize: 0.0018,
};

// Mode indices are limited to MODE_INDEX_MIN..MODE_INDEX_MAX. On a real ~24 cm
// plate, patterns beyond ~8 nodal lines per axis are too fine for sand to
// resolve — this also keeps every reachable eigenfrequency inside the knob dial.
const MODE_INDEX_MIN = 1;
const MODE_INDEX_MAX = 8;

const chladniModes = [
    { n: 2, m: 1 },
    { n: 3, m: 2 },
    { n: 4, m: 1 },
    { n: 4, m: 3 },
    { n: 5, m: 3 },
    { n: 5, m: 4 },
    { n: 6, m: 2 },
    { n: 6, m: 4 },
    { n: 7, m: 3 },
    { n: 7, m: 5 },
    { n: 8, m: 3 },
    { n: 8, m: 4 },
    { n: 8, m: 5 },
];

// Thin-plate physical parameters (steel, approximate, for realistic Hz mapping).
const platePhysics = {
    youngsModulusPa: 210e9,  // E
    densityKgM3: 7850,       // rho
    poisson: 0.30,           // nu
    thicknessM: 0.0016,      // h (1.6 mm)
    widthM: 0.24,            // Lx
    heightM: 0.24,           // Ly
    calibrationScale: 1.0,   // tweak if you want to match a measured real plate
};

function modeFrequencyHz(n, m) {
    const { youngsModulusPa: E, densityKgM3: rho, poisson: nu, thicknessM: h, widthM: Lx, heightM: Ly, calibrationScale } = platePhysics;
    const D = (E * h * h * h) / (12.0 * (1.0 - nu * nu));
    const arealMass = rho * h;
    const shapeTerm = (n / Lx) ** 2 + (m / Ly) ** 2;
    // Simply-supported thin plate baseline used for practical teaching/demo mapping.
    const f = (Math.PI / 2.0) * Math.sqrt(D / arealMass) * shapeTerm;
    return f * calibrationScale;
}

const modeFrequenciesHz = chladniModes.map((mode) => modeFrequencyHz(mode.n, mode.m));
// morphSpeed = seconds to travel from one mode to the next — future slider hook
const morphSpeed = 2.0;
let morphT = 0;
let morphFromIndex = 0;
let morphToIndex = 1;

// ==========================================
// RESONANCE
// ==========================================
// The knob sets a continuous drive frequency. Each mode is a Lorentzian peak
// around its eigenfrequency; the plate "response" (0..1) drives how strongly
// the pattern forms, how loud the plate rings, and how much the mesh deflects.
// Between peaks the sand jitters chaotically and the tone falls to a quiet hum.

const resonance = {
    halfWidthHz: 80,     // Lorentzian half-width at half-maximum
    driveHz: 0,
    // 'knob' → pattern blends between frequency-adjacent modes by response.
    // 'custom' → sliders set an exact (n, m); drive locks to its eigenfrequency.
    source: 'knob',
    customN: chladni.nf,
    customM: chladni.mf,
    customHz: 0,
    response: 0,         // current plate excitation, 0..1
    dominantHz: 440,     // eigenfrequency of the mode nearest the drive
    dominantN: chladni.nf,
    dominantM: chladni.mf,
};

const sortedModes = chladniModes
    .map((mode, i) => ({ n: mode.n, m: mode.m, hz: modeFrequenciesHz[i] }))
    .sort((a, b) => a.hz - b.hz);

function lorentzianResponse(driveHz, peakHz) {
    const x = (driveHz - peakHz) / resonance.halfWidthHz;
    return 1.0 / (1.0 + x * x);
}

function setCustomResonanceMode(n, m) {
    resonance.source = 'custom';
    resonance.customN = n;
    resonance.customM = m;
    resonance.customHz = modeFrequencyHz(n, m);
    resonance.driveHz = resonance.customHz;
    guiParams.frequencyHz = Math.round(resonance.customHz);
}

function updateResonance() {
    if (resonance.source === 'custom') {
        resonance.response = lorentzianResponse(resonance.driveHz, resonance.customHz);
        resonance.dominantHz = resonance.customHz;
        resonance.dominantN = resonance.customN;
        resonance.dominantM = resonance.customM;
        applyModeValues(resonance.customN, resonance.customM);
        return;
    }

    const drive = resonance.driveHz;

    // Bracketing modes in the frequency-sorted list
    let hi = 0;
    while (hi < sortedModes.length && sortedModes[hi].hz < drive) hi++;
    const below = sortedModes[Math.max(0, hi - 1)];
    const above = sortedModes[Math.min(sortedModes.length - 1, hi)];

    const rBelow = lorentzianResponse(drive, below.hz);
    const rAbove = lorentzianResponse(drive, above.hz);
    resonance.response = Math.max(rBelow, rAbove);

    const dominant = rBelow >= rAbove ? below : above;
    resonance.dominantHz = dominant.hz;
    resonance.dominantN = dominant.n;
    resonance.dominantM = dominant.m;

    // Pattern = response-weighted blend of the bracketing modes.
    // Cubed weights so the pattern snaps to a pure mode right at a peak.
    const wBelow = rBelow * rBelow * rBelow;
    const wAbove = rAbove * rAbove * rAbove;
    const wSum = wBelow + wAbove;
    let nf = dominant.n;
    let mf = dominant.m;
    if (wSum > 1e-6) {
        nf = (below.n * wBelow + above.n * wAbove) / wSum;
        mf = (below.m * wBelow + above.m * wAbove) / wSum;
    }
    applyModeValues(nf, mf);

    if (dominant.n !== guiParams.modeX || dominant.m !== guiParams.modeY) {
        guiParams.modeX = dominant.n;
        guiParams.modeY = dominant.m;
        deps.syncModeMenuSlidersFromParams?.();
    }
}

function applyResonanceToVisuals() {
    // Mesh deflection grows with resonance; only pay when Mesh view is active.
    if (currentViewMode !== VIEW_MODES.MESH || !meshUniforms) return;
    const R = resonance.response;
    meshUniforms.meshAmplitude.value = guiParams.meshHeight * (0.1 + 0.9 * R);
}


// Edge button anchors disabled (button spheres removed)
const viewModeButtonMeshes = [];

const particlePositions = new Float32Array(chladni.particleCount * 3);
for (let i = 0; i < chladni.particleCount; i++) {
    const i3 = i * 3;
    particlePositions[i3]     = (Math.random() - 0.5) * containerConfig.containerSize;
    particlePositions[i3 + 1] = plateY + 0.001;
    particlePositions[i3 + 2] = (Math.random() - 0.5) * containerConfig.containerSize;
}

const particleGeometry = new THREE.BufferGeometry();
const particlePositionAttr = new THREE.BufferAttribute(particlePositions, 3);
particlePositionAttr.setUsage(THREE.DynamicDrawUsage);
particleGeometry.setAttribute('position', particlePositionAttr);

const particleMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: chladni.particleSize,
    sizeAttenuation: true,
});

const particleSystem = new THREE.Points(particleGeometry, particleMaterial);
particleSystem.frustumCulled = false;
containerGroup.add(particleSystem);

// ==========================================
// CONTOUR SHADER VIEW
// ==========================================

const contourUniforms = {
    nf:        { value: chladni.nf },
    mf:        { value: chladni.mf },
    a:         { value: chladni.a  },
    b:         { value: chladni.b  },
    patternScale: { value: chladni.patternScale },
    lineWidth: { value: 0.2 },
};

const contourShaderMaterial = new THREE.ShaderMaterial({
    uniforms: contourUniforms,
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        uniform float nf;
        uniform float mf;
        uniform float a;
        uniform float b;
        uniform float patternScale;
        uniform float lineWidth;
        varying vec2 vUv;
        #define PI 3.14159265358979324

        void main() {
            vec2 p = (vUv * 2.0 - 1.0) * patternScale;
            float f = a * cos(nf * PI * p.x) * cos(mf * PI * p.y)
                    + b * cos(mf * PI * p.x) * cos(nf * PI * p.y);
            float absF = abs(f);

            float core  = 1.0 - smoothstep(0.0, lineWidth, absF);
            float glow  = (1.0 - smoothstep(0.0, lineWidth * 4.0, absF)) * 0.55;
            float ring1 = (1.0 - smoothstep(0.0, lineWidth * 0.7, abs(absF - 0.5))) * 0.2;
            float ring2 = (1.0 - smoothstep(0.0, lineWidth * 0.5, abs(absF - 1.0))) * 0.1;

            float alpha = clamp(core + glow + ring1 + ring2, 0.0, 1.0);
            gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
        }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
});

const contourShaderMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(containerConfig.containerSize, containerConfig.containerSize),
    contourShaderMaterial
);
contourShaderMesh.rotation.x = -Math.PI / 2;
contourShaderMesh.position.y = plateY + 0.001;
contourShaderMesh.frustumCulled = false;
containerGroup.add(contourShaderMesh);

// ==========================================
// MESH VIEW (lazy — built on first MESH mode enter)
// ==========================================

const MESH_VIEW_SEGMENTS = 64;
const DEFAULT_MESH_AMPLITUDE = 0.01;

let meshUniforms = null;
let meshShaderMaterial = null;
let meshView = null;

const MESH_VERTEX_SHADER = `
        uniform float nf;
        uniform float mf;
        uniform float a;
        uniform float b;
        uniform float patternScale;
        uniform float meshAmplitude;

        varying vec2  vUv;
        varying float vF;
        varying vec3  vNormal;

        #define PI 3.14159265358979324
        // Mix may grow |a|+|b|; keep peak height from exploding past this bound.
        #define MESH_MIX_F_BOUND_MAX 6.0

        void main() {
            vUv = uv;
            vec2 p = (uv * 2.0 - 1.0) * patternScale;

            float npi = nf * PI;
            float mpi = mf * PI;

            float fRaw = a * cos(npi * p.x) * cos(mpi * p.y)
                       + b * cos(mpi * p.x) * cos(npi * p.y);

            // Same as before near default Mix; compress only when Mix gets extreme.
            float fBound = max(abs(a) + abs(b), 1e-4);
            float drive = min(fBound, MESH_MIX_F_BOUND_MAX);
            float f = (fRaw / fBound) * drive;
            float derivScale = drive / fBound;

            float dfdx = (-a * npi * sin(npi * p.x) * cos(mpi * p.y)
                         - b * mpi * sin(mpi * p.x) * cos(npi * p.y)) * derivScale;
            float dfdy = (-a * mpi * cos(npi * p.x) * sin(mpi * p.y)
                         - b * npi * cos(mpi * p.x) * sin(npi * p.y)) * derivScale;

            vF = f;

            // Analytical normal: surface is local-Z = f * amplitude
            // Tangent vectors T_x=(1,0,dz/dx), T_y=(0,1,dz/dy) → normal = cross = (-dz/dx, -dz/dy, 1)
            vec3 localNormal = normalize(vec3(
                -dfdx * meshAmplitude,
                -dfdy * meshAmplitude,
                1.0
            ));
            vNormal = normalize(normalMatrix * localNormal);

            vec3 displaced = vec3(position.x, position.y, position.z + f * meshAmplitude);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
        }
    `;

const MESH_FRAGMENT_SHADER = `
        uniform float lineWidth;

        varying vec2  vUv;
        varying float vF;
        varying vec3  vNormal;

        void main() {
            float absF = abs(vF);

            // Nodal-line glow (reuse contour formula)
            float core = 1.0 - smoothstep(0.0, lineWidth,        absF);
            float glow = (1.0 - smoothstep(0.0, lineWidth * 4.0, absF)) * 0.55;
            float nodalIntensity = clamp(core + glow, 0.0, 1.0);

            // Crest yellow → trough orange (slightly less red/dark than before)
            vec3 posColor  = vec3(1.00, 0.95, 0.10);
            vec3 negColor  = vec3(1.00, 0.46, 0.06);
            vec3 surfColor = mix(negColor, posColor, vF * 0.5 + 0.5);

            // Simple diffuse lighting in view space
            vec3  lightDir = normalize(vec3(0.4, 0.8, 0.6));
            float diffuse  = max(dot(normalize(vNormal), lightDir), 0.0);
            float lighting = 0.22 + diffuse * 0.78;

            // Blend lit surface with white nodal lines
            vec3 color = mix(surfColor * lighting, vec3(1.0), nodalIntensity * 0.88);
            gl_FragColor = vec4(color, 1.0);
        }
    `;

function syncMeshUniformsFromState() {
    if (!meshUniforms) return;
    meshUniforms.nf.value = chladni.nf;
    meshUniforms.mf.value = chladni.mf;
    meshUniforms.a.value = chladni.a;
    meshUniforms.b.value = chladni.b;
    meshUniforms.patternScale.value = chladni.patternScale;
    meshUniforms.lineWidth.value = guiParams.lineWidth;
    meshUniforms.meshAmplitude.value = guiParams.meshHeight * (0.1 + 0.9 * resonance.response);
}

function ensureMeshView() {
    if (meshView) return meshView;

    meshUniforms = {
        nf:            { value: chladni.nf },
        mf:            { value: chladni.mf },
        a:             { value: chladni.a  },
        b:             { value: chladni.b  },
        patternScale:  { value: chladni.patternScale },
        meshAmplitude: { value: DEFAULT_MESH_AMPLITUDE },
        lineWidth:     { value: 0.2  },
    };

    meshShaderMaterial = new THREE.ShaderMaterial({
        uniforms: meshUniforms,
        vertexShader: MESH_VERTEX_SHADER,
        fragmentShader: MESH_FRAGMENT_SHADER,
        side: THREE.DoubleSide,
    });

    meshView = new THREE.Mesh(
        new THREE.PlaneGeometry(
            containerConfig.containerSize,
            containerConfig.containerSize,
            MESH_VIEW_SEGMENTS,
            MESH_VIEW_SEGMENTS
        ),
        meshShaderMaterial
    );
    meshView.rotation.x = -Math.PI / 2;
    meshView.position.y = plateY;
    meshView.frustumCulled = false;
    meshView.visible = false;
    containerGroup.add(meshView);

    syncMeshUniformsFromState();
    return meshView;
}

// ==========================================
// APP PARAMETERS
// ==========================================

const guiParams = {
    view: 'contour',
    frequencyHz: 440,
    modeX: chladni.nf,
    modeY: chladni.mf,
    plateWidth: chladni.a,
    plateHeight: chladni.b,
    meshHeight: DEFAULT_MESH_AMPLITUDE,
    vibrationStrength: chladni.vibration,
    lineWidth: contourUniforms.lineWidth.value,
    patternZoom: chladni.patternScale,
};

const _handWorld = new THREE.Vector3();
const _handLocal = new THREE.Vector3();

const handSweep = {
    radius: 0.07,
    strength: 1.2,
    maxStep: 0.02,
    activeYRange: 0.12,
    emitters: [],
};

/** Active emitters with non-zero sweep velocity (filled each particle frame). */
const _activeSweepEmitters = [];

/** Cheap LCG — avoids Math.random() overhead in the particle hot loop. */
let _particleRandState = 0x9E3779B9;
function particleRand() {
    _particleRandState = (_particleRandState * 1664525 + 1013904223) >>> 0;
    return _particleRandState * (1 / 4294967296);
}

/** Alternate even/odd particle indices each frame (~half the CPU, same look). */
let _particleUpdateParity = 0;

function createHandSweepEmitter(joint) {
    return { joint, prevX: 0, prevZ: 0, hasPrev: false, x: 0, z: 0, vx: 0, vz: 0, active: false };
}

function updateHandSweepEmitters(dt) {
    const safeDt = Math.max(dt, 1 / 120);
    const velToStep = handSweep.strength * safeDt * 60.0;
    const emitters = handSweep.emitters;
    const activeYRange = handSweep.activeYRange;
    const maxStep = handSweep.maxStep;

    _activeSweepEmitters.length = 0;

    for (let i = 0; i < emitters.length; i++) {
        const emitter = emitters[i];
        _handWorld.copy(emitter.joint.position);
        _handLocal.copy(_handWorld);
        containerGroup.worldToLocal(_handLocal);

        const nearPlate = Math.abs(_handLocal.y - plateY) <= activeYRange;
        emitter.active = nearPlate;
        emitter.x = _handLocal.x;
        emitter.z = _handLocal.z;

        if (!nearPlate) {
            emitter.hasPrev = false;
            emitter.vx = 0;
            emitter.vz = 0;
            continue;
        }

        if (!emitter.hasPrev) {
            emitter.prevX = emitter.x;
            emitter.prevZ = emitter.z;
            emitter.hasPrev = true;
            emitter.vx = 0;
            emitter.vz = 0;
            continue;
        }

        const dx = emitter.x - emitter.prevX;
        const dz = emitter.z - emitter.prevZ;
        emitter.prevX = emitter.x;
        emitter.prevZ = emitter.z;

        emitter.vx = THREE.MathUtils.clamp(dx * velToStep, -maxStep, maxStep);
        emitter.vz = THREE.MathUtils.clamp(dz * velToStep, -maxStep, maxStep);

        if (emitter.vx !== 0 || emitter.vz !== 0) {
            _activeSweepEmitters.push(emitter);
        }
    }
}

function updateChladniParticles(dt) {
    const positions = particlePositionAttr.array;
    const particleCount = chladni.particleCount;
    // ×2 step/vib: each particle updates every other frame.
    const gradientStep = chladni.gradientStep * 2;
    const vibration = chladni.vibration * 2;
    const invHalfSize = 1.0 / halfSize;
    const radius = handSweep.radius;
    const invRadius = 1.0 / radius;
    const radiusSq = radius * radius;

    const nf = chladni.nf;
    const mf = chladni.mf;
    const a = chladni.a;
    const b = chladni.b;
    const patternScale = chladni.patternScale;
    const npi = nf * Math.PI;
    const mpi = mf * Math.PI;
    const scaleNpi = npi * patternScale;
    const scaleMpi = mpi * patternScale;

    updateHandSweepEmitters(dt);
    const activeEmitters = _activeSweepEmitters;
    const activeEmitterCount = activeEmitters.length;
    const sweepActive = activeEmitterCount > 0;

    const parity = _particleUpdateParity;
    _particleUpdateParity ^= 1;

    for (let i = parity; i < particleCount; i += 2) {
        const i3 = i * 3;
        let px = positions[i3];
        let pz = positions[i3 + 2];

        const sx = px * invHalfSize * patternScale;
        const sy = pz * invHalfSize * patternScale;

        const cosNSx = Math.cos(npi * sx);
        const cosMSy = Math.cos(mpi * sy);
        const cosMSx = Math.cos(mpi * sx);
        const cosNSy = Math.cos(npi * sy);
        const sinNSx = Math.sin(npi * sx);
        const sinMSx = Math.sin(mpi * sx);
        const sinMSy = Math.sin(mpi * sy);
        const sinNSy = Math.sin(npi * sy);

        const f = a * cosNSx * cosMSy + b * cosMSx * cosNSy;
        let dfdx = (-a * scaleNpi * sinNSx * cosMSy - b * scaleMpi * sinMSx * cosNSy);
        let dfdy = (-a * scaleMpi * cosNSx * sinMSy - b * scaleNpi * cosMSx * sinNSy);
        if (f < 0) {
            dfdx = -dfdx;
            dfdy = -dfdy;
        }

        const lenSq = dfdx * dfdx + dfdy * dfdy;
        if (lenSq > 1e-6) {
            const invLen = gradientStep / Math.sqrt(lenSq);
            px -= dfdx * invLen;
            pz -= dfdy * invLen;
        }

        px += (particleRand() - 0.5) * vibration;
        pz += (particleRand() - 0.5) * vibration;

        if (sweepActive) {
            for (let e = 0; e < activeEmitterCount; e++) {
                const emitter = activeEmitters[e];
                const ex = px - emitter.x;
                const ez = pz - emitter.z;
                const distSq = ex * ex + ez * ez;
                if (distSq >= radiusSq || distSq < 1e-12) continue;

                const falloff = 1.0 - Math.sqrt(distSq) * invRadius;
                px += emitter.vx * falloff;
                pz += emitter.vz * falloff;
            }
        }

        if (px < -halfSize) px = -halfSize;
        else if (px > halfSize) px = halfSize;
        if (pz < -halfSize) pz = -halfSize;
        else if (pz > halfSize) pz = halfSize;

        positions[i3] = px;
        positions[i3 + 2] = pz;
    }

    particlePositionAttr.needsUpdate = true;
}

function updateMorph(dt) {
    morphT += dt / morphSpeed;

    if (morphT >= 1.0) {
        morphT -= 1.0;
        morphFromIndex = morphToIndex;
        morphToIndex = (morphToIndex + 1) % chladniModes.length;
    }

    // Smoothstep: slow departure, fast transit, slow arrival — dwells on clean modes
    const t = morphT * morphT * (3.0 - 2.0 * morphT);

    const from = chladniModes[morphFromIndex];
    const to   = chladniModes[morphToIndex];
    chladni.nf = from.n + (to.n - from.n) * t;
    chladni.mf = from.m + (to.m - from.m) * t;
}

// ==========================================
// VIEW MODE SYSTEM
// ==========================================

const VIEW_MODES = Object.freeze({ PARTICLES: 'particles', CONTOUR: 'contour', MESH: 'mesh' });
let currentViewMode = VIEW_MODES.CONTOUR;

function setViewMode(mode) {
    if (mode === currentViewMode) return;
    currentViewMode = mode;
    particleSystem.visible    = (mode === VIEW_MODES.PARTICLES);
    contourShaderMesh.visible = (mode === VIEW_MODES.CONTOUR);
    plateCenterDisc.visible   = (mode !== VIEW_MODES.MESH);
    if (mode === VIEW_MODES.MESH) {
        ensureMeshView().visible = true;
        syncMeshUniformsFromState();
    } else if (meshView) {
        meshView.visible = false;
    }
    if (mode === VIEW_MODES.CONTOUR) {
        contourUniforms.nf.value = chladni.nf;
        contourUniforms.mf.value = chladni.mf;
        contourUniforms.a.value = chladni.a;
        contourUniforms.b.value = chladni.b;
        contourUniforms.patternScale.value = chladni.patternScale;
        contourUniforms.lineWidth.value = guiParams.lineWidth;
    }
    deps.syncMenuViewToggleToViewMode?.(mode);
}

/** Left→right edge spheres: particles, contour, mesh */
const VIEW_MODE_BY_EDGE_BUTTON = [
    VIEW_MODES.PARTICLES,
    VIEW_MODES.CONTOUR,
    VIEW_MODES.MESH,
];
const VIEW_BUTTON_PRESS_DIST = 0.028;
const VIEW_BUTTON_RELEASE_DIST = 0.042;
let viewModeEdgeButtonEngaged = false;

const _wlIndex = new THREE.Vector3();
const _wrIndex = new THREE.Vector3();
const _wBtn = new THREE.Vector3();

function updateViewModeEdgeButtons() {
    if (!viewModeButtonMeshes.length) return;

    lIndexObj.getWorldPosition(_wlIndex);
    rIndexObj.getWorldPosition(_wrIndex);

    let bestDist = Infinity;
    let bestIdx = -1;
    for (let i = 0; i < viewModeButtonMeshes.length; i++) {
        viewModeButtonMeshes[i].getWorldPosition(_wBtn);
        const d = Math.min(_wlIndex.distanceTo(_wBtn), _wrIndex.distanceTo(_wBtn));
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }

    if (bestIdx < 0) return;

    if (bestDist < VIEW_BUTTON_PRESS_DIST) {
        if (!viewModeEdgeButtonEngaged) {
            setViewMode(VIEW_MODE_BY_EDGE_BUTTON[bestIdx]);
            viewModeEdgeButtonEngaged = true;
        }
    } else if (bestDist > VIEW_BUTTON_RELEASE_DIST) {
        viewModeEdgeButtonEngaged = false;
    }
}

particleSystem.visible    = (currentViewMode === VIEW_MODES.PARTICLES);
contourShaderMesh.visible = (currentViewMode === VIEW_MODES.CONTOUR);
// meshView is created lazily on first MESH mode enter

// Sync initial view with current mode
guiParams.view = currentViewMode;

// Knob dial bounds — the max is derived from the highest reachable mode
// (MODE_INDEX_MAX × MODE_INDEX_MAX), so the dial covers every eigenfrequency
// the mode sliders can produce. With the current steel-plate physics this is
// 8800 Hz — in line with real square-plate demos (first pattern ~340 Hz,
// finest usable patterns in the upper kHz range).
const FREQUENCY_MAX_HZ = Math.ceil(modeFrequencyHz(MODE_INDEX_MAX, MODE_INDEX_MAX) / 100) * 100;

function applyModeValues(n, m) {
    chladni.nf = n;
    chladni.mf = m;
    if (currentViewMode === VIEW_MODES.CONTOUR) {
        contourUniforms.nf.value = n;
        contourUniforms.mf.value = m;
    } else if (currentViewMode === VIEW_MODES.MESH && meshUniforms) {
        meshUniforms.nf.value = n;
        meshUniforms.mf.value = m;
    }
}

function nearestModeIndex(n, m) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < chladniModes.length; i++) {
        const dn = chladniModes[i].n - n;
        const dm = chladniModes[i].m - m;
        const d2 = dn * dn + dm * dm;
        if (d2 < bestDist) {
            bestDist = d2;
            bestIdx = i;
        }
    }
    return bestIdx;
}

function nearestModeIndexByFrequency(hz) {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (let i = 0; i < modeFrequenciesHz.length; i++) {
        const d = Math.abs(modeFrequenciesHz[i] - hz);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }
    return bestIdx;
}

/** Knob dial: continuous 0–FREQUENCY_MAX_HZ drive frequency; resonance decides how the plate answers. */
function applyFrequencyKnobHz(hz) {
    const clamped = THREE.MathUtils.clamp(hz, 0, FREQUENCY_MAX_HZ);
    guiParams.frequencyHz = Math.round(clamped);
    resonance.driveHz = clamped;
    resonance.source = 'knob';
}

// Initialize the drive frequency right on the current (n, m) resonance peak.
{
    const idx = nearestModeIndex(guiParams.modeX, guiParams.modeY);
    guiParams.frequencyHz = Math.round(modeFrequenciesHz[idx]);
    resonance.driveHz = modeFrequenciesHz[idx];
    resonance.source = 'knob';
}

handSweep.emitters = [
    createHandSweepEmitter(lIndexObj),
    createHandSweepEmitter(rIndexObj),
    createHandSweepEmitter(lThumbObj),
    createHandSweepEmitter(rThumbObj),
];


    const api = {
        chladni,
        guiParams,
        resonance,
        VIEW_MODES,
        MODE_INDEX_MIN,
        MODE_INDEX_MAX,
        FREQUENCY_MAX_HZ,
        setViewMode,
        setCustomResonanceMode,
        applyFrequencyKnobHz,
        applyModeValues,
        updateResonance,
        applyResonanceToVisuals,
        updateChladniParticles,
        updateViewModeEdgeButtons,
        contourUniforms,
        ensureMeshView,
        handSweep,
        createHandSweepEmitter,
        particleSystem,
        contourShaderMesh,
        updateMorph,
        chladniModes,
        modeFrequenciesHz,
        modeFrequencyHz,
        nearestModeIndex,
        nearestModeIndexByFrequency,
        syncMeshUniformsFromState
    };
    Object.assign(deps, api);
    // Live bindings — Object.assign would snapshot `let` values
    Object.defineProperty(deps, 'currentViewMode', {
        get() { return currentViewMode; },
        enumerable: true,
        configurable: true,
    });
    Object.defineProperty(deps, 'meshUniforms', {
        get() { return meshUniforms; },
        enumerable: true,
        configurable: true,
    });
    Object.defineProperty(deps, 'meshView', {
        get() { return meshView; },
        enumerable: true,
        configurable: true,
    });
    return api;
}
