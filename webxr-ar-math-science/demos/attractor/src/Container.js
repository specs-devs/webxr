import * as THREE from 'three';
import { TextGeometry } from 'three/addons/geometries/TextGeometry.js';
import {
    createEquationCanvasTexture,
    hasAttractorEquation,
    renderAttractorEquation,
} from './attractorEquationDisplay.js';
import { DEFAULT_HEAD_OFFSET } from './XRHeadPlacement.js';

export function createContainer(deps) {
    const { scene, camera, renderer } = deps;
const containerConfig = {
    containerSize: 0.45,
    /** Uniform open scale on containerGroup — same as pinch scale; keeps internal gaps/layout unchanged. */
    initialScale: 0.65,
};

/** Desktop / pre-XR preview — fixed world position (floor-relative). */
const DESKTOP_CONTAINER_POS = new THREE.Vector3(0, 1.3, -1.2);
const DESKTOP_CONTAINER_ROTATION_Y = Math.PI * 0.25;
/** Head-local offset applied when an immersive session starts. */
const HEAD_OFFSET = { ...DEFAULT_HEAD_OFFSET };

const containerGroup = new THREE.Group();
containerGroup.position.copy(DESKTOP_CONTAINER_POS);
containerGroup.rotation.y = DESKTOP_CONTAINER_ROTATION_Y;
containerGroup.scale.setScalar(containerConfig.initialScale);
scene.add(containerGroup);

const containerHalf = containerConfig.containerSize * 0.5;
const wireframeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });

function createContainerWirePlane(rotation, position) {
    const planeGeometry = new THREE.PlaneGeometry(
        containerConfig.containerSize,
        containerConfig.containerSize
    );
    const planeEdges = new THREE.EdgesGeometry(planeGeometry);
    const plane = new THREE.LineSegments(planeEdges, wireframeMaterial);
    plane.rotation.set(rotation.x, rotation.y, rotation.z);
    plane.position.copy(position);
    return plane;
}

const container = new THREE.Group();
const containerFaceDefs = [
    { id: 'posX', rotation: new THREE.Euler(0, Math.PI * 0.5, 0), position: new THREE.Vector3(containerHalf, 0, 0), localNormal: new THREE.Vector3(1, 0, 0), side: true },
    { id: 'negX', rotation: new THREE.Euler(0, -Math.PI * 0.5, 0), position: new THREE.Vector3(-containerHalf, 0, 0), localNormal: new THREE.Vector3(-1, 0, 0), side: true },
    { id: 'posY', rotation: new THREE.Euler(-Math.PI * 0.5, 0, 0), position: new THREE.Vector3(0, containerHalf, 0), localNormal: new THREE.Vector3(0, 1, 0), side: false },
    { id: 'negY', rotation: new THREE.Euler(Math.PI * 0.5, 0, 0), position: new THREE.Vector3(0, -containerHalf, 0), localNormal: new THREE.Vector3(0, -1, 0), side: false },
    { id: 'posZ', rotation: new THREE.Euler(0, 0, 0), position: new THREE.Vector3(0, 0, containerHalf), localNormal: new THREE.Vector3(0, 0, 1), side: true },
    { id: 'negZ', rotation: new THREE.Euler(0, Math.PI, 0), position: new THREE.Vector3(0, 0, -containerHalf), localNormal: new THREE.Vector3(0, 0, -1), side: true },
];
const containerFaces = {};
const containerSideFaces = [];
for (const def of containerFaceDefs) {
    const plane = createContainerWirePlane(def.rotation, def.position);
    container.add(plane);
    const face = { plane, localNormal: def.localNormal, localCenter: def.position };
    containerFaces[def.id] = face;
    if (def.side) containerSideFaces.push(face);
}
containerGroup.add(container);

const CONTAINER_ATTRACTOR_LABEL_Y_OFFSET = 0.12;
const CONTAINER_ATTRACTOR_LABEL_SIZE = 0.04;
const assetBase = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/');
const CONTAINER_ATTRACTOR_LABEL_FONT_URL = `${assetBase}static/fonts/inter_bold.json`;
let containerAttractorLabelFont = null;
let containerAttractorLabelMesh = null;

