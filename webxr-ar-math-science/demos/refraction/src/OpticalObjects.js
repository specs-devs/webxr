import * as THREE from 'three';
import gsap from 'gsap';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DEFAULT_HEAD_OFFSET } from './XRHeadPlacement.js';
import {
    loadHelvetikerBold,
    getHelvetikerBold,
    createNameLabelGroup,
    updateNameLabelGroup,
    disposeNameLabelGroup,
} from './XRText.js';
import { ensureBoundsTree } from './SceneSetup.js';
import {
    LENS_EDGE_CAGE_SEGMENTS,
    AR_POINTER_CYLINDER_SEGMENTS,
    AR_ROUNDED_BOX_SEGMENTS,
    makeTriangularPrism,
    makeTrapezoidPrismGeometry,
    makeCylindricalBiconvexGeometry,
    makeCylindricalPlanoConvexGeometry,
    makeCylindricalPlanoConcaveGeometry,
    makeCylindricalMeniscusGeometry,
    makeHalfCylinderGeometry,
    makeCylindricalBiconcaveGeometry,
} from './OpticalGeometry.js';

export function createOpticalObjects(deps) {
    const { scene, camera, renderer } = deps;
// ==========================================
// CONTAINER
// ==========================================

const containerConfig = {
    containerSize: 0.45,
    /** Desktop / pre-XR preview — fixed world position. */
    desktopPosition: new THREE.Vector3(0, 1.3, -1.3),
    /** Head-local offset applied when an immersive session starts. */
    headOffset: { ...DEFAULT_HEAD_OFFSET },
};

const containerGroup = new THREE.Group();
containerGroup.position.copy(containerConfig.desktopPosition);
scene.add(containerGroup);

const cubeGeometry = new THREE.BoxGeometry(
    containerConfig.containerSize,
    containerConfig.containerSize,
    containerConfig.containerSize
);
const cubeEdges = new THREE.EdgesGeometry(cubeGeometry);
const cubeMaterial = new THREE.LineBasicMaterial({ color: 0xffffff });
const containerCube = new THREE.LineSegments(cubeEdges, cubeMaterial);
containerCube.visible = false;
containerGroup.add(containerCube);

const groundTextureLoader = new THREE.TextureLoader();

// Vertical header plane on the top-front edge of the container.
const headerAspect = 562 / 144;
const headerScale = 1.1;
const headerPlaneWidth = containerConfig.containerSize * headerScale;
const headerPlaneHeight = headerPlaneWidth / headerAspect;
const headerTexture = groundTextureLoader.load('static/ui-header.png');
headerTexture.colorSpace = THREE.SRGBColorSpace;
const headerPlaneMaterial = new THREE.MeshBasicMaterial({
    map: headerTexture,
    // PERF: billboarded toward the camera every frame, so the back face is never seen.
    side: THREE.FrontSide,
    transparent: true,
    depthWrite: false, // don't clip the pointer laser through the header art
});
const containerHeaderPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(headerPlaneWidth, headerPlaneHeight),
    headerPlaneMaterial
);
containerHeaderPlane.renderOrder = 0;
containerHeaderPlane.position.set(
    0,
    containerConfig.containerSize * 0.5 + headerPlaneHeight * 0.5,
    0
);
containerGroup.add(containerHeaderPlane);

const _headerWorldPos = new THREE.Vector3();
const _headerCamDir = new THREE.Vector3();
const _headerTargetQuat = new THREE.Quaternion();
const _headerInvParentQuat = new THREE.Quaternion();
const _headerWorldUp = new THREE.Vector3(0, 1, 0);
const _containerWorldQuat = new THREE.Quaternion();

function updateContainerHeaderBillboard() {
    containerHeaderPlane.getWorldPosition(_headerWorldPos);
    camera.getWorldPosition(_camWorldPos);
    _headerCamDir.subVectors(_camWorldPos, _headerWorldPos);
    _headerCamDir.y = 0;
    if (_headerCamDir.lengthSq() < 1e-8) return;

    _headerTargetQuat.setFromAxisAngle(
        _headerWorldUp,
        Math.atan2(_headerCamDir.x, _headerCamDir.z)
    );
    containerGroup.getWorldQuaternion(_containerWorldQuat);
    _headerInvParentQuat.copy(_containerWorldQuat).invert();
    containerHeaderPlane.quaternion.copy(_headerInvParentQuat).multiply(_headerTargetQuat);
}

// ------------------------------------------
// Optical objects inside the container (basic materials first)
// ------------------------------------------

const objectMaterialBase = {
    color: 0xffffff,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false
};

const prismMaterial = new THREE.MeshBasicMaterial(objectMaterialBase);
const cubeObjectMaterial = new THREE.MeshBasicMaterial(objectMaterialBase);
const biconvexMaterial = new THREE.MeshBasicMaterial(objectMaterialBase);
const biconcaveMaterial = new THREE.MeshBasicMaterial(objectMaterialBase);
const planoConvexMaterial  = new THREE.MeshBasicMaterial(objectMaterialBase);
const planoConcaveMaterial = new THREE.MeshBasicMaterial(objectMaterialBase);
const trapezoidMaterial = new THREE.MeshBasicMaterial(objectMaterialBase);
const sphereObjectMaterial = new THREE.MeshBasicMaterial(objectMaterialBase);
const halfCylinderMaterial = new THREE.MeshBasicMaterial(objectMaterialBase);
const positiveMeniscusMaterial = new THREE.MeshBasicMaterial(objectMaterialBase);
const negativeMeniscusMaterial = new THREE.MeshBasicMaterial(objectMaterialBase);
const OPTICAL_OBJECT_SCALE = 0.8;

// ------------------------------------------
// Shared geometries, materials, and edge overlays
// ------------------------------------------

const edgeLineMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: false,
    opacity: 1.0
});

const containerBottomFrameGeom = new THREE.PlaneGeometry(
    containerConfig.containerSize,
    containerConfig.containerSize
);
const containerBottomFrameMaterial = edgeLineMaterial.clone();
containerBottomFrameMaterial.transparent = true;
containerBottomFrameMaterial.opacity = 0.7;
const containerBottomFrame = new THREE.LineSegments(
    new THREE.EdgesGeometry(containerBottomFrameGeom),
    containerBottomFrameMaterial
);
containerBottomFrameGeom.dispose();
containerBottomFrame.rotation.x = -Math.PI / 2;
containerBottomFrame.position.y = -containerConfig.containerSize * 0.5 + 0.0005;
containerGroup.add(containerBottomFrame);

