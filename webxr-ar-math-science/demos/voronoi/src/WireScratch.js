import * as THREE from 'three';

/** Growable CPU-side wire buffers — reset + fill each rebuild, then upload with needsUpdate. */
export class WireScratch {
    constructor(initialPosFloats = 256) {
        this.positions = new Float32Array(initialPosFloats);
        this.alphas = new Float32Array(Math.ceil(initialPosFloats / 3));
        this.indices = new Uint32Array(Math.ceil(initialPosFloats / 3) * 6);
        this.posCount = 0;
        this.alphaCount = 0;
        this.indexCount = 0;
    }

    reset() {
        this.posCount = 0;
        this.alphaCount = 0;
        this.indexCount = 0;
    }

    get vertCount() {
        return this.posCount / 3;
    }

    allocPositions(floatCount) {
        const start = this.posCount;
        const needed = start + floatCount;
        if (needed > this.positions.length) {
            const next = new Float32Array(Math.max(needed, this.positions.length * 2));
            next.set(this.positions.subarray(0, this.posCount));
            this.positions = next;
        }
        this.posCount = needed;
        return start;
    }

    allocAlphas(count) {
        const start = this.alphaCount;
        const needed = start + count;
        if (needed > this.alphas.length) {
            const next = new Float32Array(Math.max(needed, this.alphas.length * 2));
            next.set(this.alphas.subarray(0, this.alphaCount));
            this.alphas = next;
        }
        this.alphaCount = needed;
        return start;
    }

    allocIndices(count) {
        const start = this.indexCount;
        const needed = start + count;
        if (needed > this.indices.length) {
            const next = new Uint32Array(Math.max(needed, this.indices.length * 2));
            next.set(this.indices.subarray(0, this.indexCount));
            this.indices = next;
        }
        this.indexCount = needed;
        return start;
    }
}

function resetBoundingSphere(geometry) {
    if (!geometry.boundingSphere) {
        geometry.boundingSphere = new THREE.Sphere();
    }
    geometry.boundingSphere.center.set(0, 0, 0);
    geometry.boundingSphere.radius = 0;
}

/**
 * Upload scratch contents into a BufferGeometry.
 * Grows GPU attributes only when capacity is exceeded; otherwise needsUpdate in place.
 * Attribute `.count` is always set to the used size so leftover capacity (and any stale
 * NaNs) is ignored by computeBoundingSphere / draw.
 */
export function writeWireGeometry(geometry, scratch) {
    if (scratch.posCount === 0 || scratch.indexCount === 0) {
        geometry.setDrawRange(0, 0);
        const posAttr = geometry.getAttribute('position');
        if (posAttr) {
            posAttr.count = 0;
            posAttr.needsUpdate = true;
        }
        const indexAttr = geometry.getIndex();
        if (indexAttr) {
            indexAttr.count = 0;
            indexAttr.needsUpdate = true;
        }
        resetBoundingSphere(geometry);
        return;
    }

    const vertCount = scratch.posCount / 3;

    let posAttr = geometry.getAttribute('position');
    if (!posAttr || posAttr.array.length < scratch.posCount) {
        const array = new Float32Array(scratch.positions.length);
        array.set(scratch.positions.subarray(0, scratch.posCount));
        posAttr = new THREE.BufferAttribute(array, 3);
        posAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('position', posAttr);
    } else {
        posAttr.array.set(scratch.positions.subarray(0, scratch.posCount));
    }
    posAttr.count = vertCount;
    posAttr.needsUpdate = true;

    let alphaAttr = geometry.getAttribute('edgeAlpha');
    if (!alphaAttr || alphaAttr.array.length < scratch.alphaCount) {
        const array = new Float32Array(scratch.alphas.length);
        array.set(scratch.alphas.subarray(0, scratch.alphaCount));
        alphaAttr = new THREE.BufferAttribute(array, 1);
        alphaAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setAttribute('edgeAlpha', alphaAttr);
    } else {
        alphaAttr.array.set(scratch.alphas.subarray(0, scratch.alphaCount));
    }
    alphaAttr.count = scratch.alphaCount;
    alphaAttr.needsUpdate = true;

    const useUint32 = vertCount > 65535;
    const IndexTypedArray = useUint32 ? Uint32Array : Uint16Array;
    let indexAttr = geometry.getIndex();
    const needsNewIndex = !indexAttr
        || indexAttr.array.length < scratch.indexCount
        || (useUint32 !== (indexAttr.array instanceof Uint32Array));
    if (needsNewIndex) {
        const capacity = Math.max(scratch.indices.length, scratch.indexCount);
        const array = new IndexTypedArray(capacity);
        array.set(scratch.indices.subarray(0, scratch.indexCount));
        indexAttr = new THREE.BufferAttribute(array, 1);
        indexAttr.setUsage(THREE.DynamicDrawUsage);
        geometry.setIndex(indexAttr);
    } else {
        indexAttr.array.set(scratch.indices.subarray(0, scratch.indexCount));
    }
    indexAttr.count = scratch.indexCount;
    indexAttr.needsUpdate = true;

    geometry.setDrawRange(0, scratch.indexCount);

    // Avoid Three's NaN-radius warning: skip sphere math if any used float is non-finite.
    let hasNonFinite = false;
    const posArray = posAttr.array;
    for (let i = 0; i < scratch.posCount; i++) {
        if (!Number.isFinite(posArray[i])) {
            hasNonFinite = true;
            break;
        }
    }
    if (hasNonFinite) {
        resetBoundingSphere(geometry);
    } else {
        geometry.computeBoundingSphere();
        if (!Number.isFinite(geometry.boundingSphere?.radius)) {
            resetBoundingSphere(geometry);
        }
    }
}
