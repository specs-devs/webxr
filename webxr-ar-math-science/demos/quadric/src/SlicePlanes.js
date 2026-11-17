/**
 * slicePlanes.js
 *
 * Manages three axis-aligned cutting planes (X / Y / Z) and the intersection
 * curves they reveal on the current quadratic surface.
 *
 * Curve extraction uses 2-D marching squares on the surface's implicit function
 * evaluated in container-local space (converted back to math space via the fit
 * transform stored in SurfaceMeshManager).
 *
 * Public API:
 *   SlicePlaneManager(containerGroup, containerSize)
 *     .setOffset(axis, t)           — move plane; t ∈ [−0.5, 0.5]
 *     .setVisible(axis, visible)    — show / hide one plane + its curve
 *     .updateAll(name, params, fitScale, fitCenter)  — recompute all curves
 */

import * as THREE from 'three';
import { SURFACES } from './Surfaces.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const GRID_N = 80; // marching-squares grid resolution per axis
// Coarser grid used while a drag is active (~4× cheaper per recompute);
// full resolution is restored + recomputed once on release.
const GRID_N_INTERACTIVE = 40;

// Upper bound on line-segment vertices per curve.
// Saddle cells emit 2 segments (4 verts); worst case = every cell is a saddle.
const MAX_VERTS_PER_CURVE = 4 * GRID_N * GRID_N;

const AXES = ['x', 'y', 'z'];

const PLANE_COLOR  = { x: 0xffffff, y: 0xffffff, z: 0xffffff };
const CURVE_COLOR  = { x: 0xffff00, y: 0xffff00, z: 0xffff00 };
const HANDLE_COLOR = 0xffff00;
const PLANE_LINEWIDTH_DEFAULT = 2;
const PLANE_LINEWIDTH_ACTIVE = 2;
const CURVE_LINEWIDTH_DEFAULT = 3;
const CURVE_LINEWIDTH_ACTIVE = 3;

// ─── Marching-squares lookup table ───────────────────────────────────────────
//
// Corner bits: bit0 = c00 (i,j), bit1 = c10 (i+1,j),
//              bit2 = c11 (i+1,j+1), bit3 = c01 (i,j+1)
// "inside" means F > 0.
//
// Edges: 0 = bottom (c00→c10), 1 = right (c10→c11),
//        2 = top    (c11→c01), 3 = left  (c01→c00)
//
// Each entry is a flat list of edge-index pairs to connect as line segments.

const MS_TABLE = [
    [],              // 0  0000
    [0, 3],          // 1  0001
    [0, 1],          // 2  0010
    [1, 3],          // 3  0011
    [1, 2],          // 4  0100
    [0, 3, 1, 2],    // 5  0101  saddle — two segments
    [0, 2],          // 6  0110
    [2, 3],          // 7  0111
    [2, 3],          // 8  1000
    [0, 2],          // 9  1001
    [0, 1, 2, 3],    // 10 1010  saddle — two segments
    [1, 2],          // 11 1011
    [1, 3],          // 12 1100
    [0, 1],          // 13 1101
    [0, 3],          // 14 1110
    [],              // 15 1111
];

// ─── SlicePlaneManager ────────────────────────────────────────────────────────

export class SlicePlaneManager {

    /**
     * @param {THREE.Group} containerGroup
     * @param {number}      containerSize   — side length of the bounding cube
     */
    constructor(containerGroup, containerSize) {
        this.containerGroup = containerGroup;
        this.containerSize  = containerSize;

        // Plane offsets in normalised units (−0.5 … 0.5 → −half … +half metres)
        this.offsets = { x: 0, y: 0, z: 0 };

        // Fit transform supplied by SurfaceMeshManager after each rebuild
        this._fitScale  = 1;
        this._fitCenter = new THREE.Vector3();
        this._surfaceName = null;
        this._params      = null;

        // Reusable scalar-field grid (shared across all three axes),
        // sized for the full resolution; the interactive grid fits inside it.
        this._grid = new Float32Array((GRID_N + 1) * (GRID_N + 1));
        this._gridN = GRID_N;

        // Lazy recompute: invisible curves are only marked stale and get
        // recomputed the moment they become visible.
        this._curveDirty = { x: true, y: true, z: true };

        this._planes = {};
        this._planeFills = {};
        this._cornerHandles = {};
        this._curves = {};
        this._buildObjects();
    }

