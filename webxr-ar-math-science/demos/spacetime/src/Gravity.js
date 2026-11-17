import * as THREE from 'three';
import gsap from 'gsap';
export function createGravity(deps) {
    const { scene, camera, renderer, containerGroup, containerConfig, GRID_EXTENT_MULTIPLIER } = deps;

const SUN_MASS = 10.0;
const PLANET_MASS = 3.5;
const MOON_MASS = 1.5;
const SUN_BEND_FACTOR = 0.70;
const SUN_BEND_MASS = SUN_MASS * SUN_BEND_FACTOR;
const SOFTENING = 1.6;
const GRID_SEGS = 30;
const ORBIT_BASE_CONST = 0.025;
const ORBIT_SPEED_MULTIPLIER = 0.8;
const HILL_SPHERE_FACTOR = 0.95;
const HILL_SWITCH_OUT_MULTIPLIER = 1.08;
const HILL_SWITCH_IN_MULTIPLIER = 0.92;
const MOON_MODE_BLEND_SPEED = 2.8;
const SUN_SELF_BLEND = 0.95;
const SUN_RECENTER_LERP = 0.12;
const BODY_EDGE_RETURN_LERP = 0.16;
// Comets now share the displayed Plummer field (see computeCometAccelerationAt).
// The unified field is ~2× stronger at flyby distances than the prior tuned
// Cauchy-core field, and escape velocity at the spawn radius is ~0.225, so the
// spawn speeds below are picked to straddle that threshold — most comets are
// slightly bound (do a partial loop) and the fastest are clearly hyperbolic
// (clean single-arc flyby). Mix gives variety and demonstrates real orbital
// behavior on the field the viewer sees.
const COMET_SPEED_CAP = 0.45;
const COMET_MAX_COUNT = 12;
const COMET_INIT_MIN_SPEED = 0.20;
const COMET_INIT_MAX_SPEED = 0.32;
const COMET_TRAIL_POINTS = 65;
const COMET_TRAIL_MESH_UPDATE_INTERVAL = 2;
const COMET_TRAIL_HALF_WIDTH = 0.003;
const COMET_TRAIL_TAIL_WIDTH_SCALE = 0.18;
const COMET_FADE_IN_SECONDS = 0.45;
const COMET_FADE_OUT_SECONDS = 0.35;
const COMET_TRAIL_OPACITY = 0.7;
// Vertical lift above the analytic surface so comets sit clear of the grid mesh.
const COMET_Y_SURFACE_OFFSET = 0.025;
const GRAVITY_CONTOUR_LEVEL_COUNT = 7;
const GRAVITY_CONTOUR_MIN_T = 0.16;
const GRAVITY_CONTOUR_MAX_T = 0.82;
const GRAVITY_CONTOUR_Y_OFFSET = 0.0016;
const GRAVITY_CONTOUR_OPACITY = 1.0;
const GRAVITY_CONTOUR_COLOR = 0xffffff;

// Let the grid extend beyond the container bounds.
const GRID_PHYS = containerConfig.containerSize * GRID_EXTENT_MULTIPLIER;
const GRID_HALF = GRID_PHYS / 2;
const GRID_STEP = GRID_PHYS / GRID_SEGS;
const COMET_SPAWN_RADIUS = GRID_HALF * 1.2;
const COMET_FADE_OUT_START_RADIUS = GRID_HALF * 1.2;
const COMET_DESPAWN_RADIUS = GRID_HALF * 2.2;

// Keep well/planet scale tied to the base container footprint so increasing
// grid extent only expands field coverage (not center depth/planet size).
const BASE_CONTAINER_HALF = containerConfig.containerSize / 2;
const NORM = 5 / BASE_CONTAINER_HALF;

// Resize container frame so its footprint matches the grid footprint.

function gravityY(x, z) {
    const xn = x * NORM;
    const zn = z * NORM;
    return -SUN_BEND_MASS / Math.sqrt(xn * xn + zn * zn + SOFTENING * SOFTENING) / NORM;
}

function gravityYWithMass(x, z, mass) {
    const xn = x * NORM;
    const zn = z * NORM;
    return -mass / Math.sqrt(xn * xn + zn * zn + SOFTENING * SOFTENING) / NORM;
}

function gravityYAt(x, z, centerX, centerZ, mass = SUN_BEND_MASS) {
    return gravityYWithMass(x - centerX, z - centerZ, mass);
}

// Build square-grid LineSegments — only horizontal and vertical edges,
// no triangle diagonals.
const GRID_NODE_AXIS = GRID_SEGS + 1;

function getGridNodeIndex(row, col) {
    return row * GRID_NODE_AXIS + col;
}

const gridVerts = [];
const gridVertexNodeIndices = [];

for (let row = 0; row <= GRID_SEGS; row++) {
    const z = -GRID_HALF + row * GRID_STEP;
    for (let col = 0; col < GRID_SEGS; col++) {
        const x0 = -GRID_HALF + col * GRID_STEP;
        const x1 = x0 + GRID_STEP;
        gridVerts.push(x0, gravityY(x0, z), z,
                       x1, gravityY(x1, z), z);
        gridVertexNodeIndices.push(
            getGridNodeIndex(row, col),
            getGridNodeIndex(row, col + 1)
        );
    }
}

for (let col = 0; col <= GRID_SEGS; col++) {
    const x = -GRID_HALF + col * GRID_STEP;
    for (let row = 0; row < GRID_SEGS; row++) {
        const z0 = -GRID_HALF + row * GRID_STEP;
        const z1 = z0 + GRID_STEP;
        gridVerts.push(x, gravityY(x, z0), z0,
                       x, gravityY(x, z1), z1);
        gridVertexNodeIndices.push(
            getGridNodeIndex(row, col),
            getGridNodeIndex(row + 1, col)
        );
    }
}

const gridGeo = new THREE.BufferGeometry();
gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridVerts, 3));
const gridVertexNodeIndexArray = new Uint16Array(gridVertexNodeIndices);
const GRID_OPACITY_WITH_FORCE_FIELD = 0.7;
const gridMat = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false
});
const gravityGrid = new THREE.LineSegments(gridGeo, gridMat);
containerGroup.add(gravityGrid);
const gravityContourMaxVertexCount = GRID_SEGS * GRID_SEGS * GRAVITY_CONTOUR_LEVEL_COUNT * 4;
const gravityContourPositions = new Float32Array(gravityContourMaxVertexCount * 3);
const gravityContourAttr = new THREE.BufferAttribute(gravityContourPositions, 3);
gravityContourAttr.setUsage(THREE.DynamicDrawUsage);
const gravityContourGeo = new THREE.BufferGeometry();
gravityContourGeo.setAttribute('position', gravityContourAttr);
gravityContourGeo.setDrawRange(0, 0);
const gravityContourMat = new THREE.LineBasicMaterial({
    color: GRAVITY_CONTOUR_COLOR,
    transparent: true,
    opacity: GRAVITY_CONTOUR_OPACITY,
    depthWrite: false
});
const gravityContours = new THREE.LineSegments(gravityContourGeo, gravityContourMat);
gravityContours.frustumCulled = false;
gravityContours.renderOrder = 1;
containerGroup.add(gravityContours);
const gravityContourBorderPositions = new Float32Array(GRID_SEGS * 4 * 3);
const gravityContourBorderAttr = new THREE.BufferAttribute(gravityContourBorderPositions, 3);
gravityContourBorderAttr.setUsage(THREE.DynamicDrawUsage);
const gravityContourBorderGeo = new THREE.BufferGeometry();
gravityContourBorderGeo.setAttribute('position', gravityContourBorderAttr);
gravityContourBorderGeo.setDrawRange(0, GRID_SEGS * 4);
const gravityContourBorder = new THREE.LineLoop(gravityContourBorderGeo, gravityContourMat);
gravityContourBorder.frustumCulled = false;
gravityContourBorder.renderOrder = 1;
containerGroup.add(gravityContourBorder);
const gravityViewState = {
    mode: 'grid' // 'grid' | 'contour'
};

// ==========================================
// FIELD ARROW LAYER (L1: make the field visible)
// ==========================================
// At each subsampled grid intersection, draw a small camera-facing arrow
// glyph (thin shaft + triangular head) pointing in the direction of −∇Φ
// (downhill on the surface). Length ∝ slope with tanh saturation so arrows
// near a body don't blow up. Each vertex sits on the surface (with a small
// Y lift) so the arrow hugs the bowl. Mesh-based instead of lines because
// 1-pixel LineSegments are invisible at grazing angles.
const FIELD_ARROW_STEP = 2; // sample every Nth grid node
const FIELD_ARROW_NUM_PER_AXIS = Math.floor(GRID_SEGS / FIELD_ARROW_STEP) + 1;
const FIELD_ARROW_COUNT = FIELD_ARROW_NUM_PER_AXIS * FIELD_ARROW_NUM_PER_AXIS;
const FIELD_ARROW_MAX_LENGTH = GRID_STEP * 1.25;   // 1.2× the prior size
const FIELD_ARROW_MIN_LENGTH = GRID_STEP * 1.0;   // raised floor — weak-field arrows
                                                    // are pulled closer to the strong ones
                                                    // so the field reads as a uniform grid
const FIELD_ARROW_TANH_SCALE = 1.6;
const FIELD_ARROW_Y_LIFT = 0.006;
const FIELD_ARROW_HEAD_RATIO = 0.40;        // head length / total length
const FIELD_ARROW_HEAD_HALF_WIDTH = 0.22;   // arrowhead half-width / total length
const FIELD_ARROW_SHAFT_HALF_WIDTH = 0.06;  // shaft half-width / total length
const FIELD_ARROW_COLOR = 0xffff00;         // white

// 3 triangles per arrow (shaft = 2 tris, head = 1 tri) → 9 vertices each.
const FIELD_ARROW_VERTS_PER = 9;
const fieldArrowPositions = new Float32Array(FIELD_ARROW_COUNT * FIELD_ARROW_VERTS_PER * 3);

