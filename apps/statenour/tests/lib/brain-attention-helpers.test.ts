/**
 * tests/lib/brain-attention-helpers.test.ts — attention-tracker primitives
 *
 * Locks down the pure math + classification pieces that feed into
 * `analyzeAttentionPatterns()`. These don't hit Prisma and carry the
 * actual signal quality for focus score / velocity / domain
 * classification shown on /system/quality and in the HQ top strip.
 */

import { describe, it, expect } from "vitest";
import { hourET } from "@/lib/utils/datetime";
import {
  ATTENTION_DOMAIN_KEYWORDS,
  classifyMessageDomain,
  computeFocusScore,
  computeActionRatio,
  computeAttentionVelocity,
  timeOfDayBucket,
} from "@/lib/brain/attention-helpers";

describe("classifyMessageDomain", () => {
  it("classifies revenue talk", () => {
    const m = classifyMessageDomain("Today's revenue was $500 and profit solid");
    expect(m.get("revenue")).toBeGreaterThan(0);
  });

  it("classifies multiple domains in one message", () => {
    const m = classifyMessageDomain("did my workout and chased leads today");
    expect(m.has("body")).toBe(true);
    expect(m.has("leads")).toBe(true);
  });

  it("returns empty map when no keywords hit", () => {
    const m = classifyMessageDomain("just a random thought about the weather");
    expect(m.size).toBe(0);
  });

  it("is case-insensitive", () => {
    const m = classifyMessageDomain("WORKOUT, Boxing, GYM");
    expect(m.get("body")).toBeGreaterThanOrEqual(2);
  });

  it("counts multiple hits per domain correctly", () => {
    const m = classifyMessageDomain("revenue, sales, income all matter");
    expect(m.get("revenue")).toBe(3);
  });

  it("exported keyword map is frozen-readable", () => {
    // Smoke check that the export is usable externally.
    expect(Object.keys(ATTENTION_DOMAIN_KEYWORDS).length).toBeGreaterThan(5);
    expect(ATTENTION_DOMAIN_KEYWORDS.revenue).toContain("revenue");
  });
});

describe("computeFocusScore", () => {
  it("returns 50 (neutral) when totalMentions=0", () => {
    expect(computeFocusScore(0, 0)).toBe(50);
  });

  it("returns 100 when all mentions are on goals", () => {
    expect(computeFocusScore(10, 10)).toBe(100);
  });

  it("returns 0 when no mentions are on goals", () => {
    expect(computeFocusScore(0, 10)).toBe(0);
  });

  it("clamps to [0, 100]", () => {
    expect(computeFocusScore(20, 10)).toBe(100); // > 100 → clamp
  });

  it("rounds to int", () => {
    expect(computeFocusScore(1, 3)).toBe(33);
    expect(computeFocusScore(2, 3)).toBe(67);
  });
});

describe("computeActionRatio", () => {
  it("returns 0 when no actions or questions", () => {
    expect(computeActionRatio(0, 0)).toBe(0);
  });

  it("returns 1 when all are actions", () => {
    expect(computeActionRatio(5, 0)).toBe(1);
  });

  it("returns 0 when all are questions", () => {
    expect(computeActionRatio(0, 5)).toBe(0);
  });

  it("rounds to 2 decimals", () => {
    expect(computeActionRatio(1, 2)).toBe(0.33);
    expect(computeActionRatio(2, 3)).toBe(0.4);
  });
});

describe("computeAttentionVelocity", () => {
  it("returns the signed delta", () => {
    expect(computeAttentionVelocity(40, 70)).toBe(30);
    expect(computeAttentionVelocity(70, 40)).toBe(-30);
  });

  it("returns 0 for no change", () => {
    expect(computeAttentionVelocity(50, 50)).toBe(0);
  });

  it("clamps to [-100, 100]", () => {
    expect(computeAttentionVelocity(-200, 500)).toBe(100);
    expect(computeAttentionVelocity(500, -200)).toBe(-100);
  });

  it("rounds to int", () => {
    expect(computeAttentionVelocity(40.3, 70.8)).toBe(31);
  });
});

describe("timeOfDayBucket", () => {
  // ET-ANCHORED FIXTURES. These used `new Date(); d.setHours(H)` — LOCAL hour H,
  // which is 16:00Z on an ET laptop and 12:00Z in CI. timeOfDayBucket reads the
  // ET hour, so the two agreed only when the machine happened to be in ET: the
  // suite passed locally and failed in CI on the same commit. A test whose result
  // depends on where it runs cannot tell you anything about the code.
  //
  // August is EDT (UTC-4), so ET hour H is UTC hour H+4 on this date. Constructed
  // with Date.UTC so no local zone enters the fixture at all.
  const atEtHour = (h: number) => new Date(Date.UTC(2026, 7, 23, h + 4, 0, 0));

  it("the fixture itself is ET-correct in any zone", () => {
    // The positive control. Without it, a broken `atEtHour` would make every
    // assertion below meaningless while they all still passed.
    expect(hourET(atEtHour(6))).toBe(6);
    expect(hourET(atEtHour(12))).toBe(12);
    expect(hourET(atEtHour(18))).toBe(18);
  });

  it("maps 6am to morning", () => {
    expect(timeOfDayBucket(atEtHour(6))).toBe("morning");
  });

  it("maps noon to afternoon (not morning)", () => {
    expect(timeOfDayBucket(atEtHour(12))).toBe("afternoon");
  });

  it("maps 5pm to afternoon", () => {
    expect(timeOfDayBucket(atEtHour(17))).toBe("afternoon");
  });

  it("maps 6pm to evening", () => {
    expect(timeOfDayBucket(atEtHour(18))).toBe("evening");
  });
});
