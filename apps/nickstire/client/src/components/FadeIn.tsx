/**
 * Shared FadeIn animation component.
 * Uses CSS animation with IntersectionObserver for reliable viewport detection.
 * Framer Motion whileInView had issues with deep pages — this is bulletproof.
 */

import { useRef, useState, useEffect } from "react";

interface FadeInProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
  /**
   * 2026-05-06 wave-31 · cinematic mode: heavier translate (16 → 0),
   * blur transition (md → 0), longer duration (800ms), and a custom
   * cubic-bezier that simulates real-world mass. Opt-in via prop so
   * existing FadeIn usages keep their familiar 0.6s ease-out behavior.
   */
  cinematic?: boolean;
}

export default function FadeIn({
  children,
  className = "",
  delay = 0,
  cinematic = false,
}: FadeInProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Fallback: force visible after 3s in case IO never fires (SSR, old browser, etc.)
    const fallbackTimer = setTimeout(() => setIsVisible(true), 3000);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.05, rootMargin: "50px 0px" }
    );

    observer.observe(el);

    return () => {
      clearTimeout(fallbackTimer);
      observer.disconnect();
    };
  }, []);

  const duration = cinematic ? 0.85 : 0.6;
  const easing = cinematic ? "cubic-bezier(0.32, 0.72, 0, 1)" : "ease-out";
  const initialTranslate = cinematic ? "translateY(64px)" : "translateY(20px)";
  const initialFilter = cinematic ? "blur(12px)" : "none";

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : initialTranslate,
        filter: isVisible ? "blur(0px)" : initialFilter,
        transition:
          `opacity ${duration}s ${easing} ${delay}s, ` +
          `transform ${duration}s ${easing} ${delay}s, ` +
          `filter ${duration}s ${easing} ${delay}s`,
        willChange: isVisible ? "auto" : "opacity, transform, filter",
      }}
    >
      {children}
    </div>
  );
}
