import * as THREE from 'three';
import { DEFAULT_HEAD_OFFSET } from './XRHeadPlacement.js';

export function createContainer(deps) {
    const { scene } = deps;
/**
 * Container Cube
 */
const containerSize = 0.4;
const cubeGeometry = new THREE.BoxGeometry(containerSize, containerSize, containerSize);
const cubeEdges = new THREE.EdgesGeometry(cubeGeometry);
const cubeMaterial = new THREE.LineBasicMaterial({ 
    color: 0xffffff
});
const containerCube = new THREE.LineSegments(cubeEdges, cubeMaterial);
/** Desktop / pre-XR preview — fixed world position (floor-relative). */
const DESKTOP_CONTAINER_POS = new THREE.Vector3(0, 1.25, -1.3);
/** Head-local offset applied when an immersive session starts. */
const HEAD_OFFSET = { ...DEFAULT_HEAD_OFFSET };
containerCube.position.copy(DESKTOP_CONTAINER_POS);
containerCube.frustumCulled = false; // Always visible on narrow FOV AR glasses
scene.add(containerCube);

// Header anchor above cube center (mesh kept invisible)
const UIHeaderRefGeometry = new THREE.SphereGeometry(0.015, 16, 16);
const UIHeaderRefMaterial = new THREE.MeshBasicMaterial({ color: 0xff0088 });
const UIHeaderRef = new THREE.Mesh(UIHeaderRefGeometry, UIHeaderRefMaterial);
UIHeaderRef.position.set(0, containerSize * 0.5 + 0.2, 0);
UIHeaderRef.frustumCulled = false;
UIHeaderRef.name = 'UIHeaderRef';
UIHeaderRef.visible = false;
containerCube.add(UIHeaderRef);

// Bottom edge reference points - kept in WORLD SPACE with absolute offsets
const edgeOffset = containerSize * 0.5; // Base offset (half container size at scale 1)
const outerOffset = 0.08;  // ABSOLUTE distance outward from edge (doesn't scale)
const downOffset = 0.08;   // ABSOLUTE distance below cube (doesn't scale)

const UIReferencePoint = [
    new THREE.Object3D(), // Front
    new THREE.Object3D(), // Back
    new THREE.Object3D(), // Left
    new THREE.Object3D()  // Right
];

// Add to scene (world space), not cube
UIReferencePoint.forEach(point => scene.add(point));

// World-space root for header UI that mirrors header reference sphere
const UIHeaderRoot = new THREE.Object3D();
UIHeaderRoot.name = 'UIHeaderRoot';
UIHeaderRoot.frustumCulled = false;
scene.add(UIHeaderRoot);

const UI_HEADER_Y_MARGIN = 0.14;

// Local edge positions (at scale 1) - these get scaled with the cube
const edgeLocalPositions = [
    new THREE.Vector3(0, -edgeOffset, -edgeOffset),  // Front edge midpoint
    new THREE.Vector3(0, -edgeOffset, edgeOffset),   // Back edge midpoint
    new THREE.Vector3(-edgeOffset, -edgeOffset, 0),  // Left edge midpoint
    new THREE.Vector3(edgeOffset, -edgeOffset, 0)    // Right edge midpoint
];

// Offset directions (local space) - for applying absolute offsets
const edgeOffsetDirections = [
    new THREE.Vector3(0, -1, -1).normalize(),  // Front: down and forward
    new THREE.Vector3(0, -1, 1).normalize(),   // Back: down and backward
    new THREE.Vector3(-1, -1, 0).normalize(),  // Left: down and left
    new THREE.Vector3(1, -1, 0).normalize()    // Right: down and right
];

// Helper vectors for dynamic positioning
const _edgeWorldPos = new THREE.Vector3();
const _offsetDir = new THREE.Vector3();

// Update UIReferencePoint positions based on current cube transform
function updateUIReferencePositions() {
    const scale = containerCube.scale.x;
    
    for (let i = 0; i < 4; i++) {
        // Get scaled edge position in world space
        _edgeWorldPos.copy(edgeLocalPositions[i])
            .multiplyScalar(scale)
            .applyQuaternion(containerCube.quaternion)
            .add(containerCube.position);
        
        // Get world-space offset direction
        _offsetDir.copy(edgeOffsetDirections[i])
            .applyQuaternion(containerCube.quaternion);
        
        // Apply FIXED offset (outerOffset + downOffset combined as diagonal)
        const combinedOffset = Math.sqrt(outerOffset * outerOffset + downOffset * downOffset);
        _edgeWorldPos.addScaledVector(_offsetDir, combinedOffset);
        
        // Set reference point position
        UIReferencePoint[i].position.copy(_edgeWorldPos);
        
        // Match cube rotation for proper alignment
        UIReferencePoint[i].quaternion.copy(containerCube.quaternion);
    }
}

function updateUIHeaderRefPosition() {
    const scale = containerCube.scale.x || 1;
    const localY = containerSize * 0.5 + UI_HEADER_Y_MARGIN / scale;
    UIHeaderRef.position.set(0, localY, 0);
}

// Keep the world-space header root synced with the UIHeaderRef sphere and facing the camera horizontally

// Skip container-derived UI layout when cube hasn't moved/scaled/rotated
const _containerLayoutCache = {
    posX: NaN, posY: NaN, posZ: NaN,
    quatX: NaN, quatY: NaN, quatZ: NaN, quatW: NaN,
    scale: NaN
};

function containerTransformChanged() {
    const p = containerCube.position;
    const q = containerCube.quaternion;
    const s = containerCube.scale.x;
    const c = _containerLayoutCache;
    if (
        p.x === c.posX && p.y === c.posY && p.z === c.posZ &&
        q.x === c.quatX && q.y === c.quatY && q.z === c.quatZ && q.w === c.quatW &&
        s === c.scale
    ) {
        return false;
    }
    c.posX = p.x; c.posY = p.y; c.posZ = p.z;
    c.quatX = q.x; c.quatY = q.y; c.quatZ = q.z; c.quatW = q.w;
    c.scale = s;
    return true;
}

// UI reference points are now empty Object3Ds (no visible debug spheres)

// Initialize positions at startup
updateUIReferencePositions();
updateUIHeaderRefPosition();

// Edge outward directions (local space, for facing detection)
const UIReferenceNormals = [
    new THREE.Vector3(0, 0, -1),  // Front - faces -Z
    new THREE.Vector3(0, 0, 1),   // Back - faces +Z
    new THREE.Vector3(-1, 0, 0),  // Left - faces -X
    new THREE.Vector3(1, 0, 0)    // Right - faces +X
];

    const api = {
        containerSize,
        containerCube,
        DESKTOP_CONTAINER_POS,
        HEAD_OFFSET,
        UIHeaderRef,
        edgeOffset,
        outerOffset,
        downOffset,
        UIReferencePoint,
        UIHeaderRoot,
        UI_HEADER_Y_MARGIN,
        edgeLocalPositions,
        edgeOffsetDirections,
        updateUIReferencePositions,
        updateUIHeaderRefPosition,
        _containerLayoutCache,
        containerTransformChanged,
        UIReferenceNormals
    };
    Object.assign(deps, api);
    return api;
}
