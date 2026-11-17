/**
 * surfaceMesh.js
 *
 * Geometry builder and mesh manager for quadratic surfaces.
 *
 * Public API:
 *   SurfaceMeshManager(containerGroup, containerSize)
 *     .setSurface(name)          — swap surface, reset to default params
 *     .setParams(partialParams)  — update one or more params, rebuild
 *     .mesh                      — the THREE.Mesh (already added to containerGroup)
 *     .activeSurface             — current surface name string
 *     .activeParams              — current param object { a, b, c }
 *
 * Code tuning (see exports below):
 *   MESH_QUAD_STEP — coarsens the shaded mesh and the quad overlay vertex grid together.
 *   QUAD_OVERLAY_LINE_STEP — sparsity of drawn isolines on the overlay only.
 */

import * as THREE from 'three';
import { SURFACES } from './Surfaces.js';

const DEFAULT_SEGMENTS = 64;
const MIN_MESH_SEGMENTS = 8;

/**
 * Shaded surface mesh + quad overlay share one segment count:
 *   segments = max(MIN_MESH_SEGMENTS, floor(DEFAULT_SEGMENTS / MESH_QUAD_STEP)).
 * 1 = full base resolution; 2 ≈ half the quads along u and v, etc.
 */
export const MESH_QUAD_STEP = 1;

/**
 * Quad line overlay only: draw every Nth u/v isoline (1 = all grid lines).
 * Independent of {@link MESH_QUAD_STEP}.
 */
export const QUAD_OVERLAY_LINE_STEP = 2;

// ─── Geometry builder ────────────────────────────────────────────────────────

/**
 * Build a BufferGeometry for a named surface.
 * Uses an (S+1)×(S+1) UV grid, no Vector3 allocations per vertex.
 */
export function buildSurfaceGeometry(surfaceName, params, segments = DEFAULT_SEGMENTS, remaps = null) {
    const surface = SURFACES[surfaceName];

    if (surface.sheets) {
        return buildMultiSheetGeometry(surface, params, segments, remaps);
    }

    return buildSingleSheetGeometry(surface.fn, surface.normalAt, params, segments, remaps ? remaps[0] : null);
}

/** One remap per sheet (single-sheet surfaces return a 1-element array). */
function computeSheetRemaps(surface, params, segments) {
    if (surface.sheets) {
        return surface.sheets.map((sheet) => buildSquareishParamRemap(sheet.fn, params, segments));
    }
    return [buildSquareishParamRemap(surface.fn, params, segments)];
}

function buildSquareishParamRemap(fn, params, segments) {
    const S = segments;
    const samples = Math.max(32, Math.min(256, S * 2));
    const out = { x: 0, y: 0, z: 0 };

    const uWeights = new Float32Array(samples);
    const vWeights = new Float32Array(samples);

    for (let k = 0; k < samples; k++) {
        const u0 = k / samples;
        const u1 = (k + 1) / samples;
        let acc = 0;
        for (let j = 0; j <= S; j++) {
            const v = j / S;
            fn(out, u0, v, params);
            const x0 = out.x, y0 = out.y, z0 = out.z;
            fn(out, u1, v, params);
            const dx = out.x - x0;
            const dy = out.y - y0;
            const dz = out.z - z0;
            acc += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        uWeights[k] = acc / (S + 1);
    }

    for (let k = 0; k < samples; k++) {
        const v0 = k / samples;
        const v1 = (k + 1) / samples;
        let acc = 0;
        for (let i = 0; i <= S; i++) {
            const u = i / S;
            fn(out, u, v0, params);
            const x0 = out.x, y0 = out.y, z0 = out.z;
            fn(out, u, v1, params);
            const dx = out.x - x0;
            const dy = out.y - y0;
            const dz = out.z - z0;
            acc += Math.sqrt(dx * dx + dy * dy + dz * dz);
        }
        vWeights[k] = acc / (S + 1);
    }

    return {
        uMap: buildUniformTargetMap(uWeights, S),
        vMap: buildUniformTargetMap(vWeights, S),
    };
}

function buildUniformTargetMap(weights, segments) {
    const N = weights.length;
    const cdf = new Float32Array(N + 1);
    cdf[0] = 0;

    for (let i = 0; i < N; i++) {
        const w = Math.max(1e-8, weights[i]);
        cdf[i + 1] = cdf[i] + w;
    }

    const total = cdf[N] || 1;
    const map = new Float32Array(segments + 1);
    map[0] = 0;
    map[segments] = 1;

    for (let s = 1; s < segments; s++) {
        const target = (s / segments) * total;
        let lo = 0, hi = N;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (cdf[mid] < target) lo = mid + 1;
            else hi = mid;
        }
        const idx = Math.max(1, lo);
        const left = cdf[idx - 1];
        const right = cdf[idx];
        const t = right > left ? (target - left) / (right - left) : 0;
        map[s] = ((idx - 1) + t) / N;
    }

    return map;
}

