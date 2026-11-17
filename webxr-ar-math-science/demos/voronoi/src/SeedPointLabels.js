import * as THREE from 'three';

const LETTER_TEXTURES = new Map();
const _labelWorld = new THREE.Vector3();
const _camWorld = new THREE.Vector3();
const _parentWorldQuat = new THREE.Quaternion();
const _worldYawQuat = new THREE.Quaternion();
const _yAxis = new THREE.Vector3(0, 1, 0);

export function indexToSeedLetter(index) {
    return String.fromCharCode(65 + index);
}

function getLetterTexture(letter) {
    if (LETTER_TEXTURES.has(letter)) {
        return LETTER_TEXTURES.get(letter);
    }

    const size = 128;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 88px Helvetica, Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, size * 0.5, size * 0.52);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    LETTER_TEXTURES.set(letter, texture);
    return texture;
}

/**
 * Index-based seed labels (A, B, C…) as Y-axis billboards on a points group.
 */
export class SeedPointLabels {
    constructor(parentGroup, options = {}) {
        this.parentGroup = parentGroup;
        this.pointRadius = options.pointRadius ?? 0.008;
        this.offsetFactor = options.offsetFactor ?? 4.2;
        this.labelScale = options.labelScale ?? 0.042;
        this.labelGeometry = new THREE.PlaneGeometry(1, 1);
        this.labels = [];
        this.visible = options.visible ?? true;
    }

    setVisible(visible) {
        this.visible = !!visible;
        for (const label of this.labels) {
            label.visible = this.visible;
        }
    }

    reset() {
        for (const label of this.labels) {
            this.parentGroup.remove(label);
            label.material.dispose();
        }
        this.labels = [];
    }

    syncCount(pointCount) {
        while (this.labels.length < pointCount) {
            const label = this._createLabel('A');
            this.parentGroup.add(label);
            this.labels.push(label);
        }
    }

    removeAt(index) {
        if (index < 0 || index >= this.labels.length) return;
        const label = this.labels.splice(index, 1)[0];
        this.parentGroup.remove(label);
        label.material.dispose();
    }

    syncTexts(pointCount) {
        for (let i = 0; i < pointCount; i++) {
            this._setLabelLetter(this.labels[i], indexToSeedLetter(i));
        }
    }

    syncPositions(getPosition) {
        const offsetY = this.pointRadius * this.offsetFactor;
        for (let i = 0; i < this.labels.length; i++) {
            const pos = getPosition(i);
            if (!pos) continue;
            this.labels[i].position.set(pos.x, pos.y + offsetY, pos.z ?? 0);
        }
    }

    /** Yaw-only billboard — stays upright when the user rolls their head. */
    updateBillboard(camera) {
        if (!this.visible || !camera || this.labels.length === 0) return;

        camera.getWorldPosition(_camWorld);

        for (const label of this.labels) {
            label.getWorldPosition(_labelWorld);

            const dx = _camWorld.x - _labelWorld.x;
            const dz = _camWorld.z - _labelWorld.z;
            if (dx * dx + dz * dz < 1e-10) continue;

            const yaw = Math.atan2(dx, dz);
            _worldYawQuat.setFromAxisAngle(_yAxis, yaw);
            label.parent.getWorldQuaternion(_parentWorldQuat);
            label.quaternion.copy(_parentWorldQuat.invert()).multiply(_worldYawQuat);
        }
    }

    _createLabel(letter) {
        const label = new THREE.Mesh(
            this.labelGeometry,
            new THREE.MeshBasicMaterial({
                map: getLetterTexture(letter),
                depthTest: false,
                depthWrite: false,
                transparent: true,
                side: THREE.FrontSide,
            }),
        );
        label.scale.set(this.labelScale, this.labelScale, 1);
        label.visible = this.visible;
        label.frustumCulled = false;
        label.renderOrder = 101;
        return label;
    }

    _setLabelLetter(label, letter) {
        const texture = getLetterTexture(letter);
        if (label.material.map !== texture) {
            label.material.map = texture;
        }
    }

    dispose() {
        this.reset();
        this.labelGeometry.dispose();
    }
}
