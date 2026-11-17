import * as THREE from 'three';
import { XRButton } from 'three/addons/webxr/XRButton.js';
import gsap from 'gsap';

export function createSceneSetup({ session = null, showXRButton = false } = {}) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);

    const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 50);
    camera.position.set(0, 1.6, 3);
    scene.add(camera);

    const XR_PIXEL_RATIO_CAP = 1.25;
    const DESKTOP_PIXEL_RATIO_CAP = 2;

    const renderer = new THREE.WebGLRenderer({
        antialias: false,
        powerPreference: 'high-performance',
    });

    function syncRendererPixelRatio() {
        const cap = renderer.xr.isPresenting ? XR_PIXEL_RATIO_CAP : DESKTOP_PIXEL_RATIO_CAP;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap));
    }

    syncRendererPixelRatio();
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.xr.enabled = true;
    renderer.xr.setFoveation(1);
    renderer.xr.setReferenceSpaceType('local-floor');
    gsap.ticker.lagSmoothing(0);
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

    return { scene, camera, renderer, syncRendererPixelRatio, XR_PIXEL_RATIO_CAP, DESKTOP_PIXEL_RATIO_CAP };
}
