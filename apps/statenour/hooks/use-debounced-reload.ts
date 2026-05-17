"use client";

/**
 * useDebouncedReload · v10.0.424
 *
 * Coalesces N reload triggers into ONE in-flight request. Skill:
 * frontend-api-integration-patterns · "race condition handling +
 * request cancellation + retry strategies".
 *
 * Without this, the /tasks page had 5 distinct reload triggers
 * (mount · interval · visibility · event-bus · 25 manual sites)
 * all firing `load()` independently. Operator-visible symptom:
 *   · burst-click "complete" on 5 tasks → 5 fast loads kick off
 *     in 200ms · last-finishing wins · earlier loads' results
 *     overwrite the latest one → flicker, stale rows
 *
 * Pattern · trigger() bumps a "request token". An effect runs,
 * sees the token changed, fires the loader inside an AbortController,
 * and aborts the previous in-flight request. Debounce window
 * coalesces tight bursts into one fetch.
 *
 * Usage:
 *
 *   const reload = useDebouncedReload(load, { debounceMs: 250 });
 *   // …everywhere you'd call load() now call:
 *   reload();
 */

import { useCallback, useEffect, useRef } from "react";

interface DebouncedReloadOpts {
  /** ms to wait after the last trigger before actually firing */
  debounceMs?: number;
  /** if true, fire on the leading edge AND debounce the trailing burst */
  leading?: boolean;
}

export function useDebouncedReload(
  load: (signal: AbortSignal) => Promise<void>,
  opts: DebouncedReloadOpts = {},
) {
  const { debounceMs = 250, leading = false } = opts;
  const tokenRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;

  const fire = useCallback(async () => {
    // Abort any in-flight request before kicking off a new one.
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const myToken = ++tokenRef.current;
    try {
      await loadRef.current(ctrl.signal);
    } catch (err) {
      // Aborts come through as DOMException · swallow them silently
      // (a newer reload is already in flight). Surface real errors.
      if (ctrl.signal.aborted) return;
      // Stale resolution · the token doesn't match · ignore.
      if (myToken !== tokenRef.current) return;
      throw err;
    } finally {
      if (abortRef.current === ctrl) abortRef.current = null;
    }
  }, []);

  const trigger = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (leading && timerRef.current === null && abortRef.current === null) {
      void fire();
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void fire();
    }, debounceMs);
  }, [debounceMs, leading, fire]);

  // Cleanup on unmount: cancel timer + in-flight request
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  return trigger;
}
