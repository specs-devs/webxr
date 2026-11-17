import * as THREE from 'three';
import { XRButton } from 'three/addons/webxr/XRButton.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export function ensureBoundsTree(geometry) {
    if (!geometry.boundsTree) geometry.computeBoundsTree();
    return geometry;
}

export function createSceneSetup({ session = null, showXRButton = false } = {}) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);
    camera.position.set(0, 1.6, 3);
    scene.add(camera);

    const renderPixelRatio = Math.min(window.devicePixelRatio, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    renderer.setPixelRatio(renderPixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setFoveation(1.0);
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.domElement.classList.add('webgl');
    document.body.appendChild(renderer.domElement);

    if (showXRButton) {
        document.body.appendChild(XRButton.createButton(renderer, { optionalFeatures: ['hand-tracking'] }));
    }

    const ambientLight = new THREE.AmbientLight(0xffffff, 2.4);
    scene.add(ambientLight);

    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(0, 10, 0);
    scene.add(light);

    return { scene, camera, renderer };
}
