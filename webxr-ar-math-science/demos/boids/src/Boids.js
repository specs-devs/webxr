import * as THREE from 'three';

export function createBoids(deps) {
    const { scene, containerSize, containerCube } = deps;
/**
 * Spatial Hash Grid for O(n) neighbor lookups
 * Packed int keys + pooled cell arrays (no string keys / per-frame alloc)
 */
class SpatialHash {
    constructor(cellSize, containerSize) {
        this.cellSize = cellSize;
        this.invCellSize = 1 / cellSize;
        this.halfContainer = containerSize * 0.5;
        // Pack cx/cy/cz into one int: key = ox + oy * GRID + oz * GRID^2
        this.GRID = 32;
        this.OFFSET = 16;
        this.cells = new Map();      // key → reusable index array
        this.activeKeys = [];        // keys touched this frame (capacity grows once)
        this.activeCount = 0;
        this.neighborIndices = [];
    }
    
    // Convert cell coords → packed int key
    packKey(cx, cy, cz) {
        return (cx + this.OFFSET) + (cy + this.OFFSET) * this.GRID + (cz + this.OFFSET) * this.GRID * this.GRID;
    }
    
    // Convert position → packed int key
    getKey(x, y, z) {
        const inv = this.invCellSize;
        const h = this.halfContainer;
        const cx = Math.floor((x + h) * inv);
        const cy = Math.floor((y + h) * inv);
        const cz = Math.floor((z + h) * inv);
        return this.packKey(cx, cy, cz);
    }
    
    // Reset cell lengths; reuse arrays and Map entries across frames
    clear() {
        const keys = this.activeKeys;
        const cells = this.cells;
        for (let i = 0; i < this.activeCount; i++) {
            cells.get(keys[i]).length = 0;
        }
        this.activeCount = 0;
    }
    
    // Insert boid index at position
    insert(index, x, y, z) {
        const key = this.getKey(x, y, z);
        let cell = this.cells.get(key);
        if (!cell) {
            cell = [];
            this.cells.set(key, cell);
        }
        if (cell.length === 0) {
            this.activeKeys[this.activeCount++] = key;
        }
        cell.push(index);
    }
    
    // Get all boid indices in neighboring cells (including current)
    getNeighborIndices(x, y, z) {
        const neighbors = this.neighborIndices;
        neighbors.length = 0;
        
        const inv = this.invCellSize;
        const h = this.halfContainer;
        const cx = Math.floor((x + h) * inv);
        const cy = Math.floor((y + h) * inv);
        const cz = Math.floor((z + h) * inv);
        const cells = this.cells;
        const grid = this.GRID;
        const offset = this.OFFSET;
        const gridSq = grid * grid;
        
        // Check 3x3x3 neighborhood
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const key = (cx + dx + offset) + (cy + dy + offset) * grid + (cz + dz + offset) * gridSq;
                    const cell = cells.get(key);
                    if (cell) {
                        for (let i = 0, n = cell.length; i < n; i++) {
                            neighbors.push(cell[i]);
                        }
                    }
                }
            }
        }
        
        return neighbors;
    }
}

/**
 * Boids Simulation - Optimized
 */
const maxBoidsCount = 500; // Maximum boids for pre-allocation
const boidsConfig = {
    count: 200, // Current active count
    maxSpeed: 0.3,
    maxSpeedSq: 0.3 * 0.3, // Pre-computed squared
    maxForce: 0.008,
    separationDist: 0.04,
    separationDistSq: 0.04 * 0.04, // Pre-computed squared
    alignmentDist: 0.08,
    alignmentDistSq: 0.08 * 0.08,
    cohesionDist: 0.1,
    cohesionDistSq: 0.1 * 0.1,
    separationWeight: 1.5,
    alignmentWeight: 1.0,
    cohesionWeight: 1.0,
    boundaryMargin: containerSize * 0.45,
    // Hand interaction
    handRepulsionDist: 0.15,
    handRepulsionDistSq: 0.15 * 0.15,
    handRepulsionWeight: 1.0
};


