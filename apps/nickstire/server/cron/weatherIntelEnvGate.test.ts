/**
 * weather-intel · env contract (2026-09-22, re-pinned 2026-09-23)
 *
 * HISTORY. The job read OpenWeather with OPENWEATHER_API_KEY and, without
 * it, RETURNED `{ details: "No API key" }` — a completed run with zero
 * records, invisible to cron-skip-watchdog. 2026-09-22 declared
 * `requiresEnv: "OPENWEATHER_API_KEY"` so a missing key became a visible skip.
 *
 * NOW. The service reads the keyless NWS forecast (lib/nwsWeather.ts), so the
 * job has no env precondition and must not skip; a failed read throws and is
 * recorded `failed`. The one env var the service reads is the customer-SMS
 * arm, WEATHER_SMS_SEND — a SEND gate, not a run gate, so it must never be
 * declared as requiresEnv (that would silence the operator alerts too).
 *
 * WHAT THIS PINS, through `getJobCadences()` (what the scheduler will
 * actually do) and the comment-stripped service source:
 *   · the job is scheduled with NO env gate
 *   · the service reads exactly WEATHER_SMS_SEND and no API key
 *   · POSITIVE CONTROL: a job that does declare an env gate reports it, so
 *     an empty list is a real reading, not a field that is never populated
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getJobCadences } from "./scheduler";

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("weather-intel env contract", () => {
  const cadences = getJobCadences();

  it("is scheduled with no env gate — the NWS read needs no key", () => {
    const job = cadences.get("weather-intel");
    expect(job, "weather-intel is not registered with the scheduler").toBeTruthy();
    expect(job!.requiresEnv).toEqual([]);
    expect(job!.scheduledAutomatically).toBe(true);
  });

  it("the service reads only the SMS arm, WEATHER_SMS_SEND (comment-stripped call sites)", () => {
    const src = stripComments(readFileSync(resolve(__dirname, "../services/weatherIntelligence.ts"), "utf8"));
    const reads = [...src.matchAll(/process\.env\.([A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(new Set(reads)).toEqual(new Set(["WEATHER_SMS_SEND"]));
  });

  it("POSITIVE CONTROL: a job that declares an env gate reports it", () => {
    const gated = [...cadences.values()].filter((j) => j.requiresEnv.length > 0);
    expect(gated.length).toBeGreaterThan(0);
  });
});
