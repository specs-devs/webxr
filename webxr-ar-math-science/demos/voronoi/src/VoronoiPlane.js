import * as THREE from 'three';
import { Delaunay } from 'd3-delaunay';
import { compareManhattanSites, manhattanDistance, manhattanVoronoiEdges } from './ManhattanVoronoi.js';
import { isEdgeBetweenSites2D, isEdgeBetweenSitesManhattan } from './VoronoiBisector.js';
import { PointScaleHighlighter } from './PointScaleHighlighter.js';
import { SeedPointLabels } from './SeedPointLabels.js';
import { createWireShaderMaterial } from './WireShaderMaterial.js';
import { WireScratch, writeWireGeometry } from './WireScratch.js';

const DEFAULT_STYLE = {
    planeColor: 0x888888,
    planeOpacity: 0,
    wireColor: 0xffffff,
    pointColor: 0xffff00,
};

/** Cap Voronoi topology rebuilds while dragging (~once per 2 XR frames at 72 Hz). */
const TOPOLOGY_REBUILD_INTERVAL_MS = 1000 / 30;

function disableFrustumCulling(object3d) {
    object3d.frustumCulled = false;
}

function edgeKey(ax, ay, bx, by) {
    const axr = Math.round(ax * 1e5);
    const ayr = Math.round(ay * 1e5);
    const bxr = Math.round(bx * 1e5);
    const byr = Math.round(by * 1e5);
    if (axr < bxr || (axr === bxr && ayr <= byr)) {
        return `${axr},${ayr}|${bxr},${byr}`;
    }
    return `${bxr},${byr}|${axr},${ayr}`;
}

/** Append a flat quad for one edge segment (single draw-call mesh, no tubes). */
function pushEdgeQuad(scratch, ax, ay, bx, by, halfWidth, alpha = 1) {
    if (
        !Number.isFinite(ax) || !Number.isFinite(ay)
        || !Number.isFinite(bx) || !Number.isFinite(by)
    ) {
        return;
    }

    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    // NaN comparisons are always false — reject non-finite / zero-length edges.
    if (!(lenSq >= 1e-12)) return;

    const invLen = 1 / Math.sqrt(lenSq);
    const dirX = dx * invLen;
    const dirY = dy * invLen;
    // Extend past endpoints so orthogonal segments overlap at corners (no butt-cap gaps).
    const joinOverlap = halfWidth * 0.4;
    const sax = ax - dirX * joinOverlap;
    const say = ay - dirY * joinOverlap;
    const sbx = bx + dirX * joinOverlap;
    const sby = by + dirY * joinOverlap;
    const px = (-dirY) * halfWidth;
    const py = dirX * halfWidth;
    const base = scratch.vertCount;

    const pi = scratch.allocPositions(12);
    const p = scratch.positions;
    p[pi] = sax + px; p[pi + 1] = say + py; p[pi + 2] = 0;
    p[pi + 3] = sax - px; p[pi + 4] = say - py; p[pi + 5] = 0;
    p[pi + 6] = sbx - px; p[pi + 7] = sby - py; p[pi + 8] = 0;
    p[pi + 9] = sbx + px; p[pi + 10] = sby + py; p[pi + 11] = 0;

    const ii = scratch.allocIndices(6);
    const idx = scratch.indices;
    idx[ii] = base;
    idx[ii + 1] = base + 1;
    idx[ii + 2] = base + 2;
    idx[ii + 3] = base;
    idx[ii + 4] = base + 2;
    idx[ii + 5] = base + 3;

    const ai = scratch.allocAlphas(4);
    scratch.alphas.fill(alpha, ai, ai + 4);
}

/**
 * Dynamic Voronoi wireframe on a vertical plane (XY local space, facing +Z).
 * Points live in plane-local coordinates centered on the plane.
 */
