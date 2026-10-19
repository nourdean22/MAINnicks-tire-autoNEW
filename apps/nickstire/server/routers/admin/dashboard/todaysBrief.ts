/**
 * Morning brief composition — the 3-line what-changed-overnight summary.
 *
 * Carved from admin/dashboard.ts (1,133 lines, one router object holding
 * 17 procedures) in the 2026-07-05 polish wave. Grouped by reason-to-change.
 * Each group is a plain procedure record; ./index.ts spread-merges them into
 * one flat router, so every adminDashboard.<proc> client call path is
 * byte-identical. Pure mechanical move — no procedure body was modified.
 */
/**
 * Admin router — dashboard stats, analytics, weekly reports, follow-ups.
 */





export const todaysBriefProcedures = {

  /**
   * Section Insight — single actionable callout for a specific admin
   * section. Returns the highest-priority signal RELEVANT TO THAT SECTION,
   * not the global Today's Brief.
   *
   * Used by the InsightStrip primitive at the top of each section so
   * Nour sees "for Customers: 12 lapsed VIPs need outreach" or "for
   * Revenue: MTD pace is 8% behind".
   *
   * Returns null when no actionable signal — section just renders no strip.
   */
};
