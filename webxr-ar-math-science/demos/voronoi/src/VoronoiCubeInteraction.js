import { updateDragMergePreview, finishDragMerge } from './MergePreview.js';

function createHandState() {
    return {
        dragging: false,
        draggedPointIndex: -1,
    };
}

/**
 * Per-hand Voronoi cube interaction: grab or spawn seeds in the volume on pinch start.
 */
export class VoronoiCubeInteraction {
    constructor(voronoiCube, options = {}) {
        this.voronoiCube = voronoiCube;
        this.mergeDeleteHighlight = options.mergeDeleteHighlight ?? null;
        this.pickRadius = options.pickRadius ?? 0.045;
        this.mergeThreshold = options.mergeThreshold ?? 0.035;
        this.hands = {
            left: createHandState(),
            right: createHandState(),
        };
    }

    isAnyHandDragging() {
        return this.hands.left.dragging || this.hands.right.dragging;
    }

    isBlockingContainerManip() {
        return this.isAnyHandDragging();
    }

    releaseAllHands() {
        this._resetHand(this.hands.left);
        this._resetHand(this.hands.right);
        this.voronoiCube.clearMergePreview();
    }

    updateHand(side, { cubeX, cubeY, cubeZ, pinching, prevPinching, hasJoints }) {
        const hand = this.hands[side];

        if (this.voronoiCube.isExploded()) {
            if (!pinching) this._resetHand(hand);
            return;
        }

        if (!hasJoints) {
            if (!pinching) this._resetHand(hand);
            return;
        }

        const clamped = this.voronoiCube.clampToBounds(cubeX, cubeY, cubeZ);

        if (pinching && !prevPinching) {
            const nearestIndex = this.voronoiCube.findNearestPointIndex(
                clamped.x,
                clamped.y,
                clamped.z,
                this.pickRadius
            );

            if (nearestIndex >= 0) {
                hand.dragging = true;
                hand.draggedPointIndex = nearestIndex;
            } else if (
                this.voronoiCube.isInsideBounds(cubeX, cubeY, cubeZ)
                && this.voronoiCube.canAddPoint()
            ) {
                const index = this.voronoiCube.addPoint(clamped.x, clamped.y, clamped.z);
                if (index >= 0) {
                    hand.dragging = true;
                    hand.draggedPointIndex = index;
                }
            }
        }

        if (hand.dragging && pinching) {
            updateDragMergePreview(
                this.voronoiCube,
                hand.draggedPointIndex,
                clamped.x,
                clamped.y,
                clamped.z,
                this.mergeThreshold,
                (draggedIndex, x, y, z, threshold) => (
                    this.voronoiCube.findMergeTargetIndex(draggedIndex, x, y, z, threshold)
                )
            );
            this.voronoiCube.movePoint(
                hand.draggedPointIndex,
                clamped.x,
                clamped.y,
                clamped.z
            );
        }

        if (!pinching && prevPinching && hand.dragging) {
            const draggedIndex = hand.draggedPointIndex;
            hand.dragging = false;
            finishDragMerge({
                voronoi: this.voronoiCube,
                highlight: this.mergeDeleteHighlight?.get(side) ?? null,
                draggedIndex,
                x: clamped.x,
                y: clamped.y,
                z: clamped.z,
                threshold: this.mergeThreshold,
                findTarget: (index, x, y, z, threshold) => (
                    this.voronoiCube.findMergeTargetIndex(index, x, y, z, threshold)
                ),
                merge: (index, x, y, z, threshold) => (
                    this.voronoiCube.mergePointIntoNearest(index, x, y, z, threshold)
                ),
                resetHand: () => this._resetHand(hand),
            });
        }
    }

    _resetHand(hand) {
        const draggedIndex = hand.draggedPointIndex;
        hand.dragging = false;
        hand.draggedPointIndex = -1;
        if (draggedIndex >= 0) {
            this.voronoiCube.clearMergePreview(draggedIndex);
        }
    }
}