// Dynamically scaled config values (updated each frame based on container scale)
// This ensures consistent flocking behavior regardless of container size
const scaledConfig = {
    separationDistSq: boidsConfig.separationDistSq,
    alignmentDistSq: boidsConfig.alignmentDistSq,
    cohesionDistSq: boidsConfig.cohesionDistSq,
    maxSpeed: boidsConfig.maxSpeed,
    maxSpeedSq: boidsConfig.maxSpeedSq,
    maxForce: boidsConfig.maxForce,
    handRepulsionDistSq: boidsConfig.handRepulsionDistSq,
    handRepulsionDist: boidsConfig.handRepulsionDist
};

// Create spatial hash with cell size = largest interaction radius
const spatialHash = new SpatialHash(boidsConfig.cohesionDist, containerSize);

/**
 * Object Pool - Pre-allocated vectors for calculations
 */
const pool = {
    // For flocking calculations
    steer: new THREE.Vector3(),
    diff: new THREE.Vector3(),
    sum: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    bounds: new THREE.Vector3(),
    // For separation
    sepSteer: new THREE.Vector3(),
    sepDiff: new THREE.Vector3(),
    // For alignment
    aliSum: new THREE.Vector3(),
    aliSteer: new THREE.Vector3(),
    // For cohesion
    cohSum: new THREE.Vector3(),
    // For flee
    fleeDiff: new THREE.Vector3(),
    // For update
    velDelta: new THREE.Vector3(),
    // For mesh orientation
    direction: new THREE.Vector3(),
    // Temp vectors
    temp1: new THREE.Vector3(),
    temp2: new THREE.Vector3()
};

// Boid data stored in flat arrays for cache efficiency (pre-allocated for max)
const boidPositions = new Float32Array(maxBoidsCount * 3);
const boidVelocities = new Float32Array(maxBoidsCount * 3);
const boidAccelerations = new Float32Array(maxBoidsCount * 3);

// Initialize boid data
const halfSize = containerSize * 0.5;
for (let i = 0; i < maxBoidsCount; i++) {
    const i3 = i * 3;
    // Position
    boidPositions[i3] = (Math.random() - 0.5) * containerSize * 0.8;
    boidPositions[i3 + 1] = (Math.random() - 0.5) * containerSize * 0.8;
    boidPositions[i3 + 2] = (Math.random() - 0.5) * containerSize * 0.8;
    // Velocity
    boidVelocities[i3] = (Math.random() - 0.5) * 0.1;
    boidVelocities[i3 + 1] = (Math.random() - 0.5) * 0.1;
    boidVelocities[i3 + 2] = (Math.random() - 0.5) * 0.1;
    // Acceleration starts at 0
    boidAccelerations[i3] = 0;
    boidAccelerations[i3 + 1] = 0;
    boidAccelerations[i3 + 2] = 0;
}

/**
 * InstancedMesh Setup - Single draw call for all boids
 */
const boidGeometry = new THREE.ConeGeometry(0.006, 0.02, 4);
const boidMaterial = new THREE.MeshBasicMaterial({ 
    vertexColors: false 
});

// Create instanced mesh (pre-allocated for max, count controls visible)
const boidInstancedMesh = new THREE.InstancedMesh(boidGeometry, boidMaterial, maxBoidsCount);
boidInstancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
// Disable frustum culling - prevents boids from disappearing on narrow FOV AR glasses
boidInstancedMesh.frustumCulled = false;
boidInstancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(maxBoidsCount * 3), 3
);
boidInstancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
boidInstancedMesh.count = boidsConfig.count; // Only render active boids

// Gradient colors for speed visualization
const colorA = new THREE.Color('#F99540'); // Orange (slow)
const colorB = new THREE.Color('#F0F921'); // Yellow (fast)
const tempColor = new THREE.Color();

// Group to hold boids (positioned at cube center)
const boidsGroup = new THREE.Group();
boidsGroup.position.copy(containerCube.position);
boidsGroup.add(boidInstancedMesh);
boidsGroup.frustumCulled = false; // Ensure group is never culled on narrow FOV
scene.add(boidsGroup);