const fieldArrowGeo = new THREE.BufferGeometry();
const fieldArrowPositionAttr = new THREE.BufferAttribute(fieldArrowPositions, 3);
fieldArrowPositionAttr.setUsage(THREE.DynamicDrawUsage);
fieldArrowGeo.setAttribute('position', fieldArrowPositionAttr);
fieldArrowGeo.setDrawRange(0, 0);
const fieldArrowMat = new THREE.MeshBasicMaterial({
    color: FIELD_ARROW_COLOR,
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide,
    depthWrite: false
});
const fieldArrows = new THREE.Mesh(fieldArrowGeo, fieldArrowMat);
fieldArrows.frustumCulled = false;
fieldArrows.renderOrder = 2;
containerGroup.add(fieldArrows);
fieldArrows.visible = false;

const fieldArrowState = {
    visible: false
};

const _fieldDownhill = new THREE.Vector2();
const _fieldCameraWorld = new THREE.Vector3();
const _fieldCameraLocal = new THREE.Vector3();

// Gradient of the displayed surface y(x,z) = gravityYTotalAt(x,z), projected
// to xz, sign flipped to point downhill. Uses the same NORM/SOFTENING the
// grid uses, so arrows are *literally* the local slope of the rubber sheet.
function surfaceDownhillAt(x, z, out) {
    out.set(0, 0);
    const SOFT2 = SOFTENING * SOFTENING;
    const addBody = (cx, cz, mass) => {
        const dx = x - cx;
        const dz = z - cz;
        const D2 = NORM * NORM * (dx * dx + dz * dz) + SOFT2;
        const D3 = Math.pow(D2, 1.5);
        const coeff = -mass * NORM / D3; // sign so result points toward body
        out.x += coeff * dx;
        out.y += coeff * dz;
    };
    addBody(sun.position.x, sun.position.z, SUN_BEND_MASS);
    addBody(planet.position.x, planet.position.z, PLANET_MASS);
    addBody(moon.position.x, moon.position.z, MOON_MASS);
}

function updateFieldArrows() {
    if (!fieldArrows.visible) {
        return;
    }

    const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
    activeCamera.getWorldPosition(_fieldCameraWorld);
    _fieldCameraLocal.copy(_fieldCameraWorld);
    containerGroup.worldToLocal(_fieldCameraLocal);

    const positions = fieldArrowPositions;
    let writeIndex = 0;
    let usedArrows = 0;
    for (let row = 0; row <= GRID_SEGS; row += FIELD_ARROW_STEP) {
        const tailX0 = -GRID_HALF;
        const tailZ = -GRID_HALF + row * GRID_STEP;
        for (let col = 0; col <= GRID_SEGS; col += FIELD_ARROW_STEP) {
            const tailX = tailX0 + col * GRID_STEP;
            surfaceDownhillAt(tailX, tailZ, _fieldDownhill);
            const magnitude = Math.hypot(_fieldDownhill.x, _fieldDownhill.y);
            if (magnitude < 1e-5) {
                continue;
            }
            // Clamp to a floor instead of culling: every cell with a nonzero
            // gradient gets an arrow, so the field has no apparent holes.
            let visualLen = FIELD_ARROW_MAX_LENGTH * Math.tanh(magnitude * FIELD_ARROW_TANH_SCALE);
            if (visualLen < FIELD_ARROW_MIN_LENGTH) {
                visualLen = FIELD_ARROW_MIN_LENGTH;
            }
            const dirX = _fieldDownhill.x / magnitude;
            const dirZ = _fieldDownhill.y / magnitude;
            const shaftLen = visualLen * (1 - FIELD_ARROW_HEAD_RATIO);
            const tipX = tailX + dirX * visualLen;
            const tipZ = tailZ + dirZ * visualLen;
            const neckX = tailX + dirX * shaftLen;
            const neckZ = tailZ + dirZ * shaftLen;
            const tailY = gravityYTotalAt(tailX, tailZ) + FIELD_ARROW_Y_LIFT;
            const tipY = gravityYTotalAt(tipX, tipZ) + FIELD_ARROW_Y_LIFT;
            const neckY = gravityYTotalAt(neckX, neckZ) + FIELD_ARROW_Y_LIFT;

            // Camera-facing "right" axis perpendicular to the arrow tangent
            // in the surface plane, computed at the arrow midpoint. Cross
            // product of arrow tangent with (camera - midpoint).
            const midX = (tailX + tipX) * 0.5;
            const midZ = (tailZ + tipZ) * 0.5;
            const midY = (tailY + tipY) * 0.5;
            const toCamX = _fieldCameraLocal.x - midX;
            const toCamY = _fieldCameraLocal.y - midY;
            const toCamZ = _fieldCameraLocal.z - midZ;
            const slope = (tipY - tailY) / Math.max(visualLen, 1e-6);
            const tanX = dirX;
            const tanY = slope;
            const tanZ = dirZ;
            let rX = tanY * toCamZ - tanZ * toCamY;
            let rY = tanZ * toCamX - tanX * toCamZ;
            let rZ = tanX * toCamY - tanY * toCamX;
            const rLen = Math.hypot(rX, rY, rZ);
            if (rLen < 1e-6) {
                rX = -dirZ; rY = 0; rZ = dirX;
            } else {
                rX /= rLen; rY /= rLen; rZ /= rLen;
            }

            const shaftHW = visualLen * FIELD_ARROW_SHAFT_HALF_WIDTH;
            const headHW = visualLen * FIELD_ARROW_HEAD_HALF_WIDTH;

            // Tail edge of shaft
            const tailLX = tailX + rX * shaftHW;
            const tailLY = tailY + rY * shaftHW;
            const tailLZ = tailZ + rZ * shaftHW;
            const tailRX = tailX - rX * shaftHW;
            const tailRY = tailY - rY * shaftHW;
            const tailRZ = tailZ - rZ * shaftHW;
            // Neck edge of shaft (where shaft meets arrowhead)
            const neckLX = neckX + rX * shaftHW;
            const neckLY = neckY + rY * shaftHW;
            const neckLZ = neckZ + rZ * shaftHW;
            const neckRX = neckX - rX * shaftHW;
            const neckRY = neckY - rY * shaftHW;
            const neckRZ = neckZ - rZ * shaftHW;
            // Outer corners of the arrowhead (wider than the shaft)
            const headLX = neckX + rX * headHW;
            const headLY = neckY + rY * headHW;
            const headLZ = neckZ + rZ * headHW;
            const headRX = neckX - rX * headHW;
            const headRY = neckY - rY * headHW;
            const headRZ = neckZ - rZ * headHW;

            // Shaft tri 1: tailL, tailR, neckL
            positions[writeIndex++] = tailLX; positions[writeIndex++] = tailLY; positions[writeIndex++] = tailLZ;
            positions[writeIndex++] = tailRX; positions[writeIndex++] = tailRY; positions[writeIndex++] = tailRZ;
            positions[writeIndex++] = neckLX; positions[writeIndex++] = neckLY; positions[writeIndex++] = neckLZ;
            // Shaft tri 2: tailR, neckR, neckL
            positions[writeIndex++] = tailRX; positions[writeIndex++] = tailRY; positions[writeIndex++] = tailRZ;
            positions[writeIndex++] = neckRX; positions[writeIndex++] = neckRY; positions[writeIndex++] = neckRZ;
            positions[writeIndex++] = neckLX; positions[writeIndex++] = neckLY; positions[writeIndex++] = neckLZ;
            // Arrowhead tri: headL, tip, headR
            positions[writeIndex++] = headLX; positions[writeIndex++] = headLY; positions[writeIndex++] = headLZ;
            positions[writeIndex++] = tipX;   positions[writeIndex++] = tipY;   positions[writeIndex++] = tipZ;
            positions[writeIndex++] = headRX; positions[writeIndex++] = headRY; positions[writeIndex++] = headRZ;

            usedArrows++;
        }
    }
    fieldArrowPositionAttr.needsUpdate = true;
    fieldArrowGeo.setDrawRange(0, usedArrows * FIELD_ARROW_VERTS_PER);
}

const GRID_BORDER_Y = gravityY(0, GRID_HALF);

const gridBorderPoints = [
    new THREE.Vector3(-GRID_HALF, GRID_BORDER_Y, -GRID_HALF),
    new THREE.Vector3(GRID_HALF, GRID_BORDER_Y, -GRID_HALF),
    new THREE.Vector3(GRID_HALF, GRID_BORDER_Y, GRID_HALF),
    new THREE.Vector3(-GRID_HALF, GRID_BORDER_Y, GRID_HALF)
];
const gridBorderGeometry = new THREE.BufferGeometry().setFromPoints(gridBorderPoints);
const gridBorderMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    depthWrite: false
});
const gridBorder = new THREE.LineLoop(gridBorderGeometry, gridBorderMaterial);
gridBorder.position.y = -0.26;
containerGroup.add(gridBorder);

// Vertical connectors from base mesh corners (dynamic, follow grid distortion)
// down to the static frame corners. Same line style as the grid.
const BORDER_CONNECTOR_Y = GRID_BORDER_Y + gridBorder.position.y;
const cornerXZ = [
    [-GRID_HALF, -GRID_HALF],
    [ GRID_HALF, -GRID_HALF],
    [ GRID_HALF,  GRID_HALF],
    [-GRID_HALF,  GRID_HALF]
];
const cornerGridNodeIndices = [
    getGridNodeIndex(0, 0),
    getGridNodeIndex(0, GRID_SEGS),
    getGridNodeIndex(GRID_SEGS, GRID_SEGS),
    getGridNodeIndex(GRID_SEGS, 0)
];
const borderConnectorPositions = new Float32Array(cornerXZ.length * 2 * 3);
for (let i = 0; i < cornerXZ.length; i++) {
    const [cx, cz] = cornerXZ[i];
    const base = i * 6;
    borderConnectorPositions[base + 0] = cx;
    borderConnectorPositions[base + 1] = gravityY(cx, cz);
    borderConnectorPositions[base + 2] = cz;
    borderConnectorPositions[base + 3] = cx;
    borderConnectorPositions[base + 4] = BORDER_CONNECTOR_Y;
    borderConnectorPositions[base + 5] = cz;
}
const borderConnectorGeometry = new THREE.BufferGeometry();
borderConnectorGeometry.setAttribute(
    'position',
    new THREE.BufferAttribute(borderConnectorPositions, 3)
);
const borderConnectors = new THREE.LineSegments(borderConnectorGeometry, gridMat);
containerGroup.add(borderConnectors);


