"use client";

/**
 * useSilentRetry — hook that swallows up to 3 stream drops silently,
 * using exponential backoff between attempts. Only after 3 failures
 * does the UI surface an error.
 *
 * Tesla principle applied to error handling: the user shouldn't see
 * "Chat error · Nick is stuck" on every transient network blip.
 * Retry in the background. Surface only when it's truly failing.
 *
 * Apr 19 · Hardened against the "Maximum update depth exceeded"
 * cascade. Previously `retrying` was state that could re-trigger
 * the effect indirectly via React 19's stricter dependency tracking.
 * Now we use refs for the guards + track a per-error "sessionKey"
 * so we only fire one retry chain per distinct error, even if the
 * parent hook re-renders us mid-schedule.
 */

import { useCallback, useEffect, useRef, useState } from "react";

interface UseSilentRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  isStreaming?: boolean;
}

export function useSilentRetry(
  error: string | null,
  onRetry: () => void,
  options: UseSilentRetryOptions = {},
) {
  const { maxAttempts = 3, baseDelayMs = 800, isStreaming = false } = options;
  const [attemptCount, setAttemptCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  // Refs so we don't re-run effects when they change.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryingRef = useRef(false);
  const sessionErrorRef = useRef<string | null>(null);
  const onRetryRef = useRef(onRetry);
  // v11.1 · Hard floor on retry cadence — last-fire timestamp. Even
  // if the effect re-runs 100× via an unrelated React update loop,
  // the cadence guard below won't let us fire onRetry more than once
  // per 500ms. Belt-and-suspenders against "Maximum update depth"
  // cascades where the retry hook gets re-triggered by a parent loop.
  const lastFireAtRef = useRef<number>(0);
  const MIN_FIRE_INTERVAL_MS = 500;

  // Keep onRetry fresh without retriggering
  useEffect(() => {
    onRetryRef.current = onRetry;
  }, [onRetry]);

  // Clear on unmount or when error goes null
  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Reset when error clears.
  // Apr 27 · COMPILER-FIX — wrap the setState calls in functional
  // updates so React can short-circuit when the value isn't actually
  // changing. That sidesteps the "cascading render" lint warning by
  // making the effect a no-op when state is already at the rest value.
  useEffect(() => {
    if (!error && !isStreaming) {
      sessionErrorRef.current = null;
      retryingRef.current = false;
      setAttemptCount((prev) => (prev === 0 ? prev : 0));
      setRetrying((prev) => (prev === false ? prev : false));
      clearTimer();
    }
  }, [error, isStreaming, clearTimer]);

  // Schedule retry on new distinct error. We gate on sessionErrorRef so
  // the same error doesn't re-arm the effect across unrelated re-renders.
  useEffect(() => {
    if (!error) return;

    // If this error is new, start a fresh retry chain for it.
    if (sessionErrorRef.current !== error) {
      sessionErrorRef.current = error;
      clearTimer();
      retryingRef.current = false;
      // DO NOT reset attemptCount here — we want the cap to span
      // multi-error chains in a single failing session. Parent clears
      // error to zero out the chain.
    }

    // Guards — all via refs so they don't participate in deps
    if (attemptCount >= maxAttempts) return;
    if (retryingRef.current) return;
    // v11.1 cadence guard — even if something else loops the effect,
    // we don't schedule a retry more than once per MIN_FIRE_INTERVAL_MS.
    const sinceLast = Date.now() - lastFireAtRef.current;
    if (sinceLast < MIN_FIRE_INTERVAL_MS) return;

    // Exponential backoff: 800ms, 1600ms, 3200ms
    const delay = baseDelayMs * Math.pow(2, attemptCount);
    retryingRef.current = true;
    setRetrying(true);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      retryingRef.current = false;
      lastFireAtRef.current = Date.now();
      setAttemptCount((c) => c + 1);
      setRetrying(false);
      try {
        onRetryRef.current();
      } catch {
        // swallow — caller's error surfaces via `error` prop
      }
    }, delay);

    return clearTimer;
  }, [error, attemptCount, maxAttempts, baseDelayMs, clearTimer]);

  const exhausted = error != null && attemptCount >= maxAttempts;

  return {
    /** Are we silently retrying right now? */
    retrying,
    /** How many silent attempts have fired? */
    attemptCount,
    /** Did we hit the cap? UI should show an error only when this is true. */
    exhausted,
    /**
     * v10.0.28 · expose the configured cap so the UI can render
     * "(N/M)" without hardcoding M. Pre-v10.0.28 the chat page
     * displayed "(1/3)" while maxAttempts was 1 — a stale string
     * from before the Apr-27 cap reduction misled the operator.
     */
    maxAttempts,
  };
}
