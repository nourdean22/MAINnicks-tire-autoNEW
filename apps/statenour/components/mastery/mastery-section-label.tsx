"use client";

/**
 * MasterySectionLabel · the editorial-minimalist section heading
 * used across the 4 mastery surfaces (/goals · /scoreboard ·
 * /journal · /tasks).
 *
 * Phase D follow-up (2026-05-18) · the audit identified 3 different
 * tracking values used for what is functionally the same idiom
 * (0.22em / 0.18em / wider). The aesthetic-principles.md doc
 * §2 specifies `.eyebrow` at letter-spacing `0.14em` as the
 * canonical eyebrow tracking · this primitive realigned to that
 * value 2026-05-18 PM after the design-tokens audit.
 *
 * Color uses `var(--text-tertiary)` (canonical token, ~A3A3A3 in
 * the dark theme) instead of bare `text-white/40` so the surface
 * inherits any future palette evolution without code changes.
 *
 * The SectionHeader primitive (`components/ui/section-header.tsx`)
 * exists but uses `text-sm font-semibold` · that's the higher-density
 * idiom used in War Room, HQ, Actions, Chat. The mastery surfaces
 * deliberately use the lower-density editorial-minimalist pattern
 * (text-xs uppercase tracked).
 *
 * Anatomy:
 *   LABEL · count                                          right-action
 */

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface MasterySectionLabelProps {
  /** The label text. Always rendered as uppercase. */
  label: string;
  /** Optional count rendered after a `·` separator. */
  count?: number | string;
  /** Right-aligned slot for a small CTA or status chip. */
  action?: ReactNode;
  /** Tone overrides the default tertiary muted color. */
  tone?: "default" | "amber" | "emerald";
  /** Additional classes on the outer wrapper. */
  className?: string;
}

const TONE_TEXT: Record<NonNullable<MasterySectionLabelProps["tone"]>, string> = {
  default: "text-[var(--text-tertiary)]",
  amber: "text-amber-300/80",
  emerald: "text-emerald-300/80",
};

export function MasterySectionLabel({
  label,
  count,
  action,
  tone = "default",
  className,
}: MasterySectionLabelProps) {
  // 2026-05-18 PM bugfix · Chrome walkthrough caught: original
  // implementation used <h2>, which globals.css line 157 styles as
  // Barlow Condensed 1.25rem (20px) · global cascade overrode our
  // text-[10px] tailwind utility on /scoreboard and other surfaces.
  // Visible symptom: 'ANOMALOUS · 2' rendered ~32px tall instead of
  // the intended ~10px eyebrow.
  //
  // Switched to <p role='heading' aria-level='2'> · keeps semantic
  // role for screen readers but bypasses the h2 global style.
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 min-w-0",
        className,
      )}
    >
      <p
        role="heading"
        aria-level={2}
        className={cn(
          // Mirrors `.eyebrow` (globals.css line 256-261):
          // 0.625rem · weight 600 · uppercase · letter-spacing 0.14em
          "text-[10px] font-semibold uppercase tracking-[0.14em] truncate m-0",
          TONE_TEXT[tone],
        )}
      >
        {label}
        {count != null ? (
          <span className="ml-1 tabular-nums font-normal">· {count}</span>
        ) : null}
      </p>
      {action ? (
        <div className="shrink-0 text-[10px] uppercase tracking-[0.14em]">
          {action}
        </div>
      ) : null}
    </div>
  );
}
