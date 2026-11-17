import * as THREE from 'three';
import gsap from 'gsap';
import { SurfaceMeshManager, MESH_QUAD_STEP, QUAD_OVERLAY_LINE_STEP } from './SurfaceMesh.js';
import { SURFACES, SURFACE_NAMES } from './Surfaces.js';
import { SlicePlaneManager } from './SlicePlanes.js';

export function createQuadSurfaces(deps) {
    const { scene, camera, containerGroup, containerConfig, halfContainerSize } = deps;
const _upVector = new THREE.Vector3(0, 1, 0);
const _uiCameraWorldPos = new THREE.Vector3();

// ==========================================
// CONTAINER HEADER PLANE (BILLBOARD)
// ==========================================

const HEADER_TEXTURE_WIDTH = 530;
const HEADER_TEXTURE_HEIGHT = 178;
const HEADER_ASPECT = HEADER_TEXTURE_WIDTH / HEADER_TEXTURE_HEIGHT;
const HEADER_WORLD_WIDTH = containerConfig.containerSize * 1.1;
const HEADER_WORLD_HEIGHT = HEADER_WORLD_WIDTH / HEADER_ASPECT;
const HEADER_VERTICAL_OFFSET = 0.12;
const HEADER_GAP_SCALE_RESPONSE = 0.4;
const HEADER_HIDE_SCALE_THRESHOLD = 1.85;
const HEADER_SHOW_SCALE_THRESHOLD = 1.72;
const HEADER_VISIBILITY_TWEEN_DURATION = 0.22;

const headerPlane = new THREE.Object3D();
headerPlane.scale.setScalar(1);
headerPlane.frustumCulled = false;
scene.add(headerPlane);

const headerEqCanvasWidth = 1024;
const headerEqCanvasHeight = 256;
const headerEqCanvas = document.createElement('canvas');
headerEqCanvas.width = headerEqCanvasWidth;
headerEqCanvas.height = headerEqCanvasHeight;
const headerEqCtx = headerEqCanvas.getContext('2d');
const headerEqTexture = new THREE.CanvasTexture(headerEqCanvas);

const headerShapeCanvasWidth = 1024;
const headerShapeCanvasHeight = 180;
const headerShapeCanvas = document.createElement('canvas');
headerShapeCanvas.width = headerShapeCanvasWidth;
headerShapeCanvas.height = headerShapeCanvasHeight;
const headerShapeCtx = headerShapeCanvas.getContext('2d');
const headerShapeTexture = new THREE.CanvasTexture(headerShapeCanvas);

const HEADER_EQ_WIDTH = HEADER_WORLD_WIDTH * 0.78;
const HEADER_EQ_HEIGHT = HEADER_EQ_WIDTH * (headerEqCanvasHeight / headerEqCanvasWidth);
const HEADER_SHAPE_WIDTH = HEADER_WORLD_WIDTH * 0.9;
const HEADER_SHAPE_HEIGHT = HEADER_SHAPE_WIDTH * (headerShapeCanvasHeight / headerShapeCanvasWidth);

const headerEqMaterial = new THREE.MeshBasicMaterial({
    map: headerEqTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
});

const headerEqPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(HEADER_EQ_WIDTH, HEADER_EQ_HEIGHT),
    headerEqMaterial
);
headerEqPlane.position.set(0, -HEADER_WORLD_HEIGHT * 0.22, 0.001);
headerEqPlane.frustumCulled = false;
headerPlane.add(headerEqPlane);

const headerShapeMaterial = new THREE.MeshBasicMaterial({
    map: headerShapeTexture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.FrontSide,
});

const headerShapePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(HEADER_SHAPE_WIDTH, HEADER_SHAPE_HEIGHT),
    headerShapeMaterial
);
headerShapePlane.position.set(0, HEADER_WORLD_HEIGHT * 0.22, 0.001);
headerShapePlane.frustumCulled = false;
headerPlane.add(headerShapePlane);


// ==========================================
// QUADRATIC SURFACE MESH
// ==========================================

