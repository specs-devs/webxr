const EPS = 1e-7;
const ROUND = 1e5;

function roundCoord(v) {
    return Math.round(v * ROUND) / ROUND;
}

function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function sub3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross3(a, b) {
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

function len3(v) {
    return Math.sqrt(dot3(v, v));
}

function normalize3(v) {
    const l = len3(v);
    if (l < EPS) return [0, 0, 0];
    return [v[0] / l, v[1] / l, v[2] / l];
}

function siteToArray(site) {
    return [site.x, site.y, site.z ?? 0];
}

/** Half-space keeping points closer to siteI than siteJ. */
export function bisectorHalfSpace(siteI, siteJ) {
    const ai = siteToArray(siteI);
    const aj = siteToArray(siteJ);
    const mx = (ai[0] + aj[0]) * 0.5;
    const my = (ai[1] + aj[1]) * 0.5;
    const mz = (ai[2] + aj[2]) * 0.5;
    const nx = aj[0] - ai[0];
    const ny = aj[1] - ai[1];
    const nz = aj[2] - ai[2];
    return { mx, my, mz, nx, ny, nz };
}

function halfSpaceDistance(hs, p) {
    return dot3([p[0] - hs.mx, p[1] - hs.my, p[2] - hs.mz], [hs.nx, hs.ny, hs.nz]);
}

function isInsideHalfSpace(hs, p) {
    return halfSpaceDistance(hs, p) <= EPS;
}

function intersectEdgeHalfSpace(a, b, hs) {
    const da = halfSpaceDistance(hs, a);
    const db = halfSpaceDistance(hs, b);
    const denom = da - db;
    const t = Math.abs(denom) < EPS ? 0.5 : da / denom;
    return [
        a[0] + t * (b[0] - a[0]),
        a[1] + t * (b[1] - a[1]),
        a[2] + t * (b[2] - a[2]),
    ];
}

function vertexKey(v) {
    return `${roundCoord(v[0])},${roundCoord(v[1])},${roundCoord(v[2])}`;
}

function clipPolygonByHalfSpace(polygon, hs) {
    if (polygon.length < 3) return { polygon: [], crossings: [] };

    const output = [];
    const crossings = [];

    for (let i = 0; i < polygon.length; i++) {
        const cur = polygon[i];
        const prev = polygon[(i - 1 + polygon.length) % polygon.length];
        const curIn = isInsideHalfSpace(hs, cur);
        const prevIn = isInsideHalfSpace(hs, prev);

        if (prevIn && curIn) {
            output.push(cur);
        } else if (prevIn && !curIn) {
            const hit = intersectEdgeHalfSpace(prev, cur, hs);
            output.push(hit);
            crossings.push(hit);
        } else if (!prevIn && curIn) {
            const hit = intersectEdgeHalfSpace(prev, cur, hs);
            output.push(hit);
            crossings.push(hit);
            output.push(cur);
        }
    }

    return { polygon: output, crossings };
}

function makeBoxPolyhedron(halfSize) {
    const h = halfSize;
    const vertices = [
        [-h, -h, -h],
        [h, -h, -h],
        [h, h, -h],
        [-h, h, -h],
        [-h, -h, h],
        [h, -h, h],
        [h, h, h],
        [-h, h, h],
    ];
    const faces = [
        [0, 1, 2, 3],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [2, 3, 7, 6],
        [0, 3, 7, 4],
        [1, 2, 6, 5],
    ];
    return { vertices, faces };
}

function dedupePoints(points) {
    const seen = new Set();
    const unique = [];
    for (const p of points) {
        const key = vertexKey(p);
        if (seen.has(key)) continue;
        seen.add(key);
        unique.push(p);
    }
    return unique;
}

function orderCapVertices(points, hs) {
    const unique = dedupePoints(points);
    if (unique.length < 3) return unique;

    const normal = normalize3([hs.nx, hs.ny, hs.nz]);
    let ref = [1, 0, 0];
    if (Math.abs(dot3(ref, normal)) > 0.9) ref = [0, 1, 0];

    const tangent = normalize3(cross3(ref, normal));
    const bitangent = cross3(normal, tangent);

    const cx = unique.reduce((s, p) => s + p[0], 0) / unique.length;
    const cy = unique.reduce((s, p) => s + p[1], 0) / unique.length;
    const cz = unique.reduce((s, p) => s + p[2], 0) / unique.length;

    return unique
        .map((p) => {
            const dx = p[0] - cx;
            const dy = p[1] - cy;
            const dz = p[2] - cz;
            const u = dot3([dx, dy, dz], tangent);
            const v = dot3([dx, dy, dz], bitangent);
            return { p, angle: Math.atan2(v, u) };
        })
        .sort((a, b) => a.angle - b.angle)
        .map((entry) => entry.p);
}

function clipPolyhedron(polyhedron, hs) {
    const vertices = [];
    const indexFor = new Map();

    const getIndex = (v) => {
        const key = vertexKey(v);
        if (indexFor.has(key)) return indexFor.get(key);
        const idx = vertices.length;
        vertices.push(v);
        indexFor.set(key, idx);
        return idx;
    };

    const newFaces = [];
    const capPoints = [];

    for (const face of polyhedron.faces) {
        const polygon = face.map((i) => polyhedron.vertices[i]);
        const { polygon: clipped, crossings } = clipPolygonByHalfSpace(polygon, hs);
        capPoints.push(...crossings);
        if (clipped.length < 3) continue;
        newFaces.push(clipped.map(getIndex));
    }

    const capPolygon = orderCapVertices(capPoints, hs);
    if (capPolygon.length >= 3) {
        newFaces.push(capPolygon.map(getIndex));
    }

    return { vertices, faces: newFaces };
}

function extractPolyhedronEdges(polyhedron) {
    const edges = [];
    const seen = new Set();

    for (const face of polyhedron.faces) {
        for (let i = 0; i < face.length; i++) {
            const a = face[i];
            const b = face[(i + 1) % face.length];
            const lo = Math.min(a, b);
            const hi = Math.max(a, b);
            const key = `${lo}|${hi}`;
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push([polyhedron.vertices[a], polyhedron.vertices[b]]);
        }
    }

    return edges;
}

export function edgeKey3d(a, b) {
    const ax = roundCoord(a[0]);
    const ay = roundCoord(a[1]);
    const az = roundCoord(a[2]);
    const bx = roundCoord(b[0]);
    const by = roundCoord(b[1]);
    const bz = roundCoord(b[2]);

    if (ax < bx || (ax === bx && ay < by) || (ax === bx && ay === by && az <= bz)) {
        return `${ax},${ay},${az}|${bx},${by},${bz}`;
    }
    return `${bx},${by},${bz}|${ax},${ay},${az}`;
}

function computeCellPolyhedron(siteIndex, sites, halfSize) {
    let polyhedron = makeBoxPolyhedron(halfSize);

    for (let j = 0; j < sites.length; j++) {
        if (j === siteIndex) continue;
        polyhedron = clipPolyhedron(polyhedron, bisectorHalfSpace(sites[siteIndex], sites[j]));
        if (polyhedron.faces.length === 0) return null;
    }

    return polyhedron;
}

function polyhedronCentroid(polyhedron) {
    const verts = polyhedron.vertices;
    if (verts.length === 0) return [0, 0, 0];

    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const v of verts) {
        sx += v[0];
        sy += v[1];
        sz += v[2];
    }
    const n = verts.length;
    return [sx / n, sy / n, sz / n];
}

