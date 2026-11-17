import * as THREE from 'three';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import { DEFAULT_HEAD_OFFSET } from './XRHeadPlacement.js';

export function createContainer(deps) {
    const { scene, camera, renderer } = deps;
// ==========================================
// CONTAINER
// ==========================================

const containerConfig = {
    containerSize: 0.45,
    containerPosition: new THREE.Vector3(0, 1.3, -1.2),
    initialScale: 0.8,
    initialYawDegrees: -22.5,
};

/** Yaw on load / after head placement: slight corner toward user. */
const CONTAINER_DEFAULT_YAW = THREE.MathUtils.degToRad(containerConfig.initialYawDegrees);

const containerGroup = new THREE.Group();
containerGroup.position.copy(containerConfig.containerPosition);
containerGroup.scale.setScalar(containerConfig.initialScale);
containerGroup.rotation.y = CONTAINER_DEFAULT_YAW;
scene.add(containerGroup);

/** Desktop / pre-XR preview — fixed world position (floor-relative). */
const DESKTOP_CONTAINER_POS = containerGroup.position.clone();
/** Head-local offset applied when an immersive session starts. */
const HEAD_OFFSET = { ...DEFAULT_HEAD_OFFSET };

const SOLID_RENDER_ORDER = 0;
const OVERLAY_RENDER_ORDER = 100;
const HANDLE_RENDER_ORDER = 2000;

const overlayDrawProps = {
    transparent: true,
    opacity: 1.0,
    depthTest: false,
    depthWrite: false,
};

const solidGroup = new THREE.Group();
solidGroup.frustumCulled = false;
containerGroup.add(solidGroup);

const CONTAINER_HALF = containerConfig.containerSize * 0.5;
const PROFILE_CONTAINER_MARGIN = 0.01;
const PROFILE_RADIUS_LIMIT = CONTAINER_HALF - PROFILE_CONTAINER_MARGIN;
const PROFILE_Y_LIMIT = CONTAINER_HALF - PROFILE_CONTAINER_MARGIN;

const containerFaceMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
});

const containerFacesGroup = new THREE.Group();
containerFacesGroup.frustumCulled = false;
containerGroup.add(containerFacesGroup);

const containerFaces = [];
const _containerCameraWorldPos = new THREE.Vector3();
const _containerViewDirLocal = new THREE.Vector3();
const _planeDefaultNormal = new THREE.Vector3(0, 0, 1);

function createContainerFace(localNormal, localCenter) {
    const facePlane = new THREE.PlaneGeometry(
        containerConfig.containerSize,
        containerConfig.containerSize
    );
    const faceEdges = new THREE.EdgesGeometry(facePlane);
    const faceLines = new THREE.LineSegments(faceEdges, containerFaceMaterial);
    faceLines.frustumCulled = false;
    faceLines.quaternion.setFromUnitVectors(_planeDefaultNormal, localNormal);
    faceLines.position.copy(localCenter);
    faceLines.userData.localNormal = localNormal.clone();
    containerFacesGroup.add(faceLines);
    containerFaces.push(faceLines);
    facePlane.dispose();
    faceEdges.dispose();
}

createContainerFace(new THREE.Vector3(1, 0, 0), new THREE.Vector3(CONTAINER_HALF, 0, 0));
createContainerFace(new THREE.Vector3(-1, 0, 0), new THREE.Vector3(-CONTAINER_HALF, 0, 0));
createContainerFace(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, CONTAINER_HALF, 0));
createContainerFace(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -CONTAINER_HALF, 0));
createContainerFace(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, CONTAINER_HALF));
createContainerFace(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 0, -CONTAINER_HALF));

const PLANE_UI_REF_Y_OFFSET = 0.18;
const planeUiRefSphere = new THREE.Object3D();
planeUiRefSphere.position.set(0, CONTAINER_HALF + PLANE_UI_REF_Y_OFFSET, 0);
containerGroup.add(planeUiRefSphere);

