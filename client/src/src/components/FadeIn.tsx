/**
 * Shared FadeIn animation component.
 * Uses CSS animation with IntersectionObserver for reliable viewport detection.
 * Fixed: reduced timers and threshold to prevent content staying invisible.
 */

import { useRef, useState, useEffect } from "react";

interface FadeInProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

export default function FadeIn({ children, className = "", delay = 0 }: FadeInProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Show immediately on first render to prevent blank pages
    const immediateTimer = setTimeout(() => setIsVisible(true), 0);

    // Fallback: force visible after 500ms in case IO never fires
    const fallbackTimer = setTimeout(() => setIsVisible(true), 500);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0, rootMargin: "0px" }
    );

    observer.observe(el);

    return () => {
      clearTimeout(immediateTimer);
      clearTimeout(fallbackTimer);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateY(0)" : "translateY(20px)",
        transition: `opacity 0.6s ease-out ${delay}s, transform 0.6s ease-out ${delay}s`,
        willChange: isVisible ? "auto" : "opacity, transform",
      }}
    >
      {children}
    </div>
  );
        }
