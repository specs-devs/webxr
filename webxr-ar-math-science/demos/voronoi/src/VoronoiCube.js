import * as THREE from 'three';
import { isEdgeBetweenSites2D, isEdgeBetweenSites3D } from './VoronoiBisector.js';
import { delaunay2dEdges, voronoi2dEdges } from './Voronoi2d.js';
import { euclideanDistance3d, voronoi3dCells } from './Voronoi3d.js';
import { PointScaleHighlighter } from './PointScaleHighlighter.js';
import { SeedPointLabels } from './SeedPointLabels.js';
import { createWireShaderMaterial } from './WireShaderMaterial.js';
import { WireScratch, writeWireGeometry } from './WireScratch.js';

const DEFAULT_STYLE = {
    wireColor: 0xffffff,
    delaunayColor: 0xffd14a,
    pointColor: 0xffff00,
};

/** Container-local Z of the coplanar seed plane (cube center). */
export const SEED_CENTER_Z = 0;

/** Cap Voronoi topology rebuilds while dragging (~once per 2 XR frames at 72 Hz). */
const TOPOLOGY_REBUILD_INTERVAL_MS = 1000 / 30;

function disableFrustumCulling(object3d) {
    object3d.frustumCulled = false;
}

/** Local box face indices — reused for every merged edge segment. */
const BOX_FACE_INDICES = [
    0, 1, 2, 0, 2, 3,
    4, 5, 6, 4, 6, 7,
    0, 4, 7, 0, 7, 1,
    1, 7, 6, 1, 6, 2,
    2, 6, 5, 2, 5, 3,
    3, 5, 4, 3, 4, 0,
];

function computeEdgeBasis(ax, ay, az, bx, by, bz) {
    if (
        !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az)
        || !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz)
    ) {
        return null;
    }

    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const lenSq = dx * dx + dy * dy + dz * dz;
    // NaN comparisons are always false — reject non-finite lengths explicitly.
    if (!(lenSq >= 1e-12)) return null;

    const invLen = 1 / Math.sqrt(lenSq);
    const dirX = dx * invLen;
    const dirY = dy * invLen;
    const dirZ = dz * invLen;

    let refX = 1;
    let refY = 0;
    let refZ = 0;
    if (Math.abs(dirX) > 0.9) {
        refX = 0;
        refY = 1;
        refZ = 0;
    }

    let uX = dirY * refZ - dirZ * refY;
    let uY = dirZ * refX - dirX * refZ;
    let uZ = dirX * refY - dirY * refX;
    const uLen = Math.sqrt(uX * uX + uY * uY + uZ * uZ);
    if (!(uLen >= 1e-12)) return null;
    uX /= uLen;
    uY /= uLen;
    uZ /= uLen;

    const vX = dirY * uZ - dirZ * uY;
    const vY = dirZ * uX - dirX * uZ;
    const vZ = dirX * uY - dirY * uX;

    return { uX, uY, uZ, vX, vY, vZ };
}

/** Stable undirected edge key for 3D wire dedupe (merged idle mesh). */
function edgeKey3d(ax, ay, az, bx, by, bz) {
    const axr = Math.round(ax * 1e5);
    const ayr = Math.round(ay * 1e5);
    const azr = Math.round(az * 1e5);
    const bxr = Math.round(bx * 1e5);
    const byr = Math.round(by * 1e5);
    const bzr = Math.round(bz * 1e5);
    if (
        axr < bxr
        || (axr === bxr && ayr < byr)
        || (axr === bxr && ayr === byr && azr <= bzr)
    ) {
        return `${axr},${ayr},${azr}|${bxr},${byr},${bzr}`;
    }
    return `${bxr},${byr},${bzr}|${axr},${ayr},${azr}`;
}

/**
 * Append a volumetric box along one edge (8 verts, 12 tris).
 * Square cross-section so the segment stays visible from every viewing angle.
 */
