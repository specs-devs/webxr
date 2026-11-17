import { generateL1Voronoi } from 'manhattan-voronoi/src/voronoi.js';

const EPS = 1e-9;

export function manhattanDistance(x, y, px, py) {
    return Math.abs(x - px) + Math.abs(y - py);
}

/** Lower index wins when Manhattan distances tie. */
export function compareManhattanSites(x, y, siteA, indexA, siteB, indexB) {
    const distA = manhattanDistance(x, y, siteA.x, siteA.y);
    const distB = manhattanDistance(x, y, siteB.x, siteB.y);
    if (distA < distB - EPS) return -1;
    if (distA > distB + EPS) return 1;
    return indexA < indexB ? -1 : indexA > indexB ? 1 : 0;
}

function snapCoord(value) {
    return Math.round(value * 1e5) / 1e5;
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

function boundaryEdges(halfSize) {
    const h = halfSize;
    return [
        [-h, -h, h, -h],
        [h, -h, h, h],
        [h, h, -h, h],
        [-h, h, -h, -h],
    ];
}

function toLibraryPoints(points, halfSize) {
    return points.map((p) => [p.x + halfSize, p.y + halfSize]);
}

/** Collect unique wireframe edges from L1 Voronoi cells plus the outer frame. */
export function manhattanVoronoiEdges(points, halfSize) {
    const edges = [];
    const seen = new Set();

    const addEdge = (ax, ay, bx, by) => {
        ax = snapCoord(ax);
        ay = snapCoord(ay);
        bx = snapCoord(bx);
        by = snapCoord(by);

        const dx = bx - ax;
        const dy = by - ay;
        if (dx * dx + dy * dy < 1e-12) return;

        const key = edgeKey(ax, ay, bx, by);
        if (seen.has(key)) return;
        seen.add(key);
        edges.push([ax, ay, bx, by]);
    };

    for (const [ax, ay, bx, by] of boundaryEdges(halfSize)) {
        addEdge(ax, ay, bx, by);
    }

    if (points.length < 2) return edges;

    const planeSize = halfSize * 2;
    const libPoints = toLibraryPoints(points, halfSize);
    const cells = generateL1Voronoi(libPoints.slice(), planeSize, planeSize, true);

    for (let i = 0; i < cells.length; i++) {
        const polygon = cells[i].polygonPoints;
        if (!polygon || polygon.length < 2) continue;

        for (let j = 0; j < polygon.length; j++) {
            const a = polygon[j];
            const b = polygon[(j + 1) % polygon.length];
            addEdge(a[0] - halfSize, a[1] - halfSize, b[0] - halfSize, b[1] - halfSize);
        }
    }

    return edges;
}
