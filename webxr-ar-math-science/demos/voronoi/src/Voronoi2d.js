import { Delaunay } from 'd3-delaunay';

const ROUND = 1e5;

function edgeKey2d(ax, ay, bx, by) {
    const axr = Math.round(ax * ROUND);
    const ayr = Math.round(ay * ROUND);
    const bxr = Math.round(bx * ROUND);
    const byr = Math.round(by * ROUND);
    if (axr < bxr || (axr === bxr && ayr <= byr)) {
        return `${axr},${ayr}|${bxr},${byr}`;
    }
    return `${bxr},${byr}|${axr},${ayr}`;
}

function boxBoundaryEdges2d(halfSize) {
    const h = halfSize;
    return [
        [-h, -h, h, -h],
        [h, -h, h, h],
        [h, h, -h, h],
        [-h, h, -h, -h],
    ];
}

/**
 * Proper Euclidean 2D Voronoi edges from site XY positions, clipped to the square bounds.
 * Returns [[ax, ay, bx, by], ...]
 */
export function voronoi2dEdges(points, halfSize) {
    if (points.length < 2) {
        return boxBoundaryEdges2d(halfSize);
    }

    const h = halfSize;
    const delaunay = Delaunay.from(points, (p) => p.x, (p) => p.y);
    const voronoi = delaunay.voronoi([-h, -h, h, h]);
    const edges = [];
    const seen = new Set();

    for (let i = 0; i < points.length; i++) {
        const polygon = voronoi.cellPolygon(i);
        if (!polygon) continue;

        for (let j = 0; j < polygon.length; j++) {
            const a = polygon[j];
            const b = polygon[(j + 1) % polygon.length];
            const key = edgeKey2d(a[0], a[1], b[0], b[1]);
            if (seen.has(key)) continue;
            seen.add(key);
            edges.push([a[0], a[1], b[0], b[1]]);
        }
    }

    return edges;
}

/**
 * Euclidean 2D Delaunay edges (site-to-site), including convex-hull edges.
 * Returns [[ax, ay, bx, by], ...]
 */
export function delaunay2dEdges(points) {
    if (points.length < 2) return [];

    const delaunay = Delaunay.from(points, (p) => p.x, (p) => p.y);
    const { halfedges, triangles, hull } = delaunay;
    const edges = [];
    const seen = new Set();

    const addEdge = (ti, tj) => {
        const ax = points[ti].x;
        const ay = points[ti].y;
        const bx = points[tj].x;
        const by = points[tj].y;
        const key = edgeKey2d(ax, ay, bx, by);
        if (seen.has(key)) return;
        seen.add(key);
        edges.push([ax, ay, bx, by]);
    };

    for (let i = 0, n = halfedges.length; i < n; ++i) {
        const j = halfedges[i];
        if (j < i) continue;
        addEdge(triangles[i], triangles[j]);
    }

    for (let i = 0, n = hull.length; i < n; ++i) {
        addEdge(hull[i], hull[(i + 1) % n]);
    }

    return edges;
}
