"use client";

/**
 * useSwipeGesture · /tasks v2.2 Phase 6 LITE · 2026-05-26
 *
 * Minimal swipe-detection hook · native pointer events · no
 * @use-gesture/react dependency. Returns handlers + drag state so
 * the consumer can render visual feedback (e.g. translateX during
 * drag) and fire callbacks on swipe-threshold crossing.
 *
 * Why not @use-gesture/react: adds a runtime dep + 30KB+ bundle.
 * The full Phase 6 (pinch · long-press · drag-reorder) would
 * justify it, but this LITE only needs swipe-right + swipe-left.
 * Native PointerEvent handles those in ~80 LOC. YAGNI.
 *
 * Returned shape ·
 *   {
 *     handlers · spread onto the swipeable element (onPointerDown
 *       /move /up /cancel · also handles touch via PointerEvent
 *       coercion in modern browsers)
 *     state: { dx, isDragging, locked } · for visual feedback
 *     reset() · imperative reset (e.g. after callback fires)
 *   }
 *
 * Threshold defaults:
 *   - 80px horizontal travel triggers the swipe callback
 *   - <10px vertical travel · otherwise treat as scroll, not swipe
 *   - 600ms max total · longer = treat as long-press, ignore
 *
 * Pairs cleanly with React 19 + Next.js 16 · no special wiring.
 */

import { useCallback, useRef, useState } from "react";

interface UseSwipeGestureOpts {
  /** Horizontal travel (px) that triggers the swipe callback. Default 80. */
  thresholdPx?: number;
  /** Max vertical drift (px) before we treat as scroll · default 10. */
  maxVerticalDrift?: number;
  /** Max duration (ms) before we treat as long-press, not swipe. Default 600. */
  maxDurationMs?: number;
  /** Fire when operator swipes right past threshold. */
  onSwipeRight?: () => void;
  /** Fire when operator swipes left past threshold. */
  onSwipeLeft?: () => void;
  /** Disable the gesture · returns no-op handlers. */
  disabled?: boolean;
}

interface SwipeState {
  /** Signed horizontal delta (px) · positive = swiping right. */
  dx: number;
  /** True while pointer is down + moving past tiny jitter threshold. */
  isDragging: boolean;
  /** True when the callback just fired · use to lock the UI mid-animation. */
  locked: boolean;
}

export function useSwipeGesture(opts: UseSwipeGestureOpts = {}) {
  const thresholdPx = opts.thresholdPx ?? 80;
  const maxVerticalDrift = opts.maxVerticalDrift ?? 10;
  const maxDurationMs = opts.maxDurationMs ?? 600;
  const disabled = opts.disabled ?? false;

  const startRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [state, setState] = useState<SwipeState>({ dx: 0, isDragging: false, locked: false });

  const reset = useCallback(() => {
    startRef.current = null;
    setState({ dx: 0, isDragging: false, locked: false });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || state.locked) return;
      startRef.current = { x: e.clientX, y: e.clientY, t: Date.now() };
      setState({ dx: 0, isDragging: false, locked: false });
      // Capture so we keep getting moves even if pointer leaves the element
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [disabled, state.locked],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || !startRef.current || state.locked) return;
      const dx = e.clientX - startRef.current.x;
      const dy = e.clientY - startRef.current.y;
      // Treat as scroll if vertical drift dominates
      if (Math.abs(dy) > maxVerticalDrift && Math.abs(dy) > Math.abs(dx)) {
        startRef.current = null;
        setState({ dx: 0, isDragging: false, locked: false });
        return;
      }
      // Only treat as drag after ~6px movement · prevents jitter
      const isDragging = Math.abs(dx) > 6;
      setState({ dx, isDragging, locked: false });
    },
    [disabled, maxVerticalDrift, state.locked],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || !startRef.current) {
        reset();
        return;
      }
      const dx = e.clientX - startRef.current.x;
      const elapsed = Date.now() - startRef.current.t;
      // Too slow · ignore (operator was probably holding for a long press)
      if (elapsed > maxDurationMs) {
        reset();
        return;
      }
      // Past threshold either direction · fire callback + lock briefly
      if (dx > thresholdPx && opts.onSwipeRight) {
        setState({ dx, isDragging: false, locked: true });
        opts.onSwipeRight();
        // Auto-reset after CSS transition completes
        setTimeout(reset, 240);
        return;
      }
      if (dx < -thresholdPx && opts.onSwipeLeft) {
        setState({ dx, isDragging: false, locked: true });
        opts.onSwipeLeft();
        setTimeout(reset, 240);
        return;
      }
      // Didn't cross threshold · snap back
      reset();
    },
    [disabled, thresholdPx, maxDurationMs, opts, reset],
  );

  const onPointerCancel = useCallback(() => reset(), [reset]);

  if (disabled) {
    return {
      handlers: {},
      state: { dx: 0, isDragging: false, locked: false },
      reset,
    };
  }

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      // touchAction:pan-y lets vertical scroll pass through while horizontal
      // swipe is captured · iOS PWA + Android Chrome both honor this.
      style: { touchAction: "pan-y" as const },
    },
    state,
    reset,
  };
}