/**
 * Build line geometry that shows the parametric quad grid
 * (u and v isolines), without triangle diagonals.
 */
export function buildQuadGridGeometry(surfaceName, params, segments = DEFAULT_SEGMENTS, lineStep = 1, remaps = null) {
    const surface = SURFACES[surfaceName];
    if (!surface) return null;

    const S = segments;
    const sheetCount = surface.sheets ? surface.sheets.length : 1;
    const vertPerSheet = (S + 1) * (S + 1);
    const totalVerts = vertPerSheet * sheetCount;

    const positions = new Float32Array(totalVerts * 3);
    const out = { x: 0, y: 0, z: 0 };

    let pOff = 0;
    for (let s = 0; s < sheetCount; s++) {
        const fn = surface.sheets ? surface.sheets[s].fn : surface.fn;
        const remap = (remaps && remaps[s]) || buildSquareishParamRemap(fn, params, S);
        for (let j = 0; j <= S; j++) {
            const v = remap.vMap[j];
            for (let i = 0; i <= S; i++) {
                fn(out, remap.uMap[i], v, params);
                positions[pOff++] = out.x;
                positions[pOff++] = out.y;
                positions[pOff++] = out.z;
            }
        }
    }

    const step = Math.max(1, Math.floor(lineStep));
    const horizontalLines = (Math.floor(S / step) + 1) * S;
    const verticalLines = (Math.floor(S / step) + 1) * S;
    const linesPerSheet = horizontalLines + verticalLines;
    const indices = new Uint32Array(linesPerSheet * sheetCount * 2);
    let iOff = 0;
    let base = 0;

    for (let s = 0; s < sheetCount; s++) {
        // Horizontal links (along +u).
        for (let j = 0; j <= S; j += step) {
            for (let i = 0; i < S; i++) {
                const a = base + j * (S + 1) + i;
                const b = a + 1;
                indices[iOff++] = a;
                indices[iOff++] = b;
            }
        }
        // Vertical links (along +v).
        for (let j = 0; j < S; j++) {
            for (let i = 0; i <= S; i += step) {
                const a = base + j * (S + 1) + i;
                const b = a + (S + 1);
                indices[iOff++] = a;
                indices[iOff++] = b;
            }
        }

        base += vertPerSheet;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
}

function buildSingleSheetGeometry(fn, normalAt, params, segments, cachedRemap = null) {
    const S         = segments;
    const vertCount = (S + 1) * (S + 1);
    const remap = cachedRemap || buildSquareishParamRemap(fn, params, S);

    const positions = new Float32Array(vertCount * 3);
    const out = { x: 0, y: 0, z: 0 };

    let pi = 0;
    for (let j = 0; j <= S; j++) {
        const v = remap.vMap[j];
        for (let i = 0; i <= S; i++) {
            fn(out, remap.uMap[i], v, params);
            positions[pi++] = out.x;
            positions[pi++] = out.y;
            positions[pi++] = out.z;
        }
    }

    const indices = new Uint32Array(S * S * 6);
    let ii = 0;
    for (let j = 0; j < S; j++) {
        for (let i = 0; i < S; i++) {
            const a = j * (S + 1) + i;
            const b = a + 1;
            const c = a + (S + 1);
            const d = c + 1;
            indices[ii++] = a; indices[ii++] = b; indices[ii++] = d;
            indices[ii++] = a; indices[ii++] = d; indices[ii++] = c;
        }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    applyAnalyticalNormals(geo, positions, vertCount, normalAt, params);

    return geo;
}

/**
 * Build geometry for surfaces with multiple disconnected sheets.
 * Each sheet gets its own UV grid; no triangles bridge across sheets.
 */
function buildMultiSheetGeometry(surface, params, segments, remaps = null) {
    const S           = segments;
    const normalAt    = surface.normalAt || null;
    const sheetCount  = surface.sheets.length;
    const vertPerSheet = (S + 1) * (S + 1);
    const idxPerSheet  = S * S * 6;
    const totalVerts   = vertPerSheet * sheetCount;
    const totalIdx     = idxPerSheet  * sheetCount;

    const positions = new Float32Array(totalVerts * 3);
    const indices   = new Uint32Array(totalIdx);
    const out       = { x: 0, y: 0, z: 0 };

    let pOff = 0, iOff = 0, vBase = 0;

    for (let s = 0; s < sheetCount; s++) {
        const fn = surface.sheets[s].fn;
        const remap = (remaps && remaps[s]) || buildSquareishParamRemap(fn, params, S);

        for (let j = 0; j <= S; j++) {
            const v = remap.vMap[j];
            for (let i = 0; i <= S; i++) {
                fn(out, remap.uMap[i], v, params);
                positions[pOff++] = out.x;
                positions[pOff++] = out.y;
                positions[pOff++] = out.z;
            }
        }

        for (let j = 0; j < S; j++) {
            for (let i = 0; i < S; i++) {
                const a = vBase + j * (S + 1) + i;
                const b = a + 1;
                const c = a + (S + 1);
                const d = c + 1;
                indices[iOff++] = a; indices[iOff++] = b; indices[iOff++] = d;
                indices[iOff++] = a; indices[iOff++] = d; indices[iOff++] = c;
            }
        }

        vBase += vertPerSheet;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));

    applyAnalyticalNormals(geo, positions, totalVerts, normalAt, params);

    return geo;
}

/** Evaluate the surface into an existing position array (math space, no allocation). */
function fillSurfacePositions(surface, params, S, remaps, positions) {
    const out = { x: 0, y: 0, z: 0 };
    const sheets = surface.sheets || [surface];
    let p = 0;
    for (let s = 0; s < sheets.length; s++) {
        const fn = sheets[s].fn;
        const remap = remaps[s];
        for (let j = 0; j <= S; j++) {
            const v = remap.vMap[j];
            for (let i = 0; i <= S; i++) {
                fn(out, remap.uMap[i], v, params);
                positions[p++] = out.x;
                positions[p++] = out.y;
                positions[p++] = out.z;
            }
        }
    }
}

/** Recompute analytic normals into an existing array (positions must be in math space). */
function fillAnalyticalNormals(normalAt, params, positions, normals, vertCount) {
    const nout = { x: 0, y: 0, z: 0 };
    for (let i = 0; i < vertCount; i++) {
        normalAt(nout, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], params);
        const len = Math.sqrt(nout.x * nout.x + nout.y * nout.y + nout.z * nout.z);
        const inv = len > 0 ? 1.0 / len : 1.0;
        normals[i * 3 + 0] = nout.x * inv;
        normals[i * 3 + 1] = nout.y * inv;
        normals[i * 3 + 2] = nout.z * inv;
    }
}