// --- Manual per-surface display/tessellation config --------------------------
// Edit this block to tune each mesh independently.
const INITIAL_SURFACE = 'ellipsoid';
const SURFACE_VIEW_CONFIG = {
    ellipsoid:            { meshQuadStep: 1, quadLineStep: 5, showQuads: true },
    ellipticCone:         { meshQuadStep: 1, quadLineStep: 5, showQuads: true },
    hyperbolicParaboloid: { meshQuadStep: 1, quadLineStep: 5, showQuads: true },
    hyperboloidOneSheet:  { meshQuadStep: 1, quadLineStep: 5, showQuads: true },
    hyperboloidTwoSheets: { meshQuadStep: 1, quadLineStep: 7, showQuads: true },
    ellipticParaboloid:   { meshQuadStep: 1, quadLineStep: 6, showQuads: true },
};

// ─── Equation renderer ────────────────────────────────────────────────────────
// Tokens: { type: 'frac', num, den } | { type: 'op', text } | { type: 'rhs', text }
// Two-pass: measure total width first, then draw centered.

const EQ_FONT    = '400 84px Helvetica, Arial, sans-serif';
const EQ_FRAC_GAP    = 52;   // half-height from bar to num/den baseline
const EQ_BAR_WIDTH   = 6;    // fraction divider thickness
const EQ_OP_PAD      = 32;   // padding on each side of an operator
const EQ_BAR_PADDING = 10;   // extra width added to each side of fraction bar

const SURFACE_EQ_TOKENS = {
    ellipsoid:            [{ type:'frac', num:'x²', den:'a²' }, { type:'op', text:'+' }, { type:'frac', num:'y²', den:'b²' }, { type:'op', text:'+' }, { type:'frac', num:'z²', den:'c²' }, { type:'rhs', text:'= 1' }],
    ellipticCone:         [{ type:'frac', num:'x²', den:'a²' }, { type:'op', text:'+' }, { type:'frac', num:'y²', den:'b²' }, { type:'op', text:'\u2212' }, { type:'frac', num:'z²', den:'c²' }, { type:'rhs', text:'= 0' }],
    hyperbolicParaboloid: [{ type:'frac', num:'z', den:'c' }, { type:'op', text:'=' }, { type:'frac', num:'x²', den:'a²' }, { type:'op', text:'\u2212' }, { type:'frac', num:'y²', den:'b²' }],
    hyperboloidOneSheet:  [{ type:'frac', num:'x²', den:'a²' }, { type:'op', text:'+' }, { type:'frac', num:'y²', den:'b²' }, { type:'op', text:'\u2212' }, { type:'frac', num:'z²', den:'c²' }, { type:'rhs', text:'= 1' }],
    hyperboloidTwoSheets: [{ type:'frac', num:'x²', den:'a²' }, { type:'op', text:'+' }, { type:'frac', num:'y²', den:'b²' }, { type:'op', text:'\u2212' }, { type:'frac', num:'z²', den:'c²' }, { type:'rhs', text:'= \u22121' }],
    ellipticParaboloid:   [{ type:'frac', num:'z', den:'c' }, { type:'op', text:'=' }, { type:'frac', num:'x²', den:'a²' }, { type:'op', text:'+' }, { type:'frac', num:'y²', den:'b²' }],
};

function measureToken(ctx, token) {
    ctx.font = EQ_FONT;
    if (token.type === 'frac') {
        const nw = ctx.measureText(token.num).width;
        const dw = ctx.measureText(token.den).width;
        return Math.max(nw, dw) + EQ_BAR_PADDING * 2;
    }
    return ctx.measureText(token.text).width;
}

function totalEqWidth(ctx, tokens) {
    let w = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'op') {
            w += EQ_OP_PAD * 2 + measureToken(ctx, t);
        } else {
            w += measureToken(ctx, t);
        }
    }
    return w;
}

function renderTokens(ctx, tokens, startX, cy) {
    ctx.font = EQ_FONT;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#ffffff';
    ctx.textBaseline = 'middle';

    let x = startX;

    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];

        if (t.type === 'frac') {
            const fracW = measureToken(ctx, t);
            const cx = x + fracW * 0.5;

            ctx.font = EQ_FONT;
            ctx.textAlign = 'center';
            ctx.fillText(t.num, cx, cy - EQ_FRAC_GAP);
            ctx.fillText(t.den, cx, cy + EQ_FRAC_GAP);

            ctx.lineWidth = EQ_BAR_WIDTH;
            ctx.beginPath();
            ctx.moveTo(x, cy);
            ctx.lineTo(x + fracW, cy);
            ctx.stroke();

            x += fracW;

        } else if (t.type === 'op') {
            const tw = measureToken(ctx, t);
            ctx.font = EQ_FONT;
            ctx.textAlign = 'center';
            ctx.fillText(t.text, x + EQ_OP_PAD + tw * 0.5, cy);
            x += EQ_OP_PAD * 2 + tw;

        } else {
            const tw = measureToken(ctx, t);
            ctx.font = EQ_FONT;
            ctx.textAlign = 'left';
            ctx.fillText(t.text, x, cy);
            x += tw;
        }
    }
}

