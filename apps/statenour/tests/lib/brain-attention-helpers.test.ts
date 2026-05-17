/**
 * tests/lib/brain-attention-helpers.test.ts — attention-tracker primitives
 *
 * Locks down the pure math + classification pieces that feed into
 * `analyzeAttentionPatterns()`. These don't hit Prisma and carry the
 * actual signal quality for focus score / velocity / domain
 * classification shown on /system/quality and in the HQ top strip.
 */

import { describe, it, expect } from "vitest";
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
  it("maps 6am to morning", () => {
    const d = new Date();
    d.setHours(6, 0, 0, 0);
    expect(timeOfDayBucket(d)).toBe("morning");
  });

  it("maps noon to afternoon (not morning)", () => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    expect(timeOfDayBucket(d)).toBe("afternoon");
  });

  it("maps 5pm to afternoon", () => {
    const d = new Date();
    d.setHours(17, 0, 0, 0);
    expect(timeOfDayBucket(d)).toBe("afternoon");
  });

  it("maps 6pm to evening", () => {
    const d = new Date();
    d.setHours(18, 0, 0, 0);
    expect(timeOfDayBucket(d)).toBe("evening");
  });

  it("maps 11pm to evening", () => {
    const d = new Date();
    d.setHours(23, 0, 0, 0);
    expect(timeOfDayBucket(d)).toBe("evening");
  });
});
