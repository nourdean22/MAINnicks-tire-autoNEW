/**
 * The capacity signals, rendered VERBATIM for the daily brief.
 *
 * WHY THIS EXISTS. `lib/brain/task-signals.ts` computes a clean bag of
 * operator-relevant facts — open, late, stale, done-today, and a realistic
 * capacity-remaining derived from a rolling 30-day completion rate. It works.
 * Probed against prod 2026-08-26: 131ms, `{hour:8, state:"normal", doneToday:0,
 * openCount:16, lateCount:0, staleCount:3, capacityRemainingMin:80,
 * allocatedMin:350}`.
 *
 * It had ZERO consumers. Not broken, not stale — computed correctly and thrown
 * away, one of seven `lib` modules the clock work touched that nothing calls.
 *
 * WHY IT IS RENDERED, NOT PROMPTED. compose-daily-brief already established the
 * rule and states it plainly: a deterministic block is counted BEFORE the model
 * runs and prepended VERBATIM, so the model "cannot round 20 to 'several', drop
 * the section for space, or soften a level". These are counts. Handing them to
 * the composer would make them suggestions.
 *
 * That matters more here than usual. MEASURED 2026-08-25: 26 of the last 32
 * briefs (81.3%) carry CRITICAL, and the marker is INVERTED at both extremes —
 * it fired on the two days with zero cron failures and stayed silent on the day
 * with 6,039. Feeding more input to that composer would inherit the problem;
 * rendering facts beside it does not.
 *
 * NO INTERPRETATION. `page-intelligence` produces lines like "Nour may be using
 * conversation as procrastination" — an inference, not a count. Deliberately not
 * wired here: the brief's measured failure is unearned claims, and an inference
 * rendered as a fact is exactly that failure with a new source.
 */

/** The subset of TaskSignals this block renders. Structural, so the source
 *  module can grow fields without touching the renderer. */
export interface CapacityInput {
  openCount: number;
  lateCount: number;
  staleCount: number;
  doneToday: number;
  capacityRemainingMin: number;
  allocatedMin: number;
}

/** Minutes as "1h 20m" / "45m" — a brief is read on a phone. */
function mins(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "unknown";
  const h = Math.floor(n / 60);
  const m = Math.round(n % 60);
  return h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
}

/**
 * Render the block, or say plainly that it was not measured.
 *
 * `null` renders as UNMEASURED rather than as an empty section or a zero.
 * `gatherTaskSignals` documents itself as "never throws", but a doc claim is not
 * a guarantee — and a silent omission here would be indistinguishable from a day
 * with nothing to report, which is the exact confusion the EmptyState provenance
 * work removed from the panels.
 */
export function renderCapacityBlock(signals: CapacityInput | null): string {
  if (!signals) {
    return [
      "## Capacity",
      "",
      "**UNMEASURED** — the task-signal read failed. This is not a claim that",
      "there is nothing open; nothing was counted.",
    ].join("\n");
  }

  const { openCount, lateCount, staleCount, doneToday, capacityRemainingMin, allocatedMin } = signals;
  const over = allocatedMin > 0 && capacityRemainingMin <= 0;

  const lines = [
    "## Capacity",
    "",
    `Open **${openCount}** · late **${lateCount}** · stale **${staleCount}** · done today **${doneToday}**`,
    over
      ? `Committed **${mins(allocatedMin)}**, and the realistic remainder is **gone** — anything new today displaces something already promised.`
      : `Committed **${mins(allocatedMin)}** · realistically **${mins(capacityRemainingMin)}** left.`,
  ];

  // Only the counts that are non-zero earn a line. A brief that lists four
  // zeroes every morning trains the eye to skip the section.
  if (lateCount > 0) lines.push("", `${lateCount} past due.`);
  if (staleCount > 0) lines.push(`${staleCount} untouched 14d+ — decide or drop.`);

  return lines.join("\n");
}