function updateHeaderEquation(surfaceName) {
    if (!headerEqCtx) return;
    headerEqCtx.clearRect(0, 0, headerEqCanvasWidth, headerEqCanvasHeight);

    const tokens = SURFACE_EQ_TOKENS[surfaceName];
    if (!tokens) { headerEqTexture.needsUpdate = true; return; }

    headerEqCtx.font = EQ_FONT;
    const totalW = totalEqWidth(headerEqCtx, tokens);
    const startX = (headerEqCanvasWidth - totalW) * 0.5;
    const cy = headerEqCanvasHeight * 0.5;

    renderTokens(headerEqCtx, tokens, startX, cy);

    headerEqTexture.needsUpdate = true;
}

function updateHeaderShapeLabel(surfaceName) {
    if (!headerShapeCtx) return;
    headerShapeCtx.clearRect(0, 0, headerShapeCanvasWidth, headerShapeCanvasHeight);

    const shapeLabel = SURFACES[surfaceName]?.label ?? surfaceName ?? '';
    if (!shapeLabel) {
        headerShapeTexture.needsUpdate = true;
        return;
    }

    headerShapeCtx.font = '700 94px Helvetica, Arial, sans-serif';
    headerShapeCtx.fillStyle = '#ffffff';
    headerShapeCtx.textAlign = 'center';
    headerShapeCtx.textBaseline = 'middle';
    headerShapeCtx.fillText(shapeLabel, headerShapeCanvasWidth * 0.5, headerShapeCanvasHeight * 0.5);

    headerShapeTexture.needsUpdate = true;
}

function getSurfaceViewConfig(name) {
    const manual = SURFACE_VIEW_CONFIG[name] || {};
    return {
        meshQuadStep: Math.max(1, Math.floor(manual.meshQuadStep ?? MESH_QUAD_STEP)),
        quadLineStep: Math.max(1, Math.floor(manual.quadLineStep ?? QUAD_OVERLAY_LINE_STEP)),
        showQuads: manual.showQuads ?? false,
    };
}

const surfaceManager = new SurfaceMeshManager(containerGroup, containerConfig.containerSize);
const initialViewConfig = getSurfaceViewConfig(INITIAL_SURFACE);
surfaceManager.setMeshQuadStep(initialViewConfig.meshQuadStep);
surfaceManager.setQuadLineStep(initialViewConfig.quadLineStep);
surfaceManager.setQuadOverlayVisible(initialViewConfig.showQuads);
surfaceManager.setSurface(INITIAL_SURFACE);
updateHeaderShapeLabel(INITIAL_SURFACE);
updateHeaderEquation(INITIAL_SURFACE);

// ==========================================
// SLICE PLANES
// ==========================================

const slicePlaneManager = new SlicePlaneManager(containerGroup, containerConfig.containerSize);

function syncSlicePlanes() {
    slicePlaneManager.updateAll(
        surfaceManager.activeSurface,
        surfaceManager.activeParams,
        surfaceManager.fitScale,
        surfaceManager.fitCenter,
    );
}

syncSlicePlanes();
for (const axis of ['x', 'y', 'z']) {
    slicePlaneManager.setCurveVisible(axis, false);
    slicePlaneManager.setFillVisible(axis, false);
}

const guiState = {
    surface: INITIAL_SURFACE,
    a: SURFACES[INITIAL_SURFACE].defaultParams.a,
    b: SURFACES[INITIAL_SURFACE].defaultParams.b,
    c: SURFACES[INITIAL_SURFACE].defaultParams.c,
    showQuads: initialViewConfig.showQuads,
    quadStep: initialViewConfig.quadLineStep,
};

const updateParams = () => {
    surfaceManager.setParams({ a: guiState.a, b: guiState.b, c: guiState.c });
    syncSlicePlanes();
};