function updateBorderConnectors() {
    const arr = borderConnectorPositions;
    for (let i = 0; i < cornerXZ.length; i++) {
        arr[i * 6 + 1] = _gravitySurfaceNodeHeights[cornerGridNodeIndices[i]];
    }
    borderConnectorGeometry.getAttribute('position').needsUpdate = true;
}

// Sun — proportional to well depth, centered in the depression
const wellBottomY = gravityYWithMass(0, 0, SUN_BEND_MASS);
const sunRadius = Math.abs(gravityYWithMass(0, 0, SUN_MASS)) / SUN_MASS * 1.6;
const INITIAL_PLANET_OFFSET_X = 0; //GRID_HALF * 0.4;
const INITIAL_PLANET_OFFSET_Z = GRID_HALF * 0.65;
const INITIAL_MOON_OFFSET_X = GRID_STEP * 2.5;
const INITIAL_MOON_OFFSET_Z = GRID_STEP * 3;
const BODY_SPHERE_SEGMENTS = 16;
const sunGeometry = new THREE.SphereGeometry(sunRadius, BODY_SPHERE_SEGMENTS, BODY_SPHERE_SEGMENTS);
const sunMaterial = new THREE.MeshLambertMaterial({
    color: 0xffd24a,
    emissive: 0xff5a1f,
    emissiveIntensity: 0.55
});
const sun = new THREE.Mesh(sunGeometry, sunMaterial);
sun.position.set(0, wellBottomY + sunRadius, 0);
containerGroup.add(sun);

// Planet: smaller than sun.
const planetRadius = sunRadius * 0.55;
const planetGeometry = new THREE.SphereGeometry(planetRadius, BODY_SPHERE_SEGMENTS, BODY_SPHERE_SEGMENTS);
const planetMaterial = new THREE.MeshLambertMaterial({ color: 0x66aaff });
const planet = new THREE.Mesh(planetGeometry, planetMaterial);
planet.position.set(INITIAL_PLANET_OFFSET_X, wellBottomY + planetRadius, INITIAL_PLANET_OFFSET_Z);
containerGroup.add(planet);

// Moon: smaller than planet.
const moonRadius = planetRadius * 0.55;
const moonGeometry = new THREE.SphereGeometry(moonRadius, BODY_SPHERE_SEGMENTS, BODY_SPHERE_SEGMENTS);
const moonMaterial = new THREE.MeshLambertMaterial({ color: 0xcfcfcf });
const moon = new THREE.Mesh(moonGeometry, moonMaterial);
moon.position.set(
    planet.position.x + INITIAL_MOON_OFFSET_X,
    wellBottomY + moonRadius,
    planet.position.z + INITIAL_MOON_OFFSET_Z
);
containerGroup.add(moon);

function createBodyLabel(text, width = 0.176, height = 0.044, font = '400 72px Helvetica, Arial, sans-serif') {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        return new THREE.Group();
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;

    const material = new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        side: THREE.FrontSide
    });

    const label = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
    label.frustumCulled = false;
    label.renderOrder = 10;
    return label;
}

const sunLabel = createBodyLabel('Sun');
const planetLabel = createBodyLabel('Planet');
const moonLabel = createBodyLabel('Moon');
const spacetimeLabel = createBodyLabel('Spacetime', 0.176 * 1.1, 0.044 * 1.1, '700 79px Helvetica, Arial, sans-serif');
spacetimeLabel.visible = false;
containerGroup.add(sunLabel, planetLabel, moonLabel, spacetimeLabel);

// Same world-space shell offset for every body so the rim matches the planet's
// current look (sun was oversized with a uniform scale; moon undersized).
const EDIT_MODE_BODY_OUTLINE_SCALE_PLANET = 1.09;
const EDIT_MODE_BODY_OUTLINE_GAP = planetRadius * (EDIT_MODE_BODY_OUTLINE_SCALE_PLANET - 1);
const editModeBodyOutlineMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    side: THREE.BackSide,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
});

function attachEditModeBodyOutline(parentMesh, radius) {
    const outlineScale = 1 + EDIT_MODE_BODY_OUTLINE_GAP / radius;
    const outline = new THREE.Mesh(
        new THREE.SphereGeometry(radius * outlineScale, BODY_SPHERE_SEGMENTS, BODY_SPHERE_SEGMENTS),
        editModeBodyOutlineMaterial
    );
    outline.name = 'editModeBodyOutline';
    outline.visible = false;
    outline.frustumCulled = false;
    parentMesh.add(outline);
    return outline;
}

const sunEditOutline = attachEditModeBodyOutline(sun, sunRadius);
const planetEditOutline = attachEditModeBodyOutline(planet, planetRadius);
const moonEditOutline = attachEditModeBodyOutline(moon, moonRadius);

const _labelCameraWorldPos = new THREE.Vector3();
const _labelCameraLocalPos = new THREE.Vector3();
const SPACETIME_LABEL_EDGE_HALF = GRID_PHYS * 0.5;
const SPACETIME_LABEL_EDGE_Y = GRID_PHYS * 0.0;
const SPACETIME_LABEL_UP_OFFSET = 0.0;
const SPACETIME_LABEL_OUTER_OFFSET = 0.02;
const spacetimeLabelEdgeLocalPositions = [
    new THREE.Vector3(0, SPACETIME_LABEL_EDGE_Y, -SPACETIME_LABEL_EDGE_HALF),
    new THREE.Vector3(0, SPACETIME_LABEL_EDGE_Y, SPACETIME_LABEL_EDGE_HALF),
    new THREE.Vector3(-SPACETIME_LABEL_EDGE_HALF, SPACETIME_LABEL_EDGE_Y, 0),
    new THREE.Vector3(SPACETIME_LABEL_EDGE_HALF, SPACETIME_LABEL_EDGE_Y, 0)
];
const spacetimeLabelEdgeNormals = [
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(1, 0, 0)
];
const spacetimeLabelEdgeOutwardDirections = [
    new THREE.Vector3(0, 0, -1),
    new THREE.Vector3(0, 0, 1),
    new THREE.Vector3(-1, 0, 0),
    new THREE.Vector3(1, 0, 0)
];
const _spacetimeLabelEdgePos = new THREE.Vector3();
const _spacetimeLabelBestPos = new THREE.Vector3();
const _spacetimeLabelToCamera = new THREE.Vector3();

function finalizeExitToEditMode() {
    orbitState.mode = 'edit';
    updateGravityVisuals({ force: true });

    for (let i = comets.length - 1; i >= 0; i--) removeCometAt(i);
    cometSpawnAccumulator = 0;
    updateEditVersusOrbitVisuals();
}

function updateLabels() {
    sunLabel.position.set(sun.position.x, sun.position.y + sunRadius + 0.045, sun.position.z);
    planetLabel.position.set(planet.position.x, planet.position.y + planetRadius + 0.035, planet.position.z);
    moonLabel.position.set(moon.position.x, moon.position.y + moonRadius + 0.03, moon.position.z);

    const activeCamera = renderer.xr.isPresenting ? renderer.xr.getCamera(camera) : camera;
    activeCamera.getWorldPosition(_labelCameraWorldPos);
    _labelCameraLocalPos.copy(_labelCameraWorldPos);
    containerGroup.worldToLocal(_labelCameraLocalPos);

    if (spacetimeLabel.visible) {
        let bestEdgeIndex = 0;
        let bestEdgeScore = -Infinity;

        for (let i = 0; i < spacetimeLabelEdgeLocalPositions.length; i++) {
            _spacetimeLabelToCamera.subVectors(_labelCameraLocalPos, spacetimeLabelEdgeLocalPositions[i]).normalize();
            const facingScore = _spacetimeLabelToCamera.dot(spacetimeLabelEdgeNormals[i]);
            const distanceScore = 1 / (_labelCameraLocalPos.distanceTo(spacetimeLabelEdgeLocalPositions[i]) + 0.1);
            const score = facingScore * distanceScore;

            if (facingScore > 0 && score > bestEdgeScore) {
                bestEdgeScore = score;
                bestEdgeIndex = i;
            }
        }

        const oppositeEdgeIndex = bestEdgeIndex === 0 ? 1 : bestEdgeIndex === 1 ? 0 : bestEdgeIndex === 2 ? 3 : 2;

        _spacetimeLabelBestPos.copy(spacetimeLabelEdgeLocalPositions[oppositeEdgeIndex]);
        _spacetimeLabelBestPos
            .addScaledVector(spacetimeLabelEdgeOutwardDirections[oppositeEdgeIndex], SPACETIME_LABEL_OUTER_OFFSET)
            .y += SPACETIME_LABEL_UP_OFFSET;
        spacetimeLabel.position.copy(_spacetimeLabelBestPos);
        const spacetimeLabelDirection = spacetimeLabelEdgeOutwardDirections[oppositeEdgeIndex];
        spacetimeLabel.rotation.set(0, Math.atan2(spacetimeLabelDirection.x, spacetimeLabelDirection.z) + Math.PI, 0);
    }

    for (const label of [sunLabel, planetLabel, moonLabel]) {
        const dx = _labelCameraLocalPos.x - label.position.x;
        const dz = _labelCameraLocalPos.z - label.position.z;
        if (dx !== 0 || dz !== 0) {
            label.rotation.set(0, Math.atan2(dx, dz), 0);
        }
    }

    if (deps.grabPlanetsHint) {
        const dx = _labelCameraLocalPos.x - deps.grabPlanetsHint.position.x;
        const dz = _labelCameraLocalPos.z - deps.grabPlanetsHint.position.z;
        if (dx !== 0 || dz !== 0) {
            deps.grabPlanetsHint.rotation.set(0, Math.atan2(dx, dz), 0);
        }
    }

    const cometHeadR = cometGeometry.parameters.radius;
    for (let ci = 0; ci < comets.length; ci++) {
        const comet = comets[ci];
        if (!comet.label || !comet.label.material) {
            continue;
        }
        const m = comet.mesh.position;
        comet.label.position.set(m.x, m.y + cometHeadR + 0.035, m.z);
        const ldx = _labelCameraLocalPos.x - comet.label.position.x;
        const ldz = _labelCameraLocalPos.z - comet.label.position.z;
        if (ldx !== 0 || ldz !== 0) {
            comet.label.rotation.set(0, Math.atan2(ldx, ldz), 0);
        }
    }
}


