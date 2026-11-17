import * as THREE from 'three';
import { DEFAULT_HEAD_OFFSET } from './XRHeadPlacement.js';

export function createContainer(deps) {
    const { scene } = deps;

const containerConfig = {
    containerSize: 0.45,
    containerPosition: new THREE.Vector3(0, 1.1, -1.2),
    /** Uniform group scale at start — same as two-hand pinch scaling, not per-part resizing. */
    initialScale: 0.85,
};

const containerGroup = new THREE.Group();
containerGroup.position.copy(containerConfig.containerPosition);
containerGroup.scale.setScalar(containerConfig.initialScale);
scene.add(containerGroup);

/** Desktop / pre-XR preview — fixed world position (floor-relative). */
const DESKTOP_CONTAINER_POS = containerGroup.position.clone();
/** Head-local offset applied when an immersive session starts. */
const HEAD_OFFSET = { ...DEFAULT_HEAD_OFFSET };

const cubeGeometry = new THREE.BoxGeometry(
    containerConfig.containerSize,
    containerConfig.containerSize,
    containerConfig.containerSize
);
const cubeEdges = new THREE.EdgesGeometry(cubeGeometry);
const cubeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
const containerCube = new THREE.LineSegments(cubeEdges, cubeMaterial);
containerCube.visible = false;
containerGroup.add(containerCube);

// Plate — horizontal mid-plane (vertically centered in the container)
const plateGeometry = new THREE.PlaneGeometry(
    containerConfig.containerSize,
    containerConfig.containerSize
);
const plateMaterial = new THREE.MeshBasicMaterial({
    color: 0x888888,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.1,
});
const plate = new THREE.Mesh(plateGeometry, plateMaterial);
plate.rotation.x = -Math.PI / 2;
plate.position.y = 0;
plate.frustumCulled = false;
containerGroup.add(plate);

// Center marker on the pattern plane
const plateCenterDiscGeometry = new THREE.CircleGeometry(0.01, 48);
const plateCenterDiscMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
});
const plateCenterDisc = new THREE.Mesh(plateCenterDiscGeometry, plateCenterDiscMaterial);
plateCenterDisc.rotation.x = -Math.PI / 2;
plateCenterDisc.position.set(0, plate.position.y + 0.0015, 0);
containerGroup.add(plateCenterDisc);

// Same square footprint as the plate — white outline (cheap; line width is ~1px in WebGL)
const plateFrameGeometry = new THREE.PlaneGeometry(
    containerConfig.containerSize,
    containerConfig.containerSize
);
const plateFrameEdges = new THREE.EdgesGeometry(plateFrameGeometry);
const plateFrameLineMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: false,
    opacity: 1.0,
});
const plateFrame = new THREE.LineSegments(plateFrameEdges, plateFrameLineMaterial);
plateFrame.rotation.x = -Math.PI / 2;
plateFrame.position.y = plate.position.y + 0.001;
containerGroup.add(plateFrame);

const frameBoxHeight = containerConfig.containerSize * 0.2;
const frameBoxDownShift = 0.04;
const frameBoxGeometry = new THREE.BoxGeometry(
    containerConfig.containerSize,
    frameBoxHeight,
    containerConfig.containerSize
);
const frameBoxEdges = new THREE.EdgesGeometry(frameBoxGeometry);
const frameBoxMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: false,
    opacity: 1.0,
});
const frameBox = new THREE.LineSegments(frameBoxEdges, frameBoxMaterial);
frameBox.position.y = plate.position.y - (frameBoxHeight / 2) - frameBoxDownShift;
containerGroup.add(frameBox);

const halfSize = containerConfig.containerSize / 2;
const plateY = 0;


    const api = {

        containerConfig,
        containerGroup,
        DESKTOP_CONTAINER_POS,
        HEAD_OFFSET,
        containerCube,
        plate,
        plateCenterDisc,
        plateFrame,
        frameBox,
        halfSize,
        plateY
    };
    Object.assign(deps, api);
    return api;
}
