import * as THREE from 'three';
import { XRButton } from 'three/addons/webxr/XRButton.js';

export function createSceneSetup({ session = null, showXRButton = false } = {}) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);
    camera.position.set(0, 1.6, 3);
    scene.add(camera);

    // AA off + capped DPR for XR headsets.
    // Desktop keeps a mild DPR cap for sharper previews without 2×/3× fill-rate.
    const DESKTOP_MAX_PIXEL_RATIO = 1.5;
    const XR_MAX_PIXEL_RATIO = 1;

    const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });

    function applyRendererPixelRatio() {
        const cap = renderer.xr.isPresenting ? XR_MAX_PIXEL_RATIO : DESKTOP_MAX_PIXEL_RATIO;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
    }

    applyRendererPixelRatio();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');
    renderer.domElement.classList.add('webgl');
    document.body.appendChild(renderer.domElement);

    if (showXRButton) {
        document.body.appendChild(XRButton.createButton(renderer, { optionalFeatures: ['hand-tracking'] }));
    }

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        applyRendererPixelRatio();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    renderer.xr.addEventListener('sessionstart', applyRendererPixelRatio);
    renderer.xr.addEventListener('sessionend', applyRendererPixelRatio);

    const ambientLight = new THREE.AmbientLight(0xffffff, 2.4);
    scene.add(ambientLight);

    const light = new THREE.DirectionalLight(0xffffff, 1.0);
    light.position.set(0, 10, 0);
    scene.add(light);

    return { scene, camera, renderer, applyRendererPixelRatio };
}
