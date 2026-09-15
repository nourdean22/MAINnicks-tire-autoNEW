"use client";

/**
 * PriorityBreakdownView · why THIS number · 2026-09-15.
 *
 * Renders lib/scoring/task-priority.ts `PriorityBreakdown`: every term of
 * the weighted sum with its input in operator words, its share as a bar,
 * the multipliers that dampened it, and the arithmetic on one line. The
 * bars are relative to the largest term so the eye lands on what actually
 * decided the rank. Presentational: plain props, so the gallery and tests
 * render it without a store or a query.
 */

import type { PriorityBreakdown } from "@/lib/scoring/task-priority";

/** Up to two decimals, trailing zeros dropped: 27 → "27", 7.15 → "7.15", 0.35 → "0.35". */
const fmt = (n: number) => String(Number(n.toFixed(2)));

export interface PriorityBreakdownViewProps {
  breakdown: PriorityBreakdown;
}

export function PriorityBreakdownView({ breakdown }: PriorityBreakdownViewProps) {
  const terms = [...breakdown.terms].sort((a, b) => b.contribution - a.contribution);
  const max = Math.max(1, ...terms.map((t) => t.contribution));
  const factor = breakdown.multipliers.reduce((m, x) => m * x.factor, 1);

  return (
    <div className="space-y-2" data-priority-breakdown={breakdown.score}>
      <ul className="space-y-1.5">
        {terms.map((t) => (
          <li key={t.key} data-priority-term={t.key} className="space-y-0.5">
            <div className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
              <span className="text-fg-secondary">
                {t.label}
                <span className="text-fg-tertiary"> · {t.note}</span>
              </span>
              <span className="tabular-nums text-fg-tertiary">
                {t.input}×{t.weight} = <span className="text-fg-secondary">{fmt(t.contribution)}</span>
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-white/5" aria-hidden>
              <div className="h-full rounded-full bg-[var(--gold)]/60" style={{ width: `${Math.round((t.contribution / max) * 100)}%` }} />
            </div>
          </li>
        ))}
      </ul>
      {breakdown.multipliers.length > 0 ? (
        <ul className="space-y-0.5 font-mono text-[11px] text-amber-300/90">
          {breakdown.multipliers.map((m) => (
            <li key={m.key} data-priority-multiplier={m.key}>
              ×{m.factor} · {m.note}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="font-mono text-[11px] text-fg-tertiary">
        Σ {fmt(breakdown.weightedSum)}
        {breakdown.multipliers.length > 0 ? ` × ${fmt(factor)}` : ""} → <span className="text-fg">{breakdown.score}</span>
      </p>
    </div>
  );
}