const HEADER_PLANE_TEX_W = 640;
const HEADER_PLANE_TEX_H = 210;
const HEADER_PLANE_SCALE = 1.1;
const HEADER_PLANE_WIDTH = 0.5 * HEADER_PLANE_SCALE;
const HEADER_PLANE_HEIGHT = HEADER_PLANE_WIDTH * (HEADER_PLANE_TEX_H / HEADER_PLANE_TEX_W);

const planeUiHeaderPivot = new THREE.Object3D();
planeUiRefSphere.add(planeUiHeaderPivot);

// Header equation canvas (textbook typography, single-line — no stacked fractions)
const HEADER_CANVAS_W = HEADER_PLANE_TEX_W * 2;
const HEADER_CANVAS_H = HEADER_PLANE_TEX_H * 2;
const HEADER_TITLE_FONT = '700 103px Helvetica, Arial, sans-serif';
const HEADER_TITLE_TEXT = 'Solids of Revolutioin';
const EQ_FONT = '400 84px Helvetica, Arial, sans-serif';
const EQ_OP_PAD = 32;
const HEADER_TITLE_Y = 0.32;

const headerCanvas = document.createElement('canvas');
headerCanvas.width = HEADER_CANVAS_W;
headerCanvas.height = HEADER_CANVAS_H;
const headerCtx = headerCanvas.getContext('2d');
const headerTexture = new THREE.CanvasTexture(headerCanvas);
headerTexture.colorSpace = THREE.SRGBColorSpace;

const PROFILE_EQ_TOKENS = {
    'r = R': [{ type: 'text', text: 'r = R' }],
    'r = R*(y1-y)/h': [{ type: 'text', text: 'r = R(y₁ − y)/h' }],
    'r = sqrt(R^2 - y^2)': [{ type: 'text', text: 'r = √(R² − y²)' }],
    'r = sqrt(a² + b²*(y-c)²)': [
        { type: 'text', text: 'r = √(a²' },
        { type: 'op', text: '+' },
        { type: 'text', text: 'b²(y − c)²)' },
    ],
    'r = c*sqrt(y - y0)': [{ type: 'text', text: 'r = c√(y − y₀)' }],
};

const DISK_EQ_TOKENS = {
    'r = R': [{ type: 'text', text: 'A(y) = πR²' }],
    'r = R*(y1-y)/h': [{ type: 'text', text: 'A(y) = πR²(y₁ − y)²/h²' }],
    'r = sqrt(R^2 - y^2)': [{ type: 'text', text: 'A(y) = π(R² − y²)' }],
    'r = sqrt(a² + b²*(y-c)²)': [
        { type: 'text', text: 'A(y) = π(a²' },
        { type: 'op', text: '+' },
        { type: 'text', text: 'b²(y − c)²)' },
    ],
    'r = c*sqrt(y - y0)': [{ type: 'text', text: 'A(y) = πc²(y − y₀)' }],
};

const FREEFORM_DISK_EQ_TOKENS = [{ type: 'text', text: 'A(y) = π[f(y)]²' }];

function getHeaderEquationTokens() {
    if (!deps.profileState || typeof deps.isDiskMode !== 'function') return null;
    if (deps.profileState.mode === 'custom') {
        return deps.isDiskMode() ? FREEFORM_DISK_EQ_TOKENS : null;
    }
    const key = deps.profileState.activePreset;
    if (deps.isDiskMode()) return DISK_EQ_TOKENS[key] ?? null;
    return PROFILE_EQ_TOKENS[key] ?? null;
}

function measureEqToken(ctx, token) {
    ctx.font = EQ_FONT;
    return ctx.measureText(token.text).width;
}

function totalEqWidth(ctx, tokens) {
    let w = 0;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'op') {
            w += EQ_OP_PAD * 2 + measureEqToken(ctx, t);
        } else {
            w += measureEqToken(ctx, t);
        }
    }
    return w;
}

function renderEqTokens(ctx, tokens, startX, cy) {
    ctx.font = EQ_FONT;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';

    let x = startX;
    for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (t.type === 'op') {
            const tw = measureEqToken(ctx, t);
            ctx.textAlign = 'center';
            ctx.fillText(t.text, x + EQ_OP_PAD + tw * 0.5, cy);
            x += EQ_OP_PAD * 2 + tw;
        } else {
            const tw = measureEqToken(ctx, t);
            ctx.textAlign = 'left';
            ctx.fillText(t.text, x, cy);
            x += tw;
        }
    }
}

