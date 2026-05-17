"use client";

/**
 * <DismissButton /> — accessible `×` close button with adequate
 * touch-target hit area without growing the visual glyph.
 *
 * v10.0.498 · ADR-0011 mobile audit follow-up.
 *
 * THE PROBLEM
 *   12 right-rail / inline cards across statenour use the pattern
 *
 *     `opacity-0 group-hover/cell:opacity-60 hover:!opacity-100 ...`
 *
 *   on `<button>×</button>` to hide the dismiss control until hover.
 *   Renders at 10×13px on mobile · below WCAG 2.5.5 AA minimum
 *   (24×24) and iOS HIG / Material touch targets (44 / 48). The
 *   `group-hover` trick doesn't translate to touch — Android never
 *   fires hover, iOS only after a long-press.
 *
 * THE FIX
 *   This primitive renders the same small `×` glyph but with a
 *   transparent 36×36 hit area achieved via padding + negative
 *   margin — the BUTTON occupies 36×36 of touch target while the
 *   GLYPH stays the same visual size. Editorial minimalism preserved.
 *
 *     padding: 12px;
 *     margin: -12px;
 *
 *   This is the "pulled-margin" pattern. Net layout impact: zero.
 *   The hit area expands but adjacent elements aren't pushed.
 *
 * USAGE
 *
 *   ```tsx
 *   <div className="group/cell relative">
 *     <DismissButton
 *       onClick={dismiss}
 *       label="Dismiss this insight"
 *       hoverGate="cell"
 *     />
 *     <CardBody />
 *   </div>
 *   ```
 *
 *   The `hoverGate` prop wires up the `group-hover/<name>:opacity-100`
 *   pattern so the visual stays hidden-until-hover for cursor users
 *   while the hit area is always reachable by touch.
 *
 * VARIANTS
 *   `hoverGate`     — name of the group-hover scope (default: "cell")
 *   `alwaysVisible` — opt out of the hover-gate entirely (touch-first
 *                     surfaces like the chat composer)
 *   `size`          — "sm" (default · 12px glyph) | "md" (16px glyph)
 */

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes } from "react";

type DismissButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label"
> & {
  /**
   * Accessible label for the close action.
   * Examples: "Dismiss this insight" · "Close panel" · "Remove tag".
   */
  label: string;
  /**
   * The `group/<name>` scope this dismiss button is nested in. When
   * present, the visual fades from opacity-0 → 0.6 → 1 on group
   * hover. The button hit area is always 36×36.
   * Default: "cell".
   */
  hoverGate?: string;
  /**
   * Skip the hover-gate entirely. Always-visible × glyph at full
   * opacity. Use on touch-first surfaces (chat composer, mobile
   * cards, etc).
   */
  alwaysVisible?: boolean;
  /** Glyph size. "sm" (12px, default) or "md" (16px). */
  size?: "sm" | "md";
};

export function DismissButton({
  label,
  hoverGate = "cell",
  alwaysVisible = false,
  size = "sm",
  className,
  ...props
}: DismissButtonProps) {
  const glyphSize = size === "md" ? 16 : 12;

  // Hover-gate Tailwind classes are built from the gate name so the
  // group-hover variant compiles correctly. We hard-code the common
  // gate names below; arbitrary names use a fallback always-visible
  // class so behavior is safe even when the gate scope is missing.
  const KNOWN_GATES: Record<string, string> = {
    cell: "opacity-0 group-hover/cell:opacity-60 hover:!opacity-100",
    card: "opacity-0 group-hover/card:opacity-60 hover:!opacity-100",
    row: "opacity-0 group-hover/row:opacity-60 hover:!opacity-100",
    panel: "opacity-0 group-hover/panel:opacity-60 hover:!opacity-100",
  };
  const hoverClasses = alwaysVisible
    ? "opacity-60 hover:opacity-100"
    : (KNOWN_GATES[hoverGate] ?? "opacity-60 hover:opacity-100");

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        // 36×36 hit area achieved via padding · zero net layout impact
        // because the negative margin pulls neighbors back to the
        // original spot.
        "p-3 -m-3",
        // Touch-friendly tap target · explicit min sizes for safety
        "inline-flex items-center justify-center",
        "min-w-[36px] min-h-[36px]",
        // Visual state · gated by hover-group OR always-visible
        hoverClasses,
        // Editorial minimalism · keep the glyph quiet
        "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
        "transition-opacity duration-150",
        // Keyboard a11y · :focus-visible rule in globals.css handles
        // the gold ring · this just rounds the focus rect cleanly.
        "rounded-full",
        // Defensive · prevent the button from being the page-wide
        // tabindex hijack when nested in cards with their own focus.
        "focus-visible:relative focus-visible:z-10",
        className,
      )}
      {...props}
    >
      <X size={glyphSize} strokeWidth={2} aria-hidden />
    </button>
  );
}