function syncBoidsGroupToContainer() {
    boidsGroup.position.copy(containerCube.position);
    boidsGroup.quaternion.copy(containerCube.quaternion);
    boidsGroup.scale.copy(containerCube.scale);
}

// Helper for mesh orientation
const _upVector = new THREE.Vector3(0, 1, 0);
const _quaternion = new THREE.Quaternion();
const _matrix = new THREE.Matrix4();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3(1, 1, 1);

// Initialize instance matrices and colors (for all pre-allocated boids)
for (let i = 0; i < maxBoidsCount; i++) {
    const i3 = i * 3;
    _position.set(boidPositions[i3], boidPositions[i3 + 1], boidPositions[i3 + 2]);
    _matrix.compose(_position, _quaternion, _scale);
    boidInstancedMesh.setMatrixAt(i, _matrix);
    
    // Initial color
    boidInstancedMesh.instanceColor.setXYZ(i, colorA.r, colorA.g, colorA.b);
}
boidInstancedMesh.instanceMatrix.needsUpdate = true;
boidInstancedMesh.instanceColor.needsUpdate = true;

/**
 * Trail System - Long colored fading tails (independent per boid)
 */
const trailConfig = {
    enabled: true,
    length: 100, // Number of points in each trail (longer trail)
    updateInterval: 1 // Update trail every frame for smooth trails
};

// Trail position history - circular buffer for each boid
const trailPositions = new Array(maxBoidsCount);
const trailIndices = new Uint8Array(maxBoidsCount); // Current write position in circular buffer
deps.trailUpdateCounter = 0;

// Initialize trail buffers
for (let i = 0; i < maxBoidsCount; i++) {
    trailPositions[i] = new Float32Array(trailConfig.length * 3);
    trailIndices[i] = 0;
    // Fill with current position
    const i3 = i * 3;
    for (let j = 0; j < trailConfig.length; j++) {
        const j3 = j * 3;
        trailPositions[i][j3] = boidPositions[i3];
        trailPositions[i][j3 + 1] = boidPositions[i3 + 1];
        trailPositions[i][j3 + 2] = boidPositions[i3 + 2];
    }
}

// Create line geometry for colored trails - using LineSegments with duplicated vertices
// Each trail segment needs 2 vertices: [p0, p1], [p1, p2], [p2, p3]...
const trailGeometry = new THREE.BufferGeometry();
const segmentsPerTrail = trailConfig.length - 1;
const verticesPerTrail = segmentsPerTrail * 2; // 2 vertices per segment
const maxTrailVertices = maxBoidsCount * verticesPerTrail;
const trailPositionArray = new Float32Array(maxTrailVertices * 3);
const trailColorArray = new Float32Array(maxTrailVertices * 3);
const trailAlphaArray = new Float32Array(maxTrailVertices); // Per-vertex alpha

trailGeometry.setAttribute('position', new THREE.BufferAttribute(trailPositionArray, 3));
trailGeometry.setAttribute('color', new THREE.BufferAttribute(trailColorArray, 3));
trailGeometry.setAttribute('alpha', new THREE.BufferAttribute(trailAlphaArray, 1));
trailGeometry.setDrawRange(0, boidsConfig.count * verticesPerTrail);

// Custom shader material for per-vertex alpha
const trailMaterial = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: `
        attribute float alpha;
        varying vec3 vColor;
        varying float vAlpha;
        
        void main() {
            vColor = color;
            vAlpha = alpha;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    fragmentShader: `
        varying vec3 vColor;
        varying float vAlpha;
        
        void main() {
            gl_FragColor = vec4(vColor, vAlpha);
        }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true
});

const trailLines = new THREE.LineSegments(trailGeometry, trailMaterial);
trailLines.frustumCulled = false;
boidsGroup.add(trailLines);

deps.trailsEnabled = false;

