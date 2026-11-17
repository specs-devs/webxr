import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';

export function createSnellsLawTracer(deps) {
    const {
        scene, camera, renderer,
        containerGroup, sceneOpticalMeshes, pointerObj, pointerDims, pointerGrab, pointerGrabRadius,
        DISPERSION_BANDS, DISPERSION_LINEWIDTH, THREE_RAY_SPACING, visualizeNormals, cauchyIOR,
        syncLaserLineVisibility, dismissGrabHint, closePointerMenu, pointerMenuState,
        applyPointerShape,
        hand1, hand2, lThumbObj, lIndexObj, rThumbObj, rIndexObj, objectGrab, slotMeshes,
        OBJ_LABEL_Y_OFFSET, OBJ_LABEL_PRISM_EXTRA_Y_OFFSET, OBJ_LABEL_WORLD_SCENE_SCALE, OBJ_LABEL_HOVER_DIST,
        laserSegments, dispersionSegments, pointerLaserMat, dispersionMat,
        appendPolylineSegments, MAX_RAY_SEGMENTS, hideUnusedLabels, drawAngleLabel,
        normalsVizLines, theta1ArcLines, theta2ArcLines,
        normalsVizGeom, theta1ArcGeom, theta2ArcGeom,
        uploadSegmentsInPlace, updateNormalsVizLineDistances, DISPERSION_BAND_RGB,
        POINTER_LASER_MAX_LENGTH, POINTER_LASER_ORIGIN_OFFSET,
        _camWorldPos, _containerWorldQuat, _pointerTipLocal, _pointerTipGapDir,
        NORMAL_VIZ_HALF_LEN, ANGLE_ARC_RADIUS, ANGLE_ARC_SEGMENTS,
        ANGLE_LABEL_OFFSET, ANGLE_LABEL_MIRROR_TANGENT_SPLIT,
        _theta1ArcFlat, _theta2ArcFlat, _angleLabelEntries,
    } = deps;
// OBJECT NAME LABELS (labels are created per-instance by createNameLabelFor)
// ==========================================

const _objLabelWorldPos = new THREE.Vector3();
const _objLabelCamDir   = new THREE.Vector3();

function updateObjectNameLabels() {
    camera.getWorldPosition(_camWorldPos);

    // Hover for menu slot labels only activates when no object is currently grabbed
    const anyObjectGrabbed = objectGrab.left.active || objectGrab.right.active;

    // Closest object within hover range resolves which menu slot preview (if any) shows its hover label.
    // Scene-instance labels stay always visible, but scene objects compete for "closest" with slots.
    let closestHoverMesh = null;
    if (!anyObjectGrabbed) {
        let closestHoverDistSq = OBJ_LABEL_HOVER_DIST * OBJ_LABEL_HOVER_DIST;

        for (let i = 0; i < sceneOpticalMeshes.length; i++) {
            const obj = sceneOpticalMeshes[i];
            obj.getWorldPosition(_objLabelWorldPos);
            const dL = lIndexObj.position.distanceToSquared(_objLabelWorldPos);
            const dR = rIndexObj.position.distanceToSquared(_objLabelWorldPos);
            const nearest = Math.min(dL, dR);
            if (nearest < closestHoverDistSq) {
                closestHoverDistSq = nearest;
                closestHoverMesh = obj;
            }
        }

        // Also check panel slot previews when the panel is open
        if (deps.UIPanelOn && deps.UIPlane.visible) {
            for (let i = 0; i < slotMeshes.length; i++) {
                const obj = slotMeshes[i];
                if (!obj) continue;
                obj.getWorldPosition(_objLabelWorldPos);
                const dL = lIndexObj.position.distanceToSquared(_objLabelWorldPos);
                const dR = rIndexObj.position.distanceToSquared(_objLabelWorldPos);
                const nearest = Math.min(dL, dR);
                if (nearest < closestHoverDistSq) {
                    closestHoverDistSq = nearest;
                    closestHoverMesh = obj;
                }
            }
        }
    }

    // Update labels for scene objects
    for (let i = 0; i < sceneOpticalMeshes.length; i++) {
        const obj   = sceneOpticalMeshes[i];
        const label = obj.userData.nameLabel;
        if (!label) continue;

        label.visible = true;
        label.scale.setScalar(OBJ_LABEL_WORLD_SCENE_SCALE);

        obj.getWorldPosition(_objLabelWorldPos);
        const yOffset = OBJ_LABEL_Y_OFFSET + (obj.userData.typeKey === 'prism' ? OBJ_LABEL_PRISM_EXTRA_Y_OFFSET : 0);
        label.position.set(
            _objLabelWorldPos.x,
            _objLabelWorldPos.y + yOffset,
            _objLabelWorldPos.z
        );
        _objLabelCamDir.subVectors(_camWorldPos, label.position);
        _objLabelCamDir.y = 0;
        if (_objLabelCamDir.lengthSq() > 1e-8) {
            label.rotation.set(0, Math.atan2(_objLabelCamDir.x, _objLabelCamDir.z), 0);
        }
    }

    // Update labels for panel slot previews
    for (let i = 0; i < slotMeshes.length; i++) {
        const obj = slotMeshes[i];
        if (!obj) continue;
        const label = obj.userData.nameLabel;
        if (!label) continue;

        const isHovered = (obj === closestHoverMesh);
        label.visible = isHovered && deps.UIPanelOn && deps.UIPlane.visible;
        label.scale.setScalar(1);

        if (label.visible) {
            obj.getWorldPosition(_objLabelWorldPos);
            const yOffset = OBJ_LABEL_Y_OFFSET + (obj.userData.typeKey === 'prism' ? OBJ_LABEL_PRISM_EXTRA_Y_OFFSET : 0);
            label.position.set(
                _objLabelWorldPos.x,
                _objLabelWorldPos.y + yOffset,
                _objLabelWorldPos.z
            );
            // Y-axis-only billboard: face camera horizontally, stay upright
            _objLabelCamDir.subVectors(_camWorldPos, label.position);
            _objLabelCamDir.y = 0;
            if (_objLabelCamDir.lengthSq() > 1e-8) {
                label.rotation.set(0, Math.atan2(_objLabelCamDir.x, _objLabelCamDir.z), 0);
            }
        }
    }
}

applyPointerShape();

const _pinchMid = new THREE.Vector3();
const _pointerObjWorldCenter = new THREE.Vector3();
const _pointerWorldPos = new THREE.Vector3();
const _wristQuat = new THREE.Quaternion();
const _decompPos = new THREE.Vector3();
const _decompScale = new THREE.Vector3();

/** 2nd segment from fingertip — index: middle phalanx; thumb: proximal phalanx (no intermediate). */
const INDEX_JOINT_SECOND_FROM_TIP = 'index-finger-phalanx-intermediate';
const THUMB_JOINT_SECOND_FROM_TIP = 'thumb-phalanx-proximal';

const _grabThumbJ2 = new THREE.Vector3();
const _grabIndexJ2 = new THREE.Vector3();
const _grabBone2Mid = new THREE.Vector3();
const _grabPointerDir = new THREE.Vector3();
const _pointerWorldUp = new THREE.Vector3(0, 1, 0);
const _pointerAxisX = new THREE.Vector3();
const _pointerAxisY = new THREE.Vector3();
const _pointerBasisMat = new THREE.Matrix4();
const _ptrLaserStart = new THREE.Vector3();
const _ptrLaserEnd = new THREE.Vector3();
const _ptrLaserDir = new THREE.Vector3();
const _boxCenterWorld = new THREE.Vector3();

/** Aim local +Z along `forward` (unit) with minimal roll: local Y toward world +Y projected onto plane ⊥ forward. */
function setPointerQuaternionAimNoRoll(forward) {
    const zAxis = forward;
    _pointerAxisY.copy(_pointerWorldUp).addScaledVector(zAxis, -_pointerWorldUp.dot(zAxis));
    if (_pointerAxisY.lengthSq() < 1e-10) {
        _pointerAxisY.set(1, 0, 0).addScaledVector(zAxis, -zAxis.x);
        if (_pointerAxisY.lengthSq() < 1e-10) {
            _pointerAxisY.set(0, 0, 1).addScaledVector(zAxis, -zAxis.z);
        }
    }
    _pointerAxisY.normalize();
    _pointerAxisX.crossVectors(_pointerAxisY, zAxis).normalize();
    _pointerAxisY.crossVectors(zAxis, _pointerAxisX);
    _pointerBasisMat.makeBasis(_pointerAxisX, _pointerAxisY, zAxis);
    pointerObj.quaternion.setFromRotationMatrix(_pointerBasisMat);
}

function getPinchMidWorld(isLeft, target) {
    if (isLeft) {
        target.addVectors(lThumbObj.position, lIndexObj.position).multiplyScalar(0.5);
    } else {
        target.addVectors(rThumbObj.position, rIndexObj.position).multiplyScalar(0.5);
    }
    return target;
}

/** Index tip in world space (same frame as joint debug spheres). */
function getIndexTipWorld(isLeft, target) {
    if (isLeft) {
        target.copy(lIndexObj.position);
    } else {
        target.copy(rIndexObj.position);
    }
    return target;
}

function getWristWorldQuaternion(hand, target) {
    const wrist = hand && hand.joints && hand.joints['wrist'];
    if (!wrist) {
        target.identity();
        return false;
    }
    wrist.matrixWorld.decompose(_decompPos, target, _decompScale);
    return true;
}

function tryStartPointerGrab(handSide) {
    const isLeft = handSide === 'left';
    const hand = isLeft ? hand1 : hand2;
    if (!hand) return;

    getPinchMidWorld(isLeft, _pinchMid);
    pointerObj.updateMatrixWorld(true);
    _pointerObjWorldCenter.set(0, 0, pointerDims.pivotOffsetZ + pointerDims.barrelLenZ * 0.5);
    pointerObj.localToWorld(_pointerObjWorldCenter);
    if (_pinchMid.distanceToSquared(_pointerObjWorldCenter) > pointerGrabRadius * pointerGrabRadius) {
        return;
    }

    pointerGrab.active = true;
    pointerGrab.hand = handSide;
    dismissGrabHint();
    if (pointerMenuState.isOpen) {
        closePointerMenu();
    }
}

/** While pinching: grip at index tip; local +Z from bone2-mid → pinch-mid (else wrist). */
function applyPointerGrab() {
    const isLeft = pointerGrab.hand === 'left';
    const hand = isLeft ? hand1 : hand2;
    if (!hand) {
        pointerGrab.active = false;
        return;
    }

    getIndexTipWorld(isLeft, _pointerWorldPos);
    pointerObj.position.copy(_pointerWorldPos);

    getPinchMidWorld(isLeft, _pinchMid);
    const thumbJ = hand.joints && hand.joints[THUMB_JOINT_SECOND_FROM_TIP];
    const indexJ = hand.joints && hand.joints[INDEX_JOINT_SECOND_FROM_TIP];
    if (thumbJ && indexJ) {
        _grabThumbJ2.set(thumbJ.position.x, thumbJ.position.y, thumbJ.position.z);
        _grabIndexJ2.set(indexJ.position.x, indexJ.position.y, indexJ.position.z);
        _grabBone2Mid.addVectors(_grabThumbJ2, _grabIndexJ2).multiplyScalar(0.5);
        _grabPointerDir.subVectors(_pinchMid, _grabBone2Mid);
        const lenSq = _grabPointerDir.lengthSq();
        if (lenSq > 1e-10) {
            _grabPointerDir.multiplyScalar(1 / Math.sqrt(lenSq));
            setPointerQuaternionAimNoRoll(_grabPointerDir);
        } else if (getWristWorldQuaternion(hand, _wristQuat)) {
            _grabPointerDir.set(0, 0, 1).applyQuaternion(_wristQuat);
            setPointerQuaternionAimNoRoll(_grabPointerDir);
        }
    } else if (getWristWorldQuaternion(hand, _wristQuat)) {
        _grabPointerDir.set(0, 0, 1).applyQuaternion(_wristQuat);
        setPointerQuaternionAimNoRoll(_grabPointerDir);
    }
}

/**
 * Initial placement only (page load + immersive session start): fixed authored local pose relative to the container.
 * After grab release the pointer is not moved — it stays where the user left it until the next session start.
 */
function applyPointerRestPose() {
    containerGroup.updateMatrixWorld(true);
    containerGroup.getWorldQuaternion(_containerWorldQuat);

    // Pointer startup transform authored in container-local space.
    const pointerLocalPos = new THREE.Vector3(0.253, -0.028, 0.045);
    const pointerLocalEuler = new THREE.Euler(
        THREE.MathUtils.degToRad(180.0),
        THREE.MathUtils.degToRad(-87.376),
        THREE.MathUtils.degToRad(180.0),
        'XYZ'
    );
    const pointerLocalQuat = new THREE.Quaternion().setFromEuler(pointerLocalEuler);
    const pointerWorldQuat = new THREE.Quaternion().copy(_containerWorldQuat).multiply(pointerLocalQuat);

    pointerObj.position.copy(pointerLocalPos);
    containerGroup.localToWorld(pointerObj.position);
    pointerObj.quaternion.copy(pointerWorldQuat);
}

applyPointerRestPose();

// ==========================================
// SNELL'S LAW RAY TRACING
// ==========================================

const RAY_MAX_BOUNCES = 24;
const RAY_EPSILON = 0.0002;
const IOR_AIR = 1.0;

const _raycaster = new THREE.Raycaster();
// With BVH-backed geometries this returns only the nearest hit per mesh instead of
// collecting + sorting every intersection along the ray — the tracer only ever uses hits[0].
_raycaster.firstHitOnly = true;
const _traceOrigin = new THREE.Vector3();
const _traceDir = new THREE.Vector3();
const _surfaceNormal = new THREE.Vector3();
const _geomNormal = new THREE.Vector3();
const _normalMat3 = new THREE.Matrix3();
const _refractedDir = new THREE.Vector3();
const _tracedPositions = [];
/** Flat pairs of endpoints for `LineSegments` when visualizing normals (caller clears). */
const _normalVizFlat = [];

/**
 * Snell's Law in vector form.
 * Returns false when sin²θt > 1 (total internal reflection).
 */
function snellRefract(incident, normal, n1, n2, out) {
    const eta = n1 / n2;
    const cosI = -incident.dot(normal);
    const sin2T = eta * eta * (1.0 - cosI * cosI);
    if (sin2T > 1.0) return false;
    out.copy(incident).multiplyScalar(eta)
        .addScaledVector(normal, eta * cosI - Math.sqrt(1.0 - sin2T));
    return true;
}

function specularReflect(incident, normal, out) {
    out.copy(incident).addScaledVector(normal, -2.0 * incident.dot(normal));
}

function appendSurfaceNormalTick(point, geomNormalWorld, outSegments) {
    const L = NORMAL_VIZ_HALF_LEN;
    const nx = geomNormalWorld.x;
    const ny = geomNormalWorld.y;
    const nz = geomNormalWorld.z;
    outSegments.push(
        point.x - L * nx,
        point.y - L * ny,
        point.z - L * nz,
        point.x + L * nx,
        point.y + L * ny,
        point.z + L * nz
    );
}

const _arcTangent = new THREE.Vector3();

/**
 * Append θ₁ and θ₂ arc segments (and optional label entries) at a ray–surface hit.
 *
 * @param {THREE.Vector3} point        Hit point (world)
 * @param {THREE.Vector3} orientedN    Surface normal oriented toward the incident side
 * @param {THREE.Vector3} incidentDir  Incoming ray unit direction (into surface)
 * @param {THREE.Vector3} exitDir      Outgoing ray unit direction (away from hit)
 * @param {boolean}        isMirrorLike true for mirror or TIR (exit stays on incident side)
 * @param {number[]}       outT1       Flat segment array for θ₁ arcs
 * @param {number[]}       outT2       Flat segment array for θ₂ arcs
 * @param {object[]|null}  outLabels   If non-null, push {x,y,z,text,isTheta1} entries
 */
function appendAngleArcs(point, orientedN, incidentDir, exitDir, isMirrorLike, outT1, outT2, outLabels, showTheta1, showTheta2) {
    const cosI = -incidentDir.dot(orientedN);
    if (cosI < 0.005) return;

    _arcTangent.copy(incidentDir).addScaledVector(orientedN, cosI);
    const tLenSq = _arcTangent.lengthSq();
    if (tLenSq < 1e-8) return;
    _arcTangent.multiplyScalar(1 / Math.sqrt(tLenSq));

    const theta1 = Math.acos(Math.min(1, cosI));
    const nx = orientedN.x, ny = orientedN.y, nz = orientedN.z;
    const tx = _arcTangent.x, ty = _arcTangent.y, tz = _arcTangent.z;
    const R = ANGLE_ARC_RADIUS;

    if (showTheta1 && theta1 > 0.02) {
        for (let i = 0; i < ANGLE_ARC_SEGMENTS; i++) {
            const a0 = (i / ANGLE_ARC_SEGMENTS) * theta1;
            const a1 = ((i + 1) / ANGLE_ARC_SEGMENTS) * theta1;
            const c0 = Math.cos(a0), s0 = Math.sin(a0);
            const c1 = Math.cos(a1), s1 = Math.sin(a1);
            outT1.push(
                point.x + R * (c0 * nx - s0 * tx), point.y + R * (c0 * ny - s0 * ty), point.z + R * (c0 * nz - s0 * tz),
                point.x + R * (c1 * nx - s1 * tx), point.y + R * (c1 * ny - s1 * ty), point.z + R * (c1 * nz - s1 * tz)
            );
        }
        if (outLabels) {
            const ma = theta1 * 0.5;
            const Rl = R + ANGLE_LABEL_OFFSET;
            const mirrorSplit = isMirrorLike ? ANGLE_LABEL_MIRROR_TANGENT_SPLIT : 0;
            outLabels.push({
                x: point.x + Rl * (Math.cos(ma) * nx - Math.sin(ma) * tx) - mirrorSplit * tx,
                y: point.y + Rl * (Math.cos(ma) * ny - Math.sin(ma) * ty) - mirrorSplit * ty,
                z: point.z + Rl * (Math.cos(ma) * nz - Math.sin(ma) * tz) - mirrorSplit * tz,
                text: Math.round(theta1 * 180 / Math.PI) + '°',
                isTheta1: true
            });
        }
    }

    const cosT = isMirrorLike ? exitDir.dot(orientedN) : -exitDir.dot(orientedN);
    const theta2 = Math.acos(Math.min(1, Math.abs(cosT)));

    if (showTheta2 && theta2 > 0.02) {
        for (let i = 0; i < ANGLE_ARC_SEGMENTS; i++) {
            const a0 = (i / ANGLE_ARC_SEGMENTS) * theta2;
            const a1 = ((i + 1) / ANGLE_ARC_SEGMENTS) * theta2;
            const c0 = Math.cos(a0), s0 = Math.sin(a0);
            const c1 = Math.cos(a1), s1 = Math.sin(a1);
            if (isMirrorLike) {
                outT2.push(
                    point.x + R * (c0 * nx + s0 * tx), point.y + R * (c0 * ny + s0 * ty), point.z + R * (c0 * nz + s0 * tz),
                    point.x + R * (c1 * nx + s1 * tx), point.y + R * (c1 * ny + s1 * ty), point.z + R * (c1 * nz + s1 * tz)
                );
            } else {
                outT2.push(
                    point.x + R * (-c0 * nx + s0 * tx), point.y + R * (-c0 * ny + s0 * ty), point.z + R * (-c0 * nz + s0 * tz),
                    point.x + R * (-c1 * nx + s1 * tx), point.y + R * (-c1 * ny + s1 * ty), point.z + R * (-c1 * nz + s1 * tz)
                );
            }
        }
        if (outLabels) {
            const ma = theta2 * 0.5;
            const Rl = R + ANGLE_LABEL_OFFSET;
            const mirrorSplit = isMirrorLike ? ANGLE_LABEL_MIRROR_TANGENT_SPLIT : 0;
            let lx, ly, lz;
            if (isMirrorLike) {
                lx = point.x + Rl * (Math.cos(ma) * nx + Math.sin(ma) * tx) + mirrorSplit * tx;
                ly = point.y + Rl * (Math.cos(ma) * ny + Math.sin(ma) * ty) + mirrorSplit * ty;
                lz = point.z + Rl * (Math.cos(ma) * nz + Math.sin(ma) * tz) + mirrorSplit * tz;
            } else {
                lx = point.x + Rl * (-Math.cos(ma) * nx + Math.sin(ma) * tx);
                ly = point.y + Rl * (-Math.cos(ma) * ny + Math.sin(ma) * ty);
                lz = point.z + Rl * (-Math.cos(ma) * nz + Math.sin(ma) * tz);
            }
            outLabels.push({
                x: lx, y: ly, z: lz,
                text: Math.round(theta2 * 180 / Math.PI) + '°',
                isTheta1: false
            });
        }
    }
}

/**
 * March a ray through the optical meshes, accumulating vertices
 * into a flat [x,y,z, x,y,z, …] array suitable for LineGeometry.
 * @param outNormalSegments If set, appends line pairs (p−, p+) along the geometric normal at each hit:
 *   refractive surfaces (entry + exit) and mirror hits.
 */
function traceRefractedRay(origin, direction, iorMapFn, outNormalSegments, outTheta1Arcs, outTheta2Arcs, outAngleLabels) {
    _tracedPositions.length = 0;
    _tracedPositions.push(origin.x, origin.y, origin.z);

    _traceOrigin.copy(origin);
    _traceDir.copy(direction);

    let currentIOR = IOR_AIR;
    for (let bounce = 0; bounce < RAY_MAX_BOUNCES; bounce++) {
        _raycaster.set(_traceOrigin, _traceDir);
        _raycaster.far = POINTER_LASER_MAX_LENGTH;

        const hits = _raycaster.intersectObjects(sceneOpticalMeshes, false);
        if (hits.length === 0) break;

        const hit = hits[0];

        _normalMat3.getNormalMatrix(hit.object.matrixWorld);
        _geomNormal.copy(hit.face.normal).applyMatrix3(_normalMat3).normalize();
        _surfaceNormal.copy(_geomNormal);

        _tracedPositions.push(hit.point.x, hit.point.y, hit.point.z);

        if (outNormalSegments) {
            appendSurfaceNormalTick(hit.point, _geomNormal, outNormalSegments);
        }

        let hitIsMirrorLike = false;
        const hitEntering = _traceDir.dot(_surfaceNormal) < 0;
        const iorBeforeHit = currentIOR;

        if (hit.object.userData.isMirror) {
            hitIsMirrorLike = true;
            if (!hitEntering) _surfaceNormal.negate();
            specularReflect(_traceDir, _surfaceNormal, _refractedDir);
        } else {
            let n2;

            if (hitEntering) {
                const baseIOR = hit.object.userData.ior;
                n2 = iorMapFn ? iorMapFn(baseIOR) : baseIOR;
            } else {
                n2 = IOR_AIR;
                _surfaceNormal.negate();
            }

            if (snellRefract(_traceDir, _surfaceNormal, currentIOR, n2, _refractedDir)) {
                currentIOR = n2;
            } else {
                specularReflect(_traceDir, _surfaceNormal, _refractedDir);
                hitIsMirrorLike = true;
            }
        }

        if (outTheta1Arcs && outTheta2Arcs) {
            const showT1 = iorBeforeHit === IOR_AIR;
            const showT2 = currentIOR === IOR_AIR;
            appendAngleArcs(
                hit.point, _surfaceNormal, _traceDir, _refractedDir,
                hitIsMirrorLike, outTheta1Arcs, outTheta2Arcs, outAngleLabels,
                showT1, showT2
            );
        }

        _traceDir.copy(_refractedDir).normalize();
        _traceOrigin.copy(hit.point).addScaledVector(_traceDir, RAY_EPSILON);
    }

    _tracedPositions.push(
        _traceOrigin.x + _traceDir.x * POINTER_LASER_MAX_LENGTH,
        _traceOrigin.y + _traceDir.y * POINTER_LASER_MAX_LENGTH,
        _traceOrigin.z + _traceDir.z * POINTER_LASER_MAX_LENGTH
    );

    return _tracedPositions;
}

const _sideRayOrigin = new THREE.Vector3();
const _sideRayPerp = new THREE.Vector3();

// ------------------------------------------------------------------
// PERF: dirty-flag for the ray tracing pass.
// The traced paths only depend on: pointer world matrix, laser mode, and each
// optical mesh's identity, IOR, and world matrix. Snapshot those inputs each
// frame (exact compare, Float64) and skip the whole trace + buffer upload when
// nothing changed — an idle scene does zero raycasts.
// ------------------------------------------------------------------
let _traceCacheValid = false;
let _traceCacheMode = '';
let _traceCacheMeshCount = -1;
let _traceCacheFloats = new Float64Array(16);
const TRACE_CACHE_FLOATS_PER_MESH = 18; // id + ior + 16 matrix elements

function isTraceInputDirty() {
    const meshes = sceneOpticalMeshes;
    const needed = 16 + meshes.length * TRACE_CACHE_FLOATS_PER_MESH;
    let dirty =
        !_traceCacheValid ||
        _traceCacheMode !== deps.laserMode ||
        _traceCacheMeshCount !== meshes.length;

    if (_traceCacheFloats.length < needed) {
        _traceCacheFloats = new Float64Array(needed);
        dirty = true;
    }
    const f = _traceCacheFloats;

    const pe = pointerObj.matrixWorld.elements;
    for (let i = 0; i < 16; i++) {
        if (f[i] !== pe[i]) { f[i] = pe[i]; dirty = true; }
    }

    let o = 16;
    for (let m = 0; m < meshes.length; m++) {
        const mesh = meshes[m];
        if (f[o] !== mesh.id) { f[o] = mesh.id; dirty = true; }
        o++;
        const ior = mesh.userData.ior || 0;
        if (f[o] !== ior) { f[o] = ior; dirty = true; }
        o++;
        const me = mesh.matrixWorld.elements;
        for (let i = 0; i < 16; i++, o++) {
            if (f[o] !== me[i]) { f[o] = me[i]; dirty = true; }
        }
    }

    _traceCacheValid = true;
    _traceCacheMode = deps.laserMode;
    _traceCacheMeshCount = meshes.length;
    return dirty;
}

// LineMaterial.resolution only changes with the render target size — sync it
// when it actually changes instead of writing it every frame.
let _lineResW = 0;
let _lineResH = 0;
function syncLineMaterialResolutions() {
    const w = renderer.domElement.width;
    const h = renderer.domElement.height;
    if (w === _lineResW && h === _lineResH) return;
    _lineResW = w;
    _lineResH = h;
    pointerLaserMat.resolution.set(w, h);
    dispersionMat.resolution.set(w, h);
}

function updatePointerLaser() {
    syncLaserLineVisibility();
    syncLineMaterialResolutions();

    pointerObj.updateMatrixWorld(true);
    containerGroup.updateMatrixWorld(true);

    // Nothing that affects the traced paths moved — keep last frame's lines.
    if (!isTraceInputDirty()) return;

    const e = pointerObj.matrixWorld.elements;
    _ptrLaserDir.set(e[8], e[9], e[10]).normalize();
    pointerObj.getWorldPosition(_ptrLaserStart);
    _ptrLaserStart.addScaledVector(_ptrLaserDir, POINTER_LASER_ORIGIN_OFFSET);

    /** Normals + θ arcs + labels only in single-ray mode (not 3-ray or dispersion). */
    const showNormalsAndAngles = visualizeNormals && deps.laserMode === '1-ray';

    const normalSegOut = showNormalsAndAngles ? _normalVizFlat : null;
    const t1Out = showNormalsAndAngles ? _theta1ArcFlat : null;
    const t2Out = showNormalsAndAngles ? _theta2ArcFlat : null;
    const labelsOut = showNormalsAndAngles ? _angleLabelEntries : null;
    if (showNormalsAndAngles) {
        _normalVizFlat.length = 0;
        _theta1ArcFlat.length = 0;
        _theta2ArcFlat.length = 0;
        _angleLabelEntries.length = 0;
        deps.activeLabelCount = 0;
    }

    if (deps.laserMode !== 'dispersion') {
        // --- 1-ray / 3-ray: pack all rays into the single merged segments mesh ---
        const geom = laserSegments.geometry;
        const posData = geom.attributes.instanceStart.data;
        const posArr = posData.array;

        const positions = traceRefractedRay(_ptrLaserStart, _ptrLaserDir, undefined, normalSegOut, t1Out, t2Out, labelsOut);
        let seg = appendPolylineSegments(posArr, 0, positions);

        if (deps.laserMode === '3-ray') {
            // Two parallel side rays offset perpendicular to the beam
            _sideRayPerp.set(e[4], e[5], e[6]).normalize();

            _sideRayOrigin.copy(_ptrLaserStart).addScaledVector(_sideRayPerp, THREE_RAY_SPACING);
            const posA = traceRefractedRay(_sideRayOrigin, _ptrLaserDir, undefined, normalSegOut, t1Out, t2Out, null);
            seg += appendPolylineSegments(posArr, seg, posA);

            _sideRayOrigin.copy(_ptrLaserStart).addScaledVector(_sideRayPerp, -THREE_RAY_SPACING);
            const posB = traceRefractedRay(_sideRayOrigin, _ptrLaserDir, undefined, normalSegOut, t1Out, t2Out, null);
            seg += appendPolylineSegments(posArr, seg, posB);
        }

        posData.needsUpdate = true;
        geom.instanceCount = seg;
    } else {
        // --- dispersion: 7 wavelength-dependent rays packed into one vertex-colored mesh ---
        const geom = dispersionSegments.geometry;
        const posData = geom.attributes.instanceStart.data;
        const colData = geom.attributes.instanceColorStart.data;
        const posArr = posData.array;
        const colArr = colData.array;

        let seg = 0;
        for (let i = 0; i < DISPERSION_BANDS.length; i++) {
            const band = DISPERSION_BANDS[i];
            const iorFn = (baseIOR) => cauchyIOR(baseIOR, band.wavelength);
            const posD = traceRefractedRay(_ptrLaserStart, _ptrLaserDir, iorFn, normalSegOut, t1Out, t2Out, null);
            const n = appendPolylineSegments(posArr, seg, posD);

            const c = DISPERSION_BAND_RGB[i];
            for (let s = 0; s < n; s++) {
                const o = (seg + s) * 6;
                colArr[o]     = c.r;
                colArr[o + 1] = c.g;
                colArr[o + 2] = c.b;
                colArr[o + 3] = c.r;
                colArr[o + 4] = c.g;
                colArr[o + 5] = c.b;
            }
            seg += n;
        }

        posData.needsUpdate = true;
        colData.needsUpdate = true;
        geom.instanceCount = seg;
    }

    if (showNormalsAndAngles && _normalVizFlat.length > 0) {
        const vertCount = uploadSegmentsInPlace(normalsVizGeom, _normalVizFlat);
        updateNormalsVizLineDistances(vertCount);
        normalsVizLines.visible = true;
    } else {
        normalsVizLines.visible = false;
    }

    if (showNormalsAndAngles && _theta1ArcFlat.length > 0) {
        uploadSegmentsInPlace(theta1ArcGeom, _theta1ArcFlat);
        theta1ArcLines.visible = true;
    } else {
        theta1ArcLines.visible = false;
    }

    if (showNormalsAndAngles && _theta2ArcFlat.length > 0) {
        uploadSegmentsInPlace(theta2ArcGeom, _theta2ArcFlat);
        theta2ArcLines.visible = true;
    } else {
        theta2ArcLines.visible = false;
    }

    if (showNormalsAndAngles) {
        for (let i = 0; i < _angleLabelEntries.length; i++) {
            const entry = _angleLabelEntries[i];
            drawAngleLabel(
                deps.activeLabelCount,
                entry.text,
                entry.x, entry.y, entry.z,
                '#ffffff'
            );
            deps.activeLabelCount++;
        }
        hideUnusedLabels();
    } else {
        deps.activeLabelCount = 0;
        hideUnusedLabels();
    }
}

    const api = {
        getPinchMidWorld,
        getIndexTipWorld,
        getWristWorldQuaternion,
        tryStartPointerGrab,
        applyPointerGrab,
        applyPointerRestPose,
        updatePointerLaser,
        updateObjectNameLabels,
        INDEX_JOINT_SECOND_FROM_TIP,
        THUMB_JOINT_SECOND_FROM_TIP,
        _pinchMid,
        _pointerObjWorldCenter,
        _pointerWorldPos,
        _grabPointerDir,
        _pointerTipLocal,
        _pointerTipGapDir,
        _wristQuat,
        snellRefract,
        traceRefractedRay,
        isTraceInputDirty
    };
    Object.assign(deps, api);
    return api;
}