function addEdgeOverlay(parentMesh, edgeSourceGeom, thresholdAngle = 1) {
    const edges = new THREE.EdgesGeometry(edgeSourceGeom, thresholdAngle);
    const lines = new THREE.LineSegments(edges, edgeLineMaterial.clone());
    parentMesh.add(lines);
    return lines;
}

// Low-res cage geometries used purely as EdgesGeometry sources for smooth curved shapes
const biconvexCageGeom         = makeCylindricalBiconvexGeometry(0.10, 0.055, 0.10, LENS_EDGE_CAGE_SEGMENTS);
const biconcaveCageGeom        = makeCylindricalBiconcaveGeometry(0.10, 0.0275, -0.0095, 0.10, LENS_EDGE_CAGE_SEGMENTS);
const planoConvexCageGeom      = makeCylindricalPlanoConvexGeometry(0.10, 0.055, 0.10, LENS_EDGE_CAGE_SEGMENTS);
const planoConcaveCageGeom     = makeCylindricalPlanoConcaveGeometry(0.10, 0.0275, -0.0095, 0.10, LENS_EDGE_CAGE_SEGMENTS);
const halfCylinderCageGeom     = makeHalfCylinderGeometry(0.05, 0.10, LENS_EDGE_CAGE_SEGMENTS);
const positiveMeniscusCageGeom = makeCylindricalMeniscusGeometry(0.10, 0, 0.024, 0.015, 0.10, LENS_EDGE_CAGE_SEGMENTS);
const negativeMeniscusCageGeom = makeCylindricalMeniscusGeometry(0.10, 0.018, 0.013, 0.021, 0.10, LENS_EDGE_CAGE_SEGMENTS);

// Shared render geometries — one buffer per type (all instances reuse the same mesh data).
const prismObjectGeom          = makeTriangularPrism(0.07, 0.11);
const trapezoidObjectGeom      = makeTrapezoidPrismGeometry(0.10, 0.034, 0.09, 0.06);
const biconvexObjectGeom       = makeCylindricalBiconvexGeometry(0.10, 0.055, 0.10);
const biconcaveObjectGeom      = makeCylindricalBiconcaveGeometry(0.10, 0.0275, -0.0095, 0.10);
const planoConvexObjectGeom    = makeCylindricalPlanoConvexGeometry(0.10, 0.055, 0.10);
const planoConcaveObjectGeom   = makeCylindricalPlanoConcaveGeometry(0.10, 0.0275, -0.0095, 0.10);
const halfCylinderObjectGeom   = makeHalfCylinderGeometry(0.05, 0.10);
const positiveMeniscusObjectGeom = makeCylindricalMeniscusGeometry(0.10, 0, 0.024, 0.015, 0.10);
const negativeMeniscusObjectGeom = makeCylindricalMeniscusGeometry(0.10, 0.018, 0.013, 0.021, 0.10);

const cubeObjectGeom   = new THREE.BoxGeometry(0.09, 0.09, 0.09);
const sphereObjectGeom = new THREE.SphereGeometry(0.052, 40, 32);
const mirrorGeom       = new THREE.BoxGeometry(0.10, 0.10, 0.006);

/** Shared mesh geoms we must never dispose when a slot preview is retired. */
const SHARED_MESH_GEOMS = [cubeObjectGeom, sphereObjectGeom, mirrorGeom];

const mirrorMaterial = new THREE.MeshBasicMaterial({
    color: 0x778899,
    transparent: false,
    opacity: 1.0,
    side: THREE.FrontSide,
    depthTest: true,
    depthWrite: true
});

// Sphere billboard outline — one Line2 per sphere instance, sharing geometry + material
const SPHERE_OUTLINE_SEGMENTS = 128;
const SPHERE_OUTLINE_RADIUS   = 0.052;
const sphereOutlinePositions = [];
for (let i = 0; i <= SPHERE_OUTLINE_SEGMENTS; i++) {
    const a = (i / SPHERE_OUTLINE_SEGMENTS) * Math.PI * 2;
    sphereOutlinePositions.push(Math.cos(a) * SPHERE_OUTLINE_RADIUS, Math.sin(a) * SPHERE_OUTLINE_RADIUS, 0);
}
const sphereOutlineGeom = new LineGeometry();
sphereOutlineGeom.setPositions(sphereOutlinePositions);
const sphereOutlineMat = new LineMaterial({
    color: 0xffffff,
    linewidth: 0.001,
    worldUnits: true,
    transparent: false,
    depthTest: true,
    depthWrite: false
});

function createSphereOutline() {
    const line = new Line2(sphereOutlineGeom, sphereOutlineMat);
    line.frustumCulled = false;
    line.renderOrder = 1;
    scene.add(line);
    return line;
}

const _sphereOutlineWorldPos   = new THREE.Vector3();
const _sphereOutlineWorldScale = new THREE.Vector3();
const _camWorldPos             = new THREE.Vector3();

/** Sphere outlines — one per sphere mesh, on both scene instances and slot previews. */
const _sphereOutlineScratch = [];

function updateSphereOutlines() {
    camera.getWorldPosition(_camWorldPos);

    const spheres = _sphereOutlineScratch;
    spheres.length = 0;
    for (let i = 0; i < sceneOpticalMeshes.length; i++) {
        const m = sceneOpticalMeshes[i];
        if (m.userData.sphereOutline) spheres.push(m);
    }
    const slotMeshes = deps.slotMeshes;
    if (slotMeshes) {
        for (let i = 0; i < slotMeshes.length; i++) {
            const m = slotMeshes[i];
            if (m && m.userData.sphereOutline) spheres.push(m);
        }
    }
    const returningMeshes = deps.returningMeshes;
    if (returningMeshes) {
        for (let i = 0; i < returningMeshes.length; i++) {
            const m = returningMeshes[i];
            if (m.userData.sphereOutline) spheres.push(m);
        }
    }

    for (let i = 0; i < spheres.length; i++) {
        const m = spheres[i];
        const outline = m.userData.sphereOutline;
        m.updateWorldMatrix(true, false);
        m.getWorldPosition(_sphereOutlineWorldPos);
        m.getWorldScale(_sphereOutlineWorldScale);
        outline.position.copy(_sphereOutlineWorldPos);
        outline.scale.set(_sphereOutlineWorldScale.x, _sphereOutlineWorldScale.y, 1);
        outline.lookAt(_camWorldPos);
        outline.scale.z = 1;
    }
    spheres.length = 0;
}

