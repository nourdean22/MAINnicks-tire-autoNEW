"use client";

/**
 * useLocalStorageState — typed persistent state backed by localStorage.
 *
 * v10.0.529.106 · Wave 50 · the 18-agent audit found 12+ system pages
 * (`repos` · `tools` · `tire-stock-requests` · `policies` · `logs` ·
 * `devices` · `crons` · `alerts` · `agent-traces` · `actions` ·
 * `wisdom` · `pins` · `knowledge` · `journal` · `content-history`)
 * each implementing the same paired get/set effects for sort key
 * persistence:
 *
 *   const [sortKey, setSortKey] = useState<Sort>(() => {
 *     if (typeof window === "undefined") return "default";
 *     const saved = window.localStorage.getItem("foo:sortKey");
 *     return validValues.includes(saved) ? saved : "default";
 *   });
 *   useEffect(() => {
 *     window.localStorage.setItem("foo:sortKey", sortKey);
 *   }, [sortKey]);
 *
 * This primitive collapses 12+ pairs into one hook + 1 line per caller.
 *
 * Usage:
 *   const [sortKey, setSortKey] = useLocalStorageState<Sort>(
 *     "journal:sortKey",
 *     "newest",
 *     ["newest", "oldest", "alpha"] as const, // optional validation list
 *   );
 *
 * SSR-safe: returns the default during server-render, hydrates from
 * localStorage on mount. The optional `validValues` array filters
 * unknown stored values (e.g. when sort options are removed in a
 * later version).
 */
import { useCallback, useEffect, useState } from "react";

export function useLocalStorageState<T extends string>(
  key: string,
  defaultValue: T,
  validValues?: ReadonlyArray<T>,
): [T, (next: T) => void] {
  const [state, setState] = useState<T>(defaultValue);

  // Hydrate from localStorage on mount. Avoid running during SSR.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem(key);
      if (!saved) return;
      // Optional validation: drop unknown values so stale localStorage
      // from a previous version doesn't render an invalid state.
      if (validValues && !validValues.includes(saved as T)) return;
      setTimeout(() => setState(saved as T), 0);
    } catch {
      // localStorage may be disabled (Safari private mode) — silent fallback to default
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setState(next);
      if (typeof window === "undefined") return;
      try {
        window.localStorage.setItem(key, next);
      } catch {
        // ignore quota / private-mode errors · state still updates in memory
      }
    },
    [key],
  );

  return [state, update];
}
