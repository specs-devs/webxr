import * as THREE from 'three';
import { DEFAULT_HEAD_OFFSET } from './XRHeadPlacement.js';

export function createContainer(deps) {
    const { scene } = deps;

    const containerSize = 0.7;

    /**
     * Wireframe Container Cube
     */
    const containerGroup = new THREE.Group();
    /** Desktop / pre-XR preview — fixed world position (floor-relative). */
    const DESKTOP_CONTAINER_POS = new THREE.Vector3(0, 1.3, -1.3);
    /** Head-local offset applied when an immersive session starts. */
    const HEAD_OFFSET = { ...DEFAULT_HEAD_OFFSET };
    const INITIAL_CONTAINER_SCALE = 0.6;
    containerGroup.position.copy(DESKTOP_CONTAINER_POS);
    scene.add(containerGroup);
    containerGroup.scale.setScalar(INITIAL_CONTAINER_SCALE);

    const cubeGeometry = new THREE.BoxGeometry(containerSize, containerSize, containerSize);
    const cubeEdges = new THREE.EdgesGeometry(cubeGeometry);
    const cubeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
    const containerCube = new THREE.LineSegments(cubeEdges, cubeMaterial);
    containerCube.visible = false;
    containerGroup.add(containerCube);

    const containerGroundGeom = new THREE.PlaneGeometry(containerSize, containerSize);
    const containerGroundEdges = new THREE.EdgesGeometry(containerGroundGeom);
    const containerGroundMaterial = new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.7
    });
    const containerGroundPlane = new THREE.LineSegments(containerGroundEdges, containerGroundMaterial);
    containerGroundPlane.rotation.x = -Math.PI / 2;
    containerGroundPlane.position.y = -containerSize * 0.5 + 0.0005;
    containerGroundPlane.frustumCulled = false;
    containerGroup.add(containerGroundPlane);

    /** Extra height above container top (local +Y); larger = header sits higher */
    const UI_HEADER_Y_MARGIN = 0.26;
    const UIHeaderRef = new THREE.Object3D();
    UIHeaderRef.name = 'UIHeaderRef';
    UIHeaderRef.frustumCulled = false;
    containerGroup.add(UIHeaderRef);

    function updateUIHeaderRefPosition() {
        const scale = containerGroup.scale.x || 1;
        const half = containerSize * 0.5;
        const localY = half + UI_HEADER_Y_MARGIN / scale;
        UIHeaderRef.position.set(0, localY, 0);
    }

    const UIHeaderRoot = new THREE.Object3D();
    UIHeaderRoot.name = 'UIHeaderRoot';
    UIHeaderRoot.frustumCulled = false;
    scene.add(UIHeaderRoot);

    updateUIHeaderRefPosition();

    const api = {
        containerSize,
        containerGroup,
        containerCube,
        containerGroundPlane,
        DESKTOP_CONTAINER_POS,
        HEAD_OFFSET,
        INITIAL_CONTAINER_SCALE,
        UI_HEADER_Y_MARGIN,
        UIHeaderRef,
        UIHeaderRoot,
        updateUIHeaderRefPosition
    };
    Object.assign(deps, api);
    return api;
}