// ------------------------------------------
// Optical object factories — one per type.
// Each returns a fresh mesh ready to be placed in the scene or a menu slot.
// ------------------------------------------
const STEPPER_MEDIUM_IOR_MAP = {
    Air: 1.0003,
    Water: 1.333,
    Glass: 1.52,
    Sapphire: 1.77,
    Diamond: 2.417,
    Custom: 1.52 // Placeholder until custom value input is added.
};
const IOR_SLIDER_MIN = 1.0;
const IOR_SLIDER_MAX = 2.5;
const IOR_SLIDER_RANGE = IOR_SLIDER_MAX - IOR_SLIDER_MIN;
// Mutated live from MenuUI.js (stepper / slider) — kept on deps (not a local let) so every
// module always reads the current value instead of a stale snapshot captured at init time.
deps.currentStepperMediumIOR = STEPPER_MEDIUM_IOR_MAP.Glass;
deps.customStepperMediumIOR = STEPPER_MEDIUM_IOR_MAP.Glass;

function makePrism() {
    const m = new THREE.Mesh(prismObjectGeom, prismMaterial);
    m.scale.setScalar(OPTICAL_OBJECT_SCALE * 0.96);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'prism';
    addEdgeOverlay(m, prismObjectGeom);
    return m;
}

function makeCube() {
    const m = new THREE.Mesh(cubeObjectGeom, cubeObjectMaterial);
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'cube';
    addEdgeOverlay(m, cubeObjectGeom);
    return m;
}

function makeBiconvex() {
    const m = new THREE.Mesh(biconvexObjectGeom, biconvexMaterial);
    m.rotation.y = Math.PI / 2;
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'biconvex';
    addEdgeOverlay(m, biconvexCageGeom, 15);
    return m;
}

function makeBiconcave() {
    const m = new THREE.Mesh(biconcaveObjectGeom, biconcaveMaterial);
    m.rotation.y = Math.PI / 2;
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'biconcave';
    addEdgeOverlay(m, biconcaveCageGeom, 15);
    return m;
}

function makePlanoConvex() {
    const m = new THREE.Mesh(planoConvexObjectGeom, planoConvexMaterial);
    m.rotation.y = Math.PI / 2;
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'planoConvex';
    addEdgeOverlay(m, planoConvexCageGeom, 15);
    return m;
}

function makePlanoConcave() {
    const m = new THREE.Mesh(planoConcaveObjectGeom, planoConcaveMaterial);
    m.rotation.y = Math.PI / 2;
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'planoConcave';
    addEdgeOverlay(m, planoConcaveCageGeom, 15);
    return m;
}

function makeTrapezoid() {
    const m = new THREE.Mesh(trapezoidObjectGeom, trapezoidMaterial);
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'trapezoid';
    addEdgeOverlay(m, trapezoidObjectGeom);
    return m;
}

function makeSphere() {
    const m = new THREE.Mesh(sphereObjectGeom, sphereObjectMaterial);
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'sphere';
    m.userData.sphereOutline = createSphereOutline();
    return m;
}

function makeHalfCylinder() {
    const m = new THREE.Mesh(halfCylinderObjectGeom, halfCylinderMaterial);
    m.rotation.y = Math.PI / 2;
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'halfCylinder';
    addEdgeOverlay(m, halfCylinderCageGeom, 15);
    return m;
}

// positive meniscus — sag1 > sag2 → thicker center, converging
function makePositiveMeniscus() {
    const m = new THREE.Mesh(positiveMeniscusObjectGeom, positiveMeniscusMaterial);
    m.rotation.y = Math.PI / 2;
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'positiveMeniscus';
    addEdgeOverlay(m, positiveMeniscusCageGeom, 15);
    return m;
}

// negative meniscus — sag2 > sag1 → thinner center, diverging
function makeNegativeMeniscus() {
    const m = new THREE.Mesh(negativeMeniscusObjectGeom, negativeMeniscusMaterial);
    m.rotation.y = Math.PI / 2;
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.ior = deps.currentStepperMediumIOR;
    m.userData.typeKey = 'negativeMeniscus';
    addEdgeOverlay(m, negativeMeniscusCageGeom, 15);
    return m;
}

function makeMirror() {
    const m = new THREE.Mesh(mirrorGeom, mirrorMaterial);
    m.scale.setScalar(OPTICAL_OBJECT_SCALE);
    m.userData.isMirror = true;
    m.userData.typeKey = 'mirror';
    addEdgeOverlay(m, mirrorGeom);
    return m;
}

/** Set once when an optical mesh is built — do not call per frame. */
function disableOpticalFrustumCulling(root) {
    root.traverse((child) => {
        child.frustumCulled = false;
    });
}

function withOpticalFrustumCulling(factory) {
    return function opticalFactory() {
        const mesh = factory();
        disableOpticalFrustumCulling(mesh);
        return mesh;
    };
}

/** Type registry — keyed by OPTICAL_PAGES entries. */
const OPTICAL_TYPES = {
    biconvex:         { name: 'Biconvex Lens',      factory: withOpticalFrustumCulling(makeBiconvex) },
    planoConvex:      { name: 'Plano-Convex Lens',  factory: withOpticalFrustumCulling(makePlanoConvex) },
    positiveMeniscus: { name: 'Positive Meniscus',  factory: withOpticalFrustumCulling(makePositiveMeniscus) },
    biconcave:        { name: 'Biconcave Lens',     factory: withOpticalFrustumCulling(makeBiconcave) },
    planoConcave:     { name: 'Plano-Concave Lens', factory: withOpticalFrustumCulling(makePlanoConcave) },
    negativeMeniscus: { name: 'Negative Meniscus',  factory: withOpticalFrustumCulling(makeNegativeMeniscus) },
    mirror:           { name: 'Mirror',             factory: withOpticalFrustumCulling(makeMirror) },
    prism:            { name: 'Prism',              factory: withOpticalFrustumCulling(makePrism) },
    cube:             { name: 'Cube',               factory: withOpticalFrustumCulling(makeCube) },
    trapezoid:        { name: 'Trapezoid',          factory: withOpticalFrustumCulling(makeTrapezoid) },
    sphere:           { name: 'Sphere',             factory: withOpticalFrustumCulling(makeSphere) },
    halfCylinder:     { name: 'Half-Cylinder',      factory: withOpticalFrustumCulling(makeHalfCylinder) }
};

