"use client";

/**
 * usePollingFetch — canonical polling primitive.
 *
 * v10.0.529.106 · Wave 50 · the 18-agent audit found 33+ files inline
 * the same `useEffect(() => { load(); const i = setInterval(load, N);
 * return () => clearInterval(i); }, [load])` pattern. Each implementation
 * had subtle differences (some forgot the cleanup, some debounced
 * differently, some had different default intervals). One canonical
 * primitive eliminates 33 boilerplate blocks and centralizes the
 * cleanup contract.
 *
 * Usage:
 *   const { data, loading, error, reload } = usePollingFetch<MyShape>(
 *     "/api/system/crons",
 *     { intervalMs: 30_000 }
 *   );
 *
 * Wraps `useAuthedFetch` for the auth-cookie retry behavior — same
 * 401 handling, same redirect, same retry contract. The polling layer
 * adds:
 *   · setInterval that calls reload() at `intervalMs`
 *   · pause-on-document-hidden (don't waste DB rpc when tab inactive)
 *   · auto-cleanup on unmount + on interval/url change
 *   · optional `skipPoll` flag to disable polling without unmounting
 *
 * Pause-on-hidden behavior matches the operator's mental model: when
 * they switch tabs we shouldn't keep hammering the API. Resumes on
 * tab visibility.
 */
import { useEffect } from "react";
import { useAuthedFetch } from "./use-authed-fetch";

interface UsePollingFetchOpts {
  /** Poll interval in ms. Default 60_000 (60s). */
  intervalMs?: number;
  /** Pause polling when the tab is hidden. Default true. */
  pauseWhenHidden?: boolean;
  /** Skip the initial fetch + polling (e.g. waiting on a parent value). */
  skip?: boolean;
  /**
   * Skip the recurring poll but still do the initial fetch. Useful
   * for surfaces that want one fetch then static rendering · same
   * shape as usePollingFetch so consumers can toggle polling without
   * a hook swap.
   */
  skipPoll?: boolean;
}

export function usePollingFetch<T>(url: string, opts: UsePollingFetchOpts = {}) {
  const intervalMs = opts.intervalMs ?? 60_000;
  const pauseWhenHidden = opts.pauseWhenHidden ?? true;
  const skip = opts.skip ?? false;
  const skipPoll = opts.skipPoll ?? false;

  const { data, loading, error, reload } = useAuthedFetch<T>(url, { skip });

  useEffect(() => {
    if (skip || skipPoll) return;
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id) return;
      id = setInterval(() => {
        // Skip the tick if the tab is hidden (Page Visibility API).
        if (pauseWhenHidden && typeof document !== "undefined" && document.visibilityState === "hidden") {
          return;
        }
        reload();
      }, intervalMs);
    };
    const stop = () => {
      if (id) {
        clearInterval(id);
        id = null;
      }
    };
    start();
    // On tab-visible · trigger an immediate reload to catch up.
    const onVisible = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        reload();
      }
    };
    if (pauseWhenHidden && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisible);
    }
    return () => {
      stop();
      if (pauseWhenHidden && typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisible);
      }
    };
  }, [intervalMs, pauseWhenHidden, reload, skip, skipPoll]);

  return { data, loading, error, reload };
}