export class VoronoiPlane {
    constructor(options = {}) {
        this.planeSize = options.planeSize ?? 0.45;
        this.halfSize = this.planeSize * 0.5;
        this.zOffset = options.zOffset ?? 0.002;
        this.pointRadius = options.pointRadius ?? 0.008;
        this.pointActiveScale = options.pointActiveScale ?? 1.55;
        this.wireThickness = options.wireThickness ?? 0.004;
        this.style = { ...DEFAULT_STYLE, ...options.style };
        this.pointScaleHighlighter = new PointScaleHighlighter(this.pointActiveScale);
        /** When true, use L1 (Manhattan) metric for the diagram and interaction. */
        this.manhattanSpace = options.manhattanSpace ?? false;
        this.maxPoints = options.maxPoints ?? Infinity;

        this.points = (options.initialPoints ?? []).map((p) => ({ x: p.x, y: p.y }));
        this.mergePreviews = new Map();
        this._topologyDirty = false;
        this._lastTopologyRebuildMs = 0;
        this._wireScratch = new WireScratch();

        this.group = new THREE.Group();
        disableFrustumCulling(this.group);

        this.planeGeometry = new THREE.PlaneGeometry(this.planeSize, this.planeSize);
        this.planeMaterial = new THREE.MeshBasicMaterial({
            color: this.style.planeColor,
            transparent: true,
            opacity: this.style.planeOpacity,
            side: THREE.DoubleSide,
            depthWrite: this.style.planeOpacity > 0,
        });
        this.planeMesh = new THREE.Mesh(this.planeGeometry, this.planeMaterial);
        disableFrustumCulling(this.planeMesh);
        this.group.add(this.planeMesh);

        this.wireGeometry = new THREE.BufferGeometry();
        this.wireMaterial = createWireShaderMaterial(this.style.wireColor, 1);
        this.wireMesh = new THREE.Mesh(this.wireGeometry, this.wireMaterial);
        this.wireMesh.position.z = this.zOffset;
        disableFrustumCulling(this.wireMesh);
        this.group.add(this.wireMesh);

        this.pointGeometry = new THREE.SphereGeometry(this.pointRadius, 16, 16);
        this.pointMaterial = new THREE.MeshBasicMaterial({
            color: this.style.pointColor,
            transparent: true,
            opacity: 1,
            depthTest: false,
            depthWrite: false,
        });
        this.pointsGroup = new THREE.Group();
        this.pointsGroup.position.z = this.zOffset * 2;
        disableFrustumCulling(this.pointsGroup);
        this.group.add(this.pointsGroup);
        this.pointMeshes = [];
        this.seedLabels = new SeedPointLabels(this.pointsGroup, {
            pointRadius: this.pointRadius,
        });

        this.rebuild();
    }

    get object3D() {
        return this.group;
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
        return this.points.map((p) => ({ x: p.x, y: p.y }));
    }

    getPointMarkerPosition(index) {
        const point = this.points[index];
        if (!point) return null;

        return {
            x: point.x,
            y: point.y,
            z: this.pointsGroup.position.z,
        };
    }

    clampToBounds(x, y) {
        const h = this.halfSize;
        return {
            x: Math.max(-h, Math.min(h, x)),
            y: Math.max(-h, Math.min(h, y)),
        };
    }

    isInsideBounds(x, y) {
        const h = this.halfSize;
        return Math.abs(x) <= h && Math.abs(y) <= h;
    }

    /** True when an empty-space pinch is on the diagram plane (not a remote off-plane pinch). */
    isOnPlaneForSpawn(x, y, z, zTolerance) {
        const markerZ = this.pointsGroup.position.z;
        return this.isInsideBounds(x, y)
            && Math.abs(z - markerZ) <= zTolerance;
    }