/** Menu pages — 4 pages × 3 slots. Prev/Next wraps. */
const OPTICAL_PAGES = [
    ['biconcave', 'planoConcave', 'negativeMeniscus'],
    ['biconvex',  'planoConvex',  'positiveMeniscus'],
    ['mirror',    'prism',        'cube'],
    ['trapezoid', 'sphere',       'halfCylinder']
];

// ------------------------------------------
// Mirror multi-instance pool — mirror is the only optical type that supports multiple
// concurrent scene instances. Up to MAX_MIRRORS can coexist; each carries a unique
// numbered internally (1..MAX_MIRRORS); in-scene labels read plain "Mirror". The slot preview's hover label
// shows the count still available to pull.
// ------------------------------------------
/** Hard cap on simultaneously placed mirrors. Tweak to allow more. */
const MAX_MIRRORS = 5;

/** Sorted ascending. shift() returns the lowest free number. */
const availableMirrorNumbers = [];
for (let i = 1; i <= MAX_MIRRORS; i++) availableMirrorNumbers.push(i);

function mirrorsAvailableCount() {
    return availableMirrorNumbers.length;
}

function acquireMirrorNumber() {
    if (availableMirrorNumbers.length === 0) return null;
    return availableMirrorNumbers.shift();
}

function releaseMirrorNumber(n) {
    if (typeof n !== 'number') return;
    if (availableMirrorNumbers.indexOf(n) >= 0) return;
    availableMirrorNumbers.push(n);
    availableMirrorNumbers.sort((a, b) => a - b);
}

// ------------------------------------------
// Scene-instance registry (dynamic — grows every time the user pulls an object from the menu).
// Only scene instances participate in ray tracing and free grabbing. Slot previews are tracked separately.
// ------------------------------------------
const sceneOpticalMeshes = [];

/** Object-name label setup (must exist before addSceneInstance is called). */
const OBJ_LABEL_SIZE_SCALE = 1.3; // tweak object name label size (font + layout)
const OBJ_LABEL_WORLD_W    = 0.156 * 0.5 * OBJ_LABEL_SIZE_SCALE;
const OBJ_LABEL_WORLD_H    = OBJ_LABEL_WORLD_W * (80 / 512);
const OBJ_LABEL_WORLD_SCENE_SCALE = 1.16; // Match world main-line visual size to menu label.
const OBJ_LABEL_Y_OFFSET   = 0.064;
const OBJ_LABEL_PRISM_EXTRA_Y_OFFSET = 0.016;
const OBJ_LABEL_HOVER_DIST = 0.05;

/**
 * Resolve the display text for a mesh's name label.
 * Mirror is the only type with stateful naming:
 *   - Scene instance (has `mirrorNumber`) → "Mirror"
 *   - Slot preview (no `mirrorNumber`)    → "Mirror (N)" where N = mirrors still available to pull
 * Every other type just uses the name from OPTICAL_TYPES.
 */
function getDisplayNameFor(mesh) {
    const typeKey = mesh.userData.typeKey;
    if (typeKey === 'mirror') {
        if (typeof mesh.userData.mirrorNumber === 'number') {
            return 'Mirror';
        }
        return `Mirror (${mirrorsAvailableCount()})`;
    }
    return OPTICAL_TYPES[typeKey].name;
}

function formatIORValue(ior) {
    const numeric = Number(ior);
    if (!Number.isFinite(numeric)) return '1.520';
    return numeric.toFixed(3);
}

function getSceneIORLineFor(mesh) {
    if (!mesh || !mesh.userData || mesh.userData.typeKey === 'mirror') return '';
    // Show IOR only for active world-space objects, never for panel slot previews.
    if (sceneOpticalMeshes.indexOf(mesh) < 0) return '';
    // STEPPER_MEDIUM_OPTIONS / currentStepperMediumIndex live in MenuUI.js (initialized on
    // deps before this can be called) — read live off deps rather than a stale local copy.
    const mediumName = (deps.STEPPER_MEDIUM_OPTIONS && deps.STEPPER_MEDIUM_OPTIONS[deps.currentStepperMediumIndex]) || 'Glass';
    const iorText = formatIORValue(mesh.userData.ior);
    return `${mediumName} · IOR: ${iorText}`;
}

/** Redraw a mesh's name label from its current display name. No-op if no label. */
function redrawNameLabel(mesh) {
    const label = mesh && mesh.userData ? mesh.userData.nameLabel : null;
    const font = getHelvetikerBold();
    if (!label || !font) return;
    updateNameLabelGroup(
        label,
        font,
        getDisplayNameFor(mesh),
        getSceneIORLineFor(mesh)
    );
}

function disposeMeshNameLabel(mesh) {
    if (!mesh?.userData?.nameLabel) return;
    const label = mesh.userData.nameLabel;
    if (label.parent) label.parent.remove(label);
    disposeNameLabelGroup(label);
    mesh.userData.nameLabel = null;
}

function createNameLabelFor(mesh) {
    disposeMeshNameLabel(mesh);

    loadHelvetikerBold().then((font) => {
        if (!mesh.userData || mesh.userData.nameLabel) return;

        const label = createNameLabelGroup(
            font,
            getDisplayNameFor(mesh),
            getSceneIORLineFor(mesh),
            { width: OBJ_LABEL_WORLD_W, height: OBJ_LABEL_WORLD_H }
        );
        label.visible = false;
        scene.add(label);
        mesh.userData.nameLabel = label;
    });
}

function addSceneInstance(mesh) {
    // Scene instances participate in per-frame ray tracing — make sure their
    // geometry carries a BVH before the first traced frame touches it.
    ensureBoundsTree(mesh.geometry);
    sceneOpticalMeshes.push(mesh);
    createNameLabelFor(mesh);
}

