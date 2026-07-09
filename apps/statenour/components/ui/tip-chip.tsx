"use client";

/**
 * TipChip · Wave 20.1 (v10.0.529.75) · contextual learning chip.
 *
 * v10.0.529.75 fix: popover now uses position:fixed with viewport
 * coords computed from the button's getBoundingClientRect(). Pre-fix
 * the popover was position:absolute · the mode-pill container's
 * overflow-x:auto (the horizontal scroller) silently collapsed
 * overflow-y to "auto" too (per CSS spec) which CLIPPED the popover
 * out of view. The operator saw the "?" chips but tapping them did
 * nothing visible. Fixed positioning escapes any overflow ancestor.
 *
 * What this is:
 *   A small "?" icon that, on click, expands to reveal a 1-2 sentence
 *   teaching note about the surface it's attached to. The operator
 *   asked for "learning installed throughout teaching me wherever I'm
 *   looking" · this is the primitive that makes that real.
 *
 * Use:
 *   <TipChip tip="A daily task fires every day. Once is one-shot." />
 *   <TipChip tip={LEARN_TIPS.modeToday} title="today" />
 *
 * Operating constraints:
 *   · Inline · doesn't eject the operator from their work
 *   · Mobile-safe · 24×24 tap target (above WCAG)
 *   · Self-dismisses on outside click + Escape + scroll
 *   · Stateless leaf · TipChip can be mounted in dozens of spots
 *     without perf cost
 *
 * Skills applied:
 *   · tutorial-engineer (micro-explanations exactly where needed)
 *   · fixing-accessibility (24px target + Escape + aria-expanded)
 *   · frontend-design (ONE direction · gold accent · zero AI-slop)
 *   · senior-frontend (single rAF positioning · no portal · no globals)
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { HelpCircle } from "lucide-react";

interface TipChipProps {
  /** The teaching note · 1-2 sentences max · plain English · lowercase. */
  tip: string;
  /** Optional title shown in bold above the tip. */
  title?: string;
  /** Visual size · "xs" (12px icon) or "sm" (14px). Default "xs". */
  size?: "xs" | "sm";
  /** Optional extra className on the wrapper button. */
  className?: string;
  /** Optional accessible label override · default is "learn more". */
  ariaLabel?: string;
}

interface PopoverPos {
  top: number;
  left: number;
  /** When true, popover renders above the button instead of below
   *  (used when the button is near the bottom of the viewport). */
  flippedAbove: boolean;
}

const POPOVER_WIDTH = 240; // px · matches Tailwind w-[240px] below
const POPOVER_GAP = 6; // px · gap between button and popover

export function TipChip({
  tip,
  title,
  size = "xs",
  className,
  ariaLabel = "learn more",
}: TipChipProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<PopoverPos | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Recompute position from the button's viewport rect. Called on open,
  // on resize, on scroll (so the popover follows the button), and right
  // after the popover mounts (to factor in its actual measured height).
  const recompute = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const popH = popoverRef.current?.offsetHeight ?? 90; // pre-measure fallback
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Default: render below the button + right-aligned to it so the
    // chip's right edge is the popover's right edge (matches mode-pill
    // layout). If that would push off the right viewport edge, anchor
    // to the button's left edge instead.
    let left = r.right - POPOVER_WIDTH;
    if (left < 8) left = 8; // 8px gutter from viewport left
    if (left + POPOVER_WIDTH > vw - 8) left = vw - POPOVER_WIDTH - 8;

    let top = r.bottom + POPOVER_GAP;
    let flippedAbove = false;
    if (top + popH > vh - 8) {
      // Not enough room below · flip above the button.
      top = r.top - POPOVER_GAP - popH;
      flippedAbove = true;
      if (top < 8) top = 8;
    }

    setPos({ top, left, flippedAbove });
  }, []);

  // Open · seed position before paint to avoid a frame of "popover at
  // (0,0)". useLayoutEffect runs synchronously before the browser paints.
  useLayoutEffect(() => {
    if (!open) {
      requestAnimationFrame(() => setPos(null));
      return;
    }
    recompute();
  }, [open, recompute]);

  // Close on outside click + Escape + scroll · the scroll handler also
  // re-runs recompute so the popover follows its button until dismissed.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (popoverRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onScroll = () => recompute();
    const onResize = () => recompute();

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    window.addEventListener("resize", onResize);
    // v10.0.529.84 · Wave 28 · C2 · iPad rotation edge case · resize
    // fires on orientation change on most browsers but not all · the
    // explicit orientationchange listener closes the gap.
    window.addEventListener("orientationchange", onResize);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, { capture: true } as EventListenerOptions);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, [open, recompute]);

  // After the popover renders for the first time, recompute again so
  // the actual measured height feeds the flip logic.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(recompute);
    return () => cancelAnimationFrame(id);
  }, [open, recompute]);

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((v) => !v);
  }, []);

  const iconPx = size === "xs" ? 12 : 14;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-label={ariaLabel}
        aria-expanded={open}
        className={cn(
          "inline-flex items-center justify-center rounded-full transition-colors",
          "min-w-[24px] min-h-[24px] p-1",
          "text-[var(--text-tertiary)] hover:text-[var(--gold)]",
          "focus-visible:ring-1 focus-visible:ring-[var(--gold)] focus-visible:outline-none",
          open && "text-[var(--gold)]",
          className,
        )}
      >
        <HelpCircle size={iconPx} strokeWidth={1.75} />
      </button>
      {open && pos && (
        <div
          ref={popoverRef}
          role="tooltip"
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: POPOVER_WIDTH,
            zIndex: 80,
          }}
          className={cn(
            "rounded-md border border-[var(--gold)]/30 bg-[var(--bg-raised)] px-3 py-2 shadow-lg",
            "text-[11px] leading-snug text-[var(--text-secondary)]",
          )}
        >
          {title && (
            <div className="mb-1 text-[10px] font-mono uppercase tracking-[0.15em] text-[var(--gold)]">
              {title}
            </div>
          )}
          <p className="lowercase">{tip}</p>
        </div>
      )}
    </>
  );
}
