import * as THREE from 'three';
import gsap from 'gsap';
import { FontLoader } from 'three/addons/loaders/FontLoader.js';
import helvetikerRegular from '../public/static/fonts/helvetiker_regular.typeface.json';
import {
    bindHeadRelativePlacementOnSessionStart,
    placeObjectAtHeadOffset,
    getHeadRelativeWorldPosition,
} from './XRHeadPlacement.js';

/**
 * Shared XR start modal — drop into other demos in the suite.
 *
 * Shows a short hint in front of the head after an immersive session starts.
 * Poke (or click) OK to dismiss and start the experience.
 *
 * Portable: three.js + gsap + XRHeadPlacement. Pass renderer/camera/hands,
 * call `updateStartModal()` each frame, skip other interactions while
 * `startModalActive` is true.
 */

/** Design pixels of static/ui-panel-hint.png */
const HINT_PANEL_PX = Object.freeze({ w: 544, h: 370 });
/** Design pixels of static/ui-button-hint-ok.png */
const HINT_OK_PX = Object.freeze({ w: 165, h: 56 });
const helvetikerFont = new FontLoader().parse(helvetikerRegular);

export const START_MODAL_DEFAULTS = Object.freeze({
    /** Set false to skip the start hint and go straight into the demo. */
    enabled: true,
    /** Swap to "Pinch both hands to move." in demos without resize. */
    message: 'Pinch both hands to move and resize.',
    /** Local Y on the panel (0 = center). Tweak this. */
    messageY: 0.079,
    messageSize: 0.01122,
    /** Seconds after XR session start before OK can be pressed. */
    startupDelay: 1.0,
    /** Head-local metres: +X right, +Y up, −Z forward. In front of the volume. */
    headOffset: Object.freeze({ x: 0, y: -0.12, z: -0.8 }),
    /** Recapture if the panel is more than this many degrees off gaze (horizontal). */
    recaptureGazeDeg: 32,
    /** Recapture if the panel is more than this far from the ideal head slot (metres). */
    recaptureSlotMeters: 0.35,
    /** Seconds to ease back in front of the head. */
    recaptureDuration: 0.4,
    pressDistance: 0.03,
    panelWidth: 0.32,
    panelHeight: 0.32 * (HINT_PANEL_PX.h / HINT_PANEL_PX.w),
});

function makeHintTextMesh(text, size) {
    const shapes = helvetikerFont.generateShapes(text, size);
    const geometry = new THREE.ShapeGeometry(shapes);
    geometry.computeBoundingBox();
    const bb = geometry.boundingBox;
    const visualMinY = Math.max(0, bb.min.y);
    const visualCenterY = (bb.max.y + visualMinY) * 0.5;
    geometry.translate(-(bb.max.x + bb.min.x) * 0.5, -visualCenterY, 0);

    const mesh = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
            color: 0xffffff,
            opacity: 1,
            transparent: true,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
            side: THREE.DoubleSide,
        })
    );
    mesh.name = 'StartModalMessage';
    mesh.frustumCulled = false;
    mesh.renderOrder = 10050;
    return mesh;
}

function animateButtonPress(buttonMesh) {
    gsap.killTweensOf(buttonMesh.position);
    gsap.killTweensOf(buttonMesh.scale);

    const originalZ = buttonMesh.position.z;
    const pressDepth = -0.02;
    const scaleUp = 1.2;
    const pressDuration = 0.15;
    const returnDuration = 0.15;
    const delayBeforeReturn = 0.075;

    const tl = gsap.timeline();
    tl.to(buttonMesh.position, {
        z: originalZ + pressDepth,
        duration: pressDuration,
        ease: 'power2.out',
    }, 0);
    tl.to(buttonMesh.scale, {
        x: scaleUp,
        y: scaleUp,
        duration: pressDuration,
        ease: 'power2.out',
    }, 0);
    tl.to(buttonMesh.position, {
        z: originalZ,
        duration: returnDuration,
        ease: 'power2.out',
    }, pressDuration + delayBeforeReturn);
    tl.to(buttonMesh.scale, {
        x: 1,
        y: 1,
        duration: returnDuration,
        ease: 'power2.out',
    }, pressDuration + delayBeforeReturn);
}