function spawnInitialSceneObject(typeKey, position, rotationDeg) {
    const typeDef = OPTICAL_TYPES[typeKey];
    if (!typeDef) return null;
    const mesh = typeDef.factory();
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.set(
        THREE.MathUtils.degToRad(rotationDeg.x),
        THREE.MathUtils.degToRad(rotationDeg.y),
        THREE.MathUtils.degToRad(rotationDeg.z),
        'XYZ'
    );
    containerGroup.add(mesh);

    if (typeKey === 'mirror') {
        mesh.userData.mirrorNumber = acquireMirrorNumber();
    } else {
        typeInScene.add(typeKey);
    }

    addSceneInstance(mesh);
    return mesh;
}

// ------------------------------------------
// One instance per type: a type is either in its menu slot or in the scene, never both.
// `typeInScene` tracks which types have already been pulled out; those slots stay empty.
// Default scene contains only pointerObj — every optical type starts in the menu.
// ------------------------------------------
const typeInScene = new Set();

/** Laser mode: '1-ray' | '3-ray' | 'dispersion' — kept on deps (not a local let) so
 *  ObjectManipulation.js / SnellsLawTracer.js always read the live value instead of the
 *  snapshot that existed when they were initialized. */
deps.laserMode = 'dispersion';

/** When true, show surface normals + θ arcs + angle labels at hits (only in 1-ray mode; future UI can toggle). */
let visualizeNormals = true;

/** Perpendicular offset between the center ray and each side ray (in world units) */
const THREE_RAY_SPACING = 0.012;

/** Dispersion: 7 spectral bands from red to violet */
const DISPERSION_BANDS = [
    { wavelength: 0.650, color: 0xff0000 },  // Red
    { wavelength: 0.600, color: 0xff6600 },  // Orange
    { wavelength: 0.570, color: 0xffff00 },  // Yellow
    { wavelength: 0.520, color: 0x00ff00 },  // Green
    { wavelength: 0.480, color: 0x0099ff },  // Cyan
    { wavelength: 0.450, color: 0x0000ff },  // Blue
    { wavelength: 0.400, color: 0x8800ff },  // Violet
];
const DISPERSION_LINEWIDTH = 0.004;
const CAUCHY_B = 0.006;
const CAUCHY_REF_WAVELENGTH = 0.5893;

function cauchyIOR(baseIOR, wavelengthMicrons) {
    const A = baseIOR - CAUCHY_B / (CAUCHY_REF_WAVELENGTH * CAUCHY_REF_WAVELENGTH);
    return A + CAUCHY_B / (wavelengthMicrons * wavelengthMicrons);
}

// Elongated pointer in world space — long axis is **Z** (grip at −Z end, barrel extends +Z); index tip at grip
const pointerDims = {
    crossX: 0.016,
    crossY: 0.016,
    barrelLenZ: 0.07,
    /** Extra Z on geometry translate (+ / − along local Z; pivot stays at index tip). */
    pivotOffsetZ: -0.03
};
// PERF: Lambert is a far cheaper lit shader than Standard (no PBR) — still shaded by the scene lights.
const pointerMaterial = new THREE.MeshLambertMaterial({
    color: 0xffffff
});

const POINTER_BARREL_Z0 = pointerDims.pivotOffsetZ;
const POINTER_BARREL_Z1 = pointerDims.pivotOffsetZ + pointerDims.barrelLenZ;

function makeZAlignedCylinder(radiusTop, radiusBottom, length, segments = AR_POINTER_CYLINDER_SEGMENTS) {
    const geom = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, segments);
    geom.rotateX(Math.PI / 2);
    return geom;
}

/** Merge geometries that may differ in indexed vs non-indexed layout. */
function mergePointerParts(...geometries) {
    const normalized = geometries.map((geom) => (geom.index ? geom.toNonIndexed() : geom));
    const merged = mergeGeometries(normalized);
    if (!merged) {
        throw new Error('Failed to merge pointer geometries');
    }
    return merged;
}

/** 1-ray: cylinder barrel + short nozzle at the emitter tip. */
function build1RayNozzlePointerGeometry() {
    const bodyLen = pointerDims.barrelLenZ * 0.84;
    const nozzleLen = pointerDims.barrelLenZ * 0.16;
    const rBody = pointerDims.crossX * 0.5;
    const rNozzleInner = pointerDims.crossX * 0.28;
    const rNozzleOuter = pointerDims.crossX * 0.38;

    const body = makeZAlignedCylinder(rBody, rBody, bodyLen);
    body.translate(0, 0, POINTER_BARREL_Z0 + bodyLen * 0.5);

    const nozzle = makeZAlignedCylinder(rNozzleInner, rNozzleOuter, nozzleLen);
    nozzle.translate(0, 0, POINTER_BARREL_Z1 - nozzleLen * 0.5);

    return mergePointerParts(body, nozzle);
}

/** 3-ray: rounded slab barrel + elliptical nozzle at the emitter tip. */
function build3RayNozzlePointerGeometry() {
    const bodyLen = pointerDims.barrelLenZ * 0.84;
    const nozzleLen = pointerDims.barrelLenZ * 0.16;
    const crossY = pointerDims.crossX + 2 * THREE_RAY_SPACING;
    const cornerRadius = pointerDims.crossX * 0.18;
    const rNozzleInner = pointerDims.crossX * 0.28;
    const rNozzleOuter = pointerDims.crossX * 0.38;

    const body = new RoundedBoxGeometry(
        pointerDims.crossX,
        crossY,
        bodyLen,
        AR_ROUNDED_BOX_SEGMENTS,
        cornerRadius
    );
    body.translate(0, 0, POINTER_BARREL_Z0 + bodyLen * 0.5);

    const nozzle = makeZAlignedCylinder(rNozzleInner, rNozzleOuter, nozzleLen);
    // Wide end slightly inset inside the slab; tip still tall enough for side rays at ±THREE_RAY_SPACING.
    const POINTER_3RAY_NOZZLE_Y_INSET = 0.9;
    const nozzleYScale = ((crossY * 0.5) / rNozzleOuter) * POINTER_3RAY_NOZZLE_Y_INSET;
    nozzle.scale(1, nozzleYScale, 1);
    nozzle.translate(0, 0, POINTER_BARREL_Z1 - nozzleLen * 0.5);

    return mergePointerParts(body, nozzle);
}

