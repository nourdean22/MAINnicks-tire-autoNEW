/**
 * The hour is DERIVED from the row's timestamp. The stored copy is not read.
 *
 * `page_visit` rows carry the same fact twice: `createdAt`, stamped by the DB,
 * and `payload.hour`, computed by app code at write time and then frozen.
 * `analyzePagePatterns` preferred the frozen copy:
 *
 *     const hour = payload?.hour ?? hourET(v.createdAt);   // <- the defect
 *
 * Measured against prod on 2026-08-26 over 30 days: **691 of 719 rows** carry a
 * UTC hour against an ET timestamp — a clean +4h, the EDT offset. Every day
 * from 07-28 to 08-24 is 100% affected, 08-25 flips mid-day, 08-26 is 100%
 * correct.
 *
 * CAUSE, found 2026-08-27: `1202bdd0f` — "Nick reads the operator's clock, not
 * the server's" — merged 2026-08-25T15:17:30Z, changing the writer in
 * lib/services/brain-domain.ts from `new Date().getHours()` (the UTC hour, on a
 * Railway container) to `hourET()`. Last row of the old shape 14:56:52Z, first
 * of the new 15:26:35Z — an interval that CONTAINS the merge. It does not time
 * the rollout: page visits are user activity, not a deployment probe.
 *
 * An earlier version of this header said the flip was ENVIRONMENTAL because
 * `git log -S` found no change to the writer. That search was run against this
 * checkout's HEAD, which sits on a branch days behind origin/main and does not
 * contain the commit — the archaeology was correct about the wrong timeline.
 * `git log` defaults to HEAD; on a shared checkout, ask origin/main.
 *
 * The fix does not depend on the cause, which is why it survived being wrong
 * about it: the stored copy is redundant with an authoritative timestamp and
 * cannot be re-derived once written wrong.
 *
 * What it cost: the daily brief shipped "21 visits after 11pm" where ET says
 * 12. A UTC hour of 23-04 is ET 19-00, so "after 11pm" was counting from 7pm —
 * and the count would have drifted 21 -> 12 over the following week with no
 * deploy, no log line, and no way to know which readings were wrong.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { hourET, toDateString } from "@/lib/utils/datetime";

const SRC = () => readFileSync("lib/brain/page-intelligence.ts", "utf8");
const code = () =>
  SRC()
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

/** The exact night test the module applies, kept in one place. */
const isLateNight = (h: number) => h >= 23 || h <= 4;

describe("page-intelligence · the hour comes from the timestamp", () => {
  it("THE FIX: the stored `payload.hour` is never read", () => {
    // Comments are stripped first — the module EXPLAINS the defect at length,
    // and naming a field in prose is not reading it.
    expect(code()).not.toMatch(/payload\s*[?.]*\.\s*hour/);
    expect(code()).not.toMatch(/\.hour\s*\?\?/);
    expect(code()).toContain("hourET(v.createdAt)");
  });

  it("POSITIVE CONTROL: the mutation this test exists to catch is representable", () => {
    // Without this, an empty file or a renamed symbol would score green.
    const reintroduced = "const hour = payload?.hour ?? hourET(v.createdAt);";
    expect(reintroduced).toMatch(/payload\s*[?.]*\.\s*hour/);
    expect(code()).toContain("lateNightCount++");
  });

  it("a UTC-stamped row lands in the ET bucket, not four hours late", () => {
    // 2026-08-20 02:30 UTC == 22:30 ET the previous evening. The archive would
    // have stored payload.hour = 2 (late night). ET says 22 (not late night).
    const at = new Date("2026-08-20T02:30:00.000Z");
    const stored = 2; // what the poisoned rows carry
    expect(hourET(at)).toBe(22);
    expect(isLateNight(stored)).toBe(true); // the wrong answer
    expect(isLateNight(hourET(at))).toBe(false); // the right one
  });

  it("the 7pm inflation is real: a UTC hour of 23 is ET 19", () => {
    const at = new Date("2026-08-20T23:15:00.000Z");
    expect(hourET(at)).toBe(19);
    expect(isLateNight(19)).toBe(false);
    expect(isLateNight(23)).toBe(true); // what the stored copy claimed
  });

  it("a genuinely late-night visit still counts", () => {
    // 2026-08-21 04:10 UTC == 00:10 ET. Both frames agree it is late night
    // here, which is why the defect was survivable and therefore invisible.
    const at = new Date("2026-08-21T04:10:00.000Z");
    expect(hourET(at)).toBe(0);
    expect(isLateNight(hourET(at))).toBe(true);
  });
});

describe("page-intelligence · days are ET days", () => {
  it("buckets by ET date, so an evening visit does not become tomorrow", () => {
    expect(code()).toContain("toDateString(v.createdAt)");
    expect(code()).not.toContain("toISOString().slice(0, 10)");
  });

  it("the two framings genuinely differ — the bug had somewhere to hide", () => {
    // 9pm ET Monday is already Tuesday in UTC. Bucketing by UTC date split one
    // ET evening across two days, inflating the divisor of avgDailyVisits.
    const at = new Date("2026-08-25T01:30:00.000Z");
    expect(at.toISOString().slice(0, 10)).toBe("2026-08-25");
    expect(toDateString(at)).toBe("2026-08-24");
  });

  it("NAME THE DENOMINATOR: activeDays is exported beside avgDailyVisits", () => {
    // avgDailyVisits divides by ACTIVE days, not the 7 calendar days of the
    // window. Rendering it as "views/day" alone reads as the second one.
    const src = SRC();
    expect(src).toContain("activeDays: number");
    expect(src).toContain("activeDays: uniqueDays.size");
    const block = readFileSync("lib/intelligence/pages-block.ts", "utf8");
    expect(block).toContain("active days");
  });
});
