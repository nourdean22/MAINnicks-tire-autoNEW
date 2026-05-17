/**
 * Forecast calibration tests · v10.0.150
 *
 * Verifies the math layer:
 *   · brierScore basics + boundary cases
 *   · bucketCalibration band assignment + per-band hitRate
 *   · summarizeCalibration verdict ladder + edge cases
 *
 * The DB-touching summarizeCalibration is mocked at the prisma layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    prediction: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mockPrisma }));

import {
  brierScore,
  bucketCalibration,
  summarizeCalibration,
} from "@/lib/brain/calibration";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("brierScore", () => {
  it("returns 0 for a perfect 1.0 prediction that confirmed", () => {
    expect(brierScore(1.0, 1)).toBe(0);
  });

  it("returns 0 for a perfect 0.0 prediction that disproved", () => {
    expect(brierScore(0.0, 0)).toBe(0);
  });

  it("returns 0.25 for a 50/50 guess that confirmed", () => {
    expect(brierScore(0.5, 1)).toBe(0.25);
  });

  it("returns 0.25 for a 50/50 guess that disproved", () => {
    expect(brierScore(0.5, 0)).toBe(0.25);
  });

  it("returns 1.0 for the worst miss (claimed certain, didn't happen)", () => {
    expect(brierScore(1.0, 0)).toBe(1);
  });

  it("rewards confidence in the right direction", () => {
    // Nick said 80% and it landed → better than saying 60% and landing
    expect(brierScore(0.8, 1)).toBeLessThan(brierScore(0.6, 1));
  });

  it("punishes confidence in the wrong direction", () => {
    // Nick said 80% and it didn't land → worse than saying 60% and not landing
    expect(brierScore(0.8, 0)).toBeGreaterThan(brierScore(0.6, 0));
  });
});

describe("bucketCalibration", () => {
  it("returns 10 bands covering [0, 1.05)", () => {
    const buckets = bucketCalibration([]);
    expect(buckets).toHaveLength(10);
    expect(buckets[0].lower).toBe(0);
    expect(buckets[9].upper).toBe(1.05);
  });

  it("places a 0.65-confidence prediction in the 0.6-0.7 band", () => {
    const buckets = bucketCalibration([
      { confidence: 0.65, status: "confirmed", brierScore: 0.1225 },
    ]);
    const band = buckets.find((b) => b.lower === 0.6);
    expect(band?.count).toBe(1);
    expect(band?.confirmed).toBe(1);
  });

  it("places a 1.0-confidence prediction in the top band (because top upper = 1.05)", () => {
    const buckets = bucketCalibration([
      { confidence: 1.0, status: "confirmed", brierScore: 0 },
    ]);
    const top = buckets[buckets.length - 1];
    expect(top.count).toBe(1);
  });

  it("computes hitRate correctly across multiple predictions in one band", () => {
    const buckets = bucketCalibration([
      { confidence: 0.75, status: "confirmed", brierScore: 0.0625 },
      { confidence: 0.78, status: "confirmed", brierScore: 0.0484 },
      { confidence: 0.72, status: "disproven", brierScore: 0.5184 },
      { confidence: 0.79, status: "disproven", brierScore: 0.6241 },
    ]);
    const band = buckets.find((b) => b.lower === 0.7);
    expect(band?.count).toBe(4);
    expect(band?.confirmed).toBe(2);
    expect(band?.hitRate).toBeCloseTo(0.5, 5);
  });

  it("returns null hitRate for bands with fewer than 2 samples", () => {
    const buckets = bucketCalibration([
      { confidence: 0.65, status: "confirmed", brierScore: 0.1 },
    ]);
    const band = buckets.find((b) => b.lower === 0.6);
    expect(band?.hitRate).toBeNull();
  });

  it("ignores pending predictions", () => {
    const buckets = bucketCalibration([
      { confidence: 0.7, status: "pending", brierScore: null },
      { confidence: 0.7, status: "pending", brierScore: null },
    ]);
    const band = buckets.find((b) => b.lower === 0.7);
    expect(band?.count).toBe(0);
  });

  it("computes meanBrier across the band", () => {
    const buckets = bucketCalibration([
      { confidence: 0.85, status: "confirmed", brierScore: 0.04 },
      { confidence: 0.85, status: "confirmed", brierScore: 0.06 },
    ]);
    const band = buckets.find((b) => b.lower === 0.8);
    expect(band?.meanBrier).toBeCloseTo(0.05, 5);
  });
});

describe("summarizeCalibration", () => {
  it("returns 'unknown' verdict when no predictions resolved", async () => {
    mockPrisma.prediction.findMany.mockResolvedValueOnce([]);
    const r = await summarizeCalibration({ days: 7 });
    expect(r.resolved).toBe(0);
    expect(r.verdict).toBe("unknown");
    expect(r.hitRate).toBeNull();
  });

  it("returns 'drift' when avgClaim is significantly higher than hitRate", async () => {
    // 5 predictions, 2 confirmed; claimed average ~0.78, actual hit rate 0.4 → 38pt gap
    mockPrisma.prediction.findMany.mockResolvedValueOnce([
      { confidence: 0.8, status: "confirmed", brierScore: 0.04 },
      { confidence: 0.78, status: "confirmed", brierScore: 0.0484 },
      { confidence: 0.78, status: "disproven", brierScore: 0.6084 },
      { confidence: 0.78, status: "disproven", brierScore: 0.6084 },
      { confidence: 0.76, status: "disproven", brierScore: 0.5776 },
    ]);
    const r = await summarizeCalibration({ days: 7 });
    expect(r.resolved).toBe(5);
    expect(r.confirmed).toBe(2);
    expect(r.hitRate).toBeCloseTo(0.4, 1);
    expect(r.verdict).toBe("drift");
    expect(r.avgClaimVsRealityGap).toBeGreaterThan(0.15);
  });

  it("returns 'well-calibrated' when claim aligns with reality", async () => {
    // Claim 0.65 across 6 predictions, 4 land (66%) → 1pt gap = well-calibrated
    mockPrisma.prediction.findMany.mockResolvedValueOnce([
      { confidence: 0.65, status: "confirmed", brierScore: 0.1225 },
      { confidence: 0.65, status: "confirmed", brierScore: 0.1225 },
      { confidence: 0.65, status: "confirmed", brierScore: 0.1225 },
      { confidence: 0.65, status: "confirmed", brierScore: 0.1225 },
      { confidence: 0.65, status: "disproven", brierScore: 0.4225 },
      { confidence: 0.65, status: "disproven", brierScore: 0.4225 },
    ]);
    const r = await summarizeCalibration({ days: 7 });
    expect(r.resolved).toBe(6);
    expect(r.verdict).toBe("well-calibrated");
  });

  it("falls back to 'unknown' when fewer than 4 resolved", async () => {
    mockPrisma.prediction.findMany.mockResolvedValueOnce([
      { confidence: 0.9, status: "confirmed", brierScore: 0.01 },
      { confidence: 0.9, status: "disproven", brierScore: 0.81 },
    ]);
    const r = await summarizeCalibration({ days: 7 });
    expect(r.resolved).toBe(2);
    // Below the 4-row threshold for a verdict
    expect(r.verdict).toBe("unknown");
  });

  it("does not crash when prisma throws", async () => {
    mockPrisma.prediction.findMany.mockRejectedValueOnce(new Error("DB down"));
    const r = await summarizeCalibration({ days: 7 });
    expect(r.resolved).toBe(0);
    expect(r.verdict).toBe("unknown");
  });

  it("computes meanBrier correctly on resolved set", async () => {
    mockPrisma.prediction.findMany.mockResolvedValueOnce([
      { confidence: 0.8, status: "confirmed", brierScore: 0.04 },
      { confidence: 0.7, status: "disproven", brierScore: 0.49 },
    ]);
    const r = await summarizeCalibration({ days: 7 });
    expect(r.meanBrier).toBeCloseTo((0.04 + 0.49) / 2, 5);
  });
});