function applyAnalyticalNormals(geo, positions, vertCount, normalAt, params) {
    if (normalAt) {
        const normals = new Float32Array(vertCount * 3);
        const nout    = { x: 0, y: 0, z: 0 };
        for (let i = 0; i < vertCount; i++) {
            normalAt(nout, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2], params);
            const len = Math.sqrt(nout.x * nout.x + nout.y * nout.y + nout.z * nout.z);
            const inv = len > 0 ? 1.0 / len : 1.0;
            normals[i * 3 + 0] = nout.x * inv;
            normals[i * 3 + 1] = nout.y * inv;
            normals[i * 3 + 2] = nout.z * inv;
        }
        geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    } else {
        geo.computeVertexNormals();
    }
}

// ─── Fit to container ─────────────────────────────────────────────────────────

/**
 * Uniformly scale and center a geometry to fit inside a cube of side containerSize.
 * Mutates geometry in place.
 */
export function fitGeometryToContainer(geometry, containerSize) {
    geometry.computeBoundingBox();
    const box    = geometry.boundingBox;
    const size   = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    const maxDim = Math.max(size.x, size.y, size.z);
    if (maxDim === 0) return { scale: 1, center: center.clone() };
    const scale = (containerSize * 0.88) / maxDim;

    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
            i,
            (pos.getX(i) - center.x) * scale,
            (pos.getY(i) - center.y) * scale,
            (pos.getZ(i) - center.z) * scale,
        );
    }
    pos.needsUpdate = true;
    geometry.computeBoundingBox();
    // Normals are invariant under uniform scale + translation — no recompute needed.
    return { scale, center: center.clone() };
}