const comets = [];
const cometGeometry = new THREE.SphereGeometry(0.0045, 10, 10);
const cometMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1
});
const cometTrailMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: COMET_TRAIL_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false
});
const _cometTrailCameraLocal = new THREE.Vector3();
const _cometTrailPoint = new THREE.Vector3();
const _cometTrailPrevPoint = new THREE.Vector3();
const _cometTrailNextPoint = new THREE.Vector3();
const _cometTrailTangent = new THREE.Vector3();
const _cometTrailToCamera = new THREE.Vector3();
const _cometTrailSide = new THREE.Vector3();
const _cometTrailOffset = new THREE.Vector3();
const _cometTrailLastSide = new THREE.Vector3(1, 0, 0);
const _upVector = new THREE.Vector3(0, 1, 0);

function createCometTrailMesh() {
    const vertexPositions = new Float32Array(COMET_TRAIL_POINTS * 2 * 3);
    const positionAttribute = new THREE.BufferAttribute(vertexPositions, 3);
    positionAttribute.setUsage(THREE.DynamicDrawUsage);

    const indices = new Uint16Array((COMET_TRAIL_POINTS - 1) * 6);
    for (let i = 0; i < COMET_TRAIL_POINTS - 1; i++) {
        const vertexIndex = i * 2;
        const indexOffset = i * 6;
        indices[indexOffset] = vertexIndex;
        indices[indexOffset + 1] = vertexIndex + 1;
        indices[indexOffset + 2] = vertexIndex + 2;
        indices[indexOffset + 3] = vertexIndex + 1;
        indices[indexOffset + 4] = vertexIndex + 3;
        indices[indexOffset + 5] = vertexIndex + 2;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positionAttribute);
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));
    geometry.setDrawRange(0, 0);

    const trailMesh = new THREE.Mesh(geometry, cometTrailMaterial.clone());
    trailMesh.frustumCulled = false;
    trailMesh.visible = false;
    return trailMesh;
}

function getFadeT(elapsed, duration) {
    return THREE.MathUtils.clamp(elapsed / Math.max(duration, 1e-6), 0, 1);
}

function easeCometFade(t) {
    return t * t * (3 - 2 * t);
}

function setCometVisuals(comet, opacityFactor, trailFactor) {
    const clampedOpacity = THREE.MathUtils.clamp(opacityFactor, 0, 1);
    const clampedTrail = THREE.MathUtils.clamp(trailFactor, 0, 1);
    comet.visualOpacity = clampedOpacity;
    comet.visualTrailFactor = clampedTrail;
    comet.mesh.material.opacity = clampedOpacity;
    comet.mesh.visible = clampedOpacity > 0.001;
    comet.trail.material.opacity = COMET_TRAIL_OPACITY * clampedOpacity;
    comet.trailDrawCount = comet.trailPointCount * clampedTrail;
    if (comet.label && comet.label.material) {
        comet.label.material.opacity = clampedOpacity;
        comet.label.visible = clampedOpacity > 0.001;
    }
}

function startCometFadeOut(comet, keepMoving = false) {
    if (comet.dying) {
        return;
    }

    comet.dying = true;
    comet.fadeOutDrift = keepMoving;
    comet.fadeOutElapsed = 0;
    comet.fadeOutStartOpacity = comet.visualOpacity;
    comet.fadeOutStartTrailFactor = comet.visualTrailFactor;
}

function advanceCometMotion(comet, deltaTime) {
    const cx = comet.mesh.position.x;
    const cz = comet.mesh.position.z;
    computeCometAccelerationAt(cx, cz, comet.accel);

    comet.velocity.addScaledVector(comet.accel, deltaTime);
    const speed = comet.velocity.length();
    if (speed > COMET_SPEED_CAP) {
        comet.velocity.multiplyScalar(COMET_SPEED_CAP / speed);
    }

    comet.mesh.position.x += comet.velocity.x * deltaTime;
    comet.mesh.position.z += comet.velocity.y * deltaTime;
    comet.mesh.position.y = gravityYTotalAt(comet.mesh.position.x, comet.mesh.position.z) + COMET_Y_SURFACE_OFFSET;
}

function appendCometTrailPoint(comet) {
    const tPos = comet.trailPositions;
    if (comet.trailPointCount < COMET_TRAIL_POINTS) {
        const tailIdx = comet.trailPointCount * 3;
        tPos[tailIdx] = comet.mesh.position.x;
        tPos[tailIdx + 1] = comet.mesh.position.y;
        tPos[tailIdx + 2] = comet.mesh.position.z;
        comet.trailPointCount += 1;
    } else {
        tPos.copyWithin(0, 3);
        const tailIdx = (COMET_TRAIL_POINTS - 1) * 3;
        tPos[tailIdx] = comet.mesh.position.x;
        tPos[tailIdx + 1] = comet.mesh.position.y;
        tPos[tailIdx + 2] = comet.mesh.position.z;
    }
}

function updateCometTrailMesh(comet, cameraLocalPosition) {
    const pointCount = comet.trailPointCount;
    const geometry = comet.trail.geometry;

    if (pointCount < 2 || comet.trailDrawCount < 2 || comet.trail.material.opacity <= 0.001) {
        geometry.setDrawRange(0, 0);
        comet.trail.visible = false;
        return;
    }

    const visiblePointCount = Math.max(2, Math.min(pointCount, Math.ceil(comet.trailDrawCount)));
    const visibleSegmentCount = visiblePointCount - 1;
    const startPointIndex = Math.max(0, pointCount - visiblePointCount);
    const vertexPositions = geometry.getAttribute('position').array;
    const trailPositions = comet.trailPositions;
    const pointDenominator = Math.max(pointCount - 1, 1);

    _cometTrailLastSide.set(1, 0, 0);

    for (let i = startPointIndex; i < pointCount; i++) {
        const currentOffset = i * 3;
        const previousOffset = i === startPointIndex ? currentOffset : currentOffset - 3;
        const nextOffset = i === pointCount - 1 ? currentOffset : currentOffset + 3;

        _cometTrailPoint.set(
            trailPositions[currentOffset],
            trailPositions[currentOffset + 1],
            trailPositions[currentOffset + 2]
        );
        _cometTrailPrevPoint.set(
            trailPositions[previousOffset],
            trailPositions[previousOffset + 1],
            trailPositions[previousOffset + 2]
        );
        _cometTrailNextPoint.set(
            trailPositions[nextOffset],
            trailPositions[nextOffset + 1],
            trailPositions[nextOffset + 2]
        );

        _cometTrailTangent.copy(_cometTrailNextPoint).sub(_cometTrailPrevPoint);
        if (_cometTrailTangent.lengthSq() < 1e-10) {
            _cometTrailTangent.set(1, 0, 0);
        } else {
            _cometTrailTangent.normalize();
        }

        _cometTrailToCamera.copy(cameraLocalPosition).sub(_cometTrailPoint);
        _cometTrailSide.crossVectors(_cometTrailTangent, _cometTrailToCamera);

        if (_cometTrailSide.lengthSq() < 1e-10) {
            _cometTrailSide.crossVectors(_cometTrailTangent, _upVector);
        }

        if (_cometTrailSide.lengthSq() < 1e-10) {
            _cometTrailSide.copy(_cometTrailLastSide);
        } else {
            _cometTrailSide.normalize();
            _cometTrailLastSide.copy(_cometTrailSide);
        }

        const widthT = i / pointDenominator;
        const halfWidth = COMET_TRAIL_HALF_WIDTH * THREE.MathUtils.lerp(
            COMET_TRAIL_TAIL_WIDTH_SCALE,
            1,
            widthT
        );
        _cometTrailOffset.copy(_cometTrailSide).multiplyScalar(halfWidth);

        const vertexOffset = i * 6;
        vertexPositions[vertexOffset] = _cometTrailPoint.x - _cometTrailOffset.x;
        vertexPositions[vertexOffset + 1] = _cometTrailPoint.y - _cometTrailOffset.y;
        vertexPositions[vertexOffset + 2] = _cometTrailPoint.z - _cometTrailOffset.z;
        vertexPositions[vertexOffset + 3] = _cometTrailPoint.x + _cometTrailOffset.x;
        vertexPositions[vertexOffset + 4] = _cometTrailPoint.y + _cometTrailOffset.y;
        vertexPositions[vertexOffset + 5] = _cometTrailPoint.z + _cometTrailOffset.z;
    }

    geometry.getAttribute('position').needsUpdate = true;
    geometry.setDrawRange(startPointIndex * 6, visibleSegmentCount * 6);
    comet.trail.visible = true;
}

let cometSpawnRate = 0;
let cometSpawnAccumulator = 0;
let cometTrailMeshFrameSkip = 0;

function computeCometAccelerationAt(x, z, outAccel) {
    // Unified field: comets feel the EXACT gradient that shapes the rubber
    // sheet you see and that the force arrows draw. Same Plummer-softened
    // Newtonian potential, same SOFTENING, same NORM scaling, same masses
    // (SUN_BEND_MASS, PLANET_MASS, MOON_MASS). Anything a viewer infers from
    // the surface or the arrows about the local pull is what a comet (and a
    // user-thrown test particle) will actually experience.
    surfaceDownhillAt(x, z, outAccel);
}

