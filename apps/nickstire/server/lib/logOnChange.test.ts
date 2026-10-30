import { describe, expect, it } from "vitest";
import { changedSinceLastLog, issueClassSignature } from "./logOnChange";

const LOG_ON_CHANGE_REPEAT_MS = 6 * 60 * 60 * 1000; // the default repeat window in logOnChange.ts

describe("changedSinceLastLog", () => {
  it("logs the first occurrence, stays quiet on an unchanged repeat, logs every change", () => {
    const k = "t1";
    expect(changedSinceLastLog(k, "a", 0)).toBe(true);
    expect(changedSinceLastLog(k, "a", 1)).toBe(false);
    expect(changedSinceLastLog(k, "b", 2)).toBe(true);
    expect(changedSinceLastLog(k, "a", 3)).toBe(true);
  });

  it("a cleared condition is a change, so its return logs again", () => {
    const k = "t2";
    expect(changedSinceLastLog(k, "x", 0)).toBe(true);
    expect(changedSinceLastLog(k, "", 1)).toBe(true);
    expect(changedSinceLastLog(k, "x", 2)).toBe(true);
  });

  it("a standing condition logs again after the repeat window", () => {
    const k = "t3";
    expect(changedSinceLastLog(k, "x", 0)).toBe(true);
    expect(changedSinceLastLog(k, "x", LOG_ON_CHANGE_REPEAT_MS - 1)).toBe(false);
    expect(changedSinceLastLog(k, "x", LOG_ON_CHANGE_REPEAT_MS)).toBe(true);
  });

  it("keys are independent", () => {
    expect(changedSinceLastLog("t4a", "x", 0)).toBe(true);
    expect(changedSinceLastLog("t4b", "x", 0)).toBe(true);
  });
});

describe("the three 2026-10-30 call sites, through their real inputs", () => {
  it("data accuracy: the live finding repeated with new counts is quiet; a new finding class is loud", async () => {
    const { describeDataAccuracy } = await import("../cron/dataAccuracyDetails");
    const run = (recentMissing: number, total7d: number, staleCallbacks: number) =>
      issueClassSignature(
        describeDataAccuracy({
          recentMissing,
          total7d,
          staleLeads: 0,
          staleCallbacks,
          freshness: { state: "fresh", reason: "last sync 2 min ago" },
          volumes: [],
          contractDetails: "",
        }).issues,
      );
    expect(changedSinceLastLog("da-it", run(1, 25, 0), 0)).toBe(true);
    expect(changedSinceLastLog("da-it", run(2, 26, 0), 1)).toBe(false);
    expect(changedSinceLastLog("da-it", run(2, 26, 3), 2)).toBe(true);
    expect(changedSinceLastLog("da-it", run(0, 26, 0), 3)).toBe(true); // cleared
    expect(changedSinceLastLog("da-it", run(1, 27, 0), 4)).toBe(true); // returned
  });

  it("statenourSync declined source: quiet on repeat, loud on a new state and on return", async () => {
    const { declinedSourceWarning } = await import("../services/declinedWorkSource");
    expect(declinedSourceWarning("empty")).toMatch(/UNMEASURED, not zero/);
    expect(declinedSourceWarning("empty")).toBeNull();
    expect(declinedSourceWarning("unknown")).toMatch(/UNKNOWN, not zero/);
    expect(declinedSourceWarning("populated")).toBeNull();
    expect(declinedSourceWarning("empty")).toMatch(/UNMEASURED, not zero/);
  });
});

describe("issueClassSignature", () => {
  it("masks counts, so the same issue with new numbers is not a new class", () => {
    const a = issueClassSignature(["1 of 25 invoices in the last 7 days have no customer phone"]);
    const b = issueClassSignature(["2 of 26 invoices in the last 7 days have no customer phone"]);
    expect(a).toBe(b);
  });

  it("a NEW issue class changes the signature, so it is never hidden", () => {
    const one = issueClassSignature(["1 of 25 invoices in the last 7 days have no customer phone"]);
    const two = issueClassSignature([
      "1 of 25 invoices in the last 7 days have no customer phone",
      "3 stale leads older than 48h",
    ]);
    expect(two).not.toBe(one);
  });
});
