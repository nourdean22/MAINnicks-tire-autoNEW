"use client";

/**
 * <EmptyState /> — "nothing here", and WHY there is nothing.
 *
 * THE DEFECT THIS PROP EXISTS TO KILL. An empty panel has at least four
 * different causes, and until now this component could not tell them apart —
 * so neither could the operator:
 *
 *   ZERO        we measured, and the true count is zero. Good news.
 *   UNMEASURED  we never took the measurement. The cron has not run, the
 *               feature is off, the window has not opened yet.
 *   ERROR       the read failed. We know nothing at all.
 *   SUPPRESSED  deliberately hidden — see below, this one is the sharp edge.
 *
 * Every one of those rendered identically, so the panels started guessing in
 * PROSE. Their own copy confesses it:
 *
 *   discover-tab              "Every recent discovery has a verdict, OR the
 *                              engines found nothing this cycle."
 *   contradiction-resolution  "EITHER you've been coherent OR the detector
 *                              hasn't seen friction yet."
 *
 * Those "or"s are this missing field, written out longhand because the
 * component genuinely could not know. And where a panel did not hedge, it
 * simply asserted the happy case: `nudge-panel` mapped a FAILED query to `[]`
 * and rendered a green "In rhythm · Silence here = all subsystems stable" —
 * a false all-clear across nine subsystems, with a code comment recording the
 * behaviour as intentional. That is the lying-surface shape: not an absent
 * signal, a confident wrong one.
 *
 * THE POSITIVE TONE IS TYPE-GATED. `tone: "positive"` is only representable
 * with `provenance: "ZERO"`. An all-clear is a claim about a measurement, so
 * you may not make it on a surface that never measured anything. This is a
 * compile error at the call site, not a lint — `components/` and `app/` are
 * both inside `tsconfig`, so it cannot be merged past.
 *
 * WHY `SUPPRESSED` IS A STATE AND NOT A `return null`. A panel that renders
 * nothing at all is indistinguishable from a panel that crashed — which is
 * exactly how `self-critique-card` sat blank for weeks while returning 200s.
 * Declaring the suppression renders one quiet line instead of a void, so
 * "deliberately hidden" and "broken" stop looking the same.
 */

import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export type EmptyStateTone = "neutral" | "positive" | "warning";

/** Why this surface is empty. Required — see the header. */
export type EmptyProvenance = "ZERO" | "UNMEASURED" | "ERROR" | "SUPPRESSED";

/** Operator-facing label per provenance. Exported so tests assert on it. */
export const PROVENANCE_LABEL: Record<EmptyProvenance, string> = {
  ZERO: "measured · zero",
  UNMEASURED: "unmeasured, not zero",
  ERROR: "read failed — unknown, not zero",
  SUPPRESSED: "hidden by design",
};

interface EmptyStateBase {
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
  /** Extra classes on the root. */
  className?: string;
}

/**
 * A positive tone is only available to a MEASURED zero. Everything else may be
 * neutral or warning. Making this a union rather than a runtime check means a
 * false all-clear does not compile.
 */
export type EmptyStateProps = EmptyStateBase &
  (
    | { provenance: "ZERO"; tone?: EmptyStateTone }
    | {
        provenance: Exclude<EmptyProvenance, "ZERO">;
        tone?: Exclude<EmptyStateTone, "positive">;
      }
  );

const TONE_STYLES: Record<
  EmptyStateTone,
  { iconColor: string; iconBg: string; titleColor: string }
> = {
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

const PROVENANCE_CHIP: Record<EmptyProvenance, string> = {
  ZERO: "text-[var(--text-tertiary)]/70",
  UNMEASURED: "text-amber-400/80",
  ERROR: "text-red-400/80",
  SUPPRESSED: "text-[var(--text-tertiary)]/50",
};

export function EmptyState(props: EmptyStateProps) {
  const {
    icon: Icon,
    title,
    why,
    unlock,
    cta,
    secondaryLink,
    provenance,
    className,
  } = props;
  const tone: EmptyStateTone = props.tone ?? "neutral";

  // A suppressed surface is quiet, but never silent. One line is the whole
  // point: it distinguishes "deliberately hidden" from "this component threw".
  if (provenance === "SUPPRESSED") {
    return (
      <p
        className={cn(
          "text-[9px] font-mono text-[var(--text-tertiary)]/50 py-1 text-center",
          className,
        )}
        data-provenance="SUPPRESSED"
      >
        {title} · {PROVENANCE_LABEL.SUPPRESSED}
      </p>
    );
  }

  const s = TONE_STYLES[tone];
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center py-5 px-4 gap-2",
        className,
      )}
      data-provenance={provenance}
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
      <p
        className={cn(
          "text-[9px] font-mono uppercase tracking-wider",
          PROVENANCE_CHIP[provenance],
        )}
      >
        {PROVENANCE_LABEL[provenance]}
      </p>
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