function spawnComet() {
    const angle = Math.random() * Math.PI * 2;
    const spawnX = Math.cos(angle) * COMET_SPAWN_RADIUS;
    const spawnZ = Math.sin(angle) * COMET_SPAWN_RADIUS;

    const inward = new THREE.Vector2(-spawnX, -spawnZ).normalize();
    const tangentSign = Math.random() > 0.5 ? 1 : -1;
    // Bias towards small impact parameters: most comets should pass close enough
    // to the Sun/Planet to show a clear arc. tangentStrength=0 means head-on,
    // tangentStrength=1 means purely tangential (grazing orbit). Use 0.15–0.75
    // so impact parameters range from ~0.08 to ~0.42 of COMET_SPAWN_RADIUS.
    const tangentStrength = THREE.MathUtils.lerp(0.15, 0.75, Math.random());
    const tangent = new THREE.Vector2(-inward.y, inward.x).multiplyScalar(tangentSign * tangentStrength);
    const direction = new THREE.Vector2().addVectors(inward, tangent).normalize();
    const speed = THREE.MathUtils.lerp(COMET_INIT_MIN_SPEED, COMET_INIT_MAX_SPEED, Math.random());
    const velocity = direction.multiplyScalar(speed);

    const cometMesh = new THREE.Mesh(cometGeometry, cometMaterial.clone());
    deps.disableFrustumCulling(cometMesh);
    const startY = gravityYTotalAt(spawnX, spawnZ) + COMET_Y_SURFACE_OFFSET;
    cometMesh.position.set(spawnX, startY, spawnZ);
    containerGroup.add(cometMesh);

    const cometLabel = createBodyLabel('Comet');
    containerGroup.add(cometLabel);

    const trailPositions = new Float32Array(COMET_TRAIL_POINTS * 3);
    trailPositions[0] = spawnX;
    trailPositions[1] = startY;
    trailPositions[2] = spawnZ;
    const trail = createCometTrailMesh();
    deps.disableFrustumCulling(trail);
    containerGroup.add(trail);

    const comet = {
        mesh: cometMesh,
        label: cometLabel,
        trail,
        trailPositions,
        velocity,
        accel: new THREE.Vector2(),
        life: 30,
        dying: false,
        fadeOutDrift: false,
        fadeInElapsed: 0,
        fadeOutElapsed: 0,
        fadeOutStartOpacity: 1,
        fadeOutStartTrailFactor: 1,
        visualOpacity: 0,
        visualTrailFactor: 0,
        trailPointCount: 1,
        trailDrawCount: 1
    };
    setCometVisuals(comet, 0, 0);
    comets.push(comet);

    while (comets.length > COMET_MAX_COUNT) {
        removeCometAt(0);
    }
}

function removeCometAt(index) {
    const comet = comets[index];
    if (!comet) {
        return;
    }
    containerGroup.remove(comet.mesh);
    containerGroup.remove(comet.trail);
    if (comet.label) {
        containerGroup.remove(comet.label);
        if (comet.label.geometry) {
            comet.label.geometry.dispose();
        }
        if (comet.label.material) {
            comet.label.material.map?.dispose();
            comet.label.material.dispose();
        }
    }
    comet.mesh.material.dispose();
    comet.trail.material.dispose();
    comet.trail.geometry.dispose();
    comets.splice(index, 1);
}

function updateComets(deltaTime) {
    const clampedDelta = Math.min(deltaTime, 0.05);
    if (orbitState.mode === 'orbit') {
        cometSpawnAccumulator += clampedDelta * cometSpawnRate;
        while (cometSpawnAccumulator >= 1) {
            spawnComet();
            cometSpawnAccumulator -= 1;
        }
    }

    cometTrailMeshFrameSkip += 1;
    const shouldUpdateTrailMeshes =
        cometTrailMeshFrameSkip >= COMET_TRAIL_MESH_UPDATE_INTERVAL;
    if (shouldUpdateTrailMeshes) {
        cometTrailMeshFrameSkip = 0;
    }

    const xrCamera = renderer.xr.getCamera(camera);
    xrCamera.getWorldPosition(_cometTrailCameraLocal);
    containerGroup.worldToLocal(_cometTrailCameraLocal);

    for (let i = comets.length - 1; i >= 0; i--) {
        const comet = comets[i];

        if (comet.dying) {
            if (comet.fadeOutDrift) {
                advanceCometMotion(comet, clampedDelta);
                appendCometTrailPoint(comet);
            }

            comet.fadeOutElapsed += clampedDelta;
            const fadeOutT = getFadeT(comet.fadeOutElapsed, COMET_FADE_OUT_SECONDS);
            const fadeOutAmount = 1 - easeCometFade(fadeOutT);
            setCometVisuals(
                comet,
                comet.fadeOutStartOpacity * fadeOutAmount,
                comet.fadeOutStartTrailFactor * fadeOutAmount
            );
            if (shouldUpdateTrailMeshes || comet.trail.material.opacity <= 0.001) {
                updateCometTrailMesh(comet, _cometTrailCameraLocal);
            }
            if (fadeOutT >= 1) {
                removeCometAt(i);
            }
            continue;
        }

        advanceCometMotion(comet, clampedDelta);
        comet.life -= clampedDelta;
        appendCometTrailPoint(comet);

        comet.fadeInElapsed += clampedDelta;
        const fadeInT = getFadeT(comet.fadeInElapsed, COMET_FADE_IN_SECONDS);
        const fadeInAmount = easeCometFade(fadeInT);
        setCometVisuals(comet, fadeInAmount, fadeInAmount);
        if (shouldUpdateTrailMeshes) {
            updateCometTrailMesh(comet, _cometTrailCameraLocal);
        }

        const cx2 = comet.mesh.position.x;
        const cz2 = comet.mesh.position.z;
        const hitSun    = Math.hypot(cx2 - sun.position.x,    cz2 - sun.position.z)    < sunRadius;
        const hitPlanet = Math.hypot(cx2 - planet.position.x, cz2 - planet.position.z) < planetRadius;
        const hitMoon   = Math.hypot(cx2 - moon.position.x,   cz2 - moon.position.z)   < moonRadius;
        if (hitSun || hitPlanet || hitMoon) {
            startCometFadeOut(comet);
            continue;
        }

        const distFromCenter = Math.hypot(cx2, cz2);
        if (comet.life <= 0 || distFromCenter > COMET_FADE_OUT_START_RADIUS) {
            startCometFadeOut(comet, true);
        }
    }
}


const orbitState = {
    mode: 'edit', // 'edit' | 'orbit'
    planeY: sunRadius,
    sunAnchor: new THREE.Vector2(),
    planetRadius: 0,
    planetAngle: 0,
    planetAngularSpeed: 0,
    moonMode: 'planet', // 'planet' | 'sun'
    moonPlanetRadius: 0,
    moonPlanetAngle: 0,
    moonPlanetAngularSpeed: 0,
    moonSunRadius: 0,
    moonSunAngle: 0,
    moonSunAngularSpeed: 0,
    hillRadius: 0,
    moonBlend: 1, // 1 = planet-follow, 0 = sun-follow
    moonBlendTarget: 1,
    moonModeCandidate: null,
    moonModeCandidateTime: 0,
    moonModeSwitchCooldown: 0,
    isTransitioningToOrbit: false,
    transitionRemaining: 0
};

function updateEditVersusOrbitVisuals() {
    const isEdit = orbitState.mode === 'edit';
    const labelTint = isEdit ? 0xffff00 : 0xffffff;
    sunEditOutline.visible = isEdit;
    planetEditOutline.visible = isEdit;
    moonEditOutline.visible = isEdit;
    if (deps.grabPlanetsHint) {
        deps.grabPlanetsHint.visible = isEdit;
    }
    for (const label of [sunLabel, planetLabel, moonLabel]) {
        if (label.material && label.material.color) {
            label.material.color.setHex(labelTint);
        }
    }
}

updateEditVersusOrbitVisuals();

const ORBIT_Y_LERP = 0.14;
const ORBIT_TRANSITION_SECONDS = 0.35;
const MOON_MODE_SWITCH_STABILITY_SECONDS = 0.16;
const MOON_MODE_SWITCH_COOLDOWN_SECONDS = 0.22;

function setMode(nextMode) {
    if (orbitState.mode === nextMode) {
        return;
    }

    endPlanetDrag('left');
    endPlanetDrag('right');

    if (nextMode === 'orbit') {
        orbitState.mode = nextMode;
        configureOrbitFromEditPose();
        orbitState.isTransitioningToOrbit = true;
        orbitState.transitionRemaining = ORBIT_TRANSITION_SECONDS;
        comets.forEach((c) => {
            c.mesh.visible = true;
            c.trail.visible = true;
            if (c.label) {
                c.label.visible = true;
            }
        });
        deps.animateShootButtonOrbitVisibility(true);
    } else {
        if (orbitState.mode === 'orbit') {
            orbitState.isTransitioningToOrbit = false;
            orbitState.transitionRemaining = 0;
            finalizeExitToEditMode();
            deps.animateShootButtonOrbitVisibility(false);
        } else {
            orbitState.mode = nextMode;
            updateGravityVisuals({ force: true });
            for (let i = comets.length - 1; i >= 0; i--) removeCometAt(i);
            cometSpawnAccumulator = 0;
            deps.animateShootButtonOrbitVisibility(false);
        }
    }

    deps.updateMenuButtonActivePosition(nextMode, true);
    updateEditVersusOrbitVisuals();
}

// Planets move on x-z; y is derived from local grid depression.
const _planetGridPositions = gridGeo.getAttribute('position');
const _gravitySurfaceNodeHeights = new Float32Array(GRID_NODE_AXIS * GRID_NODE_AXIS);
const _gravitySurfaceHeightRange = { min: 0, max: 0 };
const GRAVITY_BODY_EPSILON = 1e-6;
const GRAVITY_CONTOUR_UPDATE_INTERVAL = 2;
const GRAVITY_ARROW_UPDATE_INTERVAL_MOVING = 1;
const GRAVITY_ARROW_UPDATE_INTERVAL_STATIC = 4;
const gravityVisualState = {
    lastSunX: NaN,
    lastSunZ: NaN,
    lastPlanetX: NaN,
    lastPlanetZ: NaN,
    lastMoonX: NaN,
    lastMoonZ: NaN,
    bodiesMovedThisFrame: false,
    contourFrameSkip: 0,
    arrowFrameSkip: 0
};
const _planetDragPinchWorld = new THREE.Vector3();
const _planetDragPinchLocal = new THREE.Vector3();
const _planetDragMidpointWorld = new THREE.Vector3();

