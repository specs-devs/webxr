import * as THREE from 'three';
import gsap from 'gsap';

const HOVER_SCALE_TRANSITION = { duration: 0.18, ease: 'power2.out' };
const CONFIRM_SCALE_TRANSITION = { duration: 0.15, ease: 'power2.in' };

/**
 * White semi-transparent sphere at the merge target — grows while hovering a
 * deletion target, shrinks to zero when the merge is confirmed on pinch release.
 * Anchor stays on the static target point, not the dragged point.
 */
export class MergeDeleteHighlight {
    constructor(parent, options = {}) {
        this.baseRadius = options.baseRadius ?? 0.034;
        this.maxScale = options.maxScale ?? 1;
        const geometry = new THREE.SphereGeometry(this.baseRadius, 16, 16);
        const material = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.5,
            depthWrite: false,
            depthTest: true,
        });
        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 0;
        this.mesh.visible = false;
        this.mesh.scale.setScalar(0);
        parent.add(this.mesh);

        this.tween = null;
        this.hoverActive = false;
        this.hiding = false;
        this.confirming = false;
        this.anchorCenter = null;
        this.anchorTargetIndex = -1;
    }

    /** Static merge anchor — the surviving target point, not the dragged point. */
    getMergeCenter(voronoi, _draggedIndex, targetIndex) {
        return voronoi.getPointMarkerPosition(targetIndex);
    }

    _setAnchorCenter(center) {
        this.anchorCenter = { x: center.x, y: center.y, z: center.z };
        this.mesh.position.set(center.x, center.y, center.z);
    }

    _clearAnchorCenter() {
        this.anchorCenter = null;
        this.anchorTargetIndex = -1;
    }

    _tweenScale(target, transition, onComplete) {
        this.tween?.kill();
        const proxy = { s: this.mesh.scale.x };
        this.tween = gsap.to(proxy, {
            s: target,
            ...transition,
            onUpdate: () => {
                this.mesh.scale.setScalar(proxy.s);
            },
            onComplete: () => {
                this.mesh.scale.setScalar(target);
                this.tween = null;
                onComplete?.();
            },
        });
    }

    updateHover(voronoi, draggedIndex, targetIndex, fade) {
        if (this.confirming) return;

        if (fade <= 0 || draggedIndex < 0 || targetIndex < 0) {
            this.hide();
            return;
        }

        const center = this.getMergeCenter(voronoi, draggedIndex, targetIndex);
        if (!center) {
            this.hide();
            return;
        }

        if (this.hiding) {
            this.hiding = false;
            this.tween?.kill();
            this.tween = null;
        }

        if (this.anchorTargetIndex !== targetIndex || !this.anchorCenter) {
            this.anchorTargetIndex = targetIndex;
            this._setAnchorCenter(center);
        }

        if (!this.hoverActive) {
            this.hoverActive = true;
            this.mesh.visible = true;
            this._tweenScale(this.maxScale, HOVER_SCALE_TRANSITION);
        }
    }

    hide() {
        if (this.confirming || this.hiding) return;

        if (!this.hoverActive) {
            return;
        }

        this.hoverActive = false;
        this.hiding = true;
        this._tweenScale(0, HOVER_SCALE_TRANSITION, () => {
            this.mesh.visible = false;
            this.hiding = false;
            this._clearAnchorCenter();
        });
    }

    confirm(voronoi, draggedIndex, targetIndex, onComplete) {
        const center = this.anchorCenter
            ?? this.getMergeCenter(voronoi, draggedIndex, targetIndex);
        if (!center) {
            onComplete?.();
            return;
        }

        this.confirming = true;
        this.hoverActive = false;
        this.hiding = false;
        this._setAnchorCenter(center);
        this.mesh.visible = true;
        this.tween?.kill();
        this.tween = null;

        this._tweenScale(0, CONFIRM_SCALE_TRANSITION, () => {
            this.mesh.visible = false;
            this.confirming = false;
            this._clearAnchorCenter();
            onComplete?.();
        });
    }
}

/** One highlight sphere per hand — left and right can merge-delete independently. */
export class MergeDeleteHighlightManager {
    constructor(parent, options = {}) {
        this.highlights = {
            left: new MergeDeleteHighlight(parent, options),
            right: new MergeDeleteHighlight(parent, options),
        };
    }

    get(side) {
        return this.highlights[side];
    }

    get confirming() {
        return this.highlights.left.confirming || this.highlights.right.confirming;
    }

    hideAll() {
        this.highlights.left.hide();
        this.highlights.right.hide();
    }
}
