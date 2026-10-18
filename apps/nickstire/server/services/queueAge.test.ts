/**
 * Queue-age classifier · red-first doctrine tests.
 *
 * "job ran" is not "work completed": cron_log can say `completed` on every run
 * while the oldest due row sits untouched. These pin the judge that turns
 * "oldest due-but-unprocessed row" into a verdict, against a fixed clock.
 *
 * The load-bearing pair is unknown-vs-in-spec: a failed read must never come
 * back as healthy (empty-vs-error). The boundary pair pins `>` (equal is
 * in-spec) from both sides so a flipped comparison cannot survive.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyQueueAge,
  formatQueueAgeAlertGroup,
  QUEUE_AGE_DECLARATIONS,
} from "./queueAge";

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 18, 16, 0, 0); // fixed clock, never Date.now()

const decl = (loop: string) => {
  const d = QUEUE_AGE_DECLARATIONS.find((x) => x.loop === loop);
  if (!d) throw new Error(`no declaration for ${loop}`);
  return d;
};

describe("classifyQueueAge", () => {
  const reminder = decl("reminder-queue");

  it("in-spec when the oldest due row is younger than its max age", () => {
    const r = classifyQueueAge({ oldestDueAtMs: NOW - 60 * MIN, readFailed: false, nowMs: NOW }, reminder);
    expect(r).toEqual({ verdict: "in-spec", ageMinutes: 60 });
  });

  it("stuck when the oldest due row is older than its max age", () => {
    const r = classifyQueueAge({ oldestDueAtMs: NOW - 3 * 24 * 60 * MIN, readFailed: false, nowMs: NOW }, reminder);
    expect(r.verdict).toBe("stuck");
    expect(r.ageMinutes).toBe(3 * 24 * 60);
  });

  it("boundary: max age minus 1 minute is in-spec, exactly max is in-spec, plus 1 minute is stuck", () => {
    const max = reminder.maxAgeMinutes;
    const at = (ageMin: number) =>
      classifyQueueAge({ oldestDueAtMs: NOW - ageMin * MIN, readFailed: false, nowMs: NOW }, reminder).verdict;
    expect(at(max - 1)).toBe("in-spec");
    expect(at(max)).toBe("in-spec");
    expect(at(max + 1)).toBe("stuck");
  });

  it("a failed read is UNKNOWN, never in-spec, even when a fresh-looking value rode along", () => {
    expect(classifyQueueAge({ oldestDueAtMs: null, readFailed: true, nowMs: NOW }, reminder)).toEqual({
      verdict: "unknown",
      ageMinutes: null,
    });
    // A young value next to readFailed must still not read as healthy.
    expect(classifyQueueAge({ oldestDueAtMs: NOW - MIN, readFailed: true, nowMs: NOW }, reminder).verdict).toBe("unknown");
    // And an old one must not page off a read that failed.
    expect(classifyQueueAge({ oldestDueAtMs: NOW - 9999 * MIN, readFailed: true, nowMs: NOW }, reminder).verdict).toBe("unknown");
  });

  it("empty when a SUCCESSFUL read found no due row", () => {
    expect(classifyQueueAge({ oldestDueAtMs: null, readFailed: false, nowMs: NOW }, reminder)).toEqual({
      verdict: "empty",
      ageMinutes: null,
    });
  });

  it("skipped when the loop is deliberately off, never stuck", () => {
    const r = classifyQueueAge(
      { oldestDueAtMs: NOW - 9999 * MIN, readFailed: false, skipped: "FEATURE_FOLLOWUP_CADENCE != '1'", nowMs: NOW },
      decl("followup-cadence"),
    );
    expect(r).toEqual({ verdict: "skipped", ageMinutes: null });
  });

  it("a non-finite timestamp is unknown, not a confident age", () => {
    expect(classifyQueueAge({ oldestDueAtMs: Number.NaN, readFailed: false, nowMs: NOW }, reminder).verdict).toBe("unknown");
  });

  it("bad item last: a batch where only the LAST loop is stuck reports exactly that one", () => {
    const loops = QUEUE_AGE_DECLARATIONS.map((d) => d.loop);
    const verdicts = QUEUE_AGE_DECLARATIONS.map((d, i) =>
      classifyQueueAge(
        {
          oldestDueAtMs: i === loops.length - 1 ? NOW - (d.maxAgeMinutes + 5) * MIN : NOW - MIN,
          readFailed: false,
          nowMs: NOW,
        },
        d,
      ).verdict,
    );
    expect(verdicts.filter((v) => v === "stuck")).toHaveLength(1);
    expect(verdicts[verdicts.length - 1]).toBe("stuck");
  });
});

describe("QUEUE_AGE_DECLARATIONS", () => {
  it("covers exactly the three loops by decision (reel has two checks)", () => {
    expect(QUEUE_AGE_DECLARATIONS.map((d) => d.loop)).toEqual([
      "reminder-queue",
      "followup-cadence",
      "reel-pipeline",
      "reel-pipeline:publish",
    ]);
  });

  it("starts from the brief's calibrated defaults", () => {
    expect(decl("reminder-queue").maxAgeMinutes).toBe(24 * 60);
    expect(decl("followup-cadence").maxAgeMinutes).toBe(72 * 60);
    expect(decl("reel-pipeline").maxAgeMinutes).toBe(6 * 60);
    expect(decl("reel-pipeline:publish").maxAgeMinutes).toBe(2 * 60);
  });

  it("every declaration names a real scheduler job and quotes its cadence", () => {
    const scheduler = readFileSync(resolve(process.cwd(), "server/cron/scheduler.ts"), "utf8");
    for (const d of QUEUE_AGE_DECLARATIONS) {
      const job = d.loop.split(":")[0];
      expect(scheduler, `${job} is not a scheduler job name`).toContain(`name: "${job}"`);
      expect(d.reason, `${d.loop} reason must state its cadence`).toMatch(/every \d+ ?(min|h)/);
      expect(d.firstCheck.length).toBeGreaterThan(20);
    }
  });
});

describe("formatQueueAgeAlertGroup", () => {
  it("names each stuck loop with its age and its limit", () => {
    const text = formatQueueAgeAlertGroup([
      { declaration: decl("reel-pipeline"), ageMinutes: 412 },
    ]);
    expect(text).toContain("reel-pipeline");
    expect(text).toContain("412m");
    expect(text).toContain("360m");
  });
});