const pointerGeom1Ray = build1RayNozzlePointerGeometry();
const pointerGeom3Ray = build3RayNozzlePointerGeometry();

const pointerObj = new THREE.Mesh(
    deps.laserMode === '3-ray' ? pointerGeom3Ray : pointerGeom1Ray,
    pointerMaterial
);
pointerObj.frustumCulled = false; // set once — 1-ray cylinder / 3-ray slab
scene.add(pointerObj);

/** Square button plane at the pointer tip while held, or while a non-pinching index approaches within `POINTER_APPROACH_RADIUS`. */
const POINTER_MENU_BUTTON_SIZE = 0.028;
/** How far (m) the button and panel each pop toward the camera along their look direction. */
const POINTER_MENU_BUTTON_Z_POP = 0.018;
const POINTER_MENU_PANEL_Z_POP  = 0.006;
const _pointerMenuButtonTextureLoader = new THREE.TextureLoader();
const _pointerMenuButtonTextures = {
    '1-ray': _pointerMenuButtonTextureLoader.load('static/ui-button-1ray.png'),
    '3-ray': _pointerMenuButtonTextureLoader.load('static/ui-button-3ray.png'),
    dispersion: _pointerMenuButtonTextureLoader.load('static/ui-button-dispersion.png')
};
for (const modeName in _pointerMenuButtonTextures) {
    _pointerMenuButtonTextures[modeName].colorSpace = THREE.SRGBColorSpace;
}
const pointerMenuButtonMaterial = new THREE.MeshBasicMaterial({
    map: _pointerMenuButtonTextures[deps.laserMode] || _pointerMenuButtonTextures['1-ray'],
    side: THREE.DoubleSide,
    transparent: true,
    depthTest: false,
    depthWrite: false
});
const pointerMenuButton = new THREE.Mesh(
    new THREE.PlaneGeometry(POINTER_MENU_BUTTON_SIZE, POINTER_MENU_BUTTON_SIZE),
    pointerMenuButtonMaterial
);
pointerMenuButton.renderOrder = 999;
pointerMenuButton.frustumCulled = false;
pointerMenuButton.visible = true;
pointerMenuButton.scale.setScalar(1);
scene.add(pointerMenuButton);

/** Pointer discoverability hints — shared text/arrow styling. */
const POINTER_HINT_TEXT_SIZE = 0.00864;
const POINTER_HINT_ARROW_W = 0.0072;
const POINTER_HINT_ARROW_H = 0.0048;
const POINTER_RAY_MODE_HINT_TEXT_Y = 0.033;
const POINTER_RAY_MODE_HINT_ARROW_Y = 0.021;
const POINTER_GRAB_HINT_TEXT_Y = 0.028;
const POINTER_GRAB_HINT_ARROW_Y = 0.015;
/** Extra billboard-up shift when the 3-ray slab is taller than 1-ray / dispersion. */
const POINTER_GRAB_HINT_3RAY_Y_OFFSET = THREE_RAY_SPACING;

const pointerHintMat = {
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide
};

function buildCenteredTextShapeGeometry(font, text, size) {
    const geometry = new THREE.ShapeGeometry(font.generateShapes(text, size));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    geometry.translate(
        -(box.max.x + box.min.x) * 0.5,
        -(box.max.y + box.min.y) * 0.5,
        0
    );
    return geometry;
}

function createPointerHintDownArrowMesh(y) {
    const shape = new THREE.Shape();
    shape.moveTo(0, -POINTER_HINT_ARROW_H * 0.5);
    shape.lineTo(POINTER_HINT_ARROW_W * 0.5, POINTER_HINT_ARROW_H * 0.5);
    shape.lineTo(-POINTER_HINT_ARROW_W * 0.5, POINTER_HINT_ARROW_H * 0.5);
    shape.closePath();
    const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: 0xffffff, ...pointerHintMat })
    );
    mesh.position.set(0, y, 0);
    mesh.renderOrder = 998;
    mesh.frustumCulled = false;
    return mesh;
}

function createPointerHintLabel(font, text, textY) {
    const mesh = new THREE.Mesh(
        buildCenteredTextShapeGeometry(font, text, POINTER_HINT_TEXT_SIZE),
        new THREE.MeshBasicMaterial({ color: 0xffffff, ...pointerHintMat })
    );
    mesh.position.set(0, textY, 0);
    mesh.renderOrder = 998;
    mesh.frustumCulled = false;
    return mesh;
}

const pointerRayModeHint = new THREE.Group();
pointerRayModeHint.add(createPointerHintDownArrowMesh(POINTER_RAY_MODE_HINT_ARROW_Y));
pointerRayModeHint.frustumCulled = false;
scene.add(pointerRayModeHint);

const pointerGrabHint = new THREE.Group();
pointerGrabHint.add(createPointerHintDownArrowMesh(POINTER_GRAB_HINT_ARROW_Y));
pointerGrabHint.frustumCulled = false;
scene.add(pointerGrabHint);

const pointerHintState = {
    rayModeDismissed: false,
    grabDismissed: false
};

function dismissRayModeHint() {
    if (pointerHintState.rayModeDismissed) return;
    pointerHintState.rayModeDismissed = true;
    pointerRayModeHint.visible = false;
}

function dismissGrabHint() {
    if (pointerHintState.grabDismissed) return;
    pointerHintState.grabDismissed = true;
    pointerGrabHint.visible = false;
}

loadHelvetikerBold().then((font) => {
    pointerRayModeHint.add(createPointerHintLabel(font, 'Ray Mode', POINTER_RAY_MODE_HINT_TEXT_Y));
    pointerGrabHint.add(createPointerHintLabel(font, 'Grab', POINTER_GRAB_HINT_TEXT_Y));
});

const _pointerTipLocal = new THREE.Vector3(0, 0, pointerDims.pivotOffsetZ + pointerDims.barrelLenZ);
const _pointerTipGapDir = new THREE.Vector3();
const POINTER_TIP_DOT_GAP = 0.025;

// ---- Pointer Menu Panel ----------------------------------------