const SUN_GRAB_MARGIN = 0.012 * 1.1;
const PLANET_GRAB_MARGIN = 0.02 * 1.2;
const MOON_GRAB_MARGIN = 0.028 * 1.3;

const planetDragState = {
    left: {
        activePlanet: null,
        offset: new THREE.Vector3()
    },
    right: {
        activePlanet: null,
        offset: new THREE.Vector3()
    }
};

let sunRecentering = false;
const bodyEdgeReturn = {
    planet: { active: false, target: new THREE.Vector2() },
    moon: { active: false, target: new THREE.Vector2() }
};

function getBodyRadius(body) {
    if (body === sun) return sunRadius;
    if (body === planet) return planetRadius;
    return moonRadius;
}

function getGrabMargin(body) {
    if (body === sun) return SUN_GRAB_MARGIN;
    if (body === planet) return PLANET_GRAB_MARGIN;
    return MOON_GRAB_MARGIN;
}

function getPlanetDragStateForHand(handKey) {
    return handKey === 'left' ? planetDragState.left : planetDragState.right;
}

function isAnyPlanetDragging() {
    return !!(planetDragState.left.activePlanet || planetDragState.right.activePlanet);
}

function isBodyBeingDragged(body) {
    return planetDragState.left.activePlanet === body || planetDragState.right.activePlanet === body;
}

function getBodyEdgeReturnState(body) {
    if (body === planet) return bodyEdgeReturn.planet;
    if (body === moon) return bodyEdgeReturn.moon;
    return null;
}

function stopBodyEdgeReturn(body) {
    const returnState = getBodyEdgeReturnState(body);
    if (!returnState) {
        return;
    }
    returnState.active = false;
}

function startBodyEdgeReturn(body) {
    const returnState = getBodyEdgeReturnState(body);
    if (!returnState) {
        return false;
    }

    const limit = Math.max(0, GRID_HALF - getBodyRadius(body));
    const targetX = THREE.MathUtils.clamp(body.position.x, -limit, limit);
    const targetZ = THREE.MathUtils.clamp(body.position.z, -limit, limit);
    const needsReturn =
        Math.abs(body.position.x - targetX) > 1e-6 ||
        Math.abs(body.position.z - targetZ) > 1e-6;

    if (!needsReturn) {
        returnState.active = false;
        return false;
    }

    returnState.target.set(targetX, targetZ);
    returnState.active = true;
    return true;
}

function updateBodyEdgeReturn(body) {
    const returnState = getBodyEdgeReturnState(body);
    if (!returnState || !returnState.active) {
        return false;
    }

    const prevX = body.position.x;
    const prevZ = body.position.z;
    body.position.x = THREE.MathUtils.lerp(body.position.x, returnState.target.x, BODY_EDGE_RETURN_LERP);
    body.position.z = THREE.MathUtils.lerp(body.position.z, returnState.target.y, BODY_EDGE_RETURN_LERP);

    if (
        Math.abs(body.position.x - returnState.target.x) < 0.001 &&
        Math.abs(body.position.z - returnState.target.y) < 0.001
    ) {
        body.position.x = returnState.target.x;
        body.position.z = returnState.target.y;
        returnState.active = false;
    }

    return (
        Math.abs(body.position.x - prevX) > 1e-6 ||
        Math.abs(body.position.z - prevZ) > 1e-6
    );
}

function getPinchWorldPosition(handKey, target) {
    if (handKey === 'left') {
        return target.copy(deps.lThumbObj.position).add(deps.lIndexObj.position).multiplyScalar(0.5);
    }

    return target.copy(deps.rThumbObj.position).add(deps.rIndexObj.position).multiplyScalar(0.5);
}

function getPinchedPlanet(handKey, pinchLocalPosition) {
    const grabTargets = [
        { body: sun, radius: sunRadius },
        { body: planet, radius: planetRadius },
        { body: moon, radius: moonRadius }
    ];

    let closestTarget = null;
    let closestDistanceSq = Infinity;

    for (const target of grabTargets) {
        if (isBodyBeingDragged(target.body) && getPlanetDragStateForHand(handKey).activePlanet !== target.body) {
            continue;
        }

        const grabRadius = target.radius + getGrabMargin(target.body);
        const distanceSq = pinchLocalPosition.distanceToSquared(target.body.position);

        if (distanceSq <= grabRadius * grabRadius && distanceSq < closestDistanceSq) {
            closestTarget = target.body;
            closestDistanceSq = distanceSq;
        }
    }

    return closestTarget;
}

function gravityYTotalAt(x, z) {
    return (
        gravityYAt(x, z, sun.position.x, sun.position.z, SUN_BEND_MASS) +
        gravityYAt(x, z, planet.position.x, planet.position.z, PLANET_MASS) +
        gravityYAt(x, z, moon.position.x, moon.position.z, MOON_MASS)
    );
}

function gravityYTotalExcluding(body, x, z) {
    let y = 0;
    if (body !== sun) {
        y += gravityYAt(x, z, sun.position.x, sun.position.z, SUN_BEND_MASS);
    }
    if (body !== planet) {
        y += gravityYAt(x, z, planet.position.x, planet.position.z, PLANET_MASS);
    }
    if (body !== moon) {
        y += gravityYAt(x, z, moon.position.x, moon.position.z, MOON_MASS);
    }
    return y;
}

function updateGravitySurfaceHeights() {
    let minHeight = Infinity;
    let maxHeight = -Infinity;

    for (let row = 0; row <= GRID_SEGS; row++) {
        const z = -GRID_HALF + row * GRID_STEP;
        for (let col = 0; col <= GRID_SEGS; col++) {
            const x = -GRID_HALF + col * GRID_STEP;
            const nodeIndex = getGridNodeIndex(row, col);
            const y = gravityYTotalAt(x, z);
            _gravitySurfaceNodeHeights[nodeIndex] = y;
            minHeight = Math.min(minHeight, y);
            maxHeight = Math.max(maxHeight, y);
        }
    }

    _gravitySurfaceHeightRange.min = minHeight;
    _gravitySurfaceHeightRange.max = maxHeight;
}

function appendContourTriangleSegment(
    ax, ay, az,
    bx, by, bz,
    cx, cy, cz,
    contourY,
    target,
    writeIndex
) {
    let hitCount = 0;
    let hit0x = 0;
    let hit0z = 0;
    let hit1x = 0;
    let hit1z = 0;

    const appendEdgeHit = (x0, y0, z0, x1, y1, z1) => {
        const side0 = y0 >= contourY;
        const side1 = y1 >= contourY;
        if (side0 === side1 || Math.abs(y1 - y0) < 1e-6) {
            return;
        }

        const t = THREE.MathUtils.clamp((contourY - y0) / (y1 - y0), 0, 1);
        const ix = THREE.MathUtils.lerp(x0, x1, t);
        const iz = THREE.MathUtils.lerp(z0, z1, t);

        if (hitCount === 0) {
            hit0x = ix;
            hit0z = iz;
        } else if (hitCount === 1) {
            hit1x = ix;
            hit1z = iz;
        }
        hitCount += 1;
    };

    appendEdgeHit(ax, ay, az, bx, by, bz);
    appendEdgeHit(bx, by, bz, cx, cy, cz);
    appendEdgeHit(cx, cy, cz, ax, ay, az);

    if (hitCount !== 2 || writeIndex + 6 > target.length) {
        return writeIndex;
    }

    const contourLiftedY = contourY + GRAVITY_CONTOUR_Y_OFFSET;
    target[writeIndex++] = hit0x;
    target[writeIndex++] = contourLiftedY;
    target[writeIndex++] = hit0z;
    target[writeIndex++] = hit1x;
    target[writeIndex++] = contourLiftedY;
    target[writeIndex++] = hit1z;
    return writeIndex;
}

function updateGravityContours(minHeight, maxHeight) {
    let writeIndex = 0;
    for (let level = 0; level < GRAVITY_CONTOUR_LEVEL_COUNT; level++) {
        const levelT = GRAVITY_CONTOUR_LEVEL_COUNT === 1 ? 0.5 : level / (GRAVITY_CONTOUR_LEVEL_COUNT - 1);
        const contourT = THREE.MathUtils.lerp(GRAVITY_CONTOUR_MIN_T, GRAVITY_CONTOUR_MAX_T, levelT);
        const contourY = THREE.MathUtils.lerp(maxHeight, minHeight, contourT);

        for (let row = 0; row < GRID_SEGS; row++) {
            const z0 = -GRID_HALF + row * GRID_STEP;
            const z1 = z0 + GRID_STEP;
            for (let col = 0; col < GRID_SEGS; col++) {
                const x0 = -GRID_HALF + col * GRID_STEP;
                const x1 = x0 + GRID_STEP;
                const i00 = getGridNodeIndex(row, col);
                const i10 = i00 + 1;
                const i01 = i00 + GRID_NODE_AXIS;
                const i11 = i01 + 1;
                const y00 = _gravitySurfaceNodeHeights[i00];
                const y10 = _gravitySurfaceNodeHeights[i10];
                const y01 = _gravitySurfaceNodeHeights[i01];
                const y11 = _gravitySurfaceNodeHeights[i11];

                writeIndex = appendContourTriangleSegment(
                    x0, y00, z0,
                    x1, y10, z0,
                    x1, y11, z1,
                    contourY,
                    gravityContourPositions,
                    writeIndex
                );
                writeIndex = appendContourTriangleSegment(
                    x0, y00, z0,
                    x1, y11, z1,
                    x0, y01, z1,
                    contourY,
                    gravityContourPositions,
                    writeIndex
                );
            }
        }
    }

    gravityContourAttr.needsUpdate = true;
    gravityContourGeo.setDrawRange(0, writeIndex / 3);
}

