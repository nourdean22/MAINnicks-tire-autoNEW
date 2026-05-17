"use client";

/**
 * SECTION HEADER — Unified section heading component.
 *
 * Replaces ~15 inline `<h2 className="text-sm font-semibold
 * text-[var(--text-secondary)] flex items-center gap-2">` duplicates
 * across War Room, HQ, Actions, and Chat. One source of truth for
 * how section headings look so we can evolve the design in one place.
 *
 * Anatomy:
 *   [icon]  LABEL  [count]  ·  subtitle                         [action→]
 *
 * All slots are optional except label. The component is stateless
 * — wrap it in a <div className="space-y-2"> in the parent.
 *
 * Accent colors let a section opt into a thematic tint (gold for MIT,
 * red for critical, blue for analytics, etc.) without needing custom
 * CSS at the call site.
 */

import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

type Accent = "default" | "gold" | "red" | "amber" | "emerald" | "blue" | "purple";

const ACCENT_TEXT: Record<Accent, string> = {
  default: "text-[var(--text-secondary)]",
  gold: "text-[var(--gold)]",
  red: "text-red-400",
  amber: "text-amber-400",
  emerald: "text-emerald-400",
  blue: "text-blue-400",
  purple: "text-violet-400",
};

interface SectionHeaderProps {
  /** Optional icon rendered left of the label. Pass a lucide icon element. */
  icon?: ReactNode;
  /** Section label — the main thing. Required. */
  label: string;
  /** Optional numeric count rendered as a small pill after the label. */
  count?: number | string;
  /** Small italic subtitle rendered right of the count. */
  subtitle?: string;
  /** Right-aligned action slot — usually a button or link. */
  action?: ReactNode;
  /** Thematic color accent for the label + icon. */
  accent?: Accent;
  /** Apply a pulsing indicator dot (for "live" sections). */
  live?: boolean;
  /** Optional extra classes on the outer wrapper. */
  className?: string;
}

export function SectionHeader({
  icon,
  label,
  count,
  subtitle,
  action,
  accent = "default",
  live = false,
  className,
}: SectionHeaderProps) {
  const textColor = ACCENT_TEXT[accent];

  return (
    <div className={cn("flex items-center justify-between gap-2 min-w-0", className)}>
      <h2 className={cn("text-sm font-semibold flex items-center gap-2 min-w-0", textColor)}>
        {icon}
        <span className="truncate">{label}</span>
        {count !== undefined && count !== null && (
          <span
            className={cn(
              "shrink-0 text-[9px] font-mono font-bold px-1.5 py-0.5 rounded",
              "bg-zinc-800/80 text-[var(--text-tertiary)]"
            )}
          >
            {count}
          </span>
        )}
        {subtitle && (
          <span className="shrink-0 text-[10px] text-[var(--text-tertiary)] font-normal italic">
            {subtitle}
          </span>
        )}
        {live && (
          <span
            className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-500 pulse-live"
            aria-label="live"
          />
        )}
      </h2>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}
