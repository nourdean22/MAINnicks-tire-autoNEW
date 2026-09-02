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

  // 2026-09-02 · this test used to read "does not crash when prisma throws"
  // and pinned `resolved: 0` / `verdict: "unknown"` — i.e. it asserted the
  // DEFECT. `summarizeCalibration` swallowed read failures into an empty
  // result, the /brain tile hides itself when resolved === 0, and so an
  // unreachable database rendered exactly like a quiet month: nothing on
  // screen, and an operator reading "calibration is fine". The helper now
  // propagates; callers that may legitimately degrade (ultron-situation's
  // weekly digest) keep their own .catch().
  it("propagates a read failure instead of reporting an empty window", async () => {
    mockPrisma.prediction.findMany.mockRejectedValueOnce(new Error("DB down"));
    await expect(summarizeCalibration({ days: 7 })).rejects.toThrow("DB down");
  });

  it("still reports a genuinely empty window as resolved 0 / unknown", async () => {
    // The other half of the distinction: emptiness is not an error.
    mockPrisma.prediction.findMany.mockResolvedValueOnce([]);
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

/**
 * 2026-09-02 · window canaries.
 *
 * The window filtered `createdAt: { gte: since }` AND required the row to be
 * resolved, so a row had to be MADE inside the window and already have landed
 * — which caps the horizon below the window length by construction. At
 * days=30 no prediction with a 30-day-or-longer horizon could ever appear in
 * "Calibration · 30d".
 *
 * These tests run the real `where` clause against a fixture table instead of
 * stubbing a fixed row list, so they prove which COLUMN is being filtered.
 */
describe("summarizeCalibration window", () => {
  interface Row {
    confidence: number;
    status: string;
    brierScore: number | null;
    createdAt: Date;
    updatedAt: Date;
  }

  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);

  /** A prediction made 90 days ago and resolved yesterday. */
  const longHorizon: Row = {
    confidence: 0.8,
    status: "confirmed",
    brierScore: 0.04,
    createdAt: ago(90),
    updatedAt: ago(1),
  };
  /** A prediction made and resolved long before the window. */
  const stale: Row = {
    confidence: 0.6,
    status: "disproven",
    brierScore: 0.36,
    createdAt: ago(200),
    updatedAt: ago(180),
  };

  function tableOf(rows: Row[]) {
    return async (args: { where?: Record<string, unknown> }) => {
      const where = args?.where ?? {};
      const created = where.createdAt as { gte?: Date } | undefined;
      const updated = where.updatedAt as { gte?: Date } | undefined;
      return rows
        .filter((r) => (created?.gte ? r.createdAt >= created.gte : true))
        .filter((r) => (updated?.gte ? r.updatedAt >= updated.gte : true))
        .map((r) => ({
          confidence: r.confidence,
          status: r.status,
          brierScore: r.brierScore,
        }));
    };
  }

  it("includes a long-horizon prediction resolved inside the window", async () => {
    mockPrisma.prediction.findMany.mockImplementationOnce(tableOf([longHorizon]));
    const r = await summarizeCalibration({ days: 30 });
    // Filtering createdAt would drop this row: it was made 90 days ago.
    expect(r.resolved).toBe(1);
    expect(r.confirmed).toBe(1);
  });

  it("excludes a prediction that was resolved before the window opened", async () => {
    mockPrisma.prediction.findMany.mockImplementationOnce(tableOf([stale]));
    const r = await summarizeCalibration({ days: 30 });
    expect(r.resolved).toBe(0);
  });

  it("keys the window on resolution time, not creation time", async () => {
    mockPrisma.prediction.findMany.mockImplementationOnce(tableOf([longHorizon, stale]));
    await summarizeCalibration({ days: 30 });
    const where = mockPrisma.prediction.findMany.mock.calls[0][0].where;
    expect(where.updatedAt).toBeDefined();
    expect(where.createdAt).toBeUndefined();
  });
});
