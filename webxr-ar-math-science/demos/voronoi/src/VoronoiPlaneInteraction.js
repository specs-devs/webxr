import { updateDragMergePreview, finishDragMerge } from './MergePreview.js';

function createHandState() {
    return {
        dragging: false,
        draggedPointIndex: -1,
    };
}

/**
 * Per-hand Voronoi plane interaction: grab or spawn seeds on pinch start, drag while pinching, merge on release.
 */
export class VoronoiPlaneInteraction {
    constructor(voronoiPlane, options = {}) {
        this.voronoiPlane = voronoiPlane;
        this.mergeDeleteHighlight = options.mergeDeleteHighlight ?? null;
        this.pickRadius = options.pickRadius ?? 0.035;
        this.mergeThreshold = options.mergeThreshold ?? 0.045;
        this.spawnZTolerance = options.spawnZTolerance ?? this.pickRadius;
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
        this.voronoiPlane.clearMergePreview();
    }

    updateHand(side, { planeX, planeY, planeZ, pinching, prevPinching, hasJoints }) {
        const hand = this.hands[side];

        if (!hasJoints) {
            if (!pinching) this._resetHand(hand);
            return;
        }

        const clamped = this.voronoiPlane.clampToBounds(planeX, planeY);

        if (pinching && !prevPinching) {
            const nearestIndex = this.voronoiPlane.findNearestPointIndex(
                clamped.x,
                clamped.y,
                this.pickRadius,
                planeZ
            );

            if (nearestIndex >= 0) {
                hand.dragging = true;
                hand.draggedPointIndex = nearestIndex;
            } else if (
                this.voronoiPlane.isOnPlaneForSpawn(
                    planeX,
                    planeY,
                    planeZ,
                    this.spawnZTolerance
                )
                && this.voronoiPlane.canAddPoint()
            ) {
                const index = this.voronoiPlane.addPoint(clamped.x, clamped.y);
                if (index >= 0) {
                    hand.dragging = true;
                    hand.draggedPointIndex = index;
                }
            }
        }

        if (hand.dragging && pinching) {
            updateDragMergePreview(
                this.voronoiPlane,
                hand.draggedPointIndex,
                clamped.x,
                clamped.y,
                0,
                this.mergeThreshold,
                (draggedIndex, x, y, _z, threshold) => (
                    this.voronoiPlane.findMergeTargetIndex(draggedIndex, x, y, threshold)
                )
            );
            this.voronoiPlane.movePoint(hand.draggedPointIndex, clamped.x, clamped.y);
        }

        if (!pinching && prevPinching && hand.dragging) {
            const draggedIndex = hand.draggedPointIndex;
            hand.dragging = false;
            finishDragMerge({
                voronoi: this.voronoiPlane,
                highlight: this.mergeDeleteHighlight?.get(side) ?? null,
                draggedIndex,
                x: clamped.x,
                y: clamped.y,
                z: 0,
                threshold: this.mergeThreshold,
                findTarget: (index, x, y, _z, threshold) => (
                    this.voronoiPlane.findMergeTargetIndex(index, x, y, threshold)
                ),
                merge: (index, x, y, _z, threshold) => (
                    this.voronoiPlane.mergePointIntoNearest(index, x, y, threshold)
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
            this.voronoiPlane.clearMergePreview(draggedIndex);
        }
    }
}
