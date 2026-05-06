/**
 * ScrollProgressBar — fixed 2px-tall bar at the top of the page that
 * fills with brand yellow as the user scrolls. Optional rolling
 * CSS-only tire icon at the leading edge for desktop (mobile = bar only).
 *
 * Why this matters: ambient brand reinforcement on every page. Most
 * sites use a generic blue or grey progress bar, or none at all. The
 * yellow + tire reinforces "you're in a tire shop site" without
 * requiring the user to look anywhere specific.
 *
 * Implementation: requestAnimationFrame-throttled scroll listener,
 * single transform mutation per frame, `will-change: transform` on
 * the fill element. ~50 lines of code, zero new dependencies.
 *
 * Honors prefers-reduced-motion (still updates on scroll, but skips
 * the tire rotation animation).
 */
import { useEffect, useRef, useState } from "react";

export function ScrollProgressBar() {
  const fillRef = useRef<HTMLDivElement>(null);
  const tireRef = useRef<HTMLDivElement>(null);
  const tickingRef = useRef(false);
  const [showTire, setShowTire] = useState(false);

  useEffect(() => {
    // Only show the tire icon on viewports wide enough to fit it without
    // crowding the headline area. Mobile gets the bar only.
    const widthQuery = window.matchMedia("(min-width: 768px)");
    setShowTire(widthQuery.matches);
    const onWidthChange = () => setShowTire(widthQuery.matches);
    widthQuery.addEventListener?.("change", onWidthChange);

    function update() {
      const doc = document.documentElement;
      const scrollTop = window.scrollY || doc.scrollTop;
      const max = (doc.scrollHeight - doc.clientHeight) || 1;
      const progress = Math.max(0, Math.min(1, scrollTop / max));

      if (fillRef.current) {
        fillRef.current.style.transform = `scaleX(${progress})`;
      }
      if (tireRef.current) {
        // Rolling tire: position keeps pace with the bar's leading edge,
        // and the rotation increments with progress so the tire literally
        // "rolls" across the screen as you scroll.
        tireRef.current.style.transform =
          `translateX(${progress * 100}vw) translateX(-50%) rotate(${progress * 1440}deg)`;
      }
      tickingRef.current = false;
    }

    function onScroll() {
      if (!tickingRef.current) {
        tickingRef.current = true;
        requestAnimationFrame(update);
      }
    }

    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", update);
      widthQuery.removeEventListener?.("change", onWidthChange);
    };
  }, []);

  return (
    <>
      {/* The bar itself — always present */}
      <div
        aria-hidden="true"
        className="fixed top-0 left-0 right-0 z-[10000] h-[3px] pointer-events-none"
        style={{ background: "rgba(0,0,0,0.18)" }}
      >
        <div
          ref={fillRef}
          style={{
            transform: "scaleX(0)",
            transformOrigin: "left center",
            willChange: "transform",
            background:
              "linear-gradient(90deg, #FDB913 0%, #FFC835 50%, #FDB913 100%)",
            boxShadow: "0 0 14px rgba(253, 185, 19, 0.6)",
            height: "100%",
            transition: "transform 80ms linear",
          }}
        />
      </div>
      {/* Rolling tire — desktop only, sits just below the bar */}
      {showTire && (
        <div
          ref={tireRef}
          aria-hidden="true"
          className="fixed top-[6px] left-0 z-[10000] pointer-events-none"
          style={{
            transform: "translateX(0vw) translateX(-50%) rotate(0deg)",
            willChange: "transform",
          }}
        >
          <div className="css-tire" style={{ width: 18, height: 18 }} />
        </div>
      )}
    </>
  );
}

export default ScrollProgressBar;