/**
 * Per-cell 3D Voronoi geometry for exploded views.
 * Returns one entry per site (null when the clipped cell is empty).
 */
export function voronoi3dCells(sites, halfSize) {
    if (sites.length === 0) return [];

    if (sites.length === 1) {
        const polyhedron = makeBoxPolyhedron(halfSize);
        return [{
            centroid: polyhedronCentroid(polyhedron),
            edges: extractPolyhedronEdges(polyhedron).map(([a, b]) => [
                a[0], a[1], a[2], b[0], b[1], b[2],
            ]),
        }];
    }

    const cells = [];
    for (let i = 0; i < sites.length; i++) {
        const polyhedron = computeCellPolyhedron(i, sites, halfSize);
        if (!polyhedron) {
            cells.push(null);
            continue;
        }

        cells.push({
            centroid: polyhedronCentroid(polyhedron),
            edges: extractPolyhedronEdges(polyhedron).map(([a, b]) => [
                a[0], a[1], a[2], b[0], b[1], b[2],
            ]),
        });
    }

    return cells;
}

/**
 * Euclidean 3D Voronoi edges clipped to an axis-aligned cube [-h,h]^3.
 * Returns [[ax,ay,az,bx,by,bz], ...] in world-local coordinates.
 */
export function voronoi3dEdges(sites, halfSize) {
    if (sites.length === 0) return [];
    if (sites.length === 1) {
        const polyhedron = makeBoxPolyhedron(halfSize);
        return extractPolyhedronEdges(polyhedron).map(([a, b]) => [
            a[0], a[1], a[2], b[0], b[1], b[2],
        ]);
    }

    const edgeMap = new Map();

    for (let i = 0; i < sites.length; i++) {
        const polyhedron = computeCellPolyhedron(i, sites, halfSize);
        if (!polyhedron) continue;

        const cellEdges = extractPolyhedronEdges(polyhedron);
        for (const [a, b] of cellEdges) {
            const key = edgeKey3d(a, b);
            if (!edgeMap.has(key)) {
                edgeMap.set(key, [a[0], a[1], a[2], b[0], b[1], b[2]]);
            }
        }
    }

    return [...edgeMap.values()];
}

export function euclideanDistance3d(x, y, z, px, py, pz) {
    const dx = px - x;
    const dy = py - y;
    const dz = pz - z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
