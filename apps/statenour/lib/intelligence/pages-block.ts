/**
 * Where attention actually went, rendered verbatim for the daily brief.
 *
 * FACTS ONLY, and the exclusion is the design. `analyzePagePatterns` returns
 * both counts and an `insights[]` array, and the two are not the same kind of
 * thing:
 *
 *   FACT       "Most visited (7d): /(68), /chat(62), /missions(45)"
 *   FACT       "not visited in 3+ days: Stats, Business, Strategy"
 *   FACT       "21 visits after 11pm"
 *   INFERENCE  "LATE NIGHT PATTERN ... correlates with overthinking and poor
 *              next-day performance"
 *   INFERENCE  "High Nick AI usage - Nour may be using conversation as
 *              procrastination"
 *
 * The inferences may well be right. They are still unearned by anything this
 * module measured — it counted page rows, it did not measure next-day
 * performance or procrastination. The brief's measured failure is exactly that
 * class: 26 of its last 32 editions (81.3%) carried CRITICAL, and the marker was
 * INVERTED at both extremes, firing on the two days with zero cron failures and
 * staying silent on the day with 6,039 of 60,519 runs failing. Adding a
 * confident psychological read to that surface would be the same defect with a
 * new source.
 *
 * So `insights` never reaches this renderer, and a test enforces it. The
 * hypotheses stay available to the chat prompt, where handing a model a
 * hypothesis is a reasonable thing to do.
 *
 * THE COUNT, NOT THE BOOLEAN. `lateNightUsage` is `lateNightCount > 3` — that
 * threshold is somebody's opinion about what counts as a lot. The number is
 * rendered instead, so the reader forms their own.
 */

/** Structural, so page-intelligence can grow fields without touching this. */
export interface PageFacts {
  topPages: Array<{ page: string; count: number }>;
  blindSpots: string[];
  lateNightCount: number;
  avgDailyVisits: number;
}

/** Below this, a late-night count is noise rather than a pattern worth a line. */
export const LATE_NIGHT_FLOOR = 3;

/**
 * Render, or say plainly that nothing was measured.
 *
 * `null` is a failed read and renders UNMEASURED. Zero visits is a real measured
 * result and says so. Collapsing those two is the confusion the EmptyState
 * provenance work removed from every panel.
 */
export function renderPagesBlock(facts: PageFacts | null): string {
  if (!facts) {
    return [
      "## Attention · surfaces",
      "",
      "**UNMEASURED** — the page-visit read failed. This is not a claim that",
      "nothing was opened; nothing was counted.",
    ].join("\n");
  }

  const { topPages, blindSpots, lateNightCount, avgDailyVisits } = facts;

  if (topPages.length === 0) {
    return [
      "## Attention · surfaces",
      "",
      "Measured: no page visits recorded in the window.",
    ].join("\n");
  }

  const lines = ["## Attention · surfaces", ""];
  lines.push(
    `Most opened: ${topPages
      .slice(0, 5)
      .map((p) => `${p.page} (${p.count})`)
      .join(" · ")}`,
  );
  lines.push(`~${avgDailyVisits} views/day.`);

  if (blindSpots.length > 0) {
    lines.push("", `Not opened in 3+ days: **${blindSpots.join(" · ")}**`);
  }
  // The count, with no claim attached about what it means.
  if (lateNightCount > LATE_NIGHT_FLOOR) {
    lines.push(`${lateNightCount} visits after 11pm this week.`);
  }

  return lines.join("\n");
}
