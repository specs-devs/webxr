import { mergeProximityFade } from './VoronoiBisector.js';

export function updateDragMergePreview(voronoi, draggedIndex, x, y, z, threshold, findTarget) {
    if (draggedIndex < 0) {
        return;
    }

    const target = findTarget(draggedIndex, x, y, z, threshold);
    if (!target) {
        voronoi.clearMergePreview(draggedIndex);
        return;
    }

    const fade = mergeProximityFade(target.dist, threshold);
    voronoi.setMergePreview(draggedIndex, target.index, fade);
}

export function finishDragMerge({
    voronoi,
    highlight,
    draggedIndex,
    x,
    y,
    z,
    threshold,
    findTarget,
    merge,
    resetHand,
}) {
    const target = findTarget(draggedIndex, x, y, z, threshold);

    if (target) {
        if (highlight) {
            highlight.confirm(voronoi, draggedIndex, target.index, () => {
                voronoi.clearMergePreview(draggedIndex);
                merge(draggedIndex, x, y, z, threshold);
                resetHand();
            });
            return;
        }

        voronoi.clearMergePreview(draggedIndex);
        merge(draggedIndex, x, y, z, threshold);
    }

    resetHand();
}
