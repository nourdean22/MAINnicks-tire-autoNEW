"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * `useMinWidth(1280)` — true when the viewport is at least that wide.
 *
 * `useSyncExternalStore` with a `false` server snapshot, so the server and the
 * first client paint agree (the sheet variant), and the panel variant takes
 * over after hydration on wide screens — no hydration mismatch, no flash of
 * the wrong chrome. Subscribes to the MediaQueryList so a window resize or an
 * iPad rotation re-renders the consumer.
 */
export function useMinWidth(px: number): boolean {
  const query = `(min-width: ${px}px)`;
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );
  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  }, [query]);
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