function pushEdgeBox3D(scratch, ax, ay, az, bx, by, bz, halfThickness, alpha = 1) {
    const basis = computeEdgeBasis(ax, ay, az, bx, by, bz);
    if (!basis) return;

    const { uX, uY, uZ, vX, vY, vZ } = basis;
    const uhx = uX * halfThickness;
    const uhy = uY * halfThickness;
    const uhz = uZ * halfThickness;
    const vhx = vX * halfThickness;
    const vhy = vY * halfThickness;
    const vhz = vZ * halfThickness;

    const base = scratch.vertCount;
    const pi = scratch.allocPositions(24);
    const p = scratch.positions;
    p[pi] = ax - uhx - vhx; p[pi + 1] = ay - uhy - vhy; p[pi + 2] = az - uhz - vhz;
    p[pi + 3] = ax + uhx - vhx; p[pi + 4] = ay + uhy - vhy; p[pi + 5] = az + uhz - vhz;
    p[pi + 6] = ax + uhx + vhx; p[pi + 7] = ay + uhy + vhy; p[pi + 8] = az + uhz + vhz;
    p[pi + 9] = ax - uhx + vhx; p[pi + 10] = ay - uhy + vhy; p[pi + 11] = az - uhz + vhz;
    p[pi + 12] = bx - uhx - vhx; p[pi + 13] = by - uhy - vhy; p[pi + 14] = bz - uhz - vhz;
    p[pi + 15] = bx + uhx - vhx; p[pi + 16] = by + uhy - vhy; p[pi + 17] = bz + uhz - vhz;
    p[pi + 18] = bx + uhx + vhx; p[pi + 19] = by + uhy + vhy; p[pi + 20] = bz + uhz + vhz;
    p[pi + 21] = bx - uhx + vhx; p[pi + 22] = by - uhy + vhy; p[pi + 23] = bz - uhz + vhz;

    const ii = scratch.allocIndices(BOX_FACE_INDICES.length);
    const idx = scratch.indices;
    for (let i = 0; i < BOX_FACE_INDICES.length; i++) {
        idx[ii + i] = base + BOX_FACE_INDICES[i];
    }

    const ai = scratch.allocAlphas(8);
    scratch.alphas.fill(alpha, ai, ai + 8);
}

/**
 * Dynamic 3D Voronoi wireframe inside an axis-aligned cube (container-local space).
 */
export class VoronoiCube {
    constructor(options = {}) {
        this.cubeSize = options.cubeSize ?? 0.45;
        this.halfSize = this.cubeSize * 0.5;
        this.pointRadius = options.pointRadius ?? 0.008;
        this.pointActiveScale = options.pointActiveScale ?? 1.55;
        this.wireThickness = options.wireThickness ?? 0.005;
        this.style = { ...DEFAULT_STYLE, ...options.style };
        this.pointScaleHighlighter = new PointScaleHighlighter(this.pointActiveScale);
        this.maxPoints = options.maxPoints ?? Infinity;

        this.points = (options.initialPoints ?? []).map((p) => ({
            x: p.x,
            y: p.y,
            z: p.z ?? 0,
        }));

        this.group = new THREE.Group();
        /** Wire meshes only — Z-scale for 2D collapse lives here, not on control spheres. */
        this.diagramGroup = new THREE.Group();
        this.group.add(this.diagramGroup);
        disableFrustumCulling(this.group);
        disableFrustumCulling(this.diagramGroup);
        this.wireViewBlend = 0;
        this.delaunayVisible = false;
        this.mergePreviews = new Map();
        /** Skipped layers stay dirty until blend / Delaunay makes them visible again. */
        this._wire2DDirty = true;
        this._wireDelaunay2DDirty = true;
        this._wire3DDirty = true;
        /** Deferred topology rebuild while dragging (flushed from update()). */
        this._topologyDirty = false;
        this._lastTopologyRebuildMs = 0;
        this._wireScratch2D = new WireScratch();
        this._wireScratchDelaunay = new WireScratch();
        this._wireScratch3D = new WireScratch();

        this.wire2DGeometry = new THREE.BufferGeometry();
        this.wire2DMaterial = createWireShaderMaterial(this.style.wireColor, 1);
        this.wire2DMesh = new THREE.Mesh(this.wire2DGeometry, this.wire2DMaterial);
        disableFrustumCulling(this.wire2DMesh);
        this.diagramGroup.add(this.wire2DMesh);

        this.wireDelaunay2DGeometry = new THREE.BufferGeometry();
        this.wireDelaunay2DMaterial = createWireShaderMaterial(this.style.delaunayColor, 1);
        this.wireDelaunay2DMesh = new THREE.Mesh(this.wireDelaunay2DGeometry, this.wireDelaunay2DMaterial);
        this.wireDelaunay2DMesh.renderOrder = 1;
        this.wireDelaunay2DMesh.visible = false;
        disableFrustumCulling(this.wireDelaunay2DMesh);
        this.diagramGroup.add(this.wireDelaunay2DMesh);

        this.wire3DMaterial = createWireShaderMaterial(this.style.wireColor, 0);
        this.wire3DGroup = new THREE.Group();
        this.diagramGroup.add(this.wire3DGroup);
        disableFrustumCulling(this.wire3DGroup);
        /** Single draw when idle (explode = 0); hidden while cells are split. */
        this.wire3DMergedGeometry = new THREE.BufferGeometry();
        this.wire3DMergedMesh = new THREE.Mesh(this.wire3DMergedGeometry, this.wire3DMaterial);
        disableFrustumCulling(this.wire3DMergedMesh);
        this.wire3DGroup.add(this.wire3DMergedMesh);
        this.wire3DCellGroups = [];
        this.cellExplodeData = [];
        this.explodeAmount = 0;

        this.pointGeometry = new THREE.SphereGeometry(this.pointRadius, 16, 16);
        this.pointMaterial = new THREE.MeshBasicMaterial({
            color: this.style.pointColor,
            transparent: true,
            opacity: 1,
            depthTest: false,
            depthWrite: false,
        });
        this.pointsGroup = new THREE.Group();
        this.group.add(this.pointsGroup);
        disableFrustumCulling(this.pointsGroup);
        this.pointMeshes = [];
        this.seedLabels = new SeedPointLabels(this.pointsGroup, {
            pointRadius: this.pointRadius,
        });

        this.rebuild();
    }