/** Floating header above the container only — stepper row uses getCurrentAttractor().label. */
function getContainerAttractorHeaderLabelText() {
    const label = deps.getCurrentAttractor().label;
    return label.endsWith(' Attractor') ? label : `${label} Attractor`;
}

function disposeContainerAttractorLabel() {
    if (!containerAttractorLabelMesh) return;
    container.remove(containerAttractorLabelMesh);
    containerAttractorLabelMesh.geometry.dispose();
    containerAttractorLabelMesh.material.dispose();
    containerAttractorLabelMesh = null;
}

/** Center on X/Z; lock Y to font em-box so descenders (q, g, …) don't shift the line. */
function centerOverlayTextGeometry(geometry, font, size) {
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const scale = size / font.data.resolution;
    const emCenterY = (font.data.ascender + font.data.descender) * 0.5 * scale;
    geometry.translate(
        -(bb.max.x + bb.min.x) * 0.5,
        -emCenterY,
        -(bb.max.z + bb.min.z) * 0.5
    );
}

function buildContainerAttractorLabel(font) {
    disposeContainerAttractorLabel();

    const geometry = new TextGeometry(getContainerAttractorHeaderLabelText(), {
        font,
        size: CONTAINER_ATTRACTOR_LABEL_SIZE,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false,
    });
    centerOverlayTextGeometry(geometry, font, CONTAINER_ATTRACTOR_LABEL_SIZE);

    containerAttractorLabelMesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        })
    );
    containerAttractorLabelMesh.position.set(
        0,
        containerHalf + CONTAINER_ATTRACTOR_LABEL_Y_OFFSET,
        0
    );
    applyOverlayRenderSettings(containerAttractorLabelMesh, TEMP_REF_UI_RENDER_ORDER.label);
    container.add(containerAttractorLabelMesh);
    container.updateWorldMatrix(true, true);
    updateContainerAttractorLabelYaw();
}

const CONTAINER_BUILD_PROGRESS_LABEL_SIZE = 0.02;
const CONTAINER_BUILD_PROGRESS_LABEL_COLOR = 0xffff00;
const CONTAINER_BUILD_PROGRESS_BAR_WIDTH = 0.186;
const CONTAINER_BUILD_PROGRESS_BAR_HEIGHT = 0.004;
const CONTAINER_BUILD_PROGRESS_BAR_GAP = 0.015;
let buildProgressGroup = null;
let _buildProgressDisplayedPercent = -1;

function disposeBuildProgressLabel() {
    if (!buildProgressGroup) return;
    container.remove(buildProgressGroup);
    buildProgressGroup.traverse((obj) => {
        if (!obj.isMesh) return;
        obj.geometry.dispose();
        const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const mat of materials) mat.dispose();
    });
    buildProgressGroup = null;
    _buildProgressDisplayedPercent = -1;
}