function setTrailsEnabled(enabled) {
    deps.trailsEnabled = enabled;
    trailConfig.enabled = enabled;
    trailLines.visible = enabled;
    const drawCount = enabled ? boidsConfig.count * verticesPerTrail : 0;
    trailGeometry.setDrawRange(0, drawCount);
}

setTrailsEnabled(deps.trailsEnabled);

/**
 * Update colored trail lines for all active boids
 */
function updateTrails() {
    const posAttr = trailGeometry.attributes.position;
    const colorAttr = trailGeometry.attributes.color;
    const alphaAttr = trailGeometry.attributes.alpha;
    const segmentsPerTrail = trailConfig.length - 1;
    const verticesPerTrail = segmentsPerTrail * 2;
    
    for (let i = 0; i < boidsConfig.count; i++) {
        const i3 = i * 3;
        const currentIdx = trailIndices[i];
        const trail = trailPositions[i];
        
        // Add current position to trail buffer (circular)
        const writeIdx = currentIdx * 3;
        trail[writeIdx] = boidPositions[i3];
        trail[writeIdx + 1] = boidPositions[i3 + 1];
        trail[writeIdx + 2] = boidPositions[i3 + 2];
        
        // Update circular buffer index
        trailIndices[i] = (currentIdx + 1) % trailConfig.length;
        
        // Get boid's current color (yellow/orange based on speed)
        const boidR = boidInstancedMesh.instanceColor.getX(i);
        const boidG = boidInstancedMesh.instanceColor.getY(i);
        const boidB = boidInstancedMesh.instanceColor.getZ(i);
        
        // Write trail segments (each segment = 2 vertices for LineSegments)
        const baseVertex = i * verticesPerTrail;
        
        for (let j = 0; j < segmentsPerTrail; j++) {
            // Read two consecutive points from circular buffer
            const readIdx1 = (trailIndices[i] + j) % trailConfig.length;
            const readIdx2 = (trailIndices[i] + j + 1) % trailConfig.length;
            
            const readIdx1_3 = readIdx1 * 3;
            const readIdx2_3 = readIdx2 * 3;
            
            // Write segment start vertex (first point)
            const vertex1Idx = baseVertex + j * 2;
            const vertex1Idx3 = vertex1Idx * 3;
            posAttr.array[vertex1Idx3] = trail[readIdx1_3];
            posAttr.array[vertex1Idx3 + 1] = trail[readIdx1_3 + 1];
            posAttr.array[vertex1Idx3 + 2] = trail[readIdx1_3 + 2];
            
            // Write segment end vertex (second point)
            const vertex2Idx = baseVertex + j * 2 + 1;
            const vertex2Idx3 = vertex2Idx * 3;
            posAttr.array[vertex2Idx3] = trail[readIdx2_3];
            posAttr.array[vertex2Idx3 + 1] = trail[readIdx2_3 + 1];
            posAttr.array[vertex2Idx3 + 2] = trail[readIdx2_3 + 2];
            
            // Fade factors for both vertices of this segment
            const fadeFactor1 = j / segmentsPerTrail;
            const fadeFactor2 = (j + 1) / segmentsPerTrail;
            const alpha1 = fadeFactor1 * fadeFactor1; // Squared for dramatic fade
            const alpha2 = fadeFactor2 * fadeFactor2;
            
            // Boid color (keep full color, don't multiply by alpha)
            colorAttr.array[vertex1Idx3] = boidR;
            colorAttr.array[vertex1Idx3 + 1] = boidG;
            colorAttr.array[vertex1Idx3 + 2] = boidB;
            
            colorAttr.array[vertex2Idx3] = boidR;
            colorAttr.array[vertex2Idx3 + 1] = boidG;
            colorAttr.array[vertex2Idx3 + 2] = boidB;
            
            // Set alpha separately (transparent to opaque)
            alphaAttr.array[vertex1Idx] = alpha1;
            alphaAttr.array[vertex2Idx] = alpha2;
        }
    }
    
    posAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    alphaAttr.needsUpdate = true;
}

/**
 * Update the number of active boids at runtime
 */
