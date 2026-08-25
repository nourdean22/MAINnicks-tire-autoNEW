/**
 * Canaries for the cost-detail coverage alarm (2026-08-25).
 *
 * The alarm exists because ShopDriver stopped sending parts/labor cost in
 * April 2026 and nothing noticed for four months. Measured by week:
 * 33/56 -> 9/31 -> 1/33 -> 0/23, then 0% since May.
 *
 * SYNTHETIC NUMBERS ONLY. `assessCoverage` is driven with counts, never with a
 * live query - a threshold test bound to production stops testing anything the
 * moment the data changes, and would flip meaning if the mirror is repaired.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

import {
  assessCoverage,
  coverageAlertMessage,
  COVERAGE_WINDOW_DAYS,
  MIN_SAMPLE_INVOICES,
} from "./services/costDetailCoverage";
import { MIN_COST_DETAIL_COVERAGE } from "./services/engines/revenue";

describe("canary - the alarm fires on the shape that actually happened", () => {
  it("BREAKS: the real April 2026 collapse trips it, week by week", () => {
    // The weeks that nothing noticed. Every one must read below-threshold.
    const collapse: Array<[number, number]> = [
      [31, 9],  // week of 2026-04-06
      [33, 1],  // week of 2026-04-13
      [23, 0],  // week of 2026-04-20
      [29, 0],  // week of 2026-04-27
    ];
    for (const [invoices, withDetail] of collapse) {
      const r = assessCoverage(invoices, withDetail);
      expect(r.verdict, `${withDetail}/${invoices} should have alarmed`).toBe("below-threshold");
    }
  });

  it("POSITIVE CONTROL: the healthy weeks BEFORE the collapse do not fire", () => {
    // Without this the alarm could be a constant "below-threshold" and the
    // test above would still pass.
    for (const [invoices, withDetail] of [[56, 56], [30, 30], [21, 21]] as Array<[number, number]>) {
      expect(assessCoverage(invoices, withDetail).verdict).toBe("ok");
    }
  });

  it("the boundary is the floor itself, and it is the SAME constant the margin uses", () => {
    // One number, two uses: the alarm fires at exactly the point the margin
    // stops rendering. If these ever diverge the operator gets a suppressed
    // margin with no alert explaining why.
    expect(MIN_COST_DETAIL_COVERAGE).toBe(0.8);
    expect(assessCoverage(100, 80).verdict).toBe("ok");
    expect(assessCoverage(100, 79).verdict).toBe("below-threshold");
  });

  it("today's production shape (0 of ~29 in 7d) alarms", () => {
    const r = assessCoverage(29, 0);
    expect(r.verdict).toBe("below-threshold");
    expect(r.coveragePct).toBe(0);
  });
});

describe("canary - the alarm does not cry wolf", () => {
  it("a quiet week is insufficient-sample, NOT an alarm", () => {
    // The shop books 2-6 invoices on some days. An alarm that fires on low
    // volume gets muted, and a muted alarm guards nothing.
    const r = assessCoverage(MIN_SAMPLE_INVOICES - 1, 0);
    expect(r.verdict).toBe("insufficient-sample");
  });

  it("zero invoices is insufficient-sample, not 0% coverage", () => {
    expect(assessCoverage(0, 0).verdict).toBe("insufficient-sample");
  });

  it("BREAKS: one more invoice than the sample floor DOES alarm", () => {
    // Proves the sample guard is a floor, not a blanket suppression.
    expect(assessCoverage(MIN_SAMPLE_INVOICES, 0).verdict).toBe("below-threshold");
  });
});

describe("canary - the message says the true thing", () => {
  const msg = coverageAlertMessage(assessCoverage(29, 0));

  it("names the counts, the percentage and the floor", () => {
    expect(msg).toContain("0 of 29");
    expect(msg).toContain("0%");
    expect(msg).toContain("80%");
    expect(msg).toContain(String(COVERAGE_WINDOW_DAYS));
  });

  it("says margin reporting is SUPPRESSED, not that margin is zero", () => {
    // The whole point of PR-A. If this message implied a low margin it would
    // recreate the defect in words.
    expect(msg).toMatch(/suppressed/i);
    expect(msg).not.toMatch(/margin is 0|0% margin/i);
  });

  it("attributes the fault to the mirror, not to the shop", () => {
    expect(msg).toMatch(/ShopDriver mirror problem, not a shop problem/);
  });
});

/**
 * Strip comments before asserting the ABSENCE of a pattern. This module's own
 * doc comment names `notification_messages` while explaining why it is NOT
 * used, and the bare assertion flagged it - the fifth mention-vs-execution
 * false positive in this codebase. A check that fails on its own documentation
 * gets deleted by the next reader.
 */
function stripComments(t: string): string {
  return t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("canary - the alarm is WIRED and uses a delivery path that demonstrably runs", () => {
  const src = stripComments(readFileSync(join(process.cwd(), "server/services/costDetailCoverage.ts"), "utf-8"));
  const host = stripComments(readFileSync(join(process.cwd(), "server/cron/jobs/intelligenceAutopilot.ts"), "utf-8"));

  it("BREAKS: the host IMPORTS the real module, not just a matching identifier", () => {
    // First draft asserted only `toContain("checkCostDetailCoverage")`. A
    // mutation probe that replaced the import with a local no-op stub of the
    // same name came back GREEN - the canary could not tell "calls the real
    // check" from "defines something spelled like it". That is the
    // built-tested-unwired shape, reproduced inside its own canary.
    expect(host).toMatch(
      /const \{ checkCostDetailCoverage \} = await import\("\.\.\/\.\.\/services\/costDetailCoverage"\)/,
    );
    // ...and actually invokes it, rather than importing and discarding it.
    expect(host).toMatch(/await checkCostDetailCoverage\(\)/);
    expect(host).toContain("COST DETAIL MISSING");
  });

  it("its host is a job that does NOT skip itself", () => {
    // Measured 2026-08-25: intelligence-autopilot 39 runs / 0 skipped, while
    // alg-mirror-health skipped 1,141 of 1,274 on the admin-inactive guard and
    // nick-morning-brief skipped 6 of 8 on a time window. The host choice IS
    // the control here, so it is pinned.
    expect(host).toContain("runIntelligenceAutopilot");
  });

  it("dedups through cron_alerts_fired - the table with 69 live rows", () => {
    // notification_messages holds ZERO rows; routing there would ship into a
    // void. This asserts the path that is demonstrably exercised.
    expect(src).toContain("INSERT IGNORE INTO cron_alerts_fired");
    expect(src).toContain("'cost_detail_coverage'");
    expect(src).toMatch(/affectedRows/);
    expect(src).not.toContain("notification_messages");
  });

  it("only alerts on below-threshold - never on ok or insufficient-sample", () => {
    expect(src).toMatch(/if \(reading\.verdict !== "below-threshold"\)/);
  });

  it("cannot take its host cron down", () => {
    // It runs inside a cron handler; a broken alarm must not break the job.
    const fn = src.slice(src.indexOf("export async function checkCostDetailCoverage"));
    expect(fn).toContain("catch (err)");
    expect(fn).toMatch(/return \{ reading: null, alerted: false \}/);
  });
});