function buildBuildProgressLabel(font, percent) {
    disposeBuildProgressLabel();

    buildProgressGroup = new THREE.Group();
    buildProgressGroup.frustumCulled = false;

    const geometry = new TextGeometry(`${percent}%`, {
        font,
        size: CONTAINER_BUILD_PROGRESS_LABEL_SIZE,
        height: 0,
        curveSegments: 8,
        bevelEnabled: false,
    });
    centerOverlayTextGeometry(geometry, font, CONTAINER_BUILD_PROGRESS_LABEL_SIZE);
    geometry.computeBoundingBox();

    const labelMesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
            color: CONTAINER_BUILD_PROGRESS_LABEL_COLOR,
            transparent: true,
            opacity: 1.0,
        })
    );
    applyOverlayRenderSettings(labelMesh, TEMP_REF_UI_RENDER_ORDER.label);
    buildProgressGroup.add(labelMesh);

    const textBottom = geometry.boundingBox.min.y;
    const barY = textBottom - CONTAINER_BUILD_PROGRESS_BAR_GAP - CONTAINER_BUILD_PROGRESS_BAR_HEIGHT * 0.5;

    const baseMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(CONTAINER_BUILD_PROGRESS_BAR_WIDTH, CONTAINER_BUILD_PROGRESS_BAR_HEIGHT),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    baseMesh.position.set(0, barY, 0);
    applyOverlayRenderSettings(baseMesh, TEMP_REF_UI_RENDER_ORDER.label);
    buildProgressGroup.add(baseMesh);

    const fillWidth = CONTAINER_BUILD_PROGRESS_BAR_WIDTH * (percent / 100);
    if (fillWidth > 0) {
        const fillMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(fillWidth, CONTAINER_BUILD_PROGRESS_BAR_HEIGHT),
            new THREE.MeshBasicMaterial({
                color: 0xffffff,
                transparent: false,
                opacity: 1.0,
                side: THREE.DoubleSide,
                depthTest: false,
                depthWrite: false,
            })
        );
        fillMesh.position.set(-CONTAINER_BUILD_PROGRESS_BAR_WIDTH * 0.5 + fillWidth * 0.5, barY, 0.001);
        fillMesh.renderOrder = TEMP_REF_UI_RENDER_ORDER.label + 1;
        fillMesh.frustumCulled = false;
        buildProgressGroup.add(fillMesh);
    }

    container.add(buildProgressGroup);
    _buildProgressDisplayedPercent = percent;
    container.updateWorldMatrix(true, true);
    updateBuildProgressLabelYaw();
}

function syncBuildProgressLabel() {
    if (!containerAttractorLabelFont) return;

    const progress = deps.getAttractorBuildProgress();
    if (progress === null) {
        if (buildProgressGroup) buildProgressGroup.visible = false;
        _buildProgressDisplayedPercent = -1;
        return;
    }

    // Snap to 2% steps to cut TextGeometry rebuilds; final look of the attractor is unchanged.
    const rawPercent = Math.min(100, Math.floor(progress * 100));
    const percent = rawPercent >= 100 ? 100 : rawPercent - (rawPercent % 2);
    if (!buildProgressGroup) {
        buildBuildProgressLabel(containerAttractorLabelFont, percent);
    } else if (percent !== _buildProgressDisplayedPercent) {
        buildBuildProgressLabel(containerAttractorLabelFont, percent);
    }
    buildProgressGroup.visible = true;
}

/** Local +X offset for the equation panel anchor (meters relative to container half-size). */
const TEMP_REF_CONTAINER_RIGHT_SPHERE_OFFSET_X = containerHalf * 2.6;
/** Extra yaw around container Y (degrees). 0 = viewer's right; 90 = toward camera; -90 = away. */
const TEMP_REF_CONTAINER_RIGHT_SPHERE_YAW_OFFSET_DEG = -30;
const tempRefContainerCenterSphere = new THREE.Object3D();
tempRefContainerCenterSphere.frustumCulled = false;
container.add(tempRefContainerCenterSphere);

const tempRefContainerRightSphere = new THREE.Object3D();
tempRefContainerRightSphere.position.set(TEMP_REF_CONTAINER_RIGHT_SPHERE_OFFSET_X, 0, 0);
tempRefContainerRightSphere.frustumCulled = false;
tempRefContainerCenterSphere.add(tempRefContainerRightSphere);

const TEMP_REF_EQUATION_PLANE_DESIGN_W = 1024;
const TEMP_REF_EQUATION_PLANE_DESIGN_H = Math.round(1024 * (325 / 380));
const TEMP_REF_CONTAINER_RIGHT_PLANE_HEIGHT = 0.04 * 13.0;
const tempRefContainerRightPlaneWidth =
    TEMP_REF_CONTAINER_RIGHT_PLANE_HEIGHT *
    (TEMP_REF_EQUATION_PLANE_DESIGN_W / TEMP_REF_EQUATION_PLANE_DESIGN_H);
const tempRefContainerRightSpherePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(
        tempRefContainerRightPlaneWidth,
        TEMP_REF_CONTAINER_RIGHT_PLANE_HEIGHT
    ),
    new THREE.MeshBasicMaterial({
        transparent: true,
        side: THREE.FrontSide,
        depthTest: false,
        depthWrite: false,
    })
);
const attractorEquationDisplay = createEquationCanvasTexture(
    THREE,
    TEMP_REF_EQUATION_PLANE_DESIGN_W,
    TEMP_REF_EQUATION_PLANE_DESIGN_H
);
tempRefContainerRightSpherePlane.material.map = attractorEquationDisplay.texture;

function syncAttractorEquationPlane() {
    const hasEquation = hasAttractorEquation(deps.currentAttractorKey);
    tempRefContainerRightSpherePlane.visible = hasEquation;
    if (!hasEquation) return;
    renderAttractorEquation(deps.currentAttractorKey, attractorEquationDisplay).then((drew) => {
        if (drew) attractorEquationDisplay.texture.needsUpdate = true;
    });
}

tempRefContainerRightSpherePlane.position.z = 0.001;
tempRefContainerRightSpherePlane.frustumCulled = false;
tempRefContainerRightSphere.add(tempRefContainerRightSpherePlane);

const tempRefGroundCenterSphere = new THREE.Object3D();
tempRefGroundCenterSphere.position.set(0, -containerHalf - 0.06, 0);
container.add(tempRefGroundCenterSphere);

const tempRefTowardUserOffsetBase = 0.34; // world-space offset at containerGroup scale 1
const tempRefTowardUserSphere = new THREE.Object3D();
tempRefGroundCenterSphere.add(tempRefTowardUserSphere);

const TEMP_REF_UI_RENDER_ORDER = {
    plane: 10,
    panel: 11,
    button: 12,
    label: 14,
};

function applyOverlayRenderSettings(object3D, renderOrder) {
    object3D.frustumCulled = false;
    if (!object3D.isMesh || !object3D.material) return;
    const materials = Array.isArray(object3D.material) ? object3D.material : [object3D.material];
    for (const mat of materials) {
        mat.depthTest = false;
        mat.depthWrite = false;
        mat.transparent = true;
    }
    if (renderOrder !== undefined) object3D.renderOrder = renderOrder;
}


const _tempRefUiPlaneWorldPos = new THREE.Vector3();
const _tempRefUiPlaneWorldQuat = new THREE.Quaternion();
const _tempRefUiPlaneParentWorldQuat = new THREE.Quaternion();

function setObjectQuaternionVerticalBillboard(object3D, worldAnchorPos) {
    getViewCameraWorldPosition(_viewCameraPos);

    const dx = _viewCameraPos.x - worldAnchorPos.x;
    const dz = _viewCameraPos.z - worldAnchorPos.z;
    if (dx * dx + dz * dz < 1e-10) return false;

    _tempRefUiPlaneWorldQuat.setFromEuler(
        new THREE.Euler(0, Math.atan2(dx, dz), 0, 'YXZ')
    );
    object3D.parent.getWorldQuaternion(_tempRefUiPlaneParentWorldQuat);
    _tempRefUiPlaneParentWorldQuat.invert();
    object3D.quaternion.copy(
        _tempRefUiPlaneParentWorldQuat.multiply(_tempRefUiPlaneWorldQuat)
    );
    return true;
}
function updateTempRefContainerRightSpherePlaneYaw() {
    tempRefContainerRightSpherePlane.getWorldPosition(_tempRefUiPlaneWorldPos);
    setObjectQuaternionVerticalBillboard(
        tempRefContainerRightSpherePlane,
        _tempRefUiPlaneWorldPos
    );
}

const _viewCameraPos = new THREE.Vector3();
const _faceWorldNormal = new THREE.Vector3();
const _faceWorldCenter = new THREE.Vector3();
const _faceToCamera = new THREE.Vector3();
const _containerWorldQuat = new THREE.Quaternion();
const _sideFaceVisibilityScratch = [];

