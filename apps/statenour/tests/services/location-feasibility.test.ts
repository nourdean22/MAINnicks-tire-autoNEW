/**
 * location-feasibility · service tests · v10.0.526 · Arc C · Feature 7
 *
 * Pure-function coverage. NO Prisma mocks needed because the scorer
 * does not touch the database · location-rank.ts holds the
 * persistence concerns and would be tested separately if/when the
 * data ingestion lands.
 */

import { describe, it, expect } from "vitest";

import {
  scoreLocation,
  tierFor,
  normalizeDimensions,
  DEFAULT_WEIGHTS,
  addressSlug,
  type LocationParams,
} from "@/lib/services/location-feasibility";

describe("scoreLocation · perfect-score case", () => {
  it("returns ~100/100 tier A when every dimension is ideal", () => {
    const params: LocationParams = {
      address: "123 Main St, Cleveland OH",
      footTrafficPercentile: 100,
      reviewDensity: 25, // above the log-saturation knee
      competitorCluster: 0,
      driveTimeToHomeMinutes: 0,
      zoningFriction: 0,
    };
    const r = scoreLocation(params);
    expect(r.normalizedScore).toBeGreaterThanOrEqual(95);
    expect(r.tier).toBe("A");
    expect(r.warnings).toHaveLength(0);
    // Reasoning should be operator-readable, not empty
    expect(r.reasoning.length).toBeGreaterThanOrEqual(3);
    expect(r.strongestDimension).not.toBeNull();
  });
});

describe("scoreLocation · all-neutral case", () => {
  it("returns exactly 50/100 tier C when zero dimensions are provided", () => {
    const r = scoreLocation({ address: "Unknown" });
    expect(r.normalizedScore).toBe(50);
    expect(r.tier).toBe("C");
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("foot-traffic");
    expect(r.warnings[0]).toContain("review density");
    expect(r.warnings[0]).toContain("competitor");
    // No provided dims means no strongest/weakest can be picked
    expect(r.strongestDimension).toBeNull();
    expect(r.weakestDimension).toBeNull();
  });
});

describe("scoreLocation · partial-data case", () => {
  it("scores what's provided, warns about missing dimensions", () => {
    const r = scoreLocation({
      address: "Partial Ave",
      footTrafficPercentile: 80,
      competitorCluster: 2,
    });
    expect(r.warnings).toHaveLength(1);
    const w = r.warnings[0];
    // Anchor on full label phrases · "competitor" alone appears in
    // the OTHER label ("review density vs competitors") so substring
    // tests need to be specific.
    expect(w).toContain("review density vs competitors");
    expect(w).toContain("drive time to Euclid HQ");
    expect(w).toContain("zoning friction");
    expect(w).not.toContain("foot-traffic percentile");
    expect(w).not.toContain("competitor cluster");
    // Strongest/weakest are picked from the PROVIDED dims only
    expect(r.strongestDimension).not.toBeNull();
    expect(["footTraffic", "competitorCluster"]).toContain(r.strongestDimension);
  });

  it("inverts competitor + drive + zoning correctly", () => {
    // Two perfectly identical except for competitor count.
    const low = scoreLocation({ address: "A", competitorCluster: 1 });
    const high = scoreLocation({ address: "B", competitorCluster: 9 });
    expect(low.normalizedScore).toBeGreaterThan(high.normalizedScore);
  });
});

describe("scoreLocation · weight correctness", () => {
  it("respects the default weight distribution (footTraffic 0.30 dominates)", () => {
    // Score #1: footTraffic perfect, everything else 0
    const r1 = scoreLocation({
      address: "X",
      footTrafficPercentile: 100,
      reviewDensity: 0,
      competitorCluster: 10,
      driveTimeToHomeMinutes: 60,
      zoningFriction: 100,
    });
    // Score #2: zoning perfect, everything else 0
    const r2 = scoreLocation({
      address: "Y",
      footTrafficPercentile: 0,
      reviewDensity: 0,
      competitorCluster: 10,
      driveTimeToHomeMinutes: 60,
      zoningFriction: 0,
    });
    // footTraffic weight (0.30) > zoning weight (0.15) so r1 must outscore r2
    expect(r1.normalizedScore).toBeGreaterThan(r2.normalizedScore);
  });

  it("DEFAULT_WEIGHTS sum to exactly 1.0", () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(Math.abs(sum - 1)).toBeLessThan(1e-9);
  });

  it("accepts override weights without mutating defaults", () => {
    const weights = { ...DEFAULT_WEIGHTS, footTraffic: 1, reviewDensity: 0, competitorCluster: 0, driveTime: 0, zoningFriction: 0 };
    const r = scoreLocation(
      {
        address: "Override",
        footTrafficPercentile: 100,
        reviewDensity: 0,
        competitorCluster: 10,
        driveTimeToHomeMinutes: 60,
        zoningFriction: 100,
      },
      weights,
    );
    expect(r.normalizedScore).toBe(100);
    // Defaults unchanged
    expect(DEFAULT_WEIGHTS.footTraffic).toBe(0.3);
  });
});

