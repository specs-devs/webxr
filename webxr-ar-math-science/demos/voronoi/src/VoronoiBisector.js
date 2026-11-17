const EPS = 1e-4;

function distSq2d(x, y, site) {
    const dx = x - site.x;
    const dy = y - site.y;
    return dx * dx + dy * dy;
}

function distSq3d(x, y, z, site) {
    const dx = x - site.x;
    const dy = y - site.y;
    const dz = z - (site.z ?? 0);
    return dx * dx + dy * dy + dz * dz;
}

function manhattanDist(x, y, site) {
    return Math.abs(x - site.x) + Math.abs(y - site.y);
}

/**
 * True when the segment lies on the L1 bisector between two sites (shared Manhattan Voronoi edge).
 * When sites nearly coincide, |dA−dB| is tiny everywhere, so the equidistance test would match
 * the whole diagram — bail out and leave edge fading to the merge-circle highlight only.
 */
export function isEdgeBetweenSitesManhattan(ax, ay, bx, by, siteA, siteB, epsilon = EPS) {
    const siteDist = manhattanDist(siteA.x, siteA.y, siteB);
    // |d(p,A)−d(p,B)| ≤ siteDist for every p; below this, every edge looks "shared".
    if (siteDist < epsilon * 10) return false;

    const eps = Math.min(epsilon, siteDist * 0.05);
    const onBisector = (x, y) => (
        Math.abs(manhattanDist(x, y, siteA) - manhattanDist(x, y, siteB)) < eps
    );

    return onBisector(ax, ay)
        && onBisector(bx, by)
        && onBisector((ax + bx) * 0.5, (ay + by) * 0.5);
}

/** True when the segment lies on the perpendicular bisector between two sites (shared Voronoi edge). */
export function isEdgeBetweenSites2D(ax, ay, bx, by, siteA, siteB, epsilon = EPS) {
    const dAi = distSq2d(ax, ay, siteA);
    const dAj = distSq2d(ax, ay, siteB);
    const dBi = distSq2d(bx, by, siteA);
    const dBj = distSq2d(bx, by, siteB);
    return Math.abs(dAi - dAj) < epsilon && Math.abs(dBi - dBj) < epsilon;
}

export function isEdgeBetweenSites3D(ax, ay, az, bx, by, bz, siteA, siteB, epsilon = EPS) {
    const dAi = distSq3d(ax, ay, az, siteA);
    const dAj = distSq3d(ax, ay, az, siteB);
    const dBi = distSq3d(bx, by, bz, siteA);
    const dBj = distSq3d(bx, by, bz, siteB);
    return Math.abs(dAi - dAj) < epsilon && Math.abs(dBi - dBj) < epsilon;
}

/** fade 0 = full opacity, 1 = invisible — binary within/outside merge threshold */
export function mergeProximityFade(distance, threshold) {
    if (threshold <= 0) return 0;
    return distance <= threshold ? 1 : 0;
}