    // ── Construction ──────────────────────────────────────────────────────────

    _buildObjects() {
        const S = this.containerSize;
        const half = S * 0.5;
        const cornerRadius = Math.max(0.005, S * 0.025);
        const handleSizeScale = 0.8;
        const handleCylinderRadius = cornerRadius * 1.2 * handleSizeScale;
        const handleCylinderLength = cornerRadius * 0.4 * handleSizeScale;
        const innerCylinderRadius = handleCylinderRadius * 0.22;
        const innerCylinderLength = handleCylinderLength * 7.5;

        const planeRotations = {
            x: new THREE.Euler(0, Math.PI / 2, 0),
            y: new THREE.Euler(-Math.PI / 2, 0, 0),
            z: new THREE.Euler(0, 0, 0),
        };

        for (const axis of AXES) {
            const fillGeo = new THREE.PlaneGeometry(S, S);
            const fillMat = new THREE.MeshBasicMaterial({
                color:       0xffffff,
                transparent: true,
                opacity:     0.2,
                depthTest:   false,
                side:        THREE.DoubleSide,
            });
            const fill = new THREE.Mesh(fillGeo, fillMat);
            fill.rotation.copy(planeRotations[axis]);
            fill.renderOrder = 10;
            fill.visible = false;
            fill.frustumCulled = false;
            this.containerGroup.add(fill);
            this._planeFills[axis] = fill;

            // Frame only (no fill)
            const outlineGeo = new THREE.EdgesGeometry(new THREE.PlaneGeometry(S, S));
            const outlineMat = new THREE.LineBasicMaterial({
                color:       PLANE_COLOR[axis],
                transparent: false,
                opacity:     1.0,
                depthTest:   false,
                linewidth:   PLANE_LINEWIDTH_DEFAULT,
            });
            const outline = new THREE.LineSegments(outlineGeo, outlineMat);
            outline.rotation.copy(planeRotations[axis]);
            outline.renderOrder = 11;
            outline.visible = false;
            outline.frustumCulled = false;
            this.containerGroup.add(outline);
            this._planes[axis] = outline;

            const handleGeo = new THREE.CylinderGeometry(
                handleCylinderRadius,
                handleCylinderRadius,
                handleCylinderLength,
                12
            );
            const innerHandleGeo = new THREE.CylinderGeometry(
                innerCylinderRadius,
                innerCylinderRadius,
                innerCylinderLength,
                12
            );
            const handleMat = new THREE.MeshStandardMaterial({
                color:       HANDLE_COLOR,
                roughness:   0.45,
                metalness:   0.05,
                emissive:    0x332200,
                emissiveIntensity: 0.2,
                depthTest:   true,
            });
            const innerHandleMat = new THREE.MeshStandardMaterial({
                color:       HANDLE_COLOR,
                roughness:   0.35,
                metalness:   0.08,
                emissive:    0x332200,
                emissiveIntensity: 0.24,
                depthTest:   true,
            });
            const axisDirection = axis === 'x'
                ? new THREE.Vector3(1, 0, 0)
                : axis === 'y'
                    ? new THREE.Vector3(0, 1, 0)
                    : new THREE.Vector3(0, 0, 1);
            const corners = this._getCornerLocalCoords(axis, half);
            const handles = [];
            for (let i = 0; i < corners.length; i++) {
                const h = new THREE.Group();
                h.frustumCulled = false;
                const outerMesh = new THREE.Mesh(handleGeo, handleMat);
                const innerMesh = new THREE.Mesh(innerHandleGeo, innerHandleMat);
                outerMesh.renderOrder = 12;
                innerMesh.renderOrder = 13;
                outerMesh.frustumCulled = false;
                innerMesh.frustumCulled = false;
                h.add(outerMesh);
                h.add(innerMesh);
                h.position.set(corners[i][0], corners[i][1], corners[i][2]);
                // Cylinder local axis is Y; align it with the edge travel direction.
                h.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axisDirection);
                h.userData.baseCorner = corners[i];
                h.userData.sliceAxis = axis;
                this.containerGroup.add(h);
                handles.push(h);
            }
            this._cornerHandles[axis] = handles;

            // Intersection curve (LineSegments with dynamic buffer)
            const posArr  = new Float32Array(MAX_VERTS_PER_CURVE * 3);
            const lineGeo = new THREE.BufferGeometry();
            lineGeo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
            lineGeo.setDrawRange(0, 0);

            const lineMat = new THREE.LineBasicMaterial({
                color:       CURVE_COLOR[axis],
                transparent: true,
                opacity:     1.0,
                depthTest:   false,
                linewidth:   CURVE_LINEWIDTH_DEFAULT, // Supported inconsistently in WebGL, kept as hint.
            });
            const line    = new THREE.LineSegments(lineGeo, lineMat);
            line.renderOrder = 12;
            line.frustumCulled = false;
            this.containerGroup.add(line);
            this._curves[axis] = line;
        }
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Move a cutting plane. t = 0 is centred; ±0.5 reaches the cube faces.
     * Triggers a curve recompute if surface data is available.
     */
    setOffset(axis, t) {
        this.offsets[axis] = t;
        const offset = t * this.containerSize;
        const fill = this._planeFills[axis];
        const frame = this._planes[axis];
        fill.position.set(
            axis === 'x' ? offset : 0,
            axis === 'y' ? offset : 0,
            axis === 'z' ? offset : 0,
        );
        frame.position.set(
            axis === 'x' ? offset : 0,
            axis === 'y' ? offset : 0,
            axis === 'z' ? offset : 0,
        );

        const handles = this._cornerHandles[axis];
        const dx = axis === 'x' ? offset : 0;
        const dy = axis === 'y' ? offset : 0;
        const dz = axis === 'z' ? offset : 0;
        for (let i = 0; i < handles.length; i++) {
            const h = handles[i];
            const c = h.userData.baseCorner;
            h.position.set(c[0] + dx, c[1] + dy, c[2] + dz);
        }
        this.compensateHandleScale();
        if (this._surfaceName) this._computeCurveIfVisible(axis);
    }

