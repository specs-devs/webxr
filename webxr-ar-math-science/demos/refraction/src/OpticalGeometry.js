import * as THREE from 'three';

export const LENS_RENDER_CURVE_SEGMENTS = 48;
export const LENS_EDGE_CAGE_SEGMENTS = 8;
export const AR_POINTER_CYLINDER_SEGMENTS = 12;
export const AR_ROUNDED_BOX_SEGMENTS = 1;

export function makeTriangularPrism(radius, height) {
    const g = new THREE.CylinderGeometry(radius, radius, height, 3);
    g.rotateY(Math.PI / 6);
    g.rotateX(Math.PI / 2);
    g.rotateZ(-Math.PI / 2);
    g.translate(0, -radius / 4, 0);
    return g;
}

export function makeTrapezoidPrismGeometry(bottomW, topW, height, depth) {
    const shape = new THREE.Shape();
    const hb = bottomW / 2;
    const ht = topW / 2;
    const hh = height / 2;
    shape.moveTo(-hb, -hh);
    shape.lineTo(hb, -hh);
    shape.lineTo(ht, hh);
    shape.lineTo(-ht, hh);
    shape.lineTo(-hb, -hh);
    const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
    geom.translate(0, 0, -depth / 2);
    return geom;
}

export function makeCylindricalBiconvexGeometry(height, maxThick, lensWidth, curveSegments = LENS_RENDER_CURVE_SEGMENTS) {
    const shape = new THREE.Shape();
    const hh = height / 2;
    const ht = maxThick / 2;
    shape.moveTo(0, -hh);
    shape.quadraticCurveTo( ht, 0,  0,  hh);
    shape.quadraticCurveTo(-ht, 0,  0, -hh);
    const geom = new THREE.ExtrudeGeometry(shape, { depth: lensWidth, bevelEnabled: false, curveSegments });
    geom.translate(0, 0, -lensWidth / 2);
    return geom;
}

export function makeCylindricalPlanoConvexGeometry(height, maxThick, lensWidth, curveSegments = LENS_RENDER_CURVE_SEGMENTS) {
    const shape = new THREE.Shape();
    const hh = height / 2;
    const ht = maxThick / 2;
    shape.moveTo(0, -hh);
    shape.quadraticCurveTo(ht, 0, 0, hh);
    shape.lineTo(0, -hh);
    const geom = new THREE.ExtrudeGeometry(shape, { depth: lensWidth, bevelEnabled: false, curveSegments });
    geom.translate(0, 0, -lensWidth / 2);
    return geom;
}

export function makeCylindricalPlanoConcaveGeometry(height, rimThick, waistThick, lensWidth, curveSegments = LENS_RENDER_CURVE_SEGMENTS) {
    const shape = new THREE.Shape();
    const hh  = height    / 2;
    const hrt = rimThick  / 2;
    const hwt = waistThick / 2;
    shape.moveTo( hrt, -hh);
    shape.quadraticCurveTo( hwt, 0,  hrt,  hh);
    shape.lineTo(-hrt,  hh);
    shape.lineTo(-hrt, -hh);
    shape.lineTo( hrt, -hh);
    const geom = new THREE.ExtrudeGeometry(shape, { depth: lensWidth, bevelEnabled: false, curveSegments });
    geom.translate(0, 0, -lensWidth / 2);
    return geom;
}

export function makeCylindricalMeniscusGeometry(height, edgeThick, sag1, sag2, lensWidth, curveSegments = LENS_RENDER_CURVE_SEGMENTS) {
    const shape = new THREE.Shape();
    const hh  = height    / 2;
    const het = edgeThick / 2;
    const rightEdgeX = het;
    const leftEdgeX  = -het;
    shape.moveTo(rightEdgeX, -hh);
    shape.quadraticCurveTo(rightEdgeX + 2 * sag1, 0, rightEdgeX, hh);
    if (het > 0) shape.lineTo(leftEdgeX, hh);
    shape.quadraticCurveTo(leftEdgeX + 2 * sag2, 0, leftEdgeX, -hh);
    if (het > 0) shape.lineTo(rightEdgeX, -hh);
    const geom = new THREE.ExtrudeGeometry(shape, { depth: lensWidth, bevelEnabled: false, curveSegments });
    geom.translate(0, 0, -lensWidth / 2);
    return geom;
}

export function makeHalfCylinderGeometry(radius, depth, curveSegments = LENS_RENDER_CURVE_SEGMENTS) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -radius);
    shape.absarc(0, 0, radius, -Math.PI / 2, Math.PI / 2, false);
    shape.lineTo(0, -radius);
    const geom = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
    geom.translate(-radius / 2, 0, -depth / 2);
    return geom;
}

export function makeCylindricalBiconcaveGeometry(height, rimThick, waistThick, lensWidth, curveSegments = LENS_RENDER_CURVE_SEGMENTS) {
    const shape = new THREE.Shape();
    const hh  = height    / 2;
    const hrt = rimThick  / 2;
    const hwt = waistThick / 2;
    shape.moveTo( hrt, -hh);
    shape.quadraticCurveTo( hwt, 0,  hrt,  hh);
    shape.lineTo(-hrt,  hh);
    shape.quadraticCurveTo(-hwt, 0, -hrt, -hh);
    shape.lineTo( hrt, -hh);
    const geom = new THREE.ExtrudeGeometry(shape, { depth: lensWidth, bevelEnabled: false, curveSegments });
    geom.translate(0, 0, -lensWidth / 2);
    return geom;
}
