/**
 * Loop shape pass · doctrine tests for the cron_log → ObservedRun mapper and
 * its composition with classifyRun.
 *
 * The caller responsibilities the contract module documents are pinned here:
 * deliberate skips never count toward a dormancy streak (a loop switched off
 * is not a loop that is broken), a failed run breaks the zero streak, and the
 * composed pipeline reproduces the ROS-033 shape — a loop that completes
 * successfully while producing nothing, for runs on end, is DORMANT.
 */
import { describe, expect, it } from "vitest";
import { observedRunFromCronRows, type CronRunRow } from "./observer";
import { classifyRun } from "../services/loopShapeContract";

const run = (over: Partial<CronRunRow> = {}): CronRunRow => ({
  status: "completed",
  recordsProcessed: 0,
  details: null,
  durationMs: 1_000,
  ...over,
});

describe("observedRunFromCronRows", () => {
  it("returns null with no rows — nothing observed is never judged healthy", () => {
    expect(observedRunFromCronRows("ig-autopost", [])).toBeNull();
  });

  it("maps the head run and counts prior consecutive zeros", () => {
    const observed = observedRunFromCronRows("ig-autopost", [
      run({ recordsProcessed: 0, details: "0 drafts", durationMs: 900 }),
      run({ recordsProcessed: 0 }),
      run({ recordsProcessed: 0 }),
      run({ recordsProcessed: 3 }),
      run({ recordsProcessed: 0 }),
    ]);
    expect(observed).toMatchObject({
      loop: "ig-autopost",
      produced: 0,
      succeeded: true,
      durationMs: 900,
      priorZeroRuns: 2, // streak breaks at the productive run; the zero behind it never counts
      runsInWindow: 5,
    });
  });

  it("deliberate skips are EXCLUDED from the dormancy streak, not counted and not breaking", () => {
    const observed = observedRunFromCronRows("ig-autopost", [
      run({ recordsProcessed: 0 }),
      run({ recordsProcessed: 0, details: "Skipped · VAPI_API_KEY missing" }),
      run({ recordsProcessed: 0 }),
      run({ recordsProcessed: 0, details: "Feature disabled" }),
      run({ recordsProcessed: 0 }),
    ]);
    expect(observed?.priorZeroRuns).toBe(2);
  });

  it("a failed prior run breaks the zero streak — failure handling owns failures", () => {
    const observed = observedRunFromCronRows("ig-autopost", [
      run({ recordsProcessed: 0 }),
      run({ status: "failed", recordsProcessed: 0 }),
      run({ recordsProcessed: 0 }),
    ]);
    expect(observed?.priorZeroRuns).toBe(0);
  });

  it("composed: the ROS-033 shape classifies DORMANT (succeeding, producing nothing)", () => {
    const observed = observedRunFromCronRows("ig-autopost", [
      run({ recordsProcessed: 0, details: "0 drafts generated" }),
      run({ recordsProcessed: 0, details: "Skipped · outside hours — skipped" }),
      run({ recordsProcessed: 0 }),
      run({ recordsProcessed: 0 }),
      run({ recordsProcessed: 0 }),
      run({ recordsProcessed: 4 }),
    ]);
    const finding = classifyRun(observed!);
    expect(finding.verdict).toBe("dormant");
    expect(finding.actionable).toBe(true);
  });

  it("composed: gsc-pipeline over its duration budget classifies ANOMALOUS", () => {
    const observed = observedRunFromCronRows("gsc-pipeline", [
      run({ recordsProcessed: 4412, durationMs: 239_000 }),
      run({ recordsProcessed: 4200, durationMs: 5_000 }),
      run({ recordsProcessed: 4100, durationMs: 5_000 }),
      run({ recordsProcessed: 3900, durationMs: 5_000 }),
    ]);
    const finding = classifyRun(observed!);
    expect(finding.verdict).toBe("anomalous");
    expect(finding.summary).toContain("budget");
  });

  it("composed: a failed head run is a FAILURE, whatever it produced", () => {
    const observed = observedRunFromCronRows("db-backup", [
      run({ status: "failed", recordsProcessed: 0 }),
      run({ recordsProcessed: 1 }),
      run({ recordsProcessed: 1 }),
      run({ recordsProcessed: 1 }),
    ]);
    const finding = classifyRun(observed!);
    expect(finding.verdict).toBe("failed");
  });
});
