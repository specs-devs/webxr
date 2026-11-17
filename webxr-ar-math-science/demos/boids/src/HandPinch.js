import * as THREE from 'three';

/**
 * Reusable hand-pinch tracker for WebXR hand tracking (three.js XRHand).
 *
 * Solves the "off-screen hand reads as pinching" problem that breaks
 * single-hand interaction and causes scene jumps on the first two-handed
 * pinch. It provides four layers of defense:
 *
 *   1. Tracking-validity gate  - a hand only counts when its key joints are
 *      actually visible this frame (three.js sets joint.visible per frame).
 *   2. Hysteresis              - separate close/open thresholds prevent chatter.
 *   3. Settle window           - a pinch must hold for a short period after the
 *      hand becomes tracked before it is trusted, absorbing init jitter.
 *   4. Jump guard (see below)  - detects tracking teleports so callers can
 *      re-base instead of applying a huge delta.
 *
 * Portable: depends only on three.js and the standard XRHand joint layout.
 * Drop this file into another project, create one tracker, call update() each
 * frame, and read the per-hand { tracked, pinching, pinchStartMs } state.
 */

const DEFAULTS = {
    /** Index/thumb distance (m) below which a pinch is considered closed. */
    pinchClose: 0.02,
    /** Index/thumb distance (m) above which a closed pinch is released. */
    pinchOpen: 0.03,
    /**
     * A hand must be continuously tracked AND continuously closed for this many
     * ms before `pinching` becomes true. Keep small so single-hand grabs stay
     * responsive while still rejecting first-frame initialization noise.
     */
    settleMs: 10,
};

function makeHandState() {
    return {
        /** Joints exist and are visible this frame. */
        tracked: false,
        /** Debounced, tracking-gated pinch state (safe for interaction logic). */
        pinching: false,
        /** Timestamp (ms) when the current continuous pinch began, else -1. */
        pinchStartMs: -1,
        // internal
        _rawClosed: false,
        _closedSinceMs: -1,
        _trackedSinceMs: -1,
    };
}

/** True if the hand's pinch joints exist and are visibly tracked this frame. */
export function isHandTracked(hand) {
    if (!hand || !hand.joints) return false;
    const thumb = hand.joints['thumb-tip'];
    const index = hand.joints['index-finger-tip'];
    return !!(thumb && index && thumb.visible === true && index.visible === true);
}

export function createPinchTracker(options = {}) {
    const cfg = { ...DEFAULTS, ...options };

    const state = {
        left: makeHandState(),
        right: makeHandState(),
        cfg,
    };

    function updateSide(side, hand, nowMs) {
        const s = state[side];
        const tracked = isHandTracked(hand);
        s.tracked = tracked;

        if (!tracked) {
            s.pinching = false;
            s.pinchStartMs = -1;
            s._rawClosed = false;
            s._closedSinceMs = -1;
            s._trackedSinceMs = -1;
            return s;
        }

        if (s._trackedSinceMs < 0) s._trackedSinceMs = nowMs;

        const thumb = hand.joints['thumb-tip'].position;
        const index = hand.joints['index-finger-tip'].position;
        const dist = thumb.distanceTo(index);

        // Hysteresis on the raw closed state.
        if (s._rawClosed) {
            if (dist > cfg.pinchOpen) s._rawClosed = false;
        } else if (dist < cfg.pinchClose) {
            s._rawClosed = true;
        }

        if (!s._rawClosed) {
            s._closedSinceMs = -1;
            s.pinching = false;
            s.pinchStartMs = -1;
            return s;
        }

        if (s._closedSinceMs < 0) s._closedSinceMs = nowMs;

        const trackedLongEnough = (nowMs - s._trackedSinceMs) >= cfg.settleMs;
        const closedLongEnough = (nowMs - s._closedSinceMs) >= cfg.settleMs;
        const pinching = trackedLongEnough && closedLongEnough;

        if (pinching && !s.pinching) s.pinchStartMs = nowMs;
        if (!pinching) s.pinchStartMs = -1;
        s.pinching = pinching;
        return s;
    }

    /**
     * Update both hands. Pass the raw three.js XRHand objects.
     * @param {{left: object, right: object}} hands
     * @param {number} [nowMs] defaults to performance.now()
     */
    state.update = function update(hands, nowMs = performance.now()) {
        updateSide('left', hands.left, nowMs);
        updateSide('right', hands.right, nowMs);
        return state;
    };

    /**
     * True when both hands have been continuously, stably pinching for at least
     * `settleMs` (in addition to the per-hand settle). Use this to decide when
     * it is safe to *start* a two-handed gesture from clean baseline data.
     */
    state.bothPinchStable = function bothPinchStable(nowMs = performance.now(), settleMs = cfg.settleMs) {
        const l = state.left;
        const r = state.right;
        if (!l.pinching || !r.pinching) return false;
        if (l.pinchStartMs < 0 || r.pinchStartMs < 0) return false;
        const laterStart = Math.max(l.pinchStartMs, r.pinchStartMs);
        return (nowMs - laterStart) >= settleMs;
    };

    return state;
}

/**
 * Detects a physically implausible per-frame jump in a tracked position
 * (e.g. a hand-tracking teleport when a joint pops into view). Callers use
 * this to re-base a gesture's reference instead of applying a giant delta.
 */
export function createJumpGuard(maxJumpPerFrame = 0.08) {
    const prev = new THREE.Vector3();
    let hasPrev = false;

    return {
        maxJumpPerFrame,
        reset() {
            hasPrev = false;
        },
        /**
         * Feed the current position. Returns true if it jumped further than
         * `maxJumpPerFrame` from the previous frame's position.
         */
        check(current) {
            if (!hasPrev) {
                prev.copy(current);
                hasPrev = true;
                return false;
            }
            const jumped = prev.distanceTo(current) > this.maxJumpPerFrame;
            prev.copy(current);
            return jumped;
        },
    };
}
