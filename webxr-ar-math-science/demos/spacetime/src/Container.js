import * as THREE from 'three';
import { DEFAULT_HEAD_OFFSET } from './XRHeadPlacement.js';
export function createContainer(deps) {
    const { scene } = deps;
const containerConfig = {
    containerSize: 0.45,
    /** Desktop / pre-XR preview — fixed world position (floor-relative). */
    containerPosition: new THREE.Vector3(0, 1.2, -1.2),
};

const GRID_EXTENT_MULTIPLIER = 1.5;
const GRID_PHYS = containerConfig.containerSize * GRID_EXTENT_MULTIPLIER;

/** Desktop / pre-XR preview — fixed world position (floor-relative). */
const DESKTOP_CONTAINER_POS = containerConfig.containerPosition;
/** Head-local offset applied when an immersive session starts. */
const HEAD_OFFSET = { ...DEFAULT_HEAD_OFFSET };
const INITIAL_CONTAINER_SCALE = 0.6;

const containerGroup = new THREE.Group();
containerGroup.position.copy(DESKTOP_CONTAINER_POS);
containerGroup.scale.setScalar(INITIAL_CONTAINER_SCALE);
scene.add(containerGroup);

function disableFrustumCulling(root) {
    root.traverse((child) => {
        if ('frustumCulled' in child) {
            child.frustumCulled = false;
        }
    });
}

const cubeGeometry = new THREE.BoxGeometry(
    GRID_PHYS,
    GRID_PHYS,
    GRID_PHYS
);
const cubeEdges = new THREE.EdgesGeometry(cubeGeometry);
const cubeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
const containerCube = new THREE.LineSegments(cubeEdges, cubeMaterial);
containerGroup.add(containerCube);
containerCube.visible = false;

    const api = {
        containerConfig,
        DESKTOP_CONTAINER_POS,
        HEAD_OFFSET,
        INITIAL_CONTAINER_SCALE,
        containerGroup,
        disableFrustumCulling,
        containerCube,
        GRID_EXTENT_MULTIPLIER
    };
    Object.assign(deps, api);
    return api;
}
