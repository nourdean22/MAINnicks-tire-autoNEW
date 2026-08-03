import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Resolve from the vitest root (apps/nickstire), NOT import.meta.url: this
// suite runs under jsdom where import.meta.url is an http:// URL, so
// fileURLToPath threw "The URL must be of scheme file" and the WHOLE suite
// failed at collection - the repo-wide red test since the admin waves.
const adminSource = readFileSync(
  resolve(process.cwd(), "client/src/pages/Admin.tsx"),
  "utf8",
);

describe("admin shell operator-truth contract", () => {
  it("uses the shared overview bundle instead of parallel stats and callback polling", () => {
    expect(adminSource).toContain("adminDashboard.overviewMediumBundle.useQuery");
    expect(adminSource).not.toContain("adminDashboard.stats.useQuery");
    expect(adminSource).not.toContain("callback.list.useQuery");
  });

  it("uses canonical non-overlapping actionable counts", () => {
    expect(adminSource).toContain("getAdminActionableCounts");
    // Asserted as intent, not as one exact line: badges must be built from the
    // canonical counts helper rather than a locally re-derived sum. The shape
    // moved from a getBadgeCount() switch to buildAdminSignals(), but the
    // guarantee is the same one.
    expect(adminSource).toMatch(/buildAdminSignals\(\{[\s\S]{0,600}counts: actionableCounts/);
  });

  /**
   * PER-SLICE, NOT PER-QUERY.
   *
   * getOverviewMediumBundle runs five reads through Promise.allSettled, so ONE
   * failing slice still resolves the query: `isError` is false, the
   * DegradedDataBanner never fires, and getAdminActionableCounts turns the failed
   * slice's undefined into [] and reports 0. adminBundle.ts:85-92 records exactly
   * that — "a leads-only or callbacks-only failure rendered a clean queue". The
   * server has always returned `slices`; the client threw it away.
   */
  it("passes the per-slice availability map, not just the query-level error", () => {
    expect(adminSource).toMatch(/slices: bundle\?\.slices/);
  });

  /**
   * The switch this replaced handled 5 of 16 sections and fell through to
   * `return 0`. A section nobody wired must render NO badge — not 0, which reads
   * as "no problems here" for a question the system never asked.
   */
  it("badges come from the signal fold, not a hand-written per-section switch", () => {
    expect(adminSource).not.toContain("function getBadgeCount");
    expect(adminSource).toContain("foldSignals(sectionSignals)");
    // The three states must all reach the render, or one of them is being
    // collapsed into another somewhere between the fold and the eye.
    expect(adminSource).toMatch(/badge\.state === "unknown"/);
    expect(adminSource).toMatch(/badge\.state === "counted" && badge\.count > 0/);
  });

  /**
   * operationsSignal returns `unknown: true` when a count could not be read, and
   * its docblock instructs callers to render that as "unable to determine, never
   * as zero". Admin.tsx is its ONLY caller and used to do `?? 0`, so a database
   * the sidebar could not reach looked exactly like a shop with nothing pending.
   * Three reels once sat held for 32 hours behind a silent sidebar — this is the
   * same silence arriving by a different route.
   */
  it("never renders an unreadable ops count as a clean sidebar", () => {
    // Both failure channels must reach the signal builder: the transport error
    // AND the server's own "I could not count this" flag. Dropping either one
    // turns an unreadable queue back into a confident zero.
    expect(adminSource).toMatch(/opsFailed,/);
    expect(adminSource).toMatch(/opsUnknown: opsSignal\?\.unknown === true/);
    // And the unknown state must reach the eye, not just the variable.
    expect(adminSource).toMatch(/badge\.state === "unknown"/);
  });

  /**
   * NEVER PINNED BEFORE, and it was broken the whole time.
   *
   * `getAdminActionableCounts` does `input.bookings ?? []`, so a FAILED overview
   * bundle produced `total: 0`. The shell knew — `overviewUnavailable` is the
   * very flag driving the DegradedDataBanner — but never passed it to the badge
   * path. leads / tireOrders / memberships / overview therefore rendered
   * confident zeros directly beside a banner announcing the data was degraded.
   */
  it("a failed overview bundle makes its badges unknown, not zero", () => {
    expect(adminSource).toMatch(/bundleFailed: overviewUnavailable/);
    // The flag must reach the builder, not merely exist for the banner.
    const banner = adminSource.indexOf("<DegradedDataBanner");
    const builder = adminSource.indexOf("bundleFailed: overviewUnavailable");
    expect(builder).toBeGreaterThan(-1);
    expect(banner).toBeGreaterThan(-1);
  });

  it("surfaces unavailable and degraded data before section content", () => {
    const banner = adminSource.indexOf("<DegradedDataBanner");
    const content = adminSource.indexOf("<SectionContent");
    expect(banner).toBeGreaterThan(-1);
    expect(content).toBeGreaterThan(banner);
  });

  it("does not retain the extra grit/neutral appearance mode", () => {
    expect(adminSource).not.toContain("nickstire.adminTheme");
    expect(adminSource).not.toContain("data-admin-theme");
  });
});
