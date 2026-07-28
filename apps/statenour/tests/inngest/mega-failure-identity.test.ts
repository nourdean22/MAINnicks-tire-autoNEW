/**
 * Cron-truth audit 2026-07-28 · failure strings must NAME the child.
 *
 * Pins the fix for seven consecutive nights of mega-evening "partial"
 * whose only diagnostic was "The operation was aborted due to timeout ;
 * The operation was aborted due to timeout" — two nameless failures.
 * summarizeSettled now attaches the index-aligned child path to every
 * rejection, so the nightly Telegram/CronJobLog names its culprits.
 */
import { describe, it, expect } from "vitest";
import { summarizeSettled } from "@/lib/inngest/functions/mega-fanout";

type ChildResult = { path: string; status: number; durationMs: number };

const fulfilled = (path: string, durationMs = 100): PromiseSettledResult<ChildResult> => ({
  status: "fulfilled",
  value: { path, status: 200, durationMs },
});
const rejected = (message: string): PromiseSettledResult<ChildResult> => ({
  status: "rejected",
  reason: new Error(message),
});

describe("summarizeSettled · child identity on failures", () => {
  const PATHS = ["/api/cron/consolidate", "/api/cron/mastery-xp", "/api/cron/predict"] as const;

  it("attaches the index-aligned path to each rejection", () => {
    const sum = summarizeSettled(
      [
        rejected("The operation was aborted due to timeout"),
        fulfilled(PATHS[1]),
        rejected("The operation was aborted due to timeout"),
      ],
      PATHS,
    );
    expect(sum.jobsFailed).toBe(2);
    expect(sum.failures[0]).toBe("/api/cron/consolidate: The operation was aborted due to timeout");
    expect(sum.failures[1]).toBe("/api/cron/predict: The operation was aborted due to timeout");
    // The exact seven-nights symptom — identical messages — now remains
    // diagnosable because the paths differ.
    expect(new Set(sum.failures).size).toBe(2);
  });

  it("all-fulfilled batches keep counting durations, zero failures", () => {
    const sum = summarizeSettled([fulfilled(PATHS[0], 40), fulfilled(PATHS[1], 60)], PATHS);
    expect(sum.jobsFailed).toBe(0);
    expect(sum.jobsRun).toBe(2);
    expect(sum.totalDurationMs).toBe(100);
  });

  it("non-Error rejection reasons still stringify with their path", () => {
    const sum = summarizeSettled(
      [{ status: "rejected", reason: "plain string reason" } as PromiseSettledResult<ChildResult>],
      PATHS,
    );
    expect(sum.failures[0]).toBe("/api/cron/consolidate: plain string reason");
  });
});