function updateBoidsCount(newCount) {
    // Clamp to valid range
    newCount = Math.max(50, Math.min(maxBoidsCount, newCount));
    
    // Update config
    boidsConfig.count = newCount;
    
    // Update instanced mesh visible count
    boidInstancedMesh.count = newCount;
    
    // Update trail draw range
    if (trailConfig.enabled) {
        const segmentsPerTrail = trailConfig.length - 1;
        const verticesPerTrail = segmentsPerTrail * 2;
        trailGeometry.setDrawRange(0, newCount * verticesPerTrail);
    }
}

// Hand positions for boid interaction (in local boids space)
const handPositions = {
    left: new THREE.Vector3(),
    right: new THREE.Vector3(),
    leftActive: false,
    rightActive: false
};

// Boid size compensation when container scales
const boidScaleConfig = {
    minScale: 0.5,  // Boids won't shrink below 50% of original (for big containers)
    maxScale: 1.0   // Boids won't grow above 100% of original (for small containers)
};

// Clamp vector length into shared out (no per-call allocation)
const _clampOut = { x: 0, y: 0, z: 0 };
function clampLength(vx, vy, vz, maxLength, maxLengthSq) {
    const lenSq = vx * vx + vy * vy + vz * vz;
    if (lenSq > maxLengthSq) {
        const scale = maxLength / Math.sqrt(lenSq);
        _clampOut.x = vx * scale;
        _clampOut.y = vy * scale;
        _clampOut.z = vz * scale;
    } else {
        _clampOut.x = vx;
        _clampOut.y = vy;
        _clampOut.z = vz;
    }
    return _clampOut;
}

