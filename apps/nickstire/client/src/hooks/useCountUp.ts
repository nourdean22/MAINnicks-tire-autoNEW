/**
 * useCountUp — animates a number from 0 to target when the element
 * scrolls into viewport. Uses IntersectionObserver + requestAnimationFrame
 * with the magnetic cubic-bezier curve for spring-like settling.
 *
 * 2026-05-07 wave-45 · design-spells micro-interaction. Brand-fit because
 * it makes the trust numbers (1,700+ reviews, 4.9 rating, 16% savings vs
 * dealer, etc.) feel ALIVE instead of stamped. Cleveland-tough register
 * preserved: counters don't bounce or pulse, they just count up cleanly.
 *
 * Honors prefers-reduced-motion: returns the final value immediately if
 * the user has motion-reduction enabled.
 */
import { useEffect, useRef, useState } from "react";

interface UseCountUpOptions {
  /** Target value to count up to */
  to: number;
  /** Animation duration in ms. Default 1200. */
  duration?: number;
  /** Optional starting value. Default 0. */
  from?: number;
  /** Decimal places to preserve. Default 0 (integer). */
  decimals?: number;
}

const MAGNETIC_EASE = (t: number): number => {
  // cubic-bezier(0.32, 0.72, 0, 1) — the project's signature easing,
  // approximated as a polynomial for use in raw RAF math.
  // Behaves as: fast initial pickup, gentle settle into final value.
  if (t >= 1) return 1;
  if (t <= 0) return 0;
  // Polynomial approximation: ease-out-quart variant
  return 1 - Math.pow(1 - t, 4);
};

export function useCountUp({ to, duration = 1200, from = 0, decimals = 0 }: UseCountUpOptions) {
  const [value, setValue] = useState(from);
  const ref = useRef<HTMLElement | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Honor prefers-reduced-motion — return final value immediately
    if (typeof window !== "undefined") {
      const prefersReducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (prefersReducedMotion) {
        setValue(to);
        return;
      }
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !startedRef.current) {
          startedRef.current = true;
          const startTime = performance.now();
          const range = to - from;

          const tick = (now: number) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = MAGNETIC_EASE(progress);
            const current = from + range * eased;
            setValue(
              decimals > 0
                ? Number(current.toFixed(decimals))
                : Math.round(current),
            );

            if (progress < 1) {
              requestAnimationFrame(tick);
            }
          };

          requestAnimationFrame(tick);
          observer.disconnect();
        }
      },
      { threshold: 0.3 },
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [to, duration, from, decimals]);

  return { ref, value };
}
