"use client";

/**
 * useAbortableFetch — fetch with automatic abort-on-reload.
 *
 * v10.0.529.106 · Wave 50 · the 18-agent audit found 8+ pages
 * (`tasks/page` · `body/page` · `knowledge/page` · `journal/page` ·
 * `ai-cost/page` · `financial/page` · `plan/page` · `actions/page` ·
 * `crons/page` · `logs/page`) using the same inline pattern:
 *
 *   const inflightRef = useRef<AbortController | null>(null);
 *   const load = async () => {
 *     if (inflightRef.current) inflightRef.current.abort();
 *     const ctrl = new AbortController();
 *     inflightRef.current = ctrl;
 *     const res = await authedFetch(url, { signal: ctrl.signal });
 *     ...
 *   };
 *
 * This primitive collapses that into a hook. Useful when the operator
 * can trigger rapid reloads (clicking a filter chip · changing a date
 * range) and the old in-flight request should be cancelled rather
 * than producing a race condition with the new one.
 *
 * Usage:
 *   const { data, loading, error, reload } = useAbortableFetch(
 *     "/api/journal",
 *     async (signal) => {
 *       const res = await authedFetch("/api/journal?date=" + date, { signal });
 *       return res.json();
 *     },
 *     [date], // re-runs when date changes
 *   );
 *
 * The fetcher receives the AbortSignal so it can pass it to authedFetch
 * (or any other abort-aware operation). Aborts fire silently — the
 * hook ignores AbortError as expected.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface UseAbortableFetchResult<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
  reload: () => Promise<void>;
}

export function useAbortableFetch<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  deps: ReadonlyArray<unknown> = [],
): UseAbortableFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const inflightRef = useRef<AbortController | null>(null);

  const reload = useCallback(async () => {
    // Cancel any previous in-flight request.
    if (inflightRef.current) {
      inflightRef.current.abort();
    }
    const ctrl = new AbortController();
    inflightRef.current = ctrl;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher(ctrl.signal);
      // Only commit if we're still the current request.
      if (inflightRef.current === ctrl) {
        setData(result);
      }
    } catch (err) {
      // AbortError is expected when a newer reload supersedes us.
      if ((err as { name?: string })?.name === "AbortError") return;
      if (inflightRef.current === ctrl) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (inflightRef.current === ctrl) {
        setLoading(false);
        inflightRef.current = null;
      }
    }
    // The `key` arg is intentionally captured in the dep list so two
    // hooks with the same fetcher but different keys don't cross-cancel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetcher]);

  useEffect(() => {
    void reload();
    return () => {
      if (inflightRef.current) {
        inflightRef.current.abort();
        inflightRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reload, ...deps]);

  return { data, loading, error, reload };
}
