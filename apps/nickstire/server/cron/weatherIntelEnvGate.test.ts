/**
 * weather-intel · a missing key is a SKIP the watchdog can see, not a completed run (2026-09-22)
 *
 * WHAT WAS WRONG. `checkWeatherTriggers` refuses to run without
 * OPENWEATHER_API_KEY — by returning `{ triggered: [], details: "No API key" }`.
 * The tier loop then logged a COMPLETED run with zero records, eight times in
 * eight weeks (every run the job has ever had in production), and
 * cron-skip-watchdog reported "no env-skip jobs in 7d window" the whole time,
 * because the watchdog reads status "skipped" with a `requiresEnv:` detail —
 * the scheduler's own gate — and nothing else.
 *
 * WHAT THIS PINS, through `getJobCadences()` — the projection that "reports
 * what the scheduler will actually do" (plateRetention.test.ts, the shape this
 * repo settled on after banning source-substring presence checks):
 *   · the job declares the key, so an absent key becomes a scheduler skip
 *   · the key it declares is the one the service actually reads — a gate on
 *     the wrong name would skip forever while the service was credentialed
 *   · POSITIVE CONTROL: a job with no env gate reports an EMPTY list, so the
 *     field is not vacuously populated
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getJobCadences } from "./scheduler";

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("weather-intel env gate", () => {
  const cadences = getJobCadences();

  it("declares OPENWEATHER_API_KEY, so the scheduler skips it through the gate the watchdog reads", () => {
    const job = cadences.get("weather-intel");
    expect(job, "weather-intel is not registered with the scheduler").toBeTruthy();
    expect(job!.requiresEnv).toEqual(["OPENWEATHER_API_KEY"]);
    expect(job!.scheduledAutomatically).toBe(true);
  });

  it("the declared key is the one the service reads (comment-stripped call sites)", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../services/weatherIntelligence.ts"), "utf8"));
    const reads = [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(reads.length).toBeGreaterThan(0);
    expect(new Set(reads)).toEqual(new Set(["OPENWEATHER_API_KEY"]));
  });

  it("POSITIVE CONTROL: a job with no env gate reports an empty list", () => {
    const job = cadences.get("daily-report");
    expect(job).toBeTruthy();
    expect(job!.requiresEnv).toEqual([]);
  });
});
