"use client";

/**
 * useIdleDetector · /tasks v2.2 Phase 2 · 2026-05-26
 *
 * Minimal idle-watcher. Returns true when no user activity (mouse,
 * keyboard, touch, or scroll) has occurred for `thresholdMs`. Resets
 * the timer on any qualifying event.
 *
 * Why not `@react-hook/idle`: adds a runtime dep for ~30 lines of
 * code we can write directly. Kaizen / YAGNI · no extra package
 * needed.
 *
 * Behavior ·
 *   - threshold default 5 min · idle nudge fires this often
 *   - second-tier threshold via the `extendedThresholdMs` opt · used
 *     for auto-release after 30 min (return `extendedIdle: true`)
 *   - paused when document.visibilityState === "hidden" · idle math
 *     resumes on tab focus so background tabs don't accumulate
 *     a "false idle" while operator is in another tab
 *
 * Returned shape ·
 *   { isIdle: boolean,             // >= thresholdMs since activity
 *     isExtendedIdle: boolean,     // >= extendedThresholdMs (if set)
 *     msSinceActivity: number }
 *
 * Usage in /tasks Phase 2 ·
 *   const { isIdle } = useIdleDetector({ thresholdMs: 5 * 60_000 });
 *   if (anchor && isIdle) → render inline nudge "still on this?"
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface UseIdleDetectorOpts {
  /** Idle threshold · default 5 min */
  thresholdMs?: number;
  /** Second-tier threshold · returns extendedIdle === true at this
   *  watermark. Use for auto-release after 30 min. Omit to disable. */
  extendedThresholdMs?: number;
  /** Disable detection · returns always-false. Useful when there's
   *  no anchor in play and the consumer wants to skip the listener. */
  disabled?: boolean;
}

/** Activity events that reset the idle timer. */
const ACTIVITY_EVENTS = ["mousemove", "keydown", "touchstart", "scroll"] as const;

export function useIdleDetector(opts: UseIdleDetectorOpts = {}) {
  const thresholdMs = opts.thresholdMs ?? 5 * 60_000;
  const extendedThresholdMs = opts.extendedThresholdMs;
  const disabled = opts.disabled ?? false;

  const lastActivityRef = useRef<number>(0);
  const [msSinceActivity, setMsSinceActivity] = useState(0);

  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, []);

  // Reset timer on any activity event. Throttle to once per second so
  // mousemove storms don't thrash React state.
  useEffect(() => {
    if (disabled) return;
    let throttleUntil = 0;
    const handler = () => {
      const now = Date.now();
      if (now < throttleUntil) return;
      throttleUntil = now + 1000;
      lastActivityRef.current = now;
      setMsSinceActivity(0);
    };
    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, handler, { passive: true });
    }
    return () => {
      for (const evt of ACTIVITY_EVENTS) {
        window.removeEventListener(evt, handler);
      }
    };
  }, [disabled]);

  // Idle math · tick every 30s · re-anchor to last-activity on tab
  // focus so background tabs don't get false-idle bumps.
  useEffect(() => {
    if (disabled) return;
    const tick = () => {
      const since = Date.now() - lastActivityRef.current;
      setMsSinceActivity(since);
    };
    tick();
    const id = setInterval(tick, 30_000);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        // Treat tab-return as a fresh activity tick.
        lastActivityRef.current = Date.now();
        setMsSinceActivity(0);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [disabled]);

  // Manual reset · consumer can force re-anchor (e.g. when operator
  // reaffirms the work anchor in the nudge UI).
  const reset = useCallback(() => {
    lastActivityRef.current = Date.now();
    setMsSinceActivity(0);
  }, []);

  if (disabled) {
    return { isIdle: false, isExtendedIdle: false, msSinceActivity: 0, reset };
  }

  const isIdle = msSinceActivity >= thresholdMs;
  const isExtendedIdle =
    extendedThresholdMs != null && msSinceActivity >= extendedThresholdMs;

  return { isIdle, isExtendedIdle, msSinceActivity, reset };
}
