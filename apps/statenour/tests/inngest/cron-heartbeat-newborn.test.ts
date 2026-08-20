/**
 * cron-heartbeat · never-run needs a birth certificate.
 *
 * Live incident 2026-08-20 12:00:38Z: `conversation-compile` shipped in #1734
 * at 11:28Z into EVENING_JOBS (03:00 UTC slot). Thirty-two minutes later the
 * heartbeat paged the operator P0 — "conversation-compile (never). The mega
 * fan-out may be broken" — while the fan-out had run CLEAN at 09:03Z and the
 * job's first possible slot was still ~15h away. `ageH = Infinity` for any
 * never-run job meant every newly added fan-out cron false-paged on its first
 * heartbeat.
 */
import { describe, it, expect } from "vitest";
import { classifySilence } from "@/lib/inngest/functions/cron-heartbeat";

const H = 3_600_000;
const NOW = Date.parse("2026-08-20T12:00:00Z");
const DAILY = 26;
const WEEKLY = 24 * 8;

describe("classifySilence", () => {
  it("a job deployed 32 minutes ago is newborn, not silent (the #1734 page)", () => {
    const v = classifySilence(
      [{ name: "conversation-compile", maxAgeH: DAILY }],
      new Map([["conversation-compile", null]]),
      new Map([["conversation-compile", NOW - 0.5 * H]]),
      NOW,
    );
    expect(v.silent).toEqual([]);
    expect(v.newborn).toEqual(["conversation-compile"]);
  });

  it("first sighting (no registry row yet) is newborn — grace starts now", () => {
    const v = classifySilence(
      [{ name: "brand-new", maxAgeH: DAILY }],
      new Map([["brand-new", null]]),
      new Map(),
      NOW,
    );
    expect(v.newborn).toEqual(["brand-new"]);
  });

  it("a never-run job past its window is genuinely silent and still pages", () => {
    const v = classifySilence(
      [{ name: "stillborn", maxAgeH: DAILY }],
      new Map([["stillborn", null]]),
      new Map([["stillborn", NOW - 3 * 24 * H]]),
      NOW,
    );
    expect(v.silent).toEqual([{ name: "stillborn", ageH: Infinity, maxAgeH: DAILY }]);
    expect(v.newborn).toEqual([]);
  });

  it("a job that HAS run is judged on its last run — grace never applies", () => {
    // Ran once, 40h ago, but first-seen only 1h ago (registry rebuilt).
    // The run record wins: silent.
    const v = classifySilence(
      [{ name: "went-quiet", maxAgeH: DAILY }],
      new Map([["went-quiet", NOW - 40 * H]]),
      new Map([["went-quiet", NOW - 1 * H]]),
      NOW,
    );
    expect(v.silent).toHaveLength(1);
    expect(v.silent[0].name).toBe("went-quiet");
    expect(Math.round(v.silent[0].ageH)).toBe(40);
  });

  it("epoch first-seen (registry down) pages a never-run job — degraded mode must alert", () => {
    // Post-crash review: the caller maps a failed registry read to
    // first-seen = 0 for every job. That must classify as silent (page),
    // never as newborn — a DB error must not silence the watchdog.
    const v = classifySilence(
      [{ name: "unknown-age", maxAgeH: DAILY }],
      new Map([["unknown-age", null]]),
      new Map([["unknown-age", 0]]),
      NOW,
    );
    expect(v.silent).toHaveLength(1);
    expect(v.newborn).toEqual([]);
  });

  it("recent runs stay quiet; weekly jobs get the weekly window", () => {
    const v = classifySilence(
      [
        { name: "daily-fine", maxAgeH: DAILY },
        { name: "weekly-fine", maxAgeH: WEEKLY },
      ],
      new Map([
        ["daily-fine", NOW - 9 * H],
        ["weekly-fine", NOW - 6 * 24 * H],
      ]),
      new Map(),
      NOW,
    );
    expect(v.silent).toEqual([]);
    expect(v.newborn).toEqual([]);
  });
});
