/**
 * useReducedMotion — respects the user's OS "Reduce Motion" setting (WCAG 2.3.3).
 *
 * Returns true when `prefers-reduced-motion: reduce` is active, so animated
 * components (tickers, count-ups, auto-rotating toasts) can skip or shorten
 * non-essential motion instead of forcing it on everyone.
 *
 * SSR/prerender-safe: defaults to `true` (no motion) until mounted on the
 * client, so prerendered HTML never ships a flash of animation for
 * reduced-motion users. Subscribes to live changes of the media query.
 */
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  // Default to true during SSR/prerender → safest (no motion) until we know.
  const [reduced, setReduced] = useState(true);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(QUERY);
    setReduced(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

export default useReducedMotion;