    get object3D() {
        return this.group;
    }

    getDiagramGroup() {
        return this.diagramGroup;
    }

    getPointMarkerGeometry() {
        return this.pointGeometry;
    }

    getPointMarkerParent() {
        return this.pointsGroup;
    }

    getPointCount() {
        return this.points.length;
    }

    canAddPoint() {
        return this.points.length < this.maxPoints;
    }

    getPoints() {
        return this.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    }

    getPointMarkerPosition(index) {
        const point = this.points[index];
        if (!point) return null;

        const offset = this._getExplodeOffset(index);
        return {
            x: point.x + offset.x,
            y: point.y + offset.y,
            z: point.z + offset.z,
        };
    }

    clampToBounds(x, y, z) {
        const h = this.halfSize;
        return {
            x: Math.max(-h, Math.min(h, x)),
            y: Math.max(-h, Math.min(h, y)),
            z: Math.max(-h, Math.min(h, z)),
        };
    }

    clampToBoundsXY(x, y) {
        const h = this.halfSize;
        return {
            x: Math.max(-h, Math.min(h, x)),
            y: Math.max(-h, Math.min(h, y)),
        };
    }

    isInsideBoundsXY(x, y) {
        const h = this.halfSize;
        return Math.abs(x) <= h && Math.abs(y) <= h;
    }

    isInsideBounds(x, y, z) {
        const h = this.halfSize;
        return Math.abs(x) <= h && Math.abs(y) <= h && Math.abs(z) <= h;
    }

    /** True when an empty-space pinch is on the coplanar diagram (not a remote off-plane pinch). */
    isOnCenterPlaneForSpawn(x, y, z, zTolerance) {
        return this.isInsideBoundsXY(x, y)
            && Math.abs(z - SEED_CENTER_Z) <= zTolerance;
    }

