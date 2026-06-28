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
 * hooks-lib REST→tRPC slice (2026-05-22) · the FINAL slice. This hook
 * is a GENERIC URL poller — its 4 consumers (/system/cockpit ·
 * /relationships · /content/drafts · /brain/identity-trajectory) each
 * pass a different endpoint, most with no 1:1 tRPC procedure, so there
 * is no typed tRPC equivalent of "fetch any URL with state". It used to
 * wrap `useAuthedFetch` for the GET-with-state + 401-retry behaviour;
 * that hook is being deleted, so the small GET-state primitive it
 * provided is inlined HERE — a bare `fetch` with `credentials:
 * "include"` + the same 401-bounce retry + envelope unwrap. The
 * `{ data, loading, error, reload }` contract is unchanged, so the 4
 * consumer pages need no edit. This is the same generic-URL-fetcher
 * carve-out the slice made for `lib/ultron/client-cache.ts`.
 *
 * The polling layer adds:
 *   · setInterval that calls reload() at `intervalMs`
 *   · pause-on-document-hidden (don't waste DB rpc when tab inactive)
 *   · auto-cleanup on unmount + on interval/url change
 *   · optional `skipPoll` flag to disable polling without unmounting
 */
import { useCallback, useEffect, useState } from "react";

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

/** Build a human-readable error string from a non-OK Response. */
async function describeError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  const preview = body.slice(0, 160).replace(/\s+/g, " ").trim();
  return `${res.status} ${res.statusText}${preview ? ` · ${preview}` : ""}`;
}

export function usePollingFetch<T>(url: string, opts: UsePollingFetchOpts = {}) {
  const intervalMs = opts.intervalMs ?? 60_000;
  const pauseWhenHidden = opts.pauseWhenHidden ?? true;
  const skip = opts.skip ?? false;
  const skipPoll = opts.skipPoll ?? false;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(!skip);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Derive loading state during render to avoid set-state-in-effect warning when skip is true
  const resolvedLoading = skip ? false : loading;

  // GET-with-state — the slice of `useAuthedFetch` this hook used to
  // depend on, inlined. `credentials: "include"` sends the session
  // cookie; a 401 retries once after a 300ms cookie-arrival grace.
  useEffect(() => {
    if (skip) {
      return;
    }
    const self = { alive: true };
    setTimeout(() => {
      if (self.alive) {
        setLoading(true);
        setError(null);
      }
    }, 0);

    void (async () => {
      let attempt = 0;
      const maxAttempts = 2; // initial + one 401-bounce retry
      while (attempt < maxAttempts) {
        attempt++;
        try {
          const res = await fetch(url, { credentials: "include" });
          if (res.status === 401 && attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 300));
            continue;
          }
          if (!res.ok) {
            const msg = await describeError(res);
            if (self.alive) {
              setError(msg);
              setLoading(false);
            }
            return;
          }
          const raw = (await res.json()) as { data?: T } | T;
          // Most apiHandler routes wrap the payload in { data }; unwrap.
          const payload = ((raw as { data?: T }).data ?? raw) as T;
          if (self.alive) {
            setData(payload);
            setError(null);
            setLoading(false);
          }
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, 300));
            continue;
          }
          if (self.alive) {
            setError(msg);
            setLoading(false);
          }
          return;
        }
      }
    })();

    return () => {
      self.alive = false;
    };
  }, [url, tick, skip]);

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

  return { data, loading: resolvedLoading, error, reload };
}
