"use client";

/**
 * <EmptyState /> — richer "nothing here yet" primitive.
 *
 * v11.1 E5 · Empty states should never be dead static text. Every
 * one says four things:
 *   1. What this surface MEANS (the concept — "skills", "beliefs")
 *   2. WHY it's empty right now (no DONE tasks yet, no curation,
 *      cron hasn't run, etc)
 *   3. HOW to unlock data (the specific next action — click, wait,
 *      write a journal entry, whatever)
 *   4. Subtle MOTION so the card breathes + signals "alive"
 *
 * Three tones:
 *   neutral  — default, most common ("no candidates yet")
 *   positive — "in rhythm" / "clean ledger" / "all clear"
 *   warning  — "something should be here but isn't" (rare)
 *
 * Usage:
 *   <EmptyState
 *     icon={Target}
 *     title="No candidates yet"
 *     why="Candidates surface Sunday at 3am from the last 30d of DONE tasks."
 *     unlock="Ship more DONE tasks, or run /api/cron/extract-skills manually."
 *     cta={{ label: "Extract now", onClick: extractNow }}
 *     tone="neutral"
 *   />
 */

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateTone = "neutral" | "positive" | "warning";

interface EmptyStateProps {
  /** Lucide icon component. Breathes subtly via .animate-breath. */
  icon?: ComponentType<{ size?: number; className?: string }>;
  /** One-line headline. Required. */
  title: string;
  /** Optional 1-2 sentence explanation of WHY it's empty. */
  why?: string;
  /** Optional 1-line description of HOW to unlock the surface. */
  unlock?: string;
  /** Optional primary action (renders as a button). */
  cta?: { label: string; onClick: () => void; disabled?: boolean };
  /** Optional secondary action (text link). */
  secondaryLink?: { label: string; href: string };
  /** Visual tone. Default "neutral". */
  tone?: EmptyStateTone;
  /** Extra classes on the root. */
  className?: string;
}

const TONE_STYLES: Record<EmptyStateTone, {
  iconColor: string;
  iconBg: string;
  titleColor: string;
}> = {
  neutral: {
    iconColor: "text-[var(--text-tertiary)]",
    iconBg: "bg-[var(--bg-base)]/50 border-[var(--border-default)]",
    titleColor: "text-[var(--text-secondary)]",
  },
  positive: {
    iconColor: "text-emerald-400",
    iconBg: "bg-emerald-500/10 border-emerald-500/20",
    titleColor: "text-emerald-300",
  },
  warning: {
    iconColor: "text-amber-400",
    iconBg: "bg-amber-500/10 border-amber-500/30",
    titleColor: "text-amber-300",
  },
};

export function EmptyState({
  icon: Icon,
  title,
  why,
  unlock,
  cta,
  secondaryLink,
  tone = "neutral",
  className,
}: EmptyStateProps) {
  const s = TONE_STYLES[tone];
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center py-5 px-4 gap-2",
        className,
      )}
    >
      {Icon && (
        <div
          className={cn(
            "w-10 h-10 rounded-full flex items-center justify-center border animate-breath",
            s.iconBg,
          )}
        >
          <Icon size={16} className={s.iconColor} />
        </div>
      )}
      <p className={cn("text-[11.5px] font-medium", s.titleColor)}>{title}</p>
      {why && (
        <p className="text-[10px] text-[var(--text-tertiary)] max-w-[320px] leading-relaxed">
          {why}
        </p>
      )}
      {unlock && (
        <p className="text-[9px] font-mono text-[var(--text-tertiary)]/80 max-w-[360px] leading-relaxed italic">
          → {unlock}
        </p>
      )}
      {(cta || secondaryLink) && (
        <div className="flex items-center gap-2 mt-1">
          {cta && (
            <button
              type="button"
              onClick={cta.onClick}
              disabled={cta.disabled}
              className={cn(
                "text-[10px] font-mono uppercase tracking-wider px-2.5 py-1 rounded border transition-all duration-200 ease-out",
                "border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/10 hover:border-[var(--gold)]/60 hover:shadow-[0_0_10px_rgba(253,185,19,0.15)]",
                "disabled:opacity-40 disabled:cursor-not-allowed",
              )}
            >
              {cta.label}
            </button>
          )}
          {secondaryLink && (
            <a
              href={secondaryLink.href}
              className="text-[10px] font-mono uppercase tracking-wider px-2 py-1 rounded text-[var(--text-tertiary)] hover:text-[var(--gold)] transition-colors"
            >
              {secondaryLink.label} →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