export function createStartModal(deps, options = {}) {
    const { onDismiss, ...modalOptions } = options;
    const {
        scene, camera, renderer,
        lIndexObj, rIndexObj,
        pinchTracker,
        TWO_HAND_SETTLE_MS = 20,
    } = deps;

    const cfg = {
        ...START_MODAL_DEFAULTS,
        ...modalOptions,
        headOffset: { ...START_MODAL_DEFAULTS.headOffset, ...(modalOptions.headOffset || {}) },
    };

    const state = {
        active: false,
        ready: false,
        dismissing: false,
        recapturing: false,
        pendingPlace: false,
        cooldown: 0,
    };

    deps.startModalActive = false;
    deps.experienceStarted = !cfg.enabled;

    const root = new THREE.Object3D();
    root.name = 'StartModalRoot';
    root.visible = false;
    root.scale.set(0, 0, 0);
    scene.add(root);

    const panelGeo = new THREE.PlaneGeometry(cfg.panelWidth, cfg.panelHeight);
    const hintPanelTexture = new THREE.TextureLoader().load('static/ui-panel-hint.png');
    hintPanelTexture.colorSpace = THREE.SRGBColorSpace;
    const panelMat = new THREE.MeshBasicMaterial({
        map: hintPanelTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.name = 'StartModalPanel';
    panel.frustumCulled = false;
    panel.renderOrder = 9998;
    root.add(panel);

    const messageMesh = makeHintTextMesh(cfg.message, cfg.messageSize);
    messageMesh.position.set(0, cfg.messageY, 0.001);
    panel.add(messageMesh);

    const okWidth = cfg.panelWidth * (HINT_OK_PX.w / HINT_PANEL_PX.w) * 0.98;
    const okHeight = okWidth * (HINT_OK_PX.h / HINT_OK_PX.w);
    const okGeo = new THREE.PlaneGeometry(okWidth, okHeight);
    const okTexture = new THREE.TextureLoader().load('static/ui-button-hint-ok.png');
    okTexture.colorSpace = THREE.SRGBColorSpace;
    const okMat = new THREE.MeshBasicMaterial({
        map: okTexture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
    });
    const okButton = new THREE.Mesh(okGeo, okMat);
    okButton.name = 'StartModalOK';
    okButton.frustumCulled = false;
    okButton.renderOrder = 9999;
    okButton.position.set(0, -0.068, 0.012);
    panel.add(okButton);

    const _okWorldPos = new THREE.Vector3();
    const _pointer = new THREE.Vector2();
    const _raycaster = new THREE.Raycaster();
    const _idealPos = new THREE.Vector3();
    const _idealQuat = new THREE.Quaternion();
    const _headPos = new THREE.Vector3();
    const _headQuat = new THREE.Quaternion();
    const _headEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const _forward = new THREE.Vector3();
    const _toPanel = new THREE.Vector3();

    function getHeadYawQuat(target) {
        camera.getWorldQuaternion(_headQuat);
        _headEuler.setFromQuaternion(_headQuat, 'YXZ');
        return target.setFromEuler(_headEuler.set(0, _headEuler.y, 0));
    }

    function isPokeFrozen() {
        if (!lIndexObj || !rIndexObj) return false;
        okButton.getWorldPosition(_okWorldPos);
        const pad = cfg.pressDistance + 0.02;
        return lIndexObj.position.distanceTo(_okWorldPos) < pad
            || rIndexObj.position.distanceTo(_okWorldPos) < pad;
    }

    function needsRecapture() {
        camera.getWorldPosition(_headPos);
        camera.getWorldDirection(_forward);
        _forward.y = 0;
        if (_forward.lengthSq() < 1e-6) return true;
        _forward.normalize();

        _toPanel.copy(root.position).sub(_headPos);
        _toPanel.y = 0;
        if (_toPanel.lengthSq() < 1e-6) return true;
        _toPanel.normalize();

        const gazeLimit = Math.cos(THREE.MathUtils.degToRad(cfg.recaptureGazeDeg));
        if (_forward.dot(_toPanel) < gazeLimit) return true;

        getHeadRelativeWorldPosition(camera, cfg.headOffset, _idealPos, { yawOnly: true });
        return root.position.distanceTo(_idealPos) > cfg.recaptureSlotMeters;
    }

    function updateRecapture(dt) {
        if (!state.active || state.dismissing || state.pendingPlace || !cfg.enabled) return;
        if (isPokeFrozen()) {
            state.recapturing = false;
            return;
        }

        camera.updateMatrixWorld(true);
        getHeadRelativeWorldPosition(camera, cfg.headOffset, _idealPos, { yawOnly: true });
        getHeadYawQuat(_idealQuat);

        if (!state.recapturing) {
            if (needsRecapture()) state.recapturing = true;
            else return;
        }

        const tau = Math.max(0.04, cfg.recaptureDuration / 3);
        const alpha = 1 - Math.exp(-(dt || 0.016) / tau);
        root.position.lerp(_idealPos, alpha);
        root.quaternion.slerp(_idealQuat, alpha);

        const closePos = root.position.distanceTo(_idealPos) < 0.012;
        const closeRot = root.quaternion.angleTo(_idealQuat) < 0.03;
        if (closePos && closeRot && !needsRecapture()) {
            root.position.copy(_idealPos);
            root.quaternion.copy(_idealQuat);
            state.recapturing = false;
        }
    }

    function placeInFrontOfHead() {
        camera.updateMatrixWorld(true);
        placeObjectAtHeadOffset(root, camera, cfg.headOffset, {
            yawOnly: true,
            matchYaw: true,
        });
    }

    function showModal(pokeDelaySec) {
        if (!cfg.enabled) return;
        gsap.killTweensOf(root.scale);
        gsap.killTweensOf(okButton.position);
        gsap.killTweensOf(okButton.scale);
        okButton.scale.set(1, 1, 1);

        state.active = true;
        state.ready = false;
        state.dismissing = false;
        state.recapturing = false;
        state.pendingPlace = false;
        state.cooldown = 0;
        deps.startModalActive = true;
        deps.experienceStarted = false;

        root.visible = true;
        root.scale.set(0, 0, 0);
        gsap.to(root.scale, {
            x: 1,
            y: 1,
            z: 1,
            duration: 0.35,
            ease: 'power2.out',
        });

        window.setTimeout(() => {
            if (state.active && !state.dismissing) {
                state.ready = true;
            }
        }, Math.max(0, pokeDelaySec) * 1000);
    }

    function hideRoot() {
        gsap.killTweensOf(root.scale);
        gsap.killTweensOf(okButton.position);
        gsap.killTweensOf(okButton.scale);
        root.visible = false;
        root.scale.set(0, 0, 0);
        state.active = false;
        state.ready = false;
        state.dismissing = false;
        state.recapturing = false;
        state.pendingPlace = false;
        deps.startModalActive = false;
    }

    /** Keep interactions locked, but do not show the panel until head pose is ready. */
    function collapseForXrPlacement() {
        gsap.killTweensOf(root.scale);
        gsap.killTweensOf(okButton.position);
        gsap.killTweensOf(okButton.scale);
        okButton.scale.set(1, 1, 1);
        root.visible = false;
        root.scale.set(0, 0, 0);
        state.active = true;
        state.ready = false;
        state.dismissing = false;
        state.recapturing = false;
        state.pendingPlace = true;
        state.cooldown = 0;
        deps.startModalActive = true;
        deps.experienceStarted = false;
    }

    function dismiss({ pressButton = true, unlockNow = false } = {}) {
        if (!state.active || state.dismissing) return;
        state.recapturing = false;
        state.dismissing = true;
        state.ready = false;
        if (unlockNow) {
            deps.startModalActive = false;
            deps.experienceStarted = true;
            onDismiss?.();
        }
        if (pressButton) animateButtonPress(okButton);

        gsap.to(root.scale, {
            x: 0,
            y: 0,
            z: 0,
            duration: 0.25,
            delay: pressButton ? 0.15 : 0,
            ease: 'power2.in',
            onComplete: () => {
                root.visible = false;
                state.active = false;
                state.dismissing = false;
                deps.startModalActive = false;
                deps.experienceStarted = true;
                if (!unlockNow) onDismiss?.();
            },
        });
    }

    function tryPress() {
        if (!state.active || !state.ready || state.dismissing) return;
        if (state.cooldown > 0) return;
        state.cooldown = 0.5;
        dismiss({ pressButton: true, unlockNow: false });
    }

    const xrPlacement = bindHeadRelativePlacementOnSessionStart({
        renderer,
        camera,
        placements: [{
            object: root,
            offset: cfg.headOffset,
            options: { yawOnly: true, matchYaw: true },
        }],
        onPlaced: () => {
            if (cfg.enabled) {
                state.pendingPlace = false;
                showModal(cfg.startupDelay);
            }
        },
        onSessionEnd: () => {
            hideRoot();
            deps.experienceStarted = true;
        },
    });

    renderer.xr.addEventListener('sessionstart', () => {
        if (cfg.enabled) collapseForXrPlacement();
    });

    // Desktop preview only — XR launches wait for head placement, then scale 0→1.
    if (cfg.enabled && !deps.session) {
        placeInFrontOfHead();
        showModal(0.35);
    } else if (cfg.enabled) {
        deps.startModalActive = true;
        deps.experienceStarted = false;
    }

    renderer.domElement.addEventListener('pointerdown', (event) => {
        if (!state.active || !state.ready || state.dismissing) return;
        const rect = renderer.domElement.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        _pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        _pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        _raycaster.setFromCamera(_pointer, camera);
        const hits = _raycaster.intersectObject(okButton, false);
        if (hits.length > 0) tryPress();
    });

    function updateStartModal() {
        xrPlacement.update();
        updateRecapture(deps.delta || 0);

        if (state.cooldown > 0) {
            state.cooldown -= deps.delta || 0;
        }

        if (!state.active || !state.ready || state.dismissing) return;

        if (pinchTracker && pinchTracker.bothPinchStable(performance.now(), TWO_HAND_SETTLE_MS)) {
            dismiss({ pressButton: false, unlockNow: true });
            return;
        }

        if (!lIndexObj || !rIndexObj) return;

        okButton.getWorldPosition(_okWorldPos);

        if (lIndexObj.position.distanceTo(_okWorldPos) < cfg.pressDistance) {
            tryPress();
            return;
        }
        if (rIndexObj.position.distanceTo(_okWorldPos) < cfg.pressDistance) {
            tryPress();
        }
    }

    const api = {
        startModalRoot: root,
        startModalOkButton: okButton,
        startModalMessage: messageMesh,
        updateStartModal,
        dismissStartModal: dismiss,
        START_MODAL_DEFAULTS: cfg,
    };
    Object.assign(deps, api);
    return api;
}
