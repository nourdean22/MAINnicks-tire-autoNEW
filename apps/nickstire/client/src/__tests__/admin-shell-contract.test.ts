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
    // Asserted as intent, not as one exact line: overview's badge must be built
    // from the canonical counts helper rather than a locally re-derived sum.
    expect(adminSource).toMatch(/if \(id === "overview"\)[\s\S]{0,80}counts\.total/);
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
    // `?? 0` on the total is fine ONCE GUARDED — it then only covers the first
    // in-flight fetch, where there is genuinely nothing to show yet. What must
    // never happen is reaching it while the signal says unknown, so the contract
    // is that the guard precedes the fallback on the same expression.
    expect(adminSource).toMatch(/opsFailed \|\| opsSignal\?\.unknown \? null :/);
    // And the unknown state must reach the eye, not just the variable.
    expect(adminSource).toMatch(/badge === null/);
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