    _pointDistance(x, y, px, py) {
        if (this.manhattanSpace) {
            return manhattanDistance(x, y, px, py);
        }
        const dx = px - x;
        const dy = py - y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    findNearestPointIndex(x, y, maxDistance = Infinity, pinchZ = null) {
        let bestIndex = -1;
        let bestDist = maxDistance;
        const markerZ = this.pointsGroup.position.z;
        const usePinchZ = pinchZ !== null && pinchZ !== undefined;

        for (let i = 0; i < this.points.length; i++) {
            const p = this.points[i];
            let dist;
            if (usePinchZ) {
                const dx = p.x - x;
                const dy = p.y - y;
                const dz = markerZ - pinchZ;
                dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            } else {
                dist = this._pointDistance(x, y, p.x, p.y);
            }
            if (dist > maxDistance + 1e-9) continue;

            if (bestIndex < 0) {
                bestIndex = i;
                bestDist = dist;
                continue;
            }

            if (this.manhattanSpace) {
                if (compareManhattanSites(x, y, this.points[i], i, this.points[bestIndex], bestIndex) < 0) {
                    bestIndex = i;
                    bestDist = dist;
                }
            } else if (dist < bestDist) {
                bestIndex = i;
                bestDist = dist;
            }
        }

        return bestIndex;
    }

    findMergeTargetIndex(draggedIndex, x, y, threshold) {
        if (draggedIndex < 0 || draggedIndex >= this.points.length) return null;

        let best = null;
        for (let i = 0; i < this.points.length; i++) {
            if (i === draggedIndex) continue;

            const p = this.points[i];
            const dist = this._pointDistance(x, y, p.x, p.y);
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

    mergePointIntoNearest(draggedIndex, x, y, threshold) {
        if (draggedIndex < 0 || draggedIndex >= this.points.length) return false;
        if (this.points.length <= 1) return false;

        for (let i = 0; i < this.points.length; i++) {
            if (i === draggedIndex) continue;

            const dist = this._pointDistance(x, y, this.points[i].x, this.points[i].y);
            if (dist <= threshold) {
                this.removePoint(draggedIndex);
                return true;
            }
        }

        return false;
    }

    addPoint(x, y) {
        if (!this.canAddPoint()) return -1;
        this.points.push({ x, y });
        this.rebuild();
        return this.points.length - 1;
    }

    movePoint(index, x, y) {
        const point = this.points[index];
        if (!point) return false;
        if (point.x === x && point.y === y) return false;
        point.x = x;
        point.y = y;
        this._syncPointMarkerPositions();
        this._markTopologyDirty();
        return true;
    }

    setPoint(index, x, y) {
        return this.movePoint(index, x, y);
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
        this._rebuildWire();
        this._syncPointMarkerPositions();
        return true;
    }

    setPoints(points) {
        const countChanged = points.length !== this.points.length;
        this.points = points.map((p) => ({ x: p.x, y: p.y }));
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
            mesh.position.set(point.x, point.y, 0);
            mesh.userData.voronoiPointIndex = i;
        }

        this.seedLabels.syncPositions((index) => {
            const point = this.points[index];
            if (!point) return null;
            return { x: point.x, y: point.y, z: 0 };
        });
    }

    setPlaneSize(size) {
        this.planeSize = size;
        this.halfSize = size * 0.5;
        this.planeGeometry.dispose();
        this.planeGeometry = new THREE.PlaneGeometry(size, size);
        this.planeMesh.geometry = this.planeGeometry;
        this.rebuild();
    }

    setManhattanSpace(enabled) {
        this.manhattanSpace = !!enabled;
        this.rebuild();
    }

    /** Hook for per-frame updates (interaction / animation can use this later). */
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
        this._rebuildWire();
    }

    rebuild() {
        this._topologyDirty = false;
        this._lastTopologyRebuildMs = performance.now();
        this._rebuildWire();
        this._syncPointMarkers();
    }

    _bounds() {
        const h = this.halfSize;
        return [-h, -h, h, h];
    }

    _planeBoundaryEdges() {
        const h = this.halfSize;
        return [
            [-h, -h, h, -h],
            [h, -h, h, h],
            [h, h, -h, h],
            [-h, h, -h, -h],
        ];
    }

    _mergePreviewEdgeAlpha(ax, ay, bx, by) {
        let alpha = 1;

        for (const [draggedIndex, { targetIndex, fade }] of this.mergePreviews) {
            if (fade <= 0) continue;

            const siteA = this.points[draggedIndex];
            const siteB = this.points[targetIndex];
            if (!siteA || !siteB) continue;

            const isShared = this.manhattanSpace
                ? isEdgeBetweenSitesManhattan(ax, ay, bx, by, siteA, siteB)
                : isEdgeBetweenSites2D(ax, ay, bx, by, siteA, siteB);

            if (isShared) {
                alpha = Math.min(alpha, 1 - fade);
            }
        }

        return alpha;
    }

    _rebuildWire() {
        const edges = this._collectEdges();
        const halfWidth = this.wireThickness * 0.5;
        const scratch = this._wireScratch;
        scratch.reset();

        for (let i = 0; i < edges.length; i++) {
            const [ax, ay, bx, by] = edges[i];
            const alpha = this._mergePreviewEdgeAlpha(ax, ay, bx, by);
            pushEdgeQuad(scratch, ax, ay, bx, by, halfWidth, alpha);
        }

        writeWireGeometry(this.wireGeometry, scratch);
        this.wireMesh.visible = true;
        this.planeMesh.visible = true;
    }

    _collectEdges() {
        if (this.points.length < 2) {
            return this._planeBoundaryEdges();
        }

        if (this.manhattanSpace) {
            return manhattanVoronoiEdges(this.points, this.halfSize);
        }

        const delaunay = Delaunay.from(this.points, (p) => p.x, (p) => p.y);
        const voronoi = delaunay.voronoi(this._bounds());
        const edges = [];
        const seen = new Set();

        for (let i = 0; i < this.points.length; i++) {
            const polygon = voronoi.cellPolygon(i);
            if (!polygon) continue;

            for (let j = 0; j < polygon.length; j++) {
                const a = polygon[j];
                const b = polygon[(j + 1) % polygon.length];
                const key = edgeKey(a[0], a[1], b[0], b[1]);
                if (seen.has(key)) continue;
                seen.add(key);

                edges.push([a[0], a[1], b[0], b[1]]);
            }
        }

        return edges;
    }

    _syncPointMarkers() {
        while (this.pointMeshes.length < this.points.length) {
            const mesh = new THREE.Mesh(this.pointGeometry, this.pointMaterial);
            mesh.frustumCulled = false;
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
        this.planeGeometry.dispose();
        this.planeMaterial.dispose();
        this.wireGeometry.dispose();
        this.wireMaterial.dispose();
        this.pointGeometry.dispose();
        this.pointMaterial.dispose();
    }
}
