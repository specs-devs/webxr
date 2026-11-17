import { updateDragMergePreview, finishDragMerge } from './MergePreview.js';

function createHandState() {
    return {
        dragging: false,
        draggedPointIndex: -1,
    };
}

/**
 * 2D interaction on the unified diagram — edits XY only, seeds stay on the center plane.
 */
export class VoronoiCubePlaneInteraction {
    constructor(voronoiCube, options = {}) {
        this.voronoiCube = voronoiCube;
        this.mergeDeleteHighlight = options.mergeDeleteHighlight ?? null;
        this.pickRadius = options.pickRadius ?? 0.035;
        this.mergeThreshold = options.mergeThreshold ?? 0.028;
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
        this.voronoiCube.clearMergePreview();
    }

    updateHand(side, { planeX, planeY, planeZ, pinching, prevPinching, hasJoints }) {
        const hand = this.hands[side];

        if (!hasJoints) {
            if (!pinching) this._resetHand(hand);
            return;
        }

        const clamped = this.voronoiCube.clampToBoundsXY(planeX, planeY);

        if (pinching && !prevPinching) {
            const nearestIndex = this.voronoiCube.findNearestPointIndex(
                clamped.x,
                clamped.y,
                planeZ,
                this.pickRadius
            );

            if (nearestIndex >= 0) {
                hand.dragging = true;
                hand.draggedPointIndex = nearestIndex;
            } else if (
                this.voronoiCube.isOnCenterPlaneForSpawn(
                    planeX,
                    planeY,
                    planeZ,
                    this.spawnZTolerance
                )
                && this.voronoiCube.canAddPoint()
            ) {
                const index = this.voronoiCube.addPointXY(clamped.x, clamped.y);
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
                0,
                this.mergeThreshold,
                (draggedIndex, x, y, _z, threshold) => (
                    this.voronoiCube.findMergeTargetIndexXY(draggedIndex, x, y, threshold)
                )
            );
            this.voronoiCube.movePointXY(hand.draggedPointIndex, clamped.x, clamped.y);
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
                z: 0,
                threshold: this.mergeThreshold,
                findTarget: (index, x, y, _z, threshold) => (
                    this.voronoiCube.findMergeTargetIndexXY(index, x, y, threshold)
                ),
                merge: (index, x, y, _z, threshold) => (
                    this.voronoiCube.mergePointIntoNearestXY(index, x, y, threshold)
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
