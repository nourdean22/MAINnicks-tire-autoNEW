/**
 * useAnimatedCounter — Viewport-triggered counting animation
 * Animates a number from 0 to target when the element enters the viewport.
 * Uses easeOutExpo for a satisfying deceleration curve.
 */
import { useState, useEffect, useRef, useCallback } from "react";

interface UseAnimatedCounterOptions {
  end: number;
  duration?: number;
  delay?: number;
  /** If true, includes decimal (e.g., 4.9) */
  decimals?: number;
}

export function useAnimatedCounter({
  end,
  duration = 2000,
  delay = 0,
  decimals = 0,
}: UseAnimatedCounterOptions) {
  const [value, setValue] = useState(0);
  const [hasAnimated, setHasAnimated] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const easeOutExpo = useCallback((t: number) => {
    return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);

          const startTime = performance.now() + delay;

          const animate = (now: number) => {
            const elapsed = now - startTime;
            if (elapsed < 0) {
              requestAnimationFrame(animate);
              return;
            }

            const progress = Math.min(elapsed / duration, 1);
            const easedProgress = easeOutExpo(progress);
            const current = easedProgress * end;

            setValue(Number(current.toFixed(decimals)));

            if (progress < 1) {
              requestAnimationFrame(animate);
            }
          };

          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [end, duration, delay, decimals, hasAnimated, easeOutExpo]);

  return { value, ref };
}