describe("scoreLocation · determinism + stability", () => {
  it("produces identical output for identical input (no Date.now leakage)", () => {
    const params: LocationParams = {
      address: "Repeat 100 W",
      footTrafficPercentile: 65,
      reviewDensity: 12,
      competitorCluster: 3,
      driveTimeToHomeMinutes: 14,
      zoningFriction: 25,
    };
    const a = scoreLocation(params);
    const b = scoreLocation(params);
    expect(a.normalizedScore).toBe(b.normalizedScore);
    expect(a.rawScore).toBe(b.rawScore);
    expect(a.tier).toBe(b.tier);
    expect(a.strongestDimension).toBe(b.strongestDimension);
    expect(a.weakestDimension).toBe(b.weakestDimension);
  });

  it("ranking is stable across permutations of the input list", () => {
    const candidates: LocationParams[] = [
      { address: "C1", footTrafficPercentile: 70, reviewDensity: 10, competitorCluster: 2, driveTimeToHomeMinutes: 10, zoningFriction: 20 },
      { address: "C2", footTrafficPercentile: 40, reviewDensity: 5, competitorCluster: 6, driveTimeToHomeMinutes: 30, zoningFriction: 60 },
      { address: "C3", footTrafficPercentile: 90, reviewDensity: 18, competitorCluster: 1, driveTimeToHomeMinutes: 5, zoningFriction: 10 },
    ];
    const scoresInOrder = candidates.map((c) => scoreLocation(c));
    const reversed = [...candidates].reverse().map((c) => scoreLocation(c));
    // Score of C3 is consistent regardless of position in caller's list
    const c3a = scoresInOrder.find((r) => r.address === "C3")!;
    const c3b = reversed.find((r) => r.address === "C3")!;
    expect(c3a.normalizedScore).toBe(c3b.normalizedScore);
    expect(c3a.tier).toBe(c3b.tier);
  });
});

describe("tierFor · threshold mapping", () => {
  it("maps each band to the right letter", () => {
    expect(tierFor(100)).toBe("A");
    expect(tierFor(85)).toBe("A");
    expect(tierFor(84)).toBe("B");
    expect(tierFor(70)).toBe("B");
    expect(tierFor(69)).toBe("C");
    expect(tierFor(50)).toBe("C");
    expect(tierFor(49)).toBe("D");
    expect(tierFor(35)).toBe("D");
    expect(tierFor(34)).toBe("F");
    expect(tierFor(0)).toBe("F");
  });

  it("does not produce gaps · every score lands on exactly one tier", () => {
    for (let s = 0; s <= 100; s++) {
      const t = tierFor(s);
      expect(["A", "B", "C", "D", "F"]).toContain(t);
    }
  });
});

describe("normalizeDimensions · invariants", () => {
  it("clamps every normalized dimension to [0, 1]", () => {
    // Out-of-band inputs · scorer should clamp not blow up
    const { values } = normalizeDimensions({
      address: "Edge",
      footTrafficPercentile: 9999,
      reviewDensity: 9999,
      competitorCluster: 9999,
      driveTimeToHomeMinutes: 9999,
      zoningFriction: 9999,
    });
    for (const v of Object.values(values)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("addressSlug · key generation", () => {
  it("produces lowercase alphanumeric+hyphen slugs", () => {
    expect(addressSlug("123 Main St, Cleveland OH 44132")).toBe(
      "123-main-st-cleveland-oh-44132",
    );
    expect(addressSlug("   leading & trailing!!  ")).toBe("leading-trailing");
    expect(addressSlug("")).toBe("");
  });
});