function updateGravityContourBorder() {
    const positions = gravityContourBorderPositions;
    let writeIndex = 0;

    const appendPoint = (x, z, nodeIndex) => {
        positions[writeIndex++] = x;
        positions[writeIndex++] = _gravitySurfaceNodeHeights[nodeIndex] + GRAVITY_CONTOUR_Y_OFFSET;
        positions[writeIndex++] = z;
    };

    for (let col = 0; col < GRID_SEGS; col++) {
        appendPoint(-GRID_HALF + col * GRID_STEP, -GRID_HALF, getGridNodeIndex(0, col));
    }
    for (let row = 0; row < GRID_SEGS; row++) {
        appendPoint(GRID_HALF, -GRID_HALF + row * GRID_STEP, getGridNodeIndex(row, GRID_SEGS));
    }
    for (let col = GRID_SEGS; col > 0; col--) {
        appendPoint(-GRID_HALF + col * GRID_STEP, GRID_HALF, getGridNodeIndex(GRID_SEGS, col));
    }
    for (let row = GRID_SEGS; row > 0; row--) {
        appendPoint(-GRID_HALF, -GRID_HALF + row * GRID_STEP, getGridNodeIndex(row, 0));
    }

    gravityContourBorderAttr.needsUpdate = true;
    gravityContourBorderGeo.setDrawRange(0, writeIndex / 3);
}

function seedGravityBodySnapshot() {
    gravityVisualState.lastSunX = sun.position.x;
    gravityVisualState.lastSunZ = sun.position.z;
    gravityVisualState.lastPlanetX = planet.position.x;
    gravityVisualState.lastPlanetZ = planet.position.z;
    gravityVisualState.lastMoonX = moon.position.x;
    gravityVisualState.lastMoonZ = moon.position.z;
}

function syncGravityBodyMotionFlag() {
    const sx = sun.position.x;
    const sz = sun.position.z;
    const px = planet.position.x;
    const pz = planet.position.z;
    const mx = moon.position.x;
    const mz = moon.position.z;

    const moved =
        Math.abs(sx - gravityVisualState.lastSunX) > GRAVITY_BODY_EPSILON ||
        Math.abs(sz - gravityVisualState.lastSunZ) > GRAVITY_BODY_EPSILON ||
        Math.abs(px - gravityVisualState.lastPlanetX) > GRAVITY_BODY_EPSILON ||
        Math.abs(pz - gravityVisualState.lastPlanetZ) > GRAVITY_BODY_EPSILON ||
        Math.abs(mx - gravityVisualState.lastMoonX) > GRAVITY_BODY_EPSILON ||
        Math.abs(mz - gravityVisualState.lastMoonZ) > GRAVITY_BODY_EPSILON;

    if (moved) {
        seedGravityBodySnapshot();
    }

    gravityVisualState.bodiesMovedThisFrame = moved;
    return moved;
}

function updateGravityGridMeshFromSurface() {
    const pos = _planetGridPositions.array;
    for (let vertexIndex = 0, posIndex = 1; vertexIndex < gridVertexNodeIndexArray.length; vertexIndex++, posIndex += 3) {
        pos[posIndex] = _gravitySurfaceNodeHeights[gridVertexNodeIndexArray[vertexIndex]];
    }
    _planetGridPositions.needsUpdate = true;
    updateBorderConnectors();
}

function updateGravityGrid(options = {}) {
    const force = options.force === true;
    const bodiesMoved = gravityVisualState.bodiesMovedThisFrame;

    if (!force && !bodiesMoved) {
        return;
    }

    updateGravitySurfaceHeights();
    updateGravityGridMeshFromSurface();

    gravityVisualState.contourFrameSkip += 1;
    if (force || gravityVisualState.contourFrameSkip >= GRAVITY_CONTOUR_UPDATE_INTERVAL) {
        gravityVisualState.contourFrameSkip = 0;
        updateGravityContours(_gravitySurfaceHeightRange.min, _gravitySurfaceHeightRange.max);
        updateGravityContourBorder();
    }
}

function updateFieldArrowsIfNeeded(options = {}) {
    if (!fieldArrows.visible) {
        return;
    }

    const force = options.force === true;
    const bodiesMoved = gravityVisualState.bodiesMovedThisFrame;

    if (force) {
        updateFieldArrows();
        gravityVisualState.arrowFrameSkip = 0;
        return;
    }

    gravityVisualState.arrowFrameSkip += 1;
    const interval = bodiesMoved
        ? GRAVITY_ARROW_UPDATE_INTERVAL_MOVING
        : GRAVITY_ARROW_UPDATE_INTERVAL_STATIC;

    if (bodiesMoved || gravityVisualState.arrowFrameSkip >= interval) {
        updateFieldArrows();
        gravityVisualState.arrowFrameSkip = 0;
    }
}

function updateGravityVisuals(options = {}) {
    const force = options.force === true;

    if (force) {
        seedGravityBodySnapshot();
        gravityVisualState.bodiesMovedThisFrame = true;
        updateGravityGrid({ force: true });
        updateFieldArrowsIfNeeded({ force: true });
        return;
    }

    syncGravityBodyMotionFlag();
    updateGravityGrid();
    updateFieldArrowsIfNeeded();
}

// When true, hide interior grid lines so field arrows read clearly, while keeping
// the rubber-sheet border visible so the frame still shows curvature.
const HIDE_GRID_INTERIOR = false;

function applyGravityViewMode(animate = true) {
    const showGrid = gravityViewState.mode === 'grid';
    gravityGrid.visible = showGrid && !HIDE_GRID_INTERIOR;
    gravityContours.visible = !showGrid;
    // Keep bending frame edges visible when the interior grid is hidden.
    gravityContourBorder.visible = !showGrid || HIDE_GRID_INTERIOR;
    deps.updateHeaderSwitchActivePosition(gravityViewState.mode, animate);
}

function updatePlanetHeights() {
    updatePlanetHeightsWithLerp(1);
}

function updatePlanetHeightsWithLerp(lerpFactor = 1) {
    const sunWithSelf = gravityYTotalAt(sun.position.x, sun.position.z);
    const sunWithoutSelf = gravityYTotalExcluding(sun, sun.position.x, sun.position.z);
    const sunSurfaceY = THREE.MathUtils.lerp(
        sunWithoutSelf,
        sunWithSelf,
        THREE.MathUtils.clamp(SUN_SELF_BLEND, 0, 1)
    );

    const targetSunY = sunSurfaceY + sunRadius;
    const targetPlanetY = gravityYTotalAt(planet.position.x, planet.position.z) + planetRadius;
    const targetMoonY = gravityYTotalAt(moon.position.x, moon.position.z) + moonRadius;

    if (lerpFactor >= 1) {
        sun.position.y = targetSunY;
        planet.position.y = targetPlanetY;
        moon.position.y = targetMoonY;
        return;
    }

    sun.position.y = THREE.MathUtils.lerp(sun.position.y, targetSunY, lerpFactor);
    planet.position.y = THREE.MathUtils.lerp(planet.position.y, targetPlanetY, lerpFactor);
    moon.position.y = THREE.MathUtils.lerp(moon.position.y, targetMoonY, lerpFactor);
}

function beginPlanetDrag(handKey, pinchWorldPosition) {
    const handDragState = getPlanetDragStateForHand(handKey);
    _planetDragPinchLocal.copy(pinchWorldPosition);
    containerGroup.worldToLocal(_planetDragPinchLocal);

    const pinchedPlanet = getPinchedPlanet(handKey, _planetDragPinchLocal);
    if (!pinchedPlanet) {
        return false;
    }

    handDragState.activePlanet = pinchedPlanet;

    deps.dismissGrabPlanetsHint();

    if (handDragState.activePlanet === sun) {
        sunRecentering = false;
    } else {
        stopBodyEdgeReturn(handDragState.activePlanet);
    }

    handDragState.offset.copy(handDragState.activePlanet.position).sub(_planetDragPinchLocal);
    handDragState.offset.y = 0;
    return true;
}

function endPlanetDrag(handKey) {
    const handDragState = getPlanetDragStateForHand(handKey);
    if (!handDragState.activePlanet) {
        return;
    }

    if (handDragState.activePlanet === sun) {
        sunRecentering = true;
    } else {
        startBodyEdgeReturn(handDragState.activePlanet);
    }
    handDragState.activePlanet = null;
}

function updatePlanetDragForHand(handKey, pinchActive) {
    const handDragState = getPlanetDragStateForHand(handKey);
    if (!pinchActive) {
        endPlanetDrag(handKey);
        return false;
    }

    if (!handDragState.activePlanet) {
        getPinchWorldPosition(handKey, _planetDragMidpointWorld);
        if (!beginPlanetDrag(handKey, _planetDragMidpointWorld)) {
            return false;
        }
    }

    getPinchWorldPosition(handKey, _planetDragPinchWorld);
    _planetDragPinchLocal.copy(_planetDragPinchWorld);
    containerGroup.worldToLocal(_planetDragPinchLocal);

    const nextX = _planetDragPinchLocal.x + handDragState.offset.x;
    const nextZ = _planetDragPinchLocal.z + handDragState.offset.z;

    handDragState.activePlanet.position.set(
        nextX,
        handDragState.activePlanet.position.y,
        nextZ
    );
    return true;
}

function updatePlanetDrag(leftPinchActive, rightPinchActive) {
    if (orbitState.mode !== 'edit') {
        endPlanetDrag('left');
        endPlanetDrag('right');
        return;
    }

    const leftDragged = updatePlanetDragForHand('left', leftPinchActive);
    const rightDragged = updatePlanetDragForHand('right', rightPinchActive);

    if (leftDragged || rightDragged) {
        updatePlanetHeightsWithLerp(ORBIT_Y_LERP);
    }
}