// Calculate flocking forces for a single boid
function calculateFlocking(index, neighborIndices) {
    const i3 = index * 3;
    const px = boidPositions[i3];
    const py = boidPositions[i3 + 1];
    const pz = boidPositions[i3 + 2];
    const vx = boidVelocities[i3];
    const vy = boidVelocities[i3 + 1];
    const vz = boidVelocities[i3 + 2];
    
    // Accumulators
    let sepX = 0, sepY = 0, sepZ = 0, sepCount = 0;
    let aliX = 0, aliY = 0, aliZ = 0, aliCount = 0;
    let cohX = 0, cohY = 0, cohZ = 0, cohCount = 0;
    
    // Single pass through neighbors for all three behaviors
    for (let n = 0; n < neighborIndices.length; n++) {
        const otherIndex = neighborIndices[n];
        if (otherIndex === index) continue;
        
        const o3 = otherIndex * 3;
        const dx = px - boidPositions[o3];
        const dy = py - boidPositions[o3 + 1];
        const dz = pz - boidPositions[o3 + 2];
        const distSq = dx * dx + dy * dy + dz * dz;
        
        // Separation (closest) - using scaled distance for consistent behavior
        if (distSq > 0 && distSq < scaledConfig.separationDistSq) {
            const dist = Math.sqrt(distSq);
            const factor = 1 / (dist * dist); // Inverse square
            sepX += dx / dist * factor;
            sepY += dy / dist * factor;
            sepZ += dz / dist * factor;
            sepCount++;
        }
        
        // Alignment - using scaled distance
        if (distSq > 0 && distSq < scaledConfig.alignmentDistSq) {
            aliX += boidVelocities[o3];
            aliY += boidVelocities[o3 + 1];
            aliZ += boidVelocities[o3 + 2];
            aliCount++;
        }
        
        // Cohesion (largest radius) - using scaled distance
        if (distSq > 0 && distSq < scaledConfig.cohesionDistSq) {
            cohX += boidPositions[o3];
            cohY += boidPositions[o3 + 1];
            cohZ += boidPositions[o3 + 2];
            cohCount++;
        }
    }
    
    let ax = 0, ay = 0, az = 0;
    
    // Process separation
    if (sepCount > 0) {
        sepX /= sepCount;
        sepY /= sepCount;
        sepZ /= sepCount;
        // Normalize and scale - using scaled maxSpeed/maxForce
        const sepLen = Math.sqrt(sepX * sepX + sepY * sepY + sepZ * sepZ);
        if (sepLen > 0) {
            sepX = sepX / sepLen * scaledConfig.maxSpeed - vx;
            sepY = sepY / sepLen * scaledConfig.maxSpeed - vy;
            sepZ = sepZ / sepLen * scaledConfig.maxSpeed - vz;
            const clamped = clampLength(sepX, sepY, sepZ, scaledConfig.maxForce, scaledConfig.maxForce * scaledConfig.maxForce);
            ax += clamped.x * boidsConfig.separationWeight;
            ay += clamped.y * boidsConfig.separationWeight;
            az += clamped.z * boidsConfig.separationWeight;
        }
    }
    
    // Process alignment - using scaled maxSpeed/maxForce
    if (aliCount > 0) {
        aliX /= aliCount;
        aliY /= aliCount;
        aliZ /= aliCount;
        const aliLen = Math.sqrt(aliX * aliX + aliY * aliY + aliZ * aliZ);
        if (aliLen > 0) {
            aliX = aliX / aliLen * scaledConfig.maxSpeed - vx;
            aliY = aliY / aliLen * scaledConfig.maxSpeed - vy;
            aliZ = aliZ / aliLen * scaledConfig.maxSpeed - vz;
            const clamped = clampLength(aliX, aliY, aliZ, scaledConfig.maxForce, scaledConfig.maxForce * scaledConfig.maxForce);
            ax += clamped.x * boidsConfig.alignmentWeight;
            ay += clamped.y * boidsConfig.alignmentWeight;
            az += clamped.z * boidsConfig.alignmentWeight;
        }
    }
    
    // Process cohesion (seek average position) - using scaled maxSpeed/maxForce
    if (cohCount > 0) {
        cohX = cohX / cohCount - px;
        cohY = cohY / cohCount - py;
        cohZ = cohZ / cohCount - pz;
        const cohLen = Math.sqrt(cohX * cohX + cohY * cohY + cohZ * cohZ);
        if (cohLen > 0) {
            cohX = cohX / cohLen * scaledConfig.maxSpeed - vx;
            cohY = cohY / cohLen * scaledConfig.maxSpeed - vy;
            cohZ = cohZ / cohLen * scaledConfig.maxSpeed - vz;
            const clamped = clampLength(cohX, cohY, cohZ, scaledConfig.maxForce, scaledConfig.maxForce * scaledConfig.maxForce);
            ax += clamped.x * boidsConfig.cohesionWeight;
            ay += clamped.y * boidsConfig.cohesionWeight;
            az += clamped.z * boidsConfig.cohesionWeight;
        }
    }
    
    // Boundaries - using scaled force/speed for consistent behavior
    const turnZone = containerSize * 0.15;
    
    // X boundaries
    const distToMaxX = halfSize - px;
    const distToMinX = px + halfSize;
    if (distToMaxX < turnZone && distToMaxX > 0) {
        ax -= scaledConfig.maxForce * (1 - distToMaxX / turnZone) * 3;
    }
    if (distToMinX < turnZone && distToMinX > 0) {
        ax += scaledConfig.maxForce * (1 - distToMinX / turnZone) * 3;
    }
    if (px > halfSize) ax -= scaledConfig.maxSpeed;
    else if (px < -halfSize) ax += scaledConfig.maxSpeed;
    
    // Y boundaries
    const distToMaxY = halfSize - py;
    const distToMinY = py + halfSize;
    if (distToMaxY < turnZone && distToMaxY > 0) {
        ay -= scaledConfig.maxForce * (1 - distToMaxY / turnZone) * 3;
    }
    if (distToMinY < turnZone && distToMinY > 0) {
        ay += scaledConfig.maxForce * (1 - distToMinY / turnZone) * 3;
    }
    if (py > halfSize) ay -= scaledConfig.maxSpeed;
    else if (py < -halfSize) ay += scaledConfig.maxSpeed;
    
    // Z boundaries
    const distToMaxZ = halfSize - pz;
    const distToMinZ = pz + halfSize;
    if (distToMaxZ < turnZone && distToMaxZ > 0) {
        az -= scaledConfig.maxForce * (1 - distToMaxZ / turnZone) * 3;
    }
    if (distToMinZ < turnZone && distToMinZ > 0) {
        az += scaledConfig.maxForce * (1 - distToMinZ / turnZone) * 3;
    }
    if (pz > halfSize) az -= scaledConfig.maxSpeed;
    else if (pz < -halfSize) az += scaledConfig.maxSpeed;
    
    // Store acceleration
    boidAccelerations[i3] = ax;
    boidAccelerations[i3 + 1] = ay;
    boidAccelerations[i3 + 2] = az;
}