    /** Show or hide one plane and its intersection curve. */
    setVisible(axis, visible) {
        // Keep outlines off by default; focus mode controls them separately.
        this._planes[axis].visible = false;
        this._planeFills[axis].visible = false;
        const handles = this._cornerHandles[axis];
        for (let i = 0; i < handles.length; i++) handles[i].visible = visible;
        this.setCurveVisible(axis, visible);
    }

    /** Show or hide one intersection curve only. Recomputes a stale curve on reveal. */
    setCurveVisible(axis, visible) {
        const show = Boolean(visible);
        const curve = this._curves[axis];
        if (show && !curve.visible && this._curveDirty[axis]) {
            this._computeCurve(axis);
        }
        curve.visible = show;
    }

    /** Slightly thicken the curve for the currently active plane. */
    setCurveActive(axis, active) {
        const curve = this._curves[axis];
        if (!curve) return;
        const width = active ? CURVE_LINEWIDTH_ACTIVE : CURVE_LINEWIDTH_DEFAULT;
        if (curve.material.linewidth === width) return;
        curve.material.linewidth = width;
        curve.material.needsUpdate = true;
    }

    /** Show or hide the colored wireframe outline only. */
    setPlaneOutlineVisible(axis, visible) {
        this._planes[axis].visible = Boolean(visible);
    }

    /** Slightly thicken the frame edge for the active plane. */
    setPlaneOutlineActive(axis, active) {
        const plane = this._planes[axis];
        if (!plane) return;
        const width = active ? PLANE_LINEWIDTH_ACTIVE : PLANE_LINEWIDTH_DEFAULT;
        if (plane.material.linewidth === width) return;
        plane.material.linewidth = width;
        plane.material.needsUpdate = true;
    }