function updateOrbitMode(deltaTime) {
    if (orbitState.mode !== 'orbit') {
        return;
    }

    if (orbitState.isTransitioningToOrbit) {
        orbitState.transitionRemaining -= deltaTime;
        if (orbitState.transitionRemaining <= 0) {
            orbitState.isTransitioningToOrbit = false;
            orbitState.transitionRemaining = 0;
        }
        updatePlanetHeightsWithLerp(ORBIT_Y_LERP);
        return;
    }

    orbitState.planetAngle += deltaTime * orbitState.planetAngularSpeed * ORBIT_SPEED_MULTIPLIER;

    sun.position.x = 0;
    sun.position.z = 0;
    planet.position.x = orbitState.sunAnchor.x + Math.cos(orbitState.planetAngle) * orbitState.planetRadius;
    planet.position.z = orbitState.sunAnchor.y + Math.sin(orbitState.planetAngle) * orbitState.planetRadius;
    updateMoonOrbitMode(deltaTime);
    orbitState.moonPlanetAngle += deltaTime * orbitState.moonPlanetAngularSpeed * ORBIT_SPEED_MULTIPLIER;
    orbitState.moonSunAngle += deltaTime * orbitState.moonSunAngularSpeed * ORBIT_SPEED_MULTIPLIER;

    const moonPlanetX = planet.position.x + Math.cos(orbitState.moonPlanetAngle) * orbitState.moonPlanetRadius;
    const moonPlanetZ = planet.position.z + Math.sin(orbitState.moonPlanetAngle) * orbitState.moonPlanetRadius;
    const moonSunX = orbitState.sunAnchor.x + Math.cos(orbitState.moonSunAngle) * orbitState.moonSunRadius;
    const moonSunZ = orbitState.sunAnchor.y + Math.sin(orbitState.moonSunAngle) * orbitState.moonSunRadius;

    orbitState.moonBlend = THREE.MathUtils.lerp(
        orbitState.moonBlend,
        orbitState.moonBlendTarget,
        Math.min(1, deltaTime * MOON_MODE_BLEND_SPEED)
    );
    moon.position.x = THREE.MathUtils.lerp(moonSunX, moonPlanetX, orbitState.moonBlend);
    moon.position.z = THREE.MathUtils.lerp(moonSunZ, moonPlanetZ, orbitState.moonBlend);

    updatePlanetHeightsWithLerp(ORBIT_Y_LERP);
}

function updateEditModeHeights() {
    if (orbitState.mode !== 'edit') {
        return;
    }

    if (sunRecentering && !isBodyBeingDragged(sun)) {
        sun.position.x = THREE.MathUtils.lerp(sun.position.x, 0, SUN_RECENTER_LERP);
        sun.position.z = THREE.MathUtils.lerp(sun.position.z, 0, SUN_RECENTER_LERP);

        if (Math.abs(sun.position.x) < 0.001 && Math.abs(sun.position.z) < 0.001) {
            sun.position.x = 0;
            sun.position.z = 0;
            sunRecentering = false;
        }
    }

    if (!isBodyBeingDragged(planet)) {
        updateBodyEdgeReturn(planet);
    }
    if (!isBodyBeingDragged(moon)) {
        updateBodyEdgeReturn(moon);
    }

    updatePlanetHeightsWithLerp(ORBIT_Y_LERP);
}

function configureOrbitFromEditPose() {
    orbitState.planeY = Math.max(sun.position.y, planet.position.y, moon.position.y) + 0.2;
    orbitState.sunAnchor.set(0, 0);
    const sunToPlanet = new THREE.Vector2(
        planet.position.x - orbitState.sunAnchor.x,
        planet.position.z - orbitState.sunAnchor.y
    );
    orbitState.planetRadius = Math.max(sunToPlanet.length(), 0.06);
    orbitState.planetAngle = Math.atan2(sunToPlanet.y, sunToPlanet.x);
    orbitState.planetAngularSpeed = THREE.MathUtils.clamp(
        Math.sqrt((ORBIT_BASE_CONST * SUN_BEND_MASS) / Math.pow(orbitState.planetRadius, 3)),
        0.35,
        1.9
    );
    orbitState.hillRadius = orbitState.planetRadius * Math.cbrt(PLANET_MASS / (3 * SUN_BEND_MASS)) * HILL_SPHERE_FACTOR;

    const planetToMoon = new THREE.Vector2(
        moon.position.x - planet.position.x,
        moon.position.z - planet.position.z
    );
    orbitState.moonPlanetRadius = Math.max(planetToMoon.length(), 0.03);
    orbitState.moonPlanetAngle = Math.atan2(planetToMoon.y, planetToMoon.x);
    orbitState.moonPlanetAngularSpeed = THREE.MathUtils.clamp(
        Math.sqrt((ORBIT_BASE_CONST * PLANET_MASS) / Math.pow(orbitState.moonPlanetRadius, 3)) * 1.25,
        0.9,
        4.8
    );

    const sunToMoon = new THREE.Vector2(
        moon.position.x - orbitState.sunAnchor.x,
        moon.position.z - orbitState.sunAnchor.y
    );
    orbitState.moonSunRadius = Math.max(sunToMoon.length(), 0.04);
    orbitState.moonSunAngle = Math.atan2(sunToMoon.y, sunToMoon.x);
    orbitState.moonSunAngularSpeed = THREE.MathUtils.clamp(
        Math.sqrt((ORBIT_BASE_CONST * SUN_BEND_MASS) / Math.pow(orbitState.moonSunRadius, 3)),
        0.35,
        2.5
    );

    orbitState.moonMode = orbitState.moonPlanetRadius <= orbitState.hillRadius ? 'planet' : 'sun';
    orbitState.moonBlendTarget = orbitState.moonMode === 'planet' ? 1 : 0;
    orbitState.moonBlend = orbitState.moonBlendTarget;
    orbitState.moonModeCandidate = null;
    orbitState.moonModeCandidateTime = 0;
    orbitState.moonModeSwitchCooldown = 0;
}

function switchMoonOrbitMode(nextMode) {
    orbitState.moonMode = nextMode;
    orbitState.moonBlendTarget = nextMode === 'planet' ? 1 : 0;
    orbitState.moonModeCandidate = null;
    orbitState.moonModeCandidateTime = 0;
    orbitState.moonModeSwitchCooldown = MOON_MODE_SWITCH_COOLDOWN_SECONDS;

    if (nextMode === 'sun') {
        const sunDx = moon.position.x - orbitState.sunAnchor.x;
        const sunDz = moon.position.z - orbitState.sunAnchor.y;
        orbitState.moonSunRadius = Math.max(Math.sqrt(sunDx * sunDx + sunDz * sunDz), 0.04);
        orbitState.moonSunAngle = Math.atan2(sunDz, sunDx);
        orbitState.moonSunAngularSpeed = THREE.MathUtils.clamp(
            Math.sqrt((ORBIT_BASE_CONST * SUN_BEND_MASS) / Math.pow(orbitState.moonSunRadius, 3)),
            0.35,
            2.5
        );
        return;
    }

    const planetDx = moon.position.x - planet.position.x;
    const planetDz = moon.position.z - planet.position.z;
    orbitState.moonPlanetRadius = Math.max(Math.sqrt(planetDx * planetDx + planetDz * planetDz), 0.03);
    orbitState.moonPlanetAngle = Math.atan2(planetDz, planetDx);
    orbitState.moonPlanetAngularSpeed = THREE.MathUtils.clamp(
        Math.sqrt((ORBIT_BASE_CONST * PLANET_MASS) / Math.pow(orbitState.moonPlanetRadius, 3)) * 1.25,
        0.9,
        4.8
    );
}

function updateMoonOrbitMode(deltaTime) {
    const moonToPlanetX =
        (orbitState.moonMode === 'planet' ? moon.position.x : orbitState.sunAnchor.x + Math.cos(orbitState.moonSunAngle) * orbitState.moonSunRadius) -
        planet.position.x;
    const moonToPlanetZ =
        (orbitState.moonMode === 'planet' ? moon.position.z : orbitState.sunAnchor.y + Math.sin(orbitState.moonSunAngle) * orbitState.moonSunRadius) -
        planet.position.z;
    const moonToPlanetDist = Math.sqrt(moonToPlanetX * moonToPlanetX + moonToPlanetZ * moonToPlanetZ);

    const switchOutRadius = orbitState.hillRadius * HILL_SWITCH_OUT_MULTIPLIER;
    const switchInRadius = orbitState.hillRadius * HILL_SWITCH_IN_MULTIPLIER;
    orbitState.moonModeSwitchCooldown = Math.max(0, orbitState.moonModeSwitchCooldown - deltaTime);

    let candidateMode = null;
    if (orbitState.moonMode === 'planet' && moonToPlanetDist > switchOutRadius) {
        candidateMode = 'sun';
    } else if (orbitState.moonMode === 'sun' && moonToPlanetDist < switchInRadius) {
        candidateMode = 'planet';
    }

    if (!candidateMode) {
        orbitState.moonModeCandidate = null;
        orbitState.moonModeCandidateTime = 0;
        return;
    }

    if (orbitState.moonModeSwitchCooldown > 0) {
        orbitState.moonModeCandidate = null;
        orbitState.moonModeCandidateTime = 0;
        return;
    }

    if (orbitState.moonModeCandidate !== candidateMode) {
        orbitState.moonModeCandidate = candidateMode;
        orbitState.moonModeCandidateTime = deltaTime;
        return;
    }

    orbitState.moonModeCandidateTime += deltaTime;
    if (orbitState.moonModeCandidateTime >= MOON_MODE_SWITCH_STABILITY_SECONDS) {
        switchMoonOrbitMode(candidateMode);
    }
}

// Apply initial bend from both planets.
updateGravityVisuals({ force: true });
applyGravityViewMode(false);
updatePlanetHeights();



    const api = {
        SUN_MASS,
        PLANET_MASS,
        MOON_MASS,
        GRID_PHYS,
        GRID_HALF,
        GRID_STEP,
        GRID_SEGS,
        NORM,
        wellBottomY,
        sun,
        planet,
        moon,
        sunRadius,
        planetRadius,
        moonRadius,
        gravityViewState,
        orbitState,
        fieldArrowState,
        gravityGrid,
        gravityContours,
        sunLabel,
        planetLabel,
        moonLabel,
        spacetimeLabel,
        comets,
        gravityY,
        gravityYTotalAt,
        updateGravityVisuals,
        applyGravityViewMode,
        updatePlanetHeights,
        updateOrbitMode,
        updateEditModeHeights,
        updatePlanetDrag,
        updateComets,
        updateLabels,
        setMode,
        spawnComet,
        isAnyPlanetDragging,
        updateFieldArrowsIfNeeded,
        gridMat,
        gridBorderMaterial,
        gravityContourMat,
        GRID_OPACITY_WITH_FORCE_FIELD,
        GRAVITY_CONTOUR_OPACITY,
        fieldArrows,
    };
    Object.assign(deps, api);
    return api;
}