// ─── Surface mesh manager ─────────────────────────────────────────────────────

export class SurfaceMeshManager {

    /**
     * @param {THREE.Group} containerGroup  — the scene group to attach the mesh to
     * @param {number}      containerSize   — side length of the bounding cube
     */
    constructor(containerGroup, containerSize) {
        this.containerGroup = containerGroup;
        this.containerSize  = containerSize;
        this.activeSurface  = 'ellipsoid';
        this.activeParams   = { ...SURFACES['ellipsoid'].defaultParams };

        this.gradientLow  = 0xff6600;   // orange
        this.gradientHigh = 0xffee00;   // yellow
        this.meshQuadStep = MESH_QUAD_STEP;
        this.quadLineStep = QUAD_OVERLAY_LINE_STEP;

        /** Set by _buildAndFit — inverse transform: mathPos = containerPos / fitScale + fitCenter */
        this.fitScale  = 1;
        this.fitCenter = new THREE.Vector3();

        /** Cached per-sheet arc-length remaps; invalidated on surface / tessellation change. */
        this._remaps = null;

        // Y-gradient computed in the shader from geometry-local position.y —
        // no per-vertex CPU color loop and no color attribute upload on param
        // drags; only these uniforms change when the fitted bounds move.
        this._gradientUniforms = {
            uGradientLow:       { value: new THREE.Color(this.gradientLow) },
            uGradientHigh:      { value: new THREE.Color(this.gradientHigh) },
            uGradientMinY:      { value: 0 },
            uGradientInvRangeY: { value: 1 },
            uGradientEnabled:   { value: 1 }, // 0 in focus mode (solid white)
        };

        // Lambert + opaque is much cheaper than Phong + transparent in XR stereo.
        // DoubleSide kept: open sheets (cone, hyperboloids, paraboloids) show both faces.
        this.material = new THREE.MeshLambertMaterial({
            side:         THREE.DoubleSide,
            transparent:  false,
            opacity:      1.0,
        });
        this.material.onBeforeCompile = (shader) => {
            Object.assign(shader.uniforms, this._gradientUniforms);
            shader.vertexShader = shader.vertexShader
                .replace('#include <common>',
                    'uniform float uGradientMinY;\n' +
                    'uniform float uGradientInvRangeY;\n' +
                    'varying float vGradientT;\n' +
                    '#include <common>')
                .replace('#include <begin_vertex>',
                    '#include <begin_vertex>\n' +
                    'vGradientT = clamp((position.y - uGradientMinY) * uGradientInvRangeY, 0.0, 1.0);');
            shader.fragmentShader = shader.fragmentShader
                .replace('#include <common>',
                    'uniform vec3 uGradientLow;\n' +
                    'uniform vec3 uGradientHigh;\n' +
                    'uniform float uGradientEnabled;\n' +
                    'varying float vGradientT;\n' +
                    '#include <common>')
                .replace('#include <color_fragment>',
                    '#include <color_fragment>\n' +
                    'diffuseColor.rgb = mix(diffuseColor.rgb, mix(uGradientLow, uGradientHigh, vGradientT), uGradientEnabled);');
        };

        const geo  = this._buildAndFit(this.activeSurface, this.activeParams);
        this.mesh  = new THREE.Mesh(geo, this.material);
        this.mesh.frustumCulled = false;
        this.containerGroup.add(this.mesh);

        this.quadLinesMaterial = new THREE.LineBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.65,
        });
        this.quadLines = new THREE.LineSegments(
            this._buildAndFitQuadGrid(this.activeSurface, this.activeParams),
            this.quadLinesMaterial
        );
        this.quadLines.visible = true;
        this.quadLines.frustumCulled = false;
        this.containerGroup.add(this.quadLines);
    }

    // ── Public API ────────────────────────────────────────────────────────────

    /** Swap to a different surface. Resets params to the surface's defaults. */
    setSurface(name) {
        if (!SURFACES[name]) {
            console.warn(`[SurfaceMeshManager] Unknown surface: "${name}"`);
            return;
        }
        this.activeSurface = name;
        this.activeParams  = { ...SURFACES[name].defaultParams };
        this._rebuild();
    }

    /**
     * Update one or more params (a / b / c).
     * Uses a fast in-place vertex update when topology is unchanged
     * (no allocations, no geometry swap, cached param remap) — ideal for
     * per-frame slider drags. Falls back to a full rebuild otherwise.
     */
    setParams(partial) {
        Object.assign(this.activeParams, partial);
        if (!this._updateInPlace()) this._rebuild();
    }

    /** Directly replace all params and rebuild. */
    setAllParams(params) {
        this.activeParams = { ...params };
        this._rebuild();
    }

    /**
     * Recompute the arc-length vertex distribution for the current params and
     * re-apply it. Call once after a slider drag ends: during the drag the
     * remap is cached (frozen), which is visually fine but can drift slightly
     * for extreme param changes.
     */
    refreshVertexDistribution() {
        this._remaps = null;
        if (!this._updateInPlace()) this._rebuild();
    }

    /** Toggle quad grid line visibility. */
    setQuadOverlayVisible(visible) {
        this.quadLines.visible = Boolean(visible);
    }

    /** Overlay only: fewer isolines when > 1. Mesh tessellation unchanged. */
    setQuadLineStep(step) {
        const nextStep = Math.max(1, Math.floor(step));
        if (nextStep === this.quadLineStep) return;
        this.quadLineStep = nextStep;
        const oldQuadGeo = this.quadLines.geometry;
        this.quadLines.geometry = this._buildAndFitQuadGrid(this.activeSurface, this.activeParams);
        oldQuadGeo.dispose();
    }

    /**
     * Coarsens or refines the shaded mesh and rebuilds the overlay grid to match.
     * Effective segments = max(MIN_MESH_SEGMENTS, floor(DEFAULT_SEGMENTS / step)).
     */
    setMeshQuadStep(step) {
        const next = Math.max(1, Math.floor(step));
        if (next === this.meshQuadStep) return;
        this.meshQuadStep = next;
        this._rebuild();
    }

    /** Set mesh opacity in [0, 1]. */
    setOpacity(opacity) {
        const o = THREE.MathUtils.clamp(opacity, 0, 1);
        if (o === this.material.opacity) return;
        this.material.opacity = o;
        this.material.transparent = o < 1.0;

        // Focus/dragging mode: solid white — the shader ignores the gradient.
        this._gradientUniforms.uGradientEnabled.value = o < 1.0 ? 0 : 1;

        this.material.needsUpdate = true;
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _effectiveSegments() {
        return Math.max(
            MIN_MESH_SEGMENTS,
            Math.floor(DEFAULT_SEGMENTS / Math.max(1, this.meshQuadStep)),
        );
    }

    _ensureRemaps() {
        if (!this._remaps) {
            this._remaps = computeSheetRemaps(
                SURFACES[this.activeSurface],
                this.activeParams,
                this._effectiveSegments(),
            );
        }
        return this._remaps;
    }

    _buildAndFit(name, params) {
        const geo = buildSurfaceGeometry(name, params, this._effectiveSegments(), this._ensureRemaps());
        const { scale, center } = fitGeometryToContainer(geo, this.containerSize);
        this.fitScale = scale;
        this.fitCenter.copy(center);
        this._updateGradientBounds(geo);
        return geo;
    }

    /** Feed the fitted Y bounds to the shader gradient (two scalar uniforms). */
    _updateGradientBounds(geo) {
        if (!geo.boundingBox) geo.computeBoundingBox();
        const minY = geo.boundingBox.min.y;
        const rangeY = geo.boundingBox.max.y - minY || 1;
        this._gradientUniforms.uGradientMinY.value = minY;
        this._gradientUniforms.uGradientInvRangeY.value = 1 / rangeY;
    }

    _buildAndFitQuadGrid(name, params) {
        const geo = buildQuadGridGeometry(name, params, this._effectiveSegments(), this.quadLineStep, this._ensureRemaps());
        fitGeometryToContainer(geo, this.containerSize);
        return geo;
    }

    _rebuild() {
        this._remaps = null; // full rebuild → fresh vertex distribution
        const oldGeo = this.mesh.geometry;
        const oldQuadGeo = this.quadLines.geometry;
        this.mesh.geometry = this._buildAndFit(this.activeSurface, this.activeParams);
        this.quadLines.geometry = this._buildAndFitQuadGrid(this.activeSurface, this.activeParams);
        oldGeo.dispose();
        oldQuadGeo.dispose();
    }

    /**
     * Fast path for param-only changes: rewrite existing position / normal /
     * color buffers in place. The quad overlay shares the exact same vertex
     * grid as the mesh, so its positions are a straight copy.
     * Returns false when buffers don't match the current topology.
     */
    _updateInPlace() {
        const surface = SURFACES[this.activeSurface];
        const S = this._effectiveSegments();
        const sheetCount = surface.sheets ? surface.sheets.length : 1;
        const vertCount = (S + 1) * (S + 1) * sheetCount;

        const geo = this.mesh.geometry;
        const posAttr = geo.attributes.position;
        const quadGeo = this.quadLines.geometry;
        const quadPosAttr = quadGeo ? quadGeo.attributes.position : null;
        if (!posAttr || posAttr.count !== vertCount) return false;
        if (!quadPosAttr || quadPosAttr.count !== vertCount) return false;

        const positions = posAttr.array;
        fillSurfacePositions(surface, this.activeParams, S, this._ensureRemaps(), positions);

        // Normals from math-space positions (before fit; uniform scale keeps them valid).
        const normalAt = surface.normalAt || null;
        const normAttr = geo.attributes.normal;
        const analyticNormals = normalAt && normAttr && normAttr.count === vertCount;
        if (analyticNormals) {
            fillAnalyticalNormals(normalAt, this.activeParams, positions, normAttr.array, vertCount);
            normAttr.needsUpdate = true;
        }

        // Fit to container in place (same math as fitGeometryToContainer).
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < positions.length; i += 3) {
            const x = positions[i], y = positions[i + 1], z = positions[i + 2];
            if (x < minX) minX = x; if (x > maxX) maxX = x;
            if (y < minY) minY = y; if (y > maxY) maxY = y;
            if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
        }
        const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
        const scale = maxDim > 0 ? (this.containerSize * 0.88) / maxDim : 1;
        const cx = (minX + maxX) * 0.5;
        const cy = (minY + maxY) * 0.5;
        const cz = (minZ + maxZ) * 0.5;
        for (let i = 0; i < positions.length; i += 3) {
            positions[i]     = (positions[i]     - cx) * scale;
            positions[i + 1] = (positions[i + 1] - cy) * scale;
            positions[i + 2] = (positions[i + 2] - cz) * scale;
        }
        this.fitScale = scale;
        this.fitCenter.set(cx, cy, cz);
        posAttr.needsUpdate = true;

        if (geo.boundingBox === null) geo.boundingBox = new THREE.Box3();
        geo.boundingBox.min.set((minX - cx) * scale, (minY - cy) * scale, (minZ - cz) * scale);
        geo.boundingBox.max.set((maxX - cx) * scale, (maxY - cy) * scale, (maxZ - cz) * scale);

        if (!analyticNormals) geo.computeVertexNormals();

        quadPosAttr.array.set(positions);
        quadPosAttr.needsUpdate = true;

        this._updateGradientBounds(geo);
        return true;
    }
}
