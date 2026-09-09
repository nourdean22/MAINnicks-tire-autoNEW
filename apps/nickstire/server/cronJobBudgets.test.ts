/**
 * THE ONLY LANE IN THE ESTATE STILL FAILING ON A SCHEDULE.
 *
 * Whole-estate cron health, measured against production 2026-09-09 over seven
 * days: roughly sixty scheduled jobs, and all but four ran clean. Of those four,
 * three had already been fixed the same week. The survivor was ig-autopost -
 * 20 failures in 703 runs, every one recorded as "timeout", on six of the last
 * eight days.
 *
 * The cause was the budget, not the work. Tier jobs race against
 * `jobTimeoutMs(job)`, which falls back to DEFAULT_JOB_TIMEOUT_MS - a value
 * sized for the database-only jobs that make up most of the estate. Inside a
 * slot window ig-autopost generates an image and uploads it to Meta: two
 * third-party network round trips, either of which can be slow.
 *
 * The invariant worth pinning is not the number. It is the RELATIONSHIP: a job
 * that calls out to a generation or publishing provider needs more than the
 * database default, and less than its own tier's cadence - over the cadence and
 * a slow run is still holding its lock when the next pulse is due.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_JOB_TIMEOUT_MS, jobTimeoutMs } from "./cron/index";

const SCHED = readFileSync(path.join(__dirname, "cron", "scheduler.ts"), "utf8");

/** The literal timeoutMs on a named tier job, in ms, or null if it has none. */
function budgetOf(jobName: string): number | null {
  const at = SCHED.indexOf(`name: "${jobName}"`);
  if (at < 0) return null;
  // Look within this job's own object literal - stop at the next job's name.
  const rest = SCHED.slice(at + 1);
  const nextJob = rest.indexOf('name: "');
  const block = rest.slice(0, nextJob < 0 ? 3000 : nextJob);
  const m = /timeoutMs:\s*(\d+)\s*\*\s*60\s*\*\s*1000/.exec(block);
  return m ? Number(m[1]) * 60 * 1000 : null;
}

const PULSE_CADENCE_MS = 15 * 60 * 1000;

describe("provider-calling jobs get more than the database default", () => {
  it("the default itself is unchanged, so the comparisons below mean something", () => {
    expect(DEFAULT_JOB_TIMEOUT_MS).toBe(4 * 60 * 1000);
    expect(jobTimeoutMs({})).toBe(DEFAULT_JOB_TIMEOUT_MS);
    expect(jobTimeoutMs({ timeoutMs: 90_000 })).toBe(90_000);
  });

  for (const job of ["ig-autopost", "reel-pipeline"]) {
    describe(job, () => {
      it("carries an explicit budget rather than inheriting the default", () => {
        expect(budgetOf(job), `${job} is back on the 4-minute database default`).not.toBeNull();
      });

      it("is longer than the default - it waits on a provider, not a query", () => {
        expect(budgetOf(job)!).toBeGreaterThan(DEFAULT_JOB_TIMEOUT_MS);
      });

      it("is SHORTER than its tier cadence, so a slow run never overlaps the next", () => {
        // Over the cadence, a slow run is still holding its cross-dyno lock when
        // the next pulse fires, and the pulse skips. A deploy already cost this
        // estate an hour of dead pipeline that way.
        expect(budgetOf(job)!).toBeLessThanOrEqual(PULSE_CADENCE_MS);
      });
    });
  }

  it("PLANTED CANARY: a job with no explicit budget reads as null", () => {
    // If budgetOf silently returned a number for everything, every assertion
    // above would pass vacuously. Pick a lane that legitimately runs on the
    // default because it only touches the database.
    expect(budgetOf("vendor-health")).toBeNull();
  });
});
