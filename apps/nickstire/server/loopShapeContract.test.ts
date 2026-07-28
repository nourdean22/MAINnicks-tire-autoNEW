/**
 * Loop shape contract tests.
 *
 * The cases below are the real production defects, replayed as observations.
 * If the classifier ever stops catching them, the loops go quiet again.
 */

import { describe, expect, it } from "vitest";

import {
  LOOP_CONTRACTS,
  classifyRun,
  findActionable,
  getLoopContract,
  undeclaredLoops,
} from "./services/loopShapeContract";

describe("loop shape contracts — registry hygiene", () => {
  it("loop ids are unique", () => {
    const ids = LOOP_CONTRACTS.map((c) => c.loop);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("any loop whose floor is zero declares a dormancy threshold", () => {
    // Otherwise "produced nothing, forever" is indistinguishable from healthy —
    // which is precisely how cross_sell ran from May to July.
    const unguarded = LOOP_CONTRACTS.filter(
      (c) => c.healthyPerRun.min === 0 && c.dormantAfterRuns === undefined,
    ).map((c) => c.loop);
    expect(unguarded).toEqual([]);
  });

  it("every contract names a concrete first check", () => {
    for (const c of LOOP_CONTRACTS) {
      expect(c.firstCheck.length, c.loop).toBeGreaterThan(40);
      expect(c.produces.length, c.loop).toBeGreaterThan(0);
    }
  });

  it("reports loops that have no contract at all", () => {
    expect(undeclaredLoops(["cross_sell", "some-new-cron"])).toEqual(["some-new-cron"]);
  });
});

describe("loop shape contracts — the defects that motivated it", () => {
  it("ROS-033: a successful run that sends nothing, repeatedly, is dormant", () => {
    // cross_sell: `completed` every day, zero sends, for two months.
    const finding = classifyRun({
      loop: "cross_sell",
      produced: 0,
      succeeded: true,
      priorZeroRuns: 60,
    });
    expect(finding.verdict).toBe("dormant");
    expect(finding.actionable).toBe(true);
    expect(finding.ros).toBe("ROS-033");
    expect(finding.firstCheck).toContain("0.330");
  });

  it("ROS-033: a threshold change that would deliver 6 sends is not a quick win", () => {
    // The guidance has to travel with the finding or the next person ships the
    // one-line gate change that the registry explicitly warns against.
    const finding = classifyRun({ loop: "cross_sell", produced: 0, succeeded: true, priorZeroRuns: 5 });
    expect(finding.firstCheck).toMatch(/do NOT ship a threshold change/i);
  });

  it("ROS-028: success without a measured output is unknown, never healthy", () => {
    // db-backup returned normally from its own catch block. The run "succeeded"
    // and produced an unmeasured nothing.
    const finding = classifyRun({ loop: "db-backup", produced: null, succeeded: true });
    expect(finding.verdict).toBe("unknown");
    expect(finding.actionable).toBe(true);
    expect(finding.summary).toContain("Completion is not output");
  });

  it("ROS-029: a run inside its cap but over budget is anomalous", () => {
    // Six consecutive runs died at the 240s cap; the authorised manual run
    // finished in 6s. Duration is the signal, and it is a ceiling, not a floor.
    const finding = classifyRun({
      loop: "gsc-pipeline",
      produced: 4412,
      succeeded: true,
      durationMs: 239_000,
    });
    expect(finding.verdict).toBe("anomalous");
    expect(finding.summary).toContain("239s");
  });

  it("ROS-029: the healthy run is silent", () => {
    const finding = classifyRun({
      loop: "gsc-pipeline",
      produced: 4412,
      succeeded: true,
      durationMs: 6_000,
    });
    expect(finding.verdict).toBe("in-spec");
    expect(finding.actionable).toBe(false);
  });

  it("ROS-028: a daily job that stops running is missing, not silent", () => {
    // The old observer's 24h / 2-consecutive-streak logic could never fire for
    // a daily job. Runs-in-window catches it directly.
    const finding = classifyRun({
      loop: "db-backup",
      produced: 1,
      succeeded: true,
      runsInWindow: 2,
    });
    expect(finding.verdict).toBe("missing");
    expect(finding.summary).toContain("expected about 7");
  });

  it("a genuinely quiet idle run is not dormant yet", () => {
    // A recovery sweep with nothing to recover is fine. For a while.
    const finding = classifyRun({
      loop: "declined-work-recovery",
      produced: 0,
      succeeded: true,
      priorZeroRuns: 2,
    });
    expect(finding.verdict).toBe("in-spec");
    expect(finding.actionable).toBe(false);
  });

  it("the same quiet run becomes dormant once the streak passes the threshold", () => {
    const finding = classifyRun({
      loop: "declined-work-recovery",
      produced: 0,
      succeeded: true,
      priorZeroRuns: 6,
    });
    expect(finding.verdict).toBe("dormant");
  });

  it("a failed run is a failure, not a shape problem", () => {
    const finding = classifyRun({ loop: "ig-autopost", produced: 0, succeeded: false });
    expect(finding.verdict).toBe("failed");
  });

  it("an undeclared loop is unjudged, and says so", () => {
    const finding = classifyRun({ loop: "mystery-cron", produced: 999, succeeded: true });
    expect(finding.verdict).toBe("unknown");
    expect(finding.actionable).toBe(true);
  });
});

describe("loop shape contracts — batch triage", () => {
  it("returns only what an operator should see", () => {
    const findings = findActionable([
      { loop: "gsc-pipeline", produced: 4412, succeeded: true, durationMs: 6_000 },
      { loop: "cross_sell", produced: 0, succeeded: true, priorZeroRuns: 60 },
      { loop: "db-backup", produced: null, succeeded: true },
    ]);
    expect(findings.map((f) => f.loop)).toEqual(["cross_sell", "db-backup"]);
  });

  it("every seeded contract resolves", () => {
    for (const c of LOOP_CONTRACTS) expect(getLoopContract(c.loop)).toBeDefined();
  });
});