/** Radius (m) within which an index finger "presses" the yellow button sphere. */
const POINTER_MENU_BUTTON_PRESS_DIST = 0.020;
/** Side length (m) of the square menu panel. */
const POINTER_MENU_PANEL_SIZE = 0.11;
/** How far above the button the panel floats (world Y, m). */
const POINTER_MENU_PANEL_OFFSET_Y = 0.075;
/** Cooldown (s) after any press before the next press can fire — prevents open→close on the same touch. */
const POINTER_MENU_PANEL_COOLDOWN_DURATION = 0.45;
/** Depth tolerance (m) for "poking" the flat panel plane. */
const POINTER_MENU_PANEL_PRESS_DEPTH = 0.025;

const _pointerMenuPanelTex = new THREE.TextureLoader().load('static/ui-pointer-menu.png');
_pointerMenuPanelTex.colorSpace = THREE.SRGBColorSpace;

const pointerMenuPanel = new THREE.Mesh(
    new THREE.PlaneGeometry(POINTER_MENU_PANEL_SIZE, POINTER_MENU_PANEL_SIZE),
    new THREE.MeshBasicMaterial({
        map: _pointerMenuPanelTex,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false
    })
);
pointerMenuPanel.scale.set(0, 0, 0);
pointerMenuPanel.visible = false;
pointerMenuPanel.frustumCulled = false;
pointerMenuPanel.material.map = null;
pointerMenuPanel.material.opacity = 0;
pointerMenuPanel.material.needsUpdate = true;
scene.add(pointerMenuPanel);

/** Child quad on the pointer panel with 172:50 image proportion. */
const POINTER_MENU_PANEL_CHILD_ASPECT = 172 / 50;
const POINTER_MENU_PANEL_CHILD_HEIGHT = POINTER_MENU_PANEL_SIZE * 0.28;
const POINTER_MENU_PANEL_CHILD_WIDTH = POINTER_MENU_PANEL_CHILD_HEIGHT * POINTER_MENU_PANEL_CHILD_ASPECT;
const POINTER_MENU_PANEL_CHILD_SPACING_Y = POINTER_MENU_PANEL_CHILD_HEIGHT * 1.1;
const _pointerMenuButtonATex = new THREE.TextureLoader().load('static/ui-pointer-a-default.png');
_pointerMenuButtonATex.colorSpace = THREE.SRGBColorSpace;
const _pointerMenuButtonAActiveTex = new THREE.TextureLoader().load('static/ui-pointer-a-active.png');
_pointerMenuButtonAActiveTex.colorSpace = THREE.SRGBColorSpace;

const _pointerMenuButtonBTex = new THREE.TextureLoader().load('static/ui-pointer-b-default.png');
_pointerMenuButtonBTex.colorSpace = THREE.SRGBColorSpace;
const _pointerMenuButtonBActiveTex = new THREE.TextureLoader().load('static/ui-pointer-b-active.png');
_pointerMenuButtonBActiveTex.colorSpace = THREE.SRGBColorSpace;

const _pointerMenuButtonCTex = new THREE.TextureLoader().load('static/ui-pointer-c-default.png');
_pointerMenuButtonCTex.colorSpace = THREE.SRGBColorSpace;
const _pointerMenuButtonCActiveTex = new THREE.TextureLoader().load('static/ui-pointer-c-active.png');
_pointerMenuButtonCActiveTex.colorSpace = THREE.SRGBColorSpace;

const pointerMenuButtonB = new THREE.Mesh(
    new THREE.PlaneGeometry(POINTER_MENU_PANEL_CHILD_WIDTH, POINTER_MENU_PANEL_CHILD_HEIGHT),
    new THREE.MeshBasicMaterial({
        map: _pointerMenuButtonBTex,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false
    })
);
pointerMenuButtonB.position.set(0, 0, 0.0005);
pointerMenuButtonB.frustumCulled = false;
pointerMenuPanel.add(pointerMenuButtonB);

const pointerMenuButtonA = new THREE.Mesh(
    new THREE.PlaneGeometry(POINTER_MENU_PANEL_CHILD_WIDTH, POINTER_MENU_PANEL_CHILD_HEIGHT),
    new THREE.MeshBasicMaterial({
        map: _pointerMenuButtonATex,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false
    })
);
pointerMenuButtonA.position.set(0, POINTER_MENU_PANEL_CHILD_SPACING_Y, 0.0005);
pointerMenuButtonA.frustumCulled = false;
pointerMenuPanel.add(pointerMenuButtonA);

const pointerMenuButtonC = new THREE.Mesh(
    new THREE.PlaneGeometry(POINTER_MENU_PANEL_CHILD_WIDTH, POINTER_MENU_PANEL_CHILD_HEIGHT),
    new THREE.MeshBasicMaterial({
        map: _pointerMenuButtonCTex,
        side: THREE.DoubleSide,
        transparent: true,
        depthTest: false,
        depthWrite: false
    })
);
pointerMenuButtonC.position.set(0, -POINTER_MENU_PANEL_CHILD_SPACING_Y, 0.0005);
pointerMenuButtonC.frustumCulled = false;
pointerMenuPanel.add(pointerMenuButtonC);

const pointerMenuState = {
    isOpen: false,
    cooldown: 0,
    activeButton: null,   // null | 'A' | 'B' | 'C'
    childCooldown: 0,
};
const _pointerMenuButtonToLaserMode = { A: '1-ray', B: '3-ray', C: 'dispersion' };

function setPointerMenuActiveButton(id) {
    pointerMenuState.activeButton = id;
    pointerMenuButtonA.material.map = (id === 'A') ? _pointerMenuButtonAActiveTex : _pointerMenuButtonATex;
    pointerMenuButtonA.material.needsUpdate = true;
    pointerMenuButtonB.material.map = (id === 'B') ? _pointerMenuButtonBActiveTex : _pointerMenuButtonBTex;
    pointerMenuButtonB.material.needsUpdate = true;
    pointerMenuButtonC.material.map = (id === 'C') ? _pointerMenuButtonCActiveTex : _pointerMenuButtonCTex;
    pointerMenuButtonC.material.needsUpdate = true;

    const newMode = _pointerMenuButtonToLaserMode[id];
    if (newMode && newMode !== deps.laserMode) {
        deps.laserMode = newMode;
        applyPointerShape();
    }
}

