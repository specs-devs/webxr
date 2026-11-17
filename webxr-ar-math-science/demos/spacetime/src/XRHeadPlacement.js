import * as THREE from 'three';

/**
 * Reusable head-relative placement for WebXR scenes (three.js).
 *
 * Places content at a fixed offset from the user's head when an immersive
 * session starts — works for both standing and sitting without hard-coding
 * eye height. Offset is in head-local space: +X right, +Y up, −Z forward.
 *
 * Portable: depends only on three.js. Copy into another project, pass your
 * renderer + camera + objects, call `update()` each animation frame.
 */

/** Centered, 0.4 m below eyes, 1.3 m in front (camera −Z). */
export const DEFAULT_HEAD_OFFSET = Object.freeze({
    x: 0,
    y: -0.35,
    z: -1.1,
});

const _headPos = new THREE.Vector3();
const _headQuat = new THREE.Quaternion();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');
const _yawQuat = new THREE.Quaternion();
const _localOffset = new THREE.Vector3();
const _worldOffset = new THREE.Vector3();

function resolveHeadRotation(camera, yawOnly) {
    camera.getWorldQuaternion(_headQuat);
    if (!yawOnly) return _headQuat;
    _euler.setFromQuaternion(_headQuat, 'YXZ');
    _yawQuat.setFromEuler(_euler.set(0, _euler.y, 0));
    return _yawQuat;
}

/**
 * @param {THREE.Camera} camera
 * @param {{ x?: number, y?: number, z?: number }} offset - head-local metres
 * @param {THREE.Vector3} [target]
 * @param {{ yawOnly?: boolean }} [options]
 * @returns {THREE.Vector3}
 */
export function getHeadRelativeWorldPosition(camera, offset, target = new THREE.Vector3(), options = {}) {
    const { yawOnly = true } = options;
    const rot = resolveHeadRotation(camera, yawOnly);
    camera.getWorldPosition(_headPos);
    _localOffset.set(offset.x ?? 0, offset.y ?? 0, offset.z ?? 0);
    _worldOffset.copy(_localOffset).applyQuaternion(rot);
    return target.copy(_headPos).add(_worldOffset);
}

/**
 * @param {THREE.Object3D} object
 * @param {THREE.Camera} camera
 * @param {{ x?: number, y?: number, z?: number }} offset
 * @param {{ yawOnly?: boolean, matchYaw?: boolean }} [options]
 */
export function placeObjectAtHeadOffset(object, camera, offset, options = {}) {
    getHeadRelativeWorldPosition(camera, offset, object.position, options);
    if (options.matchYaw) {
        object.quaternion.copy(resolveHeadRotation(camera, true));
    }
    return object;
}

/**
 * Wait for stable XR tracking after session start, then place objects.
 *
 * @param {object} params
 * @param {THREE.WebGLRenderer} params.renderer
 * @param {THREE.Camera} params.camera
 * @param {Array<{ object: THREE.Object3D, offset: { x?: number, y?: number, z?: number }, options?: object }>} params.placements
 * @param {(camera: THREE.Camera) => void} [params.onPlaced]
 * @param {(camera: THREE.Camera) => void} [params.onSessionEnd]
 * @param {number} [params.frameDelay=4] - animation frames to wait after sessionstart
 * @param {number} [params.minHeadY=1.0] - minimum camera height (m) before placing
 * @param {number} [params.maxWaitFrames=90] - cap for tracking-stability wait
 */
export function bindHeadRelativePlacementOnSessionStart({
    renderer,
    camera,
    placements,
    onPlaced,
    onSessionEnd,
    frameDelay = 4,
    minHeadY = 1.0,
    maxWaitFrames = 90,
}) {
    let framesRemaining = -1;
    let stabilityFrames = 0;

    const runPlacement = () => {
        camera.updateMatrixWorld(true);
        for (const { object, offset, options } of placements) {
            placeObjectAtHeadOffset(object, camera, offset, options);
        }
        onPlaced?.(camera);
    };

    const schedulePlacement = () => {
        framesRemaining = frameDelay;
        stabilityFrames = 0;
    };

    renderer.xr.addEventListener('sessionstart', schedulePlacement);

    renderer.xr.addEventListener('sessionend', () => {
        framesRemaining = -1;
        stabilityFrames = 0;
        onSessionEnd?.(camera);
    });

    return {
        /** Call once per animation frame (top of your render loop). */
        update() {
            if (framesRemaining < 0) return;

            if (framesRemaining > 0) {
                framesRemaining--;
                return;
            }

            stabilityFrames++;
            camera.updateMatrixWorld(true);
            camera.getWorldPosition(_headPos);

            if (_headPos.y < minHeadY && stabilityFrames < maxWaitFrames) {
                return;
            }

            framesRemaining = -1;
            stabilityFrames = 0;
            runPlacement();
        },
        schedulePlacement,
    };
}