    findNearestPointIndexXY(x, y, maxDistance = Infinity) {
        let bestIndex = -1;
        let bestDist = maxDistance;

        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            const dx = p.x - x;
            const dy = p.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
                bestIndex = i;
                bestDist = dist;
            }
        }

        return bestIndex;
    }

    findMergeTargetIndexXY(draggedIndex, x, y, threshold) {
        if (draggedIndex < 0 || draggedIndex >= this.points.length) return null;

        let best = null;
        for (let i = 0; i < this.points.length; i++) {
            if (i === draggedIndex) continue;

            const p = this.points[i];
            const dx = p.x - x;
            const dy = p.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= threshold && (!best || dist < best.dist)) {
                best = { index: i, dist };
            }
        }

        return best;
    }

    mergePointIntoNearestXY(draggedIndex, x, y, threshold) {
        if (draggedIndex < 0 || draggedIndex >= this.points.length) return false;
        if (this.points.length <= 1) return false;

        for (let i = 0; i < this.points.length; i++) {
            if (i === draggedIndex) continue;

            const p = this.points[i];
            const dx = p.x - x;
            const dy = p.y - y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist <= threshold) {
                this.removePoint(draggedIndex);
                return true;
            }
        }

        return false;
    }

    addPointXY(x, y, z = SEED_CENTER_Z) {
        return this.addPoint(x, y, z);
    }

    movePointXY(index, x, y) {
        if (!this.points[index]) return false;
        return this.movePoint(index, x, y, SEED_CENTER_Z);
    }

    /** Move every seed to the center plane so 2D and 3D diagrams align on transition. */
    flattenToCenterPlane(z = SEED_CENTER_Z) {
        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            p.z = z;
        }
        this.rebuild();
    }

    findNearestPointIndex(x, y, z, maxDistance = Infinity) {
        let bestIndex = -1;
        let bestDist = maxDistance;

        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            const offset = this._getExplodeOffset(i);
            const dist = euclideanDistance3d(
                x,
                y,
                z,
                p.x + offset.x,
                p.y + offset.y,
                p.z + offset.z,
            );
            if (dist < bestDist) {
                bestIndex = i;
                bestDist = dist;
            }
        }

        return bestIndex;
    }

    findMergeTargetIndex(draggedIndex, x, y, z, threshold) {
        if (draggedIndex < 0 || draggedIndex >= this.points.length) return null;

        let best = null;
        for (let i = 0; i < this.points.length; i++) {
            if (i === draggedIndex) continue;

            const p = this.points[i];
            const offset = this._getExplodeOffset(i);
            const dist = euclideanDistance3d(
                x,
                y,
                z,
                p.x + offset.x,
                p.y + offset.y,
                p.z + offset.z,
            );
            if (dist <= threshold && (!best || dist < best.dist)) {
                best = { index: i, dist };
            }
        }

        return best;
    }

    setMergePreview(draggedIndex, targetIndex, fade) {
        const clamped = THREE.MathUtils.clamp(fade, 0, 1);
        const prev = this.mergePreviews.get(draggedIndex);
        if (clamped <= 0) {
            if (!prev) return;
            this.mergePreviews.delete(draggedIndex);
        } else if (
            prev
            && prev.targetIndex === targetIndex
            && prev.fade === clamped
        ) {
            return;
        } else {
            this.mergePreviews.set(draggedIndex, { targetIndex, fade: clamped });
        }
        this._markTopologyDirty();
    }

    getMergePreview(draggedIndex) {
        return this.mergePreviews.get(draggedIndex) ?? null;
    }

    clearMergePreview(draggedIndex) {
        const hadPreview = this.mergePreviews.size > 0;
        if (draggedIndex === undefined) {
            this.mergePreviews.clear();
        } else {
            this.mergePreviews.delete(draggedIndex);
        }
        if (hadPreview) {
            this._topologyDirty = true;
            this._flushTopologyRebuild({ force: true });
        }
    }

    mergePointIntoNearest(draggedIndex, x, y, z, threshold) {
        if (draggedIndex < 0 || draggedIndex >= this.points.length) return false;
        if (this.points.length <= 1) return false;

        for (let i = 0; i < this.points.length; i++) {
            if (i === draggedIndex) continue;

            const p = this.points[i];
            const dist = euclideanDistance3d(x, y, z, p.x, p.y, p.z);
            if (dist <= threshold) {
                this.removePoint(draggedIndex);
                return true;
            }
        }

        return false;
    }

    addPoint(x, y, z) {
        if (!this.canAddPoint()) return -1;
        this.points.push({ x, y, z });
        this.rebuild();
        return this.points.length - 1;
    }

    movePoint(index, x, y, z) {
        const point = this.points[index];
        if (!point) return false;
        const offset = this._getExplodeOffset(index);
        const nextX = x - offset.x;
        const nextY = y - offset.y;
        const nextZ = z - offset.z;
        if (point.x === nextX && point.y === nextY && point.z === nextZ) {
            return false;
        }
        point.x = nextX;
        point.y = nextY;
        point.z = nextZ;
        this._syncPointMarkerPositions();
        this._markTopologyDirty();
        return true;
    }

    setPointZ(index, z) {
        const point = this.points[index];
        if (!point) return false;
        if (point.z === z) return false;
        point.z = z;
        this._syncPointMarkerPositions();
        this._markTopologyDirty();
        return true;
    }

    /** Write every seed Z then rebuild once (view-align tween). */
    setPointZs(zValues) {
        let changed = false;
        const n = Math.min(zValues.length, this.points.length);
        for (let i = 0; i < n; i++) {
            const z = zValues[i];
            if (this.points[i].z !== z) {
                this.points[i].z = z;
                changed = true;
            }
        }
        if (!changed) return false;
        this.rebuild();
        return true;
    }

    setPoint(index, x, y, z) {
        return this.movePoint(index, x, y, z);
    }

    removePoint(index) {
        if (index < 0 || index >= this.points.length) return false;
        this.points.splice(index, 1);

        if (index < this.pointMeshes.length) {
            const mesh = this.pointMeshes.splice(index, 1)[0];
            this.pointsGroup.remove(mesh);
        }

        this.seedLabels.removeAt(index);
        this.seedLabels.syncTexts(this.points.length);
        this.pointScaleHighlighter.onPointRemoved(index, this.pointMeshes);
        this._topologyDirty = false;
        this._lastTopologyRebuildMs = performance.now();
        this._rebuildVisibleWires();
        this._syncPointMarkerPositions();
        return true;
    }

    setPoints(points) {
        const countChanged = points.length !== this.points.length;
        this.points = points.map((p) => ({ x: p.x, y: p.y, z: p.z ?? 0 }));
        if (countChanged) {
            this._resetPointMarkers();
        }
        this.rebuild();
    }

    _resetPointMarkers() {
        for (const mesh of this.pointMeshes) {
            this.pointsGroup.remove(mesh);
        }
        this.pointMeshes = [];
        this.seedLabels.reset();
        this.pointScaleHighlighter.reset();
    }

    _syncPointMarkerPositions() {
        for (let i = 0; i < this.points.length; i++) {
            const point = this.points[i];
            const mesh = this.pointMeshes[i];
            if (!mesh) continue;
            const offset = this._getExplodeOffset(i);
            mesh.position.set(point.x + offset.x, point.y + offset.y, point.z + offset.z);
            mesh.userData.voronoiPointIndex = i;
        }

        this.seedLabels.syncPositions((index) => this.getPointMarkerPosition(index));
    }

    setCubeSize(size) {
        this.cubeSize = size;
        this.halfSize = size * 0.5;
        this.rebuild();
    }

    /** 0 = proper 2D wire only, 1 = proper 3D wire only (crossfade between during transitions). */
    setWireViewBlend(t) {
        this.wireViewBlend = THREE.MathUtils.clamp(t, 0, 1);
        this._ensureVisibleWireLayers();
        this._applyWireOpacities();
    }

    setDelaunayVisible(visible) {
        this.delaunayVisible = visible;
        this._ensureVisibleWireLayers();
        this._applyWireOpacities();
    }

    _needsWire2D() {
        return this._getWire2DBaseOpacity() > 0.01;
    }

    _needsWire3D() {
        return this.wireViewBlend > 0.01;
    }

    _needsWireDelaunay2D() {
        return this.delaunayVisible && this._needsWire2D();
    }

    _getWire2DBaseOpacity() {
        return 1 - this.wireViewBlend;
    }

    _getWire2DOpacity() {
        const base = this._getWire2DBaseOpacity();
        return this.delaunayVisible ? base * 0.2 : base;
    }

    _applyWireOpacities() {
        const opacity2d = this._getWire2DOpacity();
        const opacity3d = this.wireViewBlend;
        this.wire2DMaterial.uniforms.uOpacity.value = opacity2d;
        this.wire3DMaterial.uniforms.uOpacity.value = opacity3d;
        this.wire2DMesh.visible = this._needsWire2D() && !this._wire2DDirty;
        const has3DContent = this.explodeAmount > 0
            ? this.wire3DCellGroups.some((group) => group?.visible)
            : this.wire3DMergedMesh.visible;
        this.wire3DGroup.visible = this._needsWire3D()
            && !this._wire3DDirty
            && has3DContent;
        this._applyDelaunayVisibility();
    }

    _applyDelaunayVisibility() {
        this.wireDelaunay2DMesh.visible = this._needsWireDelaunay2D() && !this._wireDelaunay2DDirty;
    }

    _mergePreviewEdgeAlpha(is2D, ax, ay, az, bx, by, bz) {
        let alpha = 1;

        for (const [draggedIndex, { targetIndex, fade }] of this.mergePreviews) {
            if (fade <= 0) continue;

            const siteA = this.points[draggedIndex];
            const siteB = this.points[targetIndex];
            if (!siteA || !siteB) continue;

            const isShared = is2D
                ? isEdgeBetweenSites2D(ax, ay, bx, by, siteA, siteB)
                : isEdgeBetweenSites3D(ax, ay, az, bx, by, bz, siteA, siteB);

            if (isShared) {
                alpha = Math.min(alpha, 1 - fade);
            }
        }

        return alpha;
    }

    isExploded() {
        return this.explodeAmount > 0;
    }

    /** 0 = assembled, 1 = cells pushed apart along center → centroid. */
    setExplodeAmount(amount) {
        const next = THREE.MathUtils.clamp(amount, 0, 3);
        const wasExploded = this.explodeAmount > 0;
        const nowExploded = next > 0;
        this.explodeAmount = next;

        // Crossing 0 switches merged ↔ per-cell mesh layout.
        if (wasExploded !== nowExploded && this._needsWire3D() && !this._wire3DDirty) {
            this._rebuildWire3D();
        } else if (nowExploded) {
            this._applyExplodeOffsets();
        }

        this._syncPointMarkerPositions();
    }

    _getExplodeScale() {
        return this.cubeSize * 0.55;
    }

    _getCellExplodeScale(data) {
        return this._getExplodeScale() * this.explodeAmount * (data.factor ?? 1);
    }

    /**
     * Cells sharing a similar explode direction get staggered radial factors so
     * co-planar neighbours do not slide out in parallel and stick together.
     */
    _computeDirectionalExplodeFactors() {
        const DOT_THRESHOLD = 0.93;
        const RANK_STEP = 0.2;
        const MIN_FACTOR = 0.2;

        const n = this.cellExplodeData.length;
        for (let i = 0; i < n; i++) {
            if (this.cellExplodeData[i]) {
                this.cellExplodeData[i].factor = 1;
            }
        }

        const parent = Array.from({ length: n }, (_, i) => i);
        const find = (i) => {
            while (parent[i] !== i) {
                parent[i] = parent[parent[i]];
                i = parent[i];
            }
            return i;
        };
        const union = (a, b) => {
            parent[find(a)] = find(b);
        };

        for (let i = 0; i < n; i++) {
            const a = this.cellExplodeData[i];
            if (!a) continue;

            for (let j = i + 1; j < n; j++) {
                const b = this.cellExplodeData[j];
                if (!b) continue;

                const dot = a.dx * b.dx + a.dy * b.dy + a.dz * b.dz;
                if (dot >= DOT_THRESHOLD) {
                    union(i, j);
                }
            }
        }

        const groups = new Map();
        for (let i = 0; i < n; i++) {
            if (!this.cellExplodeData[i]) continue;

            const root = find(i);
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root).push(i);
        }

        for (const groupIndices of groups.values()) {
            if (groupIndices.length <= 1) continue;

            let refDx = 0;
            let refDy = 0;
            let refDz = 0;
            for (const index of groupIndices) {
                const data = this.cellExplodeData[index];
                refDx += data.dx;
                refDy += data.dy;
                refDz += data.dz;
            }

            const refLen = Math.sqrt(refDx * refDx + refDy * refDy + refDz * refDz) || 1;
            refDx /= refLen;
            refDy /= refLen;
            refDz /= refLen;

            groupIndices.sort((indexA, indexB) => {
                const a = this.cellExplodeData[indexA];
                const b = this.cellExplodeData[indexB];
                const depthA = a.cx * refDx + a.cy * refDy + a.cz * refDz;
                const depthB = b.cx * refDx + b.cy * refDy + b.cz * refDz;
                return depthB - depthA;
            });

            for (let rank = 0; rank < groupIndices.length; rank++) {
                this.cellExplodeData[groupIndices[rank]].factor = Math.max(
                    MIN_FACTOR,
                    1 - rank * RANK_STEP,
                );
            }
        }
    }

    _computeExplodeDirection(centroid, siteIndex) {
        const cx = centroid[0];
        const cy = centroid[1];
        const cz = centroid[2];
        const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
        if (len > 1e-7) {
            return { dx: cx / len, dy: cy / len, dz: cz / len };
        }

        const site = this.points[siteIndex];
        if (!site) return { dx: 0, dy: 0, dz: 0 };

        const sx = site.x;
        const sy = site.y;
        const sz = site.z;
        const siteLen = Math.sqrt(sx * sx + sy * sy + sz * sz);
        if (siteLen > 1e-7) {
            return { dx: sx / siteLen, dy: sy / siteLen, dz: sz / siteLen };
        }

        return { dx: 0, dy: 0, dz: 0 };
    }

    _getExplodeOffset(index) {
        const data = this.cellExplodeData[index];
        if (!data || this.explodeAmount <= 0) {
            return { x: 0, y: 0, z: 0 };
        }

        const scale = this._getCellExplodeScale(data);
        return {
            x: data.dx * scale,
            y: data.dy * scale,
            z: data.dz * scale,
        };
    }

    _applyExplodeOffsets() {
        for (let i = 0; i < this.cellExplodeData.length; i++) {
            const group = this.wire3DCellGroups[i];
            const data = this.cellExplodeData[i];
            if (!group || !data) continue;

            const scale = this._getCellExplodeScale(data);
            group.position.set(
                data.cx + data.dx * scale,
                data.cy + data.dy * scale,
                data.cz + data.dz * scale,
            );
        }
    }

    _clearWire3DCells() {
        for (const group of this.wire3DCellGroups) {
            if (!group) continue;
            const mesh = group.children[0];
            mesh?.geometry?.dispose();
            this.wire3DGroup.remove(group);
        }
        this.wire3DCellGroups = [];
        this.cellExplodeData = [];
        if (this.wire3DMergedMesh) {
            this.wire3DMergedMesh.visible = false;
        }
    }

    _hideExplodedWire3DCells() {
        for (const group of this.wire3DCellGroups) {
            if (group) group.visible = false;
        }
        this.cellExplodeData = [];
    }

    setPointHighlights(indices) {
        this.pointScaleHighlighter.setHighlights(indices, this.pointMeshes);
    }

    update(camera) {
        this._flushTopologyRebuild();
        this.seedLabels.updateBillboard(camera);
    }

    _markTopologyDirty() {
        this._topologyDirty = true;
    }

    /** Rebuild wires at most ~30 Hz while dragging; force for structural / preview clears. */
    _flushTopologyRebuild({ force = false } = {}) {
        if (!this._topologyDirty) return;
        const now = performance.now();
        if (!force && (now - this._lastTopologyRebuildMs) < TOPOLOGY_REBUILD_INTERVAL_MS) {
            return;
        }
        this._topologyDirty = false;
        this._lastTopologyRebuildMs = now;
        this._rebuildVisibleWires();
        this._applyWireOpacities();
    }

    rebuild() {
        this._topologyDirty = false;
        this._lastTopologyRebuildMs = performance.now();
        this._rebuildVisibleWires();
        this._syncPointMarkers();
        this._applyWireOpacities();
    }

    /** Rebuild only layers that are currently visible; mark the rest dirty. */
    _rebuildVisibleWires() {
        if (this._needsWire2D()) {
            this._rebuildWire2D();
        } else {
            this._wire2DDirty = true;
            this.wire2DMesh.visible = false;
        }

        if (this._needsWireDelaunay2D()) {
            this._rebuildWireDelaunay2D();
        } else {
            this._wireDelaunay2DDirty = true;
            this.wireDelaunay2DMesh.visible = false;
        }

        if (this._needsWire3D()) {
            this._rebuildWire3D();
        } else {
            this._wire3DDirty = true;
            this.wire3DGroup.visible = false;
        }
    }

    /** Catch-up rebuild when blend / Delaunay turns a dirty layer back on. */
    _ensureVisibleWireLayers() {
        if (this._needsWire2D() && this._wire2DDirty) {
            this._rebuildWire2D();
        }
        if (this._needsWireDelaunay2D() && this._wireDelaunay2DDirty) {
            this._rebuildWireDelaunay2D();
        }
        if (this._needsWire3D() && this._wire3DDirty) {
            this._rebuildWire3D();
        }
    }

    _rebuildWire2D() {
        const edges = voronoi2dEdges(this.points, this.halfSize);
        const halfWidth = this.wireThickness * 0.5;
        const scratch = this._wireScratch2D;
        scratch.reset();

        for (let i = 0; i < edges.length; i++) {
            const [ax, ay, bx, by] = edges[i];
            const alpha = this._mergePreviewEdgeAlpha(true, ax, ay, 0, bx, by, 0);
            pushEdgeBox3D(scratch, ax, ay, 0, bx, by, 0, halfWidth, alpha);
        }

        writeWireGeometry(this.wire2DGeometry, scratch);
        this.wire2DMesh.visible = edges.length > 0
            && this._getWire2DBaseOpacity() > 0.01;
        this._wire2DDirty = false;
        this._applyDelaunayVisibility();
    }

    _rebuildWireDelaunay2D() {
        const edges = delaunay2dEdges(this.points);
        const halfWidth = this.wireThickness * 0.5;
        const scratch = this._wireScratchDelaunay;
        scratch.reset();

        for (let i = 0; i < edges.length; i++) {
            const [ax, ay, bx, by] = edges[i];
            pushEdgeBox3D(scratch, ax, ay, 0, bx, by, 0, halfWidth, 1);
        }

        writeWireGeometry(this.wireDelaunay2DGeometry, scratch);
        this._wireDelaunay2DDirty = false;
        this._applyDelaunayVisibility();
    }

    _rebuildWire3D() {
        const cells = voronoi3dCells(this.points, this.halfSize);
        const halfWidth = this.wireThickness * 0.5;

        if (this.explodeAmount > 0) {
            this.wire3DMergedMesh.visible = false;
            this._rebuildWire3DExploded(cells, halfWidth);
        } else {
            this._hideExplodedWire3DCells();
            this._rebuildWire3DMerged(cells, halfWidth);
        }

        this._wire3DDirty = false;
        this._applyWireOpacities();
    }

    /** One mesh for all unique edges while explode = 0 (single draw call). */
    _rebuildWire3DMerged(cells, halfWidth) {
        const scratch = this._wireScratch3D;
        scratch.reset();
        const seen = new Set();

        for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
            const cell = cells[cellIndex];
            if (!cell) continue;

            const { edges } = cell;
            for (let i = 0; i < edges.length; i++) {
                const [ax, ay, az, bx, by, bz] = edges[i];
                const key = edgeKey3d(ax, ay, az, bx, by, bz);
                if (seen.has(key)) continue;
                seen.add(key);

                const alpha = this._mergePreviewEdgeAlpha(false, ax, ay, az, bx, by, bz);
                pushEdgeBox3D(scratch, ax, ay, az, bx, by, bz, halfWidth, alpha);
            }
        }

        writeWireGeometry(this.wire3DMergedGeometry, scratch);
        this.wire3DMergedMesh.visible = scratch.posCount > 0;
    }

    /** Per-cell meshes so explode can offset each cell group independently. */
    _rebuildWire3DExploded(cells, halfWidth) {
        const nextGroups = new Array(cells.length);
        const nextExplode = new Array(cells.length);
        const scratch = this._wireScratch3D;

        for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
            const cell = cells[cellIndex];
            let group = this.wire3DCellGroups[cellIndex] ?? null;

            if (!cell) {
                if (group) group.visible = false;
                nextGroups[cellIndex] = group;
                nextExplode[cellIndex] = null;
                continue;
            }

            const { centroid, edges } = cell;
            const [cx, cy, cz] = centroid;
            scratch.reset();

            for (let i = 0; i < edges.length; i++) {
                const [ax, ay, az, bx, by, bz] = edges[i];
                const alpha = this._mergePreviewEdgeAlpha(false, ax, ay, az, bx, by, bz);
                pushEdgeBox3D(
                    scratch,
                    ax - cx,
                    ay - cy,
                    az - cz,
                    bx - cx,
                    by - cy,
                    bz - cz,
                    halfWidth,
                    alpha,
                );
            }

            if (scratch.posCount === 0) {
                if (group) group.visible = false;
                nextGroups[cellIndex] = group;
                nextExplode[cellIndex] = null;
                continue;
            }

            if (!group) {
                const geometry = new THREE.BufferGeometry();
                const mesh = new THREE.Mesh(geometry, this.wire3DMaterial);
                disableFrustumCulling(mesh);
                group = new THREE.Group();
                disableFrustumCulling(group);
                group.add(mesh);
                this.wire3DGroup.add(group);
            }

            const mesh = group.children[0];
            writeWireGeometry(mesh.geometry, scratch);
            group.visible = true;

            const direction = this._computeExplodeDirection(centroid, cellIndex);
            nextGroups[cellIndex] = group;
            nextExplode[cellIndex] = {
                cx,
                cy,
                cz,
                dx: direction.dx,
                dy: direction.dy,
                dz: direction.dz,
                factor: 1,
            };
        }

        for (let i = cells.length; i < this.wire3DCellGroups.length; i++) {
            const group = this.wire3DCellGroups[i];
            if (!group) continue;
            const mesh = group.children[0];
            mesh?.geometry?.dispose();
            this.wire3DGroup.remove(group);
        }

        this.wire3DCellGroups = nextGroups;
        this.cellExplodeData = nextExplode;

        this._computeDirectionalExplodeFactors();
        this._applyExplodeOffsets();
    }

    _syncPointMarkers() {
        while (this.pointMeshes.length < this.points.length) {
            const mesh = new THREE.Mesh(this.pointGeometry, this.pointMaterial);
            disableFrustumCulling(mesh);
            mesh.renderOrder = 100;
            mesh.userData.voronoiPointIndex = this.pointMeshes.length;
            this.pointsGroup.add(mesh);
            this.pointMeshes.push(mesh);
        }

        this.seedLabels.syncCount(this.points.length);
        this.seedLabels.syncTexts(this.points.length);
        this._syncPointMarkerPositions();
        this.pointScaleHighlighter.syncAfterRebuild(this.pointMeshes);
    }

    dispose() {
        this.pointScaleHighlighter.dispose();
        this.seedLabels.reset();
        this.wire2DGeometry.dispose();
        this.wire2DMaterial.dispose();
        this.wireDelaunay2DGeometry.dispose();
        this.wireDelaunay2DMaterial.dispose();
        this._clearWire3DCells();
        this.wire3DMergedGeometry.dispose();
        this.wire3DMaterial.dispose();
        this.pointGeometry.dispose();
        this.pointMaterial.dispose();
    }
}