function getViewCameraWorldPosition(target) {
    if (renderer.xr.isPresenting) {
        renderer.xr.getCamera().getWorldPosition(target);
    } else {
        camera.getWorldPosition(target);
    }
    return target;
}

const _attractorLabelWorldPos = new THREE.Vector3();
const _attractorLabelWorldQuat = new THREE.Quaternion();
const _attractorLabelParentWorldQuat = new THREE.Quaternion();

function billboardContainerChildToCamera(mesh) {
    if (!mesh) return;

    mesh.getWorldPosition(_attractorLabelWorldPos);
    getViewCameraWorldPosition(_viewCameraPos);

    const dx = _viewCameraPos.x - _attractorLabelWorldPos.x;
    const dz = _viewCameraPos.z - _attractorLabelWorldPos.z;
    if (dx * dx + dz * dz < 1e-10) return;

    _attractorLabelWorldQuat.setFromEuler(
        new THREE.Euler(0, Math.atan2(dx, dz), 0, 'YXZ')
    );
    container.getWorldQuaternion(_attractorLabelParentWorldQuat);
    _attractorLabelParentWorldQuat.invert();
    mesh.quaternion.copy(
        _attractorLabelParentWorldQuat.multiply(_attractorLabelWorldQuat)
    );
}

function updateContainerAttractorLabelYaw() {
    billboardContainerChildToCamera(containerAttractorLabelMesh);
}

/** Keeps tempRefContainerRightSphere on the viewer's right (+X after yaw toward camera, 90° left of forward). */
function updateTempRefContainerCenterSphereYaw() {
    tempRefContainerCenterSphere.getWorldPosition(_attractorLabelWorldPos);
    getViewCameraWorldPosition(_viewCameraPos);

    const dx = _viewCameraPos.x - _attractorLabelWorldPos.x;
    const dz = _viewCameraPos.z - _attractorLabelWorldPos.z;
    if (dx * dx + dz * dz < 1e-10) return;

    const yaw =
        Math.atan2(dx, dz) +
        THREE.MathUtils.degToRad(TEMP_REF_CONTAINER_RIGHT_SPHERE_YAW_OFFSET_DEG);
    _attractorLabelWorldQuat.setFromEuler(new THREE.Euler(0, yaw, 0, 'YXZ'));
    container.getWorldQuaternion(_attractorLabelParentWorldQuat);
    _attractorLabelParentWorldQuat.invert();
    tempRefContainerCenterSphere.quaternion.copy(
        _attractorLabelParentWorldQuat.multiply(_attractorLabelWorldQuat)
    );
}

function updateBuildProgressLabelYaw() {
    if (!buildProgressGroup?.visible) return;
    billboardContainerChildToCamera(buildProgressGroup);
}

function updateContainerWireframeVisibility() {
    containerFaces.posY.plane.visible = false;
    containerFaces.negY.plane.visible = true;

    getViewCameraWorldPosition(_viewCameraPos);
    containerGroup.getWorldQuaternion(_containerWorldQuat);

    _sideFaceVisibilityScratch.length = 0;
    for (const face of containerSideFaces) {
        _faceWorldNormal.copy(face.localNormal).applyQuaternion(_containerWorldQuat);
        _faceWorldCenter.copy(face.localCenter);
        containerGroup.localToWorld(_faceWorldCenter);
        _faceToCamera.subVectors(_viewCameraPos, _faceWorldCenter).normalize();
        _sideFaceVisibilityScratch.push({
            plane: face.plane,
            facing: _faceWorldNormal.dot(_faceToCamera),
        });
    }

    _sideFaceVisibilityScratch.sort((a, b) => b.facing - a.facing);
    _sideFaceVisibilityScratch[0].plane.visible = false;
    _sideFaceVisibilityScratch[1].plane.visible = false;
    _sideFaceVisibilityScratch[2].plane.visible = true;
    _sideFaceVisibilityScratch[3].plane.visible = true;
}