function applySurfaceSelection(name) {
    const viewCfg = getSurfaceViewConfig(name);
    surfaceManager.setMeshQuadStep(viewCfg.meshQuadStep);
    surfaceManager.setQuadLineStep(viewCfg.quadLineStep);
    surfaceManager.setQuadOverlayVisible(viewCfg.showQuads);
    surfaceManager.setSurface(name);
    updateHeaderShapeLabel(name);
    updateHeaderEquation(name);
    deps.updateUISurfaceTitle(name);
    syncSlicePlanes();

    const def = SURFACES[name].defaultParams;
    guiState.surface = name;
    guiState.a = def.a;
    guiState.b = def.b;
    guiState.c = def.c;
    guiState.showQuads = viewCfg.showQuads;
    guiState.quadStep = viewCfg.quadLineStep;
    deps.syncABCSlidersFromState();
}

function cycleSurface(step) {
    const total = SURFACE_NAMES.length;
    if (total === 0) return;
    const currentIndex = SURFACE_NAMES.indexOf(guiState.surface);
    const baseIndex = currentIndex === -1 ? 0 : currentIndex;
    const nextIndex = (baseIndex + step + total) % total;
    applySurfaceSelection(SURFACE_NAMES[nextIndex]);
}

const sliceState = {
    xOffset: 0, xVisible: true,
    yOffset: 0, yVisible: true,
    zOffset: 0, zVisible: true,
};
const sliceOffsetControllers = {};

const _headerLocalScaledOffset = new THREE.Vector3(0, halfContainerSize, 0);
const _headerLocalFixedOffset = new THREE.Vector3(0, HEADER_VERTICAL_OFFSET, 0);
const _headerScaledWorldOffset = new THREE.Vector3();
const _headerFixedWorldOffset = new THREE.Vector3();
const _headerWorldPos = new THREE.Vector3();
const _headerToCamera = new THREE.Vector3();
let headerTargetVisible = true;

function setHeaderVisibility(shouldBeVisible) {
    if (headerTargetVisible === shouldBeVisible) return;
    headerTargetVisible = shouldBeVisible;

    if (shouldBeVisible && !headerPlane.visible) {
        headerPlane.visible = true;
    }

    gsap.killTweensOf(headerPlane.scale);
    gsap.to(headerPlane.scale, {
        x: shouldBeVisible ? 1 : 0,
        y: shouldBeVisible ? 1 : 0,
        z: shouldBeVisible ? 1 : 0,
        duration: HEADER_VISIBILITY_TWEEN_DURATION,
        ease: 'power2.inOut',
        onComplete: () => {
            if (!headerTargetVisible) headerPlane.visible = false;
        },
    });
}

function updateHeaderPlaneTransform() {
    const scale = containerGroup.scale.x;
    if (headerTargetVisible) {
        if (scale >= HEADER_HIDE_SCALE_THRESHOLD) setHeaderVisibility(false);
    } else if (scale <= HEADER_SHOW_SCALE_THRESHOLD) {
        setHeaderVisibility(true);
    }

    if (!headerPlane.visible && !headerTargetVisible) return;

    const effectiveGap = HEADER_VERTICAL_OFFSET * (1 + (scale - 1) * HEADER_GAP_SCALE_RESPONSE);

    _headerScaledWorldOffset.copy(_headerLocalScaledOffset)
        .multiplyScalar(scale)
        .applyQuaternion(containerGroup.quaternion)
    _headerLocalFixedOffset.set(0, effectiveGap, 0);
    _headerFixedWorldOffset.copy(_headerLocalFixedOffset)
        .applyQuaternion(containerGroup.quaternion);

    _headerWorldPos.copy(containerGroup.position)
        .add(_headerScaledWorldOffset)
        .add(_headerFixedWorldOffset);

    headerPlane.position.copy(_headerWorldPos);

    camera.getWorldPosition(_uiCameraWorldPos);
    _headerToCamera.subVectors(_uiCameraWorldPos, _headerWorldPos);

    const yaw = Math.atan2(_headerToCamera.x, _headerToCamera.z);
    headerPlane.quaternion.setFromAxisAngle(_upVector, yaw);
}


    const api = {
        headerPlane,
        headerTargetVisible,
        setHeaderVisibility,
        updateHeaderPlaneTransform,
        updateHeaderEquation,
        updateHeaderShapeLabel,
        getSurfaceViewConfig,
        surfaceManager,
        slicePlaneManager,
        syncSlicePlanes,
        guiState,
        updateParams,
        applySurfaceSelection,
        cycleSurface,
        sliceState,
        INITIAL_SURFACE
    };
    Object.assign(deps, api);
    return api;
}