function openPointerMenu() {
    if (pointerMenuState.isOpen) return;
    pointerMenuState.isOpen = true;
    pointerMenuState.cooldown = POINTER_MENU_PANEL_COOLDOWN_DURATION;

    pointerMenuPanel.visible = true;
    gsap.killTweensOf(pointerMenuPanel.scale);
    gsap.to(pointerMenuPanel.scale, {
        x: 1, y: 1, z: 1,
        duration: 0.25,
        ease: 'power2.out'
    });
}

function closePointerMenu(force = false) {
    if (!force && !pointerMenuState.isOpen) return;
    pointerMenuState.isOpen = false;
    pointerMenuState.cooldown = POINTER_MENU_PANEL_COOLDOWN_DURATION;

    gsap.killTweensOf(pointerMenuPanel.scale);
    if (force) {
        pointerMenuPanel.scale.set(0, 0, 0);
        pointerMenuPanel.visible = false;
        return;
    }

    gsap.to(pointerMenuPanel.scale, {
        x: 0, y: 0, z: 0,
        duration: 0.15,
        ease: 'power2.in',
        onComplete: () => { pointerMenuPanel.visible = false; }
    });
}

// Sync button visuals with the default laserMode on startup
setPointerMenuActiveButton(deps.laserMode === '1-ray' ? 'A' : deps.laserMode === 'dispersion' ? 'C' : 'B');

const pointerMenuButtonPressAnim = { depthOffset: 0 };

const _pmButtonWorldPos = new THREE.Vector3();
const _pmCamWorldPos    = new THREE.Vector3();
const _pmFingerLocal    = new THREE.Vector3();
const _pmChildFingerLocal = new THREE.Vector3();
const _pmOffsetDir      = new THREE.Vector3();
const _pmButtonBaseWorldPos = new THREE.Vector3();

// ----------------------------------------------------------------

const POINTER_GRAB_EXTRA = 0.038;
const _pointerBoxHeight = pointerDims.crossX + 2 * THREE_RAY_SPACING;
const pointerGrabRadius =
    0.5 *
        Math.sqrt(
            pointerDims.crossX * pointerDims.crossX +
                _pointerBoxHeight * _pointerBoxHeight +
                pointerDims.barrelLenZ * pointerDims.barrelLenZ
        ) +
    POINTER_GRAB_EXTRA;

/** Index tip within this distance of the pointer hull (world) shows the tip dot before pinch. */
const POINTER_APPROACH_RADIUS = pointerGrabRadius * 2.15 + 0.01;
const POINTER_APPROACH_RADIUS_SQ = POINTER_APPROACH_RADIUS * POINTER_APPROACH_RADIUS;

/** Keeps Line2 visibility aligned with `laserMode` (also called every frame in `updatePointerLaser`). */
function syncLaserLineVisibility() {
    deps.laserSegments.visible = deps.laserMode !== 'dispersion';
    deps.dispersionSegments.visible = deps.laserMode === 'dispersion';
}

/** Call this whenever laserMode changes to swap the pointer mesh shape and ray visibility. */
function applyPointerShape() {
    pointerObj.geometry = deps.laserMode === '3-ray' ? pointerGeom3Ray : pointerGeom1Ray;
    pointerMenuButtonMaterial.map = _pointerMenuButtonTextures[deps.laserMode] || _pointerMenuButtonTextures['1-ray'];
    pointerMenuButtonMaterial.needsUpdate = true;
    syncLaserLineVisibility();
}

const pointerGrab = {
    active: false,
    /** @type {'left' | 'right' | null} */
    hand: null
};


    const api = {
        containerConfig,
        containerGroup,
        sceneOpticalMeshes,
        OPTICAL_TYPES,
        OPTICAL_PAGES,
        SHARED_MESH_GEOMS,
        typeInScene,
        mirrorsAvailableCount,
        acquireMirrorNumber,
        releaseMirrorNumber,
        spawnInitialSceneObject,
        addSceneInstance,
        disposeMeshNameLabel,
        redrawNameLabel,
        pointerObj,
        pointerDims,
        pointerGrab,
        pointerGrabRadius,
        DISPERSION_BANDS,
        DISPERSION_LINEWIDTH,
        THREE_RAY_SPACING,
        visualizeNormals,
        cauchyIOR,
        syncLaserLineVisibility,
        applyPointerShape,
        dismissRayModeHint,
        dismissGrabHint,
        pointerHintState,
        pointerMenuState,
        pointerMenuButton,
        pointerMenuPanel,
        pointerMenuButtonA,
        pointerMenuButtonB,
        pointerMenuButtonC,
        pointerMenuButtonMaterial,
        setPointerMenuActiveButton,
        openPointerMenu,
        closePointerMenu,
        STEPPER_MEDIUM_IOR_MAP,
        IOR_SLIDER_MIN,
        IOR_SLIDER_MAX,
        IOR_SLIDER_RANGE,
        formatIORValue,
        disableOpticalFrustumCulling,
        createNameLabelFor,
        availableMirrorNumbers,
        MAX_MIRRORS,
        updateContainerHeaderBillboard,
        updateSphereOutlines,
        OBJ_LABEL_Y_OFFSET,
        OBJ_LABEL_PRISM_EXTRA_Y_OFFSET,
        OBJ_LABEL_WORLD_SCENE_SCALE,
        OBJ_LABEL_HOVER_DIST,
        _camWorldPos,
        _containerWorldQuat,
        _pointerTipLocal,
        _pointerTipGapDir,
        POINTER_TIP_DOT_GAP,
        POINTER_MENU_BUTTON_PRESS_DIST,
        POINTER_MENU_PANEL_CHILD_WIDTH,
        POINTER_MENU_PANEL_CHILD_HEIGHT,
        POINTER_MENU_PANEL_COOLDOWN_DURATION,
        POINTER_MENU_BUTTON_Z_POP,
        POINTER_MENU_PANEL_OFFSET_Y,
        POINTER_MENU_PANEL_Z_POP,
        POINTER_GRAB_HINT_3RAY_Y_OFFSET,
        _pmButtonWorldPos,
        _pmChildFingerLocal,
        _pmCamWorldPos,
        _pmOffsetDir,
        _pmButtonBaseWorldPos,
        pointerMenuButtonPressAnim,
        pointerRayModeHint,
        pointerGrabHint,
    };
    Object.assign(deps, api);
    return api;
}
