import gsap from 'gsap';

const DEFAULT_TRANSITION = {
    duration: 0.18,
    ease: 'power2.out',
};

export class PointScaleHighlighter {
    constructor(pointActiveScale = 1.55, transition = DEFAULT_TRANSITION) {
        this.pointActiveScale = pointActiveScale;
        this.transition = transition;
        this.pointHighlights = new Set();
        this.tweens = new Map();
    }

    setHighlights(indices, pointMeshes) {
        const next = new Set(indices);

        for (let i = 0; i < pointMeshes.length; i++) {
            const wasHighlighted = this.pointHighlights.has(i);
            const isHighlighted = next.has(i);
            if (wasHighlighted === isHighlighted) continue;
            this._tweenTo(pointMeshes[i], i, isHighlighted ? this.pointActiveScale : 1);
        }

        for (const index of [...this.tweens.keys()]) {
            if (index >= pointMeshes.length) {
                this.tweens.get(index)?.kill();
                this.tweens.delete(index);
            }
        }

        this.pointHighlights = next;
    }

    /** Remap highlight/tween indices after a point is removed from the array. */
    onPointRemoved(removedIndex, pointMeshes) {
        this.tweens.get(removedIndex)?.kill();
        this.tweens.delete(removedIndex);

        const remappedTweens = new Map();
        for (const [index, tween] of this.tweens) {
            if (index < removedIndex) {
                remappedTweens.set(index, tween);
            } else if (index > removedIndex) {
                remappedTweens.set(index - 1, tween);
            }
        }
        this.tweens = remappedTweens;

        const remappedHighlights = new Set();
        for (const index of this.pointHighlights) {
            if (index < removedIndex) {
                remappedHighlights.add(index);
            } else if (index > removedIndex) {
                remappedHighlights.add(index - 1);
            }
        }
        this.pointHighlights = remappedHighlights;

        for (let i = 0; i < pointMeshes.length; i++) {
            this.tweens.get(i)?.kill();
            this.tweens.delete(i);
            const target = this.pointHighlights.has(i) ? this.pointActiveScale : 1;
            pointMeshes[i].scale.setScalar(target);
        }
    }

    reset() {
        for (const tween of this.tweens.values()) {
            tween.kill();
        }
        this.tweens.clear();
        this.pointHighlights.clear();
    }

    /** After marker rebuild — re-tween if scale drifted (e.g. new mesh at default scale). */
    syncAfterRebuild(pointMeshes) {
        for (let i = 0; i < pointMeshes.length; i++) {
            if (this.tweens.has(i)) continue;

            const target = this.pointHighlights.has(i) ? this.pointActiveScale : 1;
            const mesh = pointMeshes[i];
            if (Math.abs(mesh.scale.x - target) > 0.001) {
                this._tweenTo(mesh, i, target);
            }
        }
    }

    _tweenTo(mesh, index, target) {
        this.tweens.get(index)?.kill();

        const start = mesh.scale.x;
        if (Math.abs(start - target) < 0.001) {
            mesh.scale.setScalar(target);
            this.tweens.delete(index);
            return;
        }

        const proxy = { s: start };
        const tween = gsap.to(proxy, {
            s: target,
            duration: this.transition.duration,
            ease: this.transition.ease,
            onUpdate: () => {
                mesh.scale.setScalar(proxy.s);
            },
            onComplete: () => {
                mesh.scale.setScalar(target);
                this.tweens.delete(index);
            },
        });
        this.tweens.set(index, tween);
    }

    dispose() {
        for (const tween of this.tweens.values()) {
            tween.kill();
        }
        this.tweens.clear();
    }
}