    /** Show or hide one translucent plane fill only. */
    setFillVisible(axis, visible) {
        this._planeFills[axis].visible = Boolean(visible);
    }

    /** Show or hide only the corner handle spheres for one axis. */
    setHandlesVisible(axis, visible) {
        const handles = this._cornerHandles[axis];
        for (let i = 0; i < handles.length; i++) handles[i].visible = Boolean(visible);
    }

    /** Return all interactive corner-handle meshes for XR grabbing. */
    getAllCornerHandles() {
        const all = [];
        for (const axis of AXES) {
            const handles = this._cornerHandles[axis];
            for (let i = 0; i < handles.length; i++) all.push(handles[i]);
        }
        return all;
    }

    /** Return corner handles for one axis (x/y/z). */
    getCornerHandles(axis) {
        return this._cornerHandles[axis] || [];
    }

    /**
     * Keep controller handle visuals at a stable world size even when
     * the parent containerGroup is uniformly/non-uniformly scaled.
     */
    compensateHandleScale() {
        const sx = Math.max(1e-6, this.containerGroup.scale.x);
        const sy = Math.max(1e-6, this.containerGroup.scale.y);
        const sz = Math.max(1e-6, this.containerGroup.scale.z);
        const invX = 1 / sx;
        const invY = 1 / sy;
        const invZ = 1 / sz;
        for (const axis of AXES) {
            const handles = this._cornerHandles[axis];
            for (let i = 0; i < handles.length; i++) {
                handles[i].scale.set(invX, invY, invZ);
            }
        }
    }

    _getCornerLocalCoords(axis, half) {
        if (axis === 'x') {
            return [
                [0, -half, -half],
                [0,  half, -half],
                [0,  half,  half],
                [0, -half,  half],
            ];
        }
        if (axis === 'y') {
            return [
                [-half, 0, -half],
                [ half, 0, -half],
                [ half, 0,  half],
                [-half, 0,  half],
            ];
        }
        return [
            [-half, -half, 0],
            [ half, -half, 0],
            [ half,  half, 0],
            [-half,  half, 0],
        ];
    }

    /**
     * Recompute all three intersection curves.
     * Call after any surface / parameter change.
     *
     * @param {string}        surfaceName
     * @param {object}        params       { a, b, c }
     * @param {number}        fitScale     from SurfaceMeshManager
     * @param {THREE.Vector3} fitCenter    from SurfaceMeshManager
     */
    updateAll(surfaceName, params, fitScale, fitCenter) {
        this._surfaceName = surfaceName;
        this._params      = params;
        this._fitScale    = fitScale;
        this._fitCenter   = fitCenter;
        // Only pay for curves that are on screen; stale hidden curves are
        // recomputed lazily when they next become visible.
        for (const axis of AXES) {
            this._curveDirty[axis] = true;
            this._computeCurveIfVisible(axis);
        }
    }