function updateHeaderPlane() {
    if (!headerCtx) return;
    if (!deps.profileState || typeof deps.isDiskMode !== 'function') return;
    headerCtx.clearRect(0, 0, HEADER_CANVAS_W, HEADER_CANVAS_H);

    headerCtx.font = HEADER_TITLE_FONT;
    headerCtx.fillStyle = '#ffffff';
    headerCtx.textAlign = 'center';
    headerCtx.textBaseline = 'middle';
    headerCtx.fillText(HEADER_TITLE_TEXT, HEADER_CANVAS_W * 0.5, HEADER_CANVAS_H * HEADER_TITLE_Y);

    const eqY = HEADER_CANVAS_H * 0.72;
    if (deps.profileState.mode === 'custom' && !deps.isDiskMode()) {
        headerCtx.font = EQ_FONT;
        headerCtx.fillStyle = 'rgba(255, 255, 255, 0.8)';
        headerCtx.textAlign = 'center';
        headerCtx.fillText('Freeform Edit', HEADER_CANVAS_W * 0.5, eqY);
    } else {
        const tokens = getHeaderEquationTokens();
        if (tokens) {
            headerCtx.font = EQ_FONT;
            const totalW = totalEqWidth(headerCtx, tokens);
            renderEqTokens(headerCtx, tokens, (HEADER_CANVAS_W - totalW) * 0.5, eqY);
        }
    }

    headerTexture.needsUpdate = true;
}

const planeUiHeaderPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(HEADER_PLANE_WIDTH, HEADER_PLANE_HEIGHT),
    new THREE.MeshBasicMaterial({
        map: headerTexture,
        transparent: true,
        side: THREE.DoubleSide,
        ...overlayDrawProps,
    })
);
planeUiHeaderPlane.frustumCulled = false;
planeUiHeaderPlane.renderOrder = OVERLAY_RENDER_ORDER + 1;
planeUiHeaderPivot.add(planeUiHeaderPlane);

function updateContainerFaceVisibility() {
    // containerGroup's parent is the scene root (always identity), so its
    // world matrix equals its local matrix — refresh just that instead of
    // forcing a recursive updateMatrixWorld(true), which would redundantly
    // recompute the whole container subtree (menu, handles, disks, etc.)
    // right before renderer.render() does the same full-tree pass anyway.
    containerGroup.updateMatrix();
    containerGroup.matrixWorld.copy(containerGroup.matrix);
    renderer.xr.getCamera().getWorldPosition(_containerCameraWorldPos);
    containerGroup.worldToLocal(_containerViewDirLocal.copy(_containerCameraWorldPos));

    for (let i = 0; i < containerFaces.length; i++) {
        const face = containerFaces[i];
        face.visible = face.userData.localNormal.dot(_containerViewDirLocal) < 0;
    }
}

const axesGroup = new THREE.Group();
axesGroup.frustumCulled = false;
containerGroup.add(axesGroup);

const AXIS_LENGTH = containerConfig.containerSize;
const AXIS_THICKNESS = 0.002;
const AXIS_ARROW_LENGTH = 0.02;
const AXIS_ARROW_RADIUS = 0.004;
const AXIS_LABEL_OFFSET = 0.015;
const AXIS_LABEL_SIZE = 0.03;
const axisLabels = [];
const _axisLabelCameraWorldPos = new THREE.Vector3();

const axisMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    ...overlayDrawProps,
});

const xAxis = new THREE.Mesh(
    new THREE.BoxGeometry(AXIS_LENGTH, AXIS_THICKNESS, AXIS_THICKNESS),
    axisMaterial
);
xAxis.frustumCulled = false;
xAxis.renderOrder = OVERLAY_RENDER_ORDER;
axesGroup.add(xAxis);