// Calculate flee force from hand - using scaled values for consistent behavior
function applyHandRepulsion(index, handPos) {
    const i3 = index * 3;
    const dx = boidPositions[i3] - handPos.x;
    const dy = boidPositions[i3 + 1] - handPos.y;
    const dz = boidPositions[i3 + 2] - handPos.z;
    const distSq = dx * dx + dy * dy + dz * dz;
    
    if (distSq > 0 && distSq < scaledConfig.handRepulsionDistSq) {
        const dist = Math.sqrt(distSq);
        const maxDist = scaledConfig.handRepulsionDist;
        const normalizedDist = dist / maxDist;
        const strength = Math.pow(1 - normalizedDist, 2) / Math.max(normalizedDist, 0.1);
        
        const factor = scaledConfig.maxSpeed * strength * boidsConfig.handRepulsionWeight / dist;
        boidVelocities[i3] += dx * factor;
        boidVelocities[i3 + 1] += dy * factor;
        boidVelocities[i3 + 2] += dz * factor;
        
        return true; // Near hand
    }
    return false;
}

// Update boids simulation
function updateBoids(delta) {
    // Pre-calculate boid inverse scale for this frame (same for all boids)
    const containerScale = boidsGroup.scale.x;
    let boidInverseScale = 1.0 / containerScale;
    boidInverseScale = Math.max(boidScaleConfig.minScale, Math.min(boidScaleConfig.maxScale, boidInverseScale));
    _scale.setScalar(boidInverseScale);
    
    // Update scaled config values to maintain consistent behavior across scales
    // Distances scale with boidInverseScale (so boids stay proportionally spaced relative to their visual size)
    const distScale = boidInverseScale;
    const distScaleSq = distScale * distScale;
    scaledConfig.separationDistSq = boidsConfig.separationDistSq * distScaleSq;
    scaledConfig.alignmentDistSq = boidsConfig.alignmentDistSq * distScaleSq;
    scaledConfig.cohesionDistSq = boidsConfig.cohesionDistSq * distScaleSq;
    scaledConfig.maxSpeed = boidsConfig.maxSpeed * distScale;
    scaledConfig.maxSpeedSq = scaledConfig.maxSpeed * scaledConfig.maxSpeed;
    scaledConfig.maxForce = boidsConfig.maxForce * distScale;
    // Hand repulsion uses ACTUAL inverse scale (not clamped) to maintain consistent world-space interaction
    // This matches the hand position conversion which divides by actual containerScale
    const actualInverseScale = 1.0 / containerScale;
    scaledConfig.handRepulsionDist = boidsConfig.handRepulsionDist * actualInverseScale;
    scaledConfig.handRepulsionDistSq = scaledConfig.handRepulsionDist * scaledConfig.handRepulsionDist;
    
    // Rebuild spatial hash
    spatialHash.clear();
    for (let i = 0; i < boidsConfig.count; i++) {
        const i3 = i * 3;
        spatialHash.insert(i, boidPositions[i3], boidPositions[i3 + 1], boidPositions[i3 + 2]);
    }
    
    // Calculate flocking forces using spatial hash
    for (let i = 0; i < boidsConfig.count; i++) {
        const i3 = i * 3;
        const neighbors = spatialHash.getNeighborIndices(
            boidPositions[i3], 
            boidPositions[i3 + 1], 
            boidPositions[i3 + 2]
        );
        calculateFlocking(i, neighbors);
    }
    
    // Apply hand repulsion and update positions
    for (let i = 0; i < boidsConfig.count; i++) {
        const i3 = i * 3;
        
        // Hand repulsion
        let nearHand = false;
        if (handPositions.leftActive) {
            nearHand = applyHandRepulsion(i, handPositions.left) || nearHand;
        }
        if (handPositions.rightActive) {
            nearHand = applyHandRepulsion(i, handPositions.right) || nearHand;
        }
        
        // Update velocity
        boidVelocities[i3] += boidAccelerations[i3];
        boidVelocities[i3 + 1] += boidAccelerations[i3 + 1];
        boidVelocities[i3 + 2] += boidAccelerations[i3 + 2];
        
        // Clamp velocity (using scaled maxSpeed for consistent behavior)
        const maxSpd = nearHand ? scaledConfig.maxSpeed * 2.5 : scaledConfig.maxSpeed;
        const maxSpdSq = maxSpd * maxSpd;
        const velSq = boidVelocities[i3] * boidVelocities[i3] + 
                      boidVelocities[i3 + 1] * boidVelocities[i3 + 1] + 
                      boidVelocities[i3 + 2] * boidVelocities[i3 + 2];
        
        if (velSq > maxSpdSq) {
            const scale = maxSpd / Math.sqrt(velSq);
            boidVelocities[i3] *= scale;
            boidVelocities[i3 + 1] *= scale;
            boidVelocities[i3 + 2] *= scale;
        }
        
        // Update position
        boidPositions[i3] += boidVelocities[i3] * delta;
        boidPositions[i3 + 1] += boidVelocities[i3 + 1] * delta;
        boidPositions[i3 + 2] += boidVelocities[i3 + 2] * delta;
        
        // Reset acceleration
        boidAccelerations[i3] = 0;
        boidAccelerations[i3 + 1] = 0;
        boidAccelerations[i3 + 2] = 0;
        
        // Update instance matrix
        _position.set(boidPositions[i3], boidPositions[i3 + 1], boidPositions[i3 + 2]);
        
        // Orient to velocity
        if (velSq > 0.0001) {
            pool.direction.set(boidVelocities[i3], boidVelocities[i3 + 1], boidVelocities[i3 + 2]).normalize();
            _quaternion.setFromUnitVectors(_upVector, pool.direction);
        }
        
        // _scale already set at start of updateBoids() with inverse container scale
        _matrix.compose(_position, _quaternion, _scale);
        boidInstancedMesh.setMatrixAt(i, _matrix);
        
        // Update color based on speed (using scaled maxSpeed for consistent coloring)
        const speed = Math.sqrt(velSq);
        const speedRatio = Math.min(speed / scaledConfig.maxSpeed, 1);
        tempColor.lerpColors(colorA, colorB, speedRatio);
        boidInstancedMesh.instanceColor.setXYZ(i, tempColor.r, tempColor.g, tempColor.b);
    }
    
    boidInstancedMesh.instanceMatrix.needsUpdate = true;
    boidInstancedMesh.instanceColor.needsUpdate = true;
}


    const api = {
        SpatialHash,
        maxBoidsCount,
        boidsConfig,
        scaledConfig,
        spatialHash,
        pool,
        boidPositions,
        boidVelocities,
        boidAccelerations,
        halfSize,
        boidInstancedMesh,
        boidsGroup,
        syncBoidsGroupToContainer,
        colorA,
        colorB,
        tempColor,
        _upVector,
        _quaternion,
        _matrix,
        _position,
        _scale,
        trailConfig,
        trailPositions,
        trailIndices,
        trailGeometry,
        trailLines,
        setTrailsEnabled,
        updateTrails,
        updateBoidsCount,
        handPositions,
        boidScaleConfig,
        clampLength,
        calculateFlocking,
        applyHandRepulsion,
        updateBoids
    };
    Object.assign(deps, api);
    return api;
}
