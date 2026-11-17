import * as THREE from 'three';
import { XRButton } from 'three/addons/webxr/XRButton.js';

export function createSceneSetup({ session = null, showXRButton = false } = {}) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);
    camera.position.set(0, 1.6, 3);
    scene.add(camera);

    // Keep MSAA off for SPECS memory and fill-rate headroom.
    const renderer = new THREE.WebGLRenderer({ antialias: false });
    // Cap DPR at 2 — desktop/mobile browsers can report 3+, which quadruples+
    // fragment-shader cost for no visible benefit past ~2x. XR sessions render
    // through their own XRWebGLLayer framebuffer and aren't affected by this.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
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