const yAxis = new THREE.Mesh(
    new THREE.BoxGeometry(AXIS_THICKNESS, AXIS_LENGTH, AXIS_THICKNESS),
    axisMaterial
);
yAxis.frustumCulled = false;
yAxis.renderOrder = OVERLAY_RENDER_ORDER;
axesGroup.add(yAxis);

const zAxis = new THREE.Mesh(
    new THREE.BoxGeometry(AXIS_THICKNESS, AXIS_THICKNESS, AXIS_LENGTH),
    axisMaterial
);
zAxis.frustumCulled = false;
zAxis.renderOrder = OVERLAY_RENDER_ORDER;
axesGroup.add(zAxis);

function addAxisArrowHead(direction, position) {
    const head = new THREE.Mesh(
        new THREE.ConeGeometry(AXIS_ARROW_RADIUS, AXIS_ARROW_LENGTH, 14),
        axisMaterial
    );
    head.position.copy(position);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    head.frustumCulled = false;
    head.renderOrder = OVERLAY_RENDER_ORDER;
    axesGroup.add(head);
}

function addAxisLabel(text, position) {
    const size = 128;
    const canvasEl = document.createElement('canvas');
    canvasEl.width = size;
    canvasEl.height = size;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    ctx.font = '700 88px Helvetica, Arial, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, size * 0.5, size * 0.55);

    const texture = new THREE.CanvasTexture(canvasEl);
    texture.needsUpdate = true;

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });

    const label = new THREE.Mesh(
        new THREE.PlaneGeometry(AXIS_LABEL_SIZE, AXIS_LABEL_SIZE),
        material
    );
    label.position.copy(position);
    label.renderOrder = 1000;
    label.frustumCulled = false;
    axisLabels.push(label);
    axesGroup.add(label);
}

function updateAxisLabelOrientation() {
    camera.getWorldPosition(_axisLabelCameraWorldPos);
    for (let i = 0; i < axisLabels.length; i++) {
        axisLabels[i].lookAt(_axisLabelCameraWorldPos);
    }
}

const axisTipOffset = AXIS_LENGTH * 0.5 + AXIS_ARROW_LENGTH * 0.5;
addAxisArrowHead(new THREE.Vector3(1, 0, 0), new THREE.Vector3(axisTipOffset, 0, 0));
addAxisArrowHead(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, axisTipOffset, 0));
addAxisArrowHead(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, axisTipOffset));
const axisLabelOffset = axisTipOffset + AXIS_ARROW_LENGTH * 0.5 + AXIS_LABEL_OFFSET;
addAxisLabel('x', new THREE.Vector3(axisLabelOffset, 0, 0));
addAxisLabel('y', new THREE.Vector3(0, axisLabelOffset, 0));
addAxisLabel('z', new THREE.Vector3(0, 0, axisLabelOffset));



function updatePlaneUiHeaderOrientation() {
    renderer.xr.getCamera().getWorldPosition(_containerCameraWorldPos);
    _containerViewDirLocal.copy(_containerCameraWorldPos);
    containerGroup.worldToLocal(_containerViewDirLocal);

    const dx = _containerViewDirLocal.x - planeUiRefSphere.position.x;
    const dz = _containerViewDirLocal.z - planeUiRefSphere.position.z;
    const horizLenSq = dx * dx + dz * dz;
    if (horizLenSq > 1e-8) {
        planeUiHeaderPivot.rotation.y = Math.atan2(dx, dz);
    }
}


    const api = {
        containerConfig,
        CONTAINER_DEFAULT_YAW,
        containerGroup,
        DESKTOP_CONTAINER_POS,
        HEAD_OFFSET,
        SOLID_RENDER_ORDER,
        OVERLAY_RENDER_ORDER,
        HANDLE_RENDER_ORDER,
        overlayDrawProps,
        solidGroup,
        CONTAINER_HALF,
        PROFILE_RADIUS_LIMIT,
        PROFILE_Y_LIMIT,
        planeUiRefSphere,
        planeUiHeaderPivot,
        updateHeaderPlane,
        updateContainerFaceVisibility,
        updateAxisLabelOrientation,
        updatePlaneUiHeaderOrientation
    };
    Object.assign(deps, api);
    return api;
}
