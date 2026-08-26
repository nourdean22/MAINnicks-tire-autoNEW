/**
 * Which domains have gone quiet, rendered verbatim for the daily brief.
 *
 * WHAT THIS WIRES. `lib/brain/attention-tracker.ts` had zero production
 * consumers — one of seven `lib` modules the clock work touched that nothing
 * calls. It works: probed against prod 2026-08-26, `analyzeAttentionPatterns`
 * returned in 393ms with three real neglected domains.
 *
 * THE SENTINEL, and why the wording here is deliberate. `daysSinceEngagement`
 * is computed as `mention ? actualDays : 14`, and the whole scan is a 14-day
 * window. So `14` does NOT mean "last seen a fortnight ago" — it means "never
 * seen in the window", and the true figure could be any number ≥ 14. Rendering
 * it as "14d silent" would state a precision the data does not have, which is
 * the failure this brief has been measured doing elsewhere. At the cap it reads
 * "not in the last 14d"; below it, the real count.
 *
 * WHAT IS DELIBERATELY LEFT OUT. `analyzeAttentionPatterns` also returns
 * `focusScore` and `attentionVelocity`. Live values are 0 and -50, and both are
 * ratios over a filtered population whose denominator is not visible in the
 * output — a "0% alignment" headline is exactly the kind of alarming number
 * that turns out to be definitional. Counts of quiet domains are checkable;
 * a derived score is an argument. Only the counts are rendered.
 *
 * WHY RENDERED, NOT PROMPTED. Same contract as the capacity block beside it and
 * the operator queue above it: counted before the model, prepended verbatim, so
 * it cannot be rounded, softened, or dropped for space.
 */

/** Structural, so attention-tracker can grow fields without touching this. */
export interface NeglectInput {
  domain: string;
  daysSinceEngagement: number;
  hasGoal: boolean;
}

/** The lookback the tracker scans. `daysSinceEngagement` saturates here. */
export const ATTENTION_WINDOW_DAYS = 14;

function phrase(days: number): string {
  return days >= ATTENTION_WINDOW_DAYS
    ? `not in the last ${ATTENTION_WINDOW_DAYS}d`
    : `${days}d quiet`;
}

/**
 * Render the block, or say plainly that nothing was measured.
 *
 * `null` is a failed read and renders as UNMEASURED. An empty ARRAY is a real
 * measured result — nothing is neglected — and says so. Those are different
 * facts and the brief must not collapse them, which is the same distinction the
 * EmptyState provenance work put on every panel.
 */
export function renderAttentionBlock(neglected: NeglectInput[] | null): string {
  if (!neglected) {
    return [
      "## Attention",
      "",
      "**UNMEASURED** — the attention read failed. This is not a claim that",
      "every domain is getting attention; nothing was counted.",
    ].join("\n");
  }

  if (neglected.length === 0) {
    return ["## Attention", "", "Measured: no domain has gone quiet."].join("\n");
  }

  // A quiet domain that carries a GOAL is the one that actually costs something
  // — it is a commitment with no attention behind it, not merely a topic that
  // has not come up. Those lead.
  const sorted = [...neglected].sort((a, b) => {
    if (a.hasGoal !== b.hasGoal) return a.hasGoal ? -1 : 1;
    return b.daysSinceEngagement - a.daysSinceEngagement;
  });

  const lines = ["## Attention", ""];
  const withGoal = sorted.filter((d) => d.hasGoal);
  const withoutGoal = sorted.filter((d) => !d.hasGoal);

  if (withGoal.length > 0) {
    lines.push(
      `**Goals with no attention:** ${withGoal
        .map((d) => `${d.domain} (${phrase(d.daysSinceEngagement)})`)
        .join(" · ")}`,
    );
  }
  if (withoutGoal.length > 0) {
    lines.push(
      `Quiet, no goal set: ${withoutGoal
        .map((d) => `${d.domain} (${phrase(d.daysSinceEngagement)})`)
        .join(" · ")}`,
    );
  }
  return lines.join("\n");
}