    /**
     * Toggle the coarse marching-squares grid used during drags. Callers must
     * trigger a recompute afterwards (e.g. updateAll / setOffset) — this only
     * switches the resolution used by subsequent recomputes.
     */
    setInteractive(active) {
        const n = active ? GRID_N_INTERACTIVE : GRID_N;
        if (n === this._gridN) return;
        this._gridN = n;
        for (const axis of AXES) this._curveDirty[axis] = true;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _computeCurveIfVisible(axis) {
        if (this._curves[axis].visible) {
            this._computeCurve(axis);
        } else {
            this._curveDirty[axis] = true;
        }
    }

    _computeCurve(axis) {
        if (!this._surfaceName) return;
        this._curveDirty[axis] = false;

        const N    = this._gridN;
        const S    = this.containerSize;
        const half = S * 0.5;
        const cell = S / N;
        const k    = this.offsets[axis] * S; // cut position in container-local space
        const grid = this._grid;

        // Hoisted out of the ~(N+1)² inner loop: implicit fn, params, and the
        // container-local → math-space fit transform (scalar math, no arrays).
        const implicit = SURFACES[this._surfaceName].implicit;
        const params = this._params;
        const invS = 1 / this._fitScale;
        const fcx = this._fitCenter.x;
        const fcy = this._fitCenter.y;
        const fcz = this._fitCenter.z;

        // ── Fill scalar field ──────────────────────────────────────────────────
        for (let j = 0; j <= N; j++) {
            const v = j * cell - half;
            for (let i = 0; i <= N; i++) {
                const u  = i * cell - half;
                let cx, cy, cz;
                if      (axis === 'z') { cx = u; cy = v; cz = k; }
                else if (axis === 'y') { cx = u; cy = k; cz = v; }
                else                   { cx = k; cy = u; cz = v; }
                const f = implicit(cx * invS + fcx, cy * invS + fcy, cz * invS + fcz, params);
                grid[j * (N + 1) + i] = isFinite(f) ? f : 1e6;
            }
        }

        // ── Marching squares ──────────────────────────────────────────────────
        const posArr = this._curves[axis].geometry.attributes.position.array;
        let count = 0;

        for (let j = 0; j < N; j++) {
            const v0 = j * cell - half;
            const v1 = v0 + cell;

            for (let i = 0; i < N; i++) {
                const u0 = i * cell - half;
                const u1 = u0 + cell;

                const f00 = grid[ j      * (N + 1) +  i     ];
                const f10 = grid[ j      * (N + 1) + (i + 1)];
                const f11 = grid[(j + 1) * (N + 1) + (i + 1)];
                const f01 = grid[(j + 1) * (N + 1) +  i     ];

                const caseIdx = ((f01 > 0 ? 1 : 0) << 3) |
                                ((f11 > 0 ? 1 : 0) << 2) |
                                ((f10 > 0 ? 1 : 0) << 1) |
                                 (f00 > 0 ? 1 : 0);

                const pairs = MS_TABLE[caseIdx];
                if (pairs.length === 0) continue;

                // Interpolated crossing points for each of the 4 edges
                const ep = [null, null, null, null];

                if ((f00 > 0) !== (f10 > 0)) {
                    const t = f00 / (f00 - f10);
                    ep[0] = [u0 + t * cell, v0];
                }
                if ((f10 > 0) !== (f11 > 0)) {
                    const t = f10 / (f10 - f11);
                    ep[1] = [u1, v0 + t * cell];
                }
                if ((f11 > 0) !== (f01 > 0)) {
                    const t = f11 / (f11 - f01);
                    ep[2] = [u1 - t * cell, v1];
                }
                if ((f01 > 0) !== (f00 > 0)) {
                    const t = f01 / (f01 - f00);
                    ep[3] = [u0, v1 - t * cell];
                }

                for (let p = 0; p < pairs.length; p += 2) {
                    const ea = ep[pairs[p]];
                    const eb = ep[pairs[p + 1]];
                    if (!ea || !eb) continue;
                    if (count + 2 > MAX_VERTS_PER_CURVE) break;

                    const b = count * 3;
                    if (axis === 'z') {
                        posArr[b]   = ea[0]; posArr[b+1] = ea[1]; posArr[b+2] = k;
                        posArr[b+3] = eb[0]; posArr[b+4] = eb[1]; posArr[b+5] = k;
                    } else if (axis === 'y') {
                        posArr[b]   = ea[0]; posArr[b+1] = k;    posArr[b+2] = ea[1];
                        posArr[b+3] = eb[0]; posArr[b+4] = k;    posArr[b+5] = eb[1];
                    } else {
                        posArr[b]   = k;    posArr[b+1] = ea[0]; posArr[b+2] = ea[1];
                        posArr[b+3] = k;    posArr[b+4] = eb[0]; posArr[b+5] = eb[1];
                    }
                    count += 2;
                }
            }
        }

        const geo = this._curves[axis].geometry;
        geo.attributes.position.needsUpdate = true;
        geo.setDrawRange(0, count);
    }
}
