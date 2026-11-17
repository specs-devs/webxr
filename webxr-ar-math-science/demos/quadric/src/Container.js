import * as THREE from 'three';
import { DEFAULT_HEAD_OFFSET } from './XRHeadPlacement.js';

export function createContainer(deps) {
    const { scene, camera } = deps;
const containerConfig = {
    containerSize: 0.35,
};

/** Desktop / pre-XR preview — fixed world position (floor-relative). */
const DESKTOP_CONTAINER_POS = new THREE.Vector3(0, 1.3, -1.3);
/** Head-local offset applied when an immersive session starts. */
const HEAD_OFFSET = { ...DEFAULT_HEAD_OFFSET };

const containerGroup = new THREE.Group();
containerGroup.position.copy(DESKTOP_CONTAINER_POS);
scene.add(containerGroup);

const cubeGeometry = new THREE.BoxGeometry(
    containerConfig.containerSize,
    containerConfig.containerSize,
    containerConfig.containerSize
);
const cubeEdges = new THREE.EdgesGeometry(cubeGeometry);
const cubeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
const containerCube = new THREE.LineSegments(cubeEdges, cubeMaterial);
containerCube.frustumCulled = false;
containerGroup.add(containerCube);

const axesGroup = new THREE.Group();
axesGroup.frustumCulled = false;
containerGroup.add(axesGroup);

const AXIS_LENGTH = containerConfig.containerSize;
const AXIS_THICKNESS = 0.0012;
const AXIS_ARROW_LENGTH = 0.02;
const AXIS_ARROW_RADIUS = 0.004;
const AXIS_LABEL_OFFSET = 0.015;
const AXIS_LABEL_SIZE = 0.03;
const axisLabels = [];
const _axisLabelCameraWorldPos = new THREE.Vector3();
const axisMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthTest: false,
    depthWrite: false,
});

const xAxis = new THREE.Mesh(
    new THREE.BoxGeometry(AXIS_LENGTH, AXIS_THICKNESS, AXIS_THICKNESS),
    axisMaterial
);
xAxis.renderOrder = 1000;
xAxis.frustumCulled = false;
axesGroup.add(xAxis);

const yAxis = new THREE.Mesh(
    new THREE.BoxGeometry(AXIS_THICKNESS, AXIS_LENGTH, AXIS_THICKNESS),
    axisMaterial
);
yAxis.renderOrder = 1000;
yAxis.frustumCulled = false;
axesGroup.add(yAxis);

const zAxis = new THREE.Mesh(
    new THREE.BoxGeometry(AXIS_THICKNESS, AXIS_THICKNESS, AXIS_LENGTH),
    axisMaterial
);
zAxis.renderOrder = 1000;
zAxis.frustumCulled = false;
axesGroup.add(zAxis);

function addAxisArrowHead(direction, position) {
    const head = new THREE.Mesh(
        new THREE.ConeGeometry(AXIS_ARROW_RADIUS, AXIS_ARROW_LENGTH, 14),
        axisMaterial
    );
    head.position.copy(position);
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    head.renderOrder = 1000;
    head.frustumCulled = false;
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
        side: THREE.FrontSide,
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

const halfContainerSize = containerConfig.containerSize * 0.5;


    const api = {
        containerConfig,
        containerGroup,
        containerCube,
        DESKTOP_CONTAINER_POS,
        HEAD_OFFSET,
        halfContainerSize,
        axesGroup,
        axisLabels,
        updateAxisLabelOrientation
    };
    Object.assign(deps, api);
    return api;
}
