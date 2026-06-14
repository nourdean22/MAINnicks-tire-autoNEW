/**
 * Tests for the GBP local-growth libraries. The load-bearing assertions
 * are the CLAIM-SAFETY ones: the Q&A copy must never make a forbidden
 * promise, and the rank/competitor models must never fabricate numbers.
 */
import { describe, it, expect } from "vitest";
import { GBP_QA_SEEDS, gbpQaByCategory } from "../client/src/lib/gbpQaSeeds";
import { weeklyPhotoQueue, PHOTO_SAFETY_RULES } from "../client/src/lib/gbpPhotoQueue";
import { ENTITY_PLATFORMS, CANONICAL_IDENTITY } from "../client/src/lib/entityConsistency";
import { COMPETITORS, reviewVolumeGaps, COMPETITOR_BASELINE_DATE } from "../client/src/lib/competitorGbpMonitor";
import { RANK_KEYWORDS, emptyRankReport } from "../client/src/lib/localRankKeywords";

describe("GBP Q&A seeds — claim safety", () => {
  const all = GBP_QA_SEEDS.map((q) => `${q.question} ${q.answer}`.toLowerCase()).join("\n");

  it("has 15+ pairs spanning many categories", () => {
    expect(GBP_QA_SEEDS.length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(gbpQaByCategory()).length).toBeGreaterThanOrEqual(10);
  });

  it("never makes forbidden promises", () => {
    expect(all).not.toMatch(/guaranteed same.?day/);
    expect(all).not.toMatch(/\bwarranty\b/);          // no invented warranties
    expect(all).not.toMatch(/everyone uses us|best in (town|cleveland)/);
    expect(all).not.toMatch(/free estimate/);          // site says "free check / written quote", not "free estimate"
  });

  it("uses approved used-tire wording only ($25 floor, never $60 on web copy)", () => {
    // The one place a price appears must be the approved used-tire line.
    expect(all).toContain("from $25 installed");
    expect(all).not.toMatch(/\$60/);
  });

  it("includes local SEO terms", () => {
    expect(all).toMatch(/cleveland/);
    expect(all).toMatch(/euclid/);
    expect(all).toMatch(/e-check|northeast ohio/);
  });

  it("uses brand payment-program language, not raw 'financing' hype", () => {
    expect(all).toMatch(/payment program/);
  });
});

describe("GBP photo queue", () => {
  it("returns 6 stable tasks for any week, with safety rules", () => {
    for (const w of [0, 1, 5, 11, 100, -3]) {
      const q = weeklyPhotoQueue(w);
      expect(q.length).toBe(6);
      expect(new Set(q.map((t) => t.title)).size).toBe(6); // no dup titles in a week
      for (const t of q) {
        expect(t.instructions.length).toBeGreaterThan(10);
        expect(t.caption.length).toBeGreaterThan(5);
      }
    }
    expect(PHOTO_SAFETY_RULES.length).toBeGreaterThanOrEqual(4);
    expect(PHOTO_SAFETY_RULES.join(" ")).toMatch(/license plate/i);
  });

  it("is deterministic for a given week", () => {
    expect(weeklyPhotoQueue(7).map((t) => t.title)).toEqual(weeklyPhotoQueue(7).map((t) => t.title));
  });
});

describe("entity consistency tracker", () => {
  it("carries canonical NAP and never auto-marks anything fixed", () => {
    expect(CANONICAL_IDENTITY.address).toBe("17625 Euclid Ave, Cleveland, OH 44112");
    expect(CANONICAL_IDENTITY.phone).toBe("(216) 862-0005");
    // Every platform starts not_checked and is never automation-safe.
    for (const p of ENTITY_PLATFORMS) {
      expect(p.status).toBe("not_checked");
      expect(p.automationSafe).toBe(false);
    }
  });
});

describe("competitor monitor — no fabricated movement", () => {
  it("baseline is explicitly dated and never presented as live", () => {
    expect(COMPETITOR_BASELINE_DATE).toMatch(/^\d{4}-\d{2}$/);
    expect(COMPETITORS.length).toBe(5);
  });

  it("computes review-volume gaps from a real input", () => {
    const gaps = reviewVolumeGaps(100);
    expect(gaps[0].gap).toBe(639 - 100); // Moe's largest gap first
    expect(gaps.every((g) => typeof g.gap === "number")).toBe(true);
  });
});

describe("rank keywords — never fakes a rank", () => {
  it("ships the target set with all ranks null until measured", () => {
    expect(RANK_KEYWORDS.length).toBeGreaterThanOrEqual(15);
    const report = emptyRankReport();
    expect(report.every((r) => r.rank === null && r.source === "unmeasured")).toBe(true);
  });
});
