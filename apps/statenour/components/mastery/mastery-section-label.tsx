"use client";

/**
 * MasterySectionLabel · the editorial-minimalist section heading
 * used across the 4 mastery surfaces (/goals · /scoreboard ·
 * /journal · /tasks).
 *
 * Phase D follow-up (2026-05-18) · the audit identified 3 different
 * tracking values being used for what is functionally the same idiom:
 *   · tracking-[0.22em] in goals sidebar, scoreboard headers, threads
 *   · tracking-[0.18em] in goals header supertitle, scoreboard cards
 *   · tracking-wider in goals domain tags, suggestions buttons
 *
 * 0.22em is the canonical value · it's the boldest visual rhythm of
 * the three and matches the aesthetic principles doc most cleanly.
 * 0.18em and tracking-wider become aliases that collapse here.
 *
 * The SectionHeader primitive (`components/ui/section-header.tsx`)
 * exists but uses `text-sm font-semibold` · that's the higher-density
 * idiom used in War Room, HQ, Actions, Chat. The mastery surfaces
 * deliberately use the lower-density editorial-minimalist pattern
 * (text-xs uppercase tracked).
 *
 * Anatomy:
 *   LABEL · count                                          right-action
 *
 * Where right-action is an optional small CTA (e.g. "stale · review →"
 * on /goals or "{N} dormant" on the ThreadRail).
 */

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

interface MasterySectionLabelProps {
  /** The label text. Always rendered as uppercase. */
  label: string;
  /** Optional count rendered after a `·` separator, also uppercase. */
  count?: number | string;
  /** Right-aligned slot for a small CTA or status chip. */
  action?: ReactNode;
  /** Tone overrides the default white/40 muted color. */
  tone?: "default" | "amber" | "emerald";
  /** Additional classes on the outer wrapper. */
  className?: string;
}

const TONE_TEXT: Record<NonNullable<MasterySectionLabelProps["tone"]>, string> = {
  default: "text-white/40",
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
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 min-w-0",
        className,
      )}
    >
      <h2
        className={cn(
          "text-[10px] uppercase tracking-[0.22em] truncate",
          TONE_TEXT[tone],
        )}
      >
        {label}
        {count != null ? (
          <span className="ml-1 tabular-nums">· {count}</span>
        ) : null}
      </h2>
      {action ? (
        <div className="shrink-0 text-[10px] uppercase tracking-wider">
          {action}
        </div>
      ) : null}
    </div>
  );
}