/** Skip billboard / wireface work when head + container barely moved (Spectacles CPU spare). */
const UI_VIEW_CAM_MOVE_EPS_SQ = 0.000025; // ~5mm
const UI_VIEW_CONT_MOVE_EPS_SQ = 0.000025;
const UI_VIEW_CONT_ROT_EPS = 0.01; // rad
const _lastUiViewCamPos = new THREE.Vector3();
const _lastUiViewContPos = new THREE.Vector3();
const _lastUiViewContQuat = new THREE.Quaternion();
let _lastUiViewContScale = NaN;
let _uiViewSampled = false;

function shouldRefreshViewDependentUI() {
    getViewCameraWorldPosition(_viewCameraPos);
    if (!_uiViewSampled) {
        _uiViewSampled = true;
        _lastUiViewCamPos.copy(_viewCameraPos);
        _lastUiViewContPos.copy(containerGroup.position);
        _lastUiViewContQuat.copy(containerGroup.quaternion);
        _lastUiViewContScale = containerGroup.scale.x;
        return true;
    }

    const camMoved = _viewCameraPos.distanceToSquared(_lastUiViewCamPos) > UI_VIEW_CAM_MOVE_EPS_SQ;
    const contMoved = containerGroup.position.distanceToSquared(_lastUiViewContPos) > UI_VIEW_CONT_MOVE_EPS_SQ;
    const contScaled = Math.abs(containerGroup.scale.x - _lastUiViewContScale) > 1e-6;
    const contRotated = _lastUiViewContQuat.angleTo(containerGroup.quaternion) > UI_VIEW_CONT_ROT_EPS;
    if (!camMoved && !contMoved && !contScaled && !contRotated) return false;

    _lastUiViewCamPos.copy(_viewCameraPos);
    _lastUiViewContPos.copy(containerGroup.position);
    _lastUiViewContQuat.copy(containerGroup.quaternion);
    _lastUiViewContScale = containerGroup.scale.x;
    return true;
}


    const api = {
        containerConfig,
        DESKTOP_CONTAINER_POS,
        DESKTOP_CONTAINER_ROTATION_Y,
        HEAD_OFFSET,
        containerGroup,
        container,
        containerHalf,
        containerFaces,
        containerSideFaces,
        CONTAINER_ATTRACTOR_LABEL_FONT_URL,
        containerAttractorLabelFont,
        containerAttractorLabelMesh,
        disposeContainerAttractorLabel,
        buildContainerAttractorLabel,
        buildProgressGroup,
        disposeBuildProgressLabel,
        buildBuildProgressLabel,
        syncBuildProgressLabel,
        tempRefContainerCenterSphere,
        tempRefContainerRightSphere,
        tempRefContainerRightSpherePlane,
        attractorEquationDisplay,
        syncAttractorEquationPlane,
        tempRefGroundCenterSphere,
        tempRefTowardUserOffsetBase,
        tempRefTowardUserSphere,
        TEMP_REF_UI_RENDER_ORDER,
        applyOverlayRenderSettings,
        getViewCameraWorldPosition,
        updateTempRefContainerRightSpherePlaneYaw,
        updateContainerAttractorLabelYaw,
        updateTempRefContainerCenterSphereYaw,
        updateBuildProgressLabelYaw,
        updateContainerWireframeVisibility,
        shouldRefreshViewDependentUI,
        centerOverlayTextGeometry
    };
    Object.assign(deps, api);
    Object.defineProperty(deps, 'containerAttractorLabelFont', {
        configurable: true,
        enumerable: true,
        get: () => containerAttractorLabelFont,
        set: (v) => { containerAttractorLabelFont = v; },
    });
    Object.defineProperty(deps, 'buildProgressGroup', {
        configurable: true,
        enumerable: true,
        get: () => buildProgressGroup,
        set: (v) => { buildProgressGroup = v; },
    });
    return api;
}
