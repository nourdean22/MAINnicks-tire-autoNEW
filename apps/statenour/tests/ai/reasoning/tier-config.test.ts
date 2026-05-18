/**
 * tests/ai/reasoning/tier-config.test.ts · Phase P.1 (2026-05-18 PM)
 *
 * Tests for the O.1 TIER_CONFIG mapped type. The Record<ReasoningTier,
 * TierConfig> shape enforces exhaustiveness at compile time · these
 * tests guard the RUNTIME invariants that the type system can't
 * express (cost monotonicity · TIER_ORDER completeness · the right
 * tiers have critique enabled).
 */

import { describe, expect, it } from "vitest";
import {
  TIER_CONFIG,
  TIER_ORDER,
  getTierConfig,
} from "@/lib/ai/reasoning/tier-config";
import type { ReasoningTier } from "@/lib/ai/reasoning/types";

const ALL_TIERS: ReasoningTier[] = [
  "quick",
  "standard",
  "smart",
  "deep",
  "thorough",
  "mega",
];

describe("TIER_CONFIG · exhaustiveness (runtime check)", () => {
  it("has an entry for every tier in the union", () => {
    for (const tier of ALL_TIERS) {
      expect(TIER_CONFIG[tier]).toBeDefined();
      expect(TIER_CONFIG[tier].label).toBe(tier);
    }
  });

  it("TIER_ORDER contains every tier exactly once", () => {
    expect(new Set(TIER_ORDER).size).toBe(ALL_TIERS.length);
    for (const t of ALL_TIERS) {
      expect(TIER_ORDER).toContain(t);
    }
  });

  it("getTierConfig returns the same object as direct lookup", () => {
    expect(getTierConfig("smart")).toBe(TIER_CONFIG.smart);
  });
});

describe("TIER_CONFIG · cost monotonicity", () => {
  it("budget estimates are monotonically non-decreasing across TIER_ORDER", () => {
    for (let i = 0; i < TIER_ORDER.length - 1; i++) {
      const cheaper = TIER_CONFIG[TIER_ORDER[i]];
      const pricier = TIER_CONFIG[TIER_ORDER[i + 1]];
      expect(pricier.budgetEstimateUsd).toBeGreaterThanOrEqual(
        cheaper.budgetEstimateUsd,
      );
    }
  });

  it("per-call cost estimates are non-decreasing across TIER_ORDER", () => {
    for (let i = 0; i < TIER_ORDER.length - 1; i++) {
      const cheaper = TIER_CONFIG[TIER_ORDER[i]];
      const pricier = TIER_CONFIG[TIER_ORDER[i + 1]];
      expect(pricier.callCostEstimate).toBeGreaterThanOrEqual(
        cheaper.callCostEstimate,
      );
    }
  });
});

describe("TIER_CONFIG · behavior toggles", () => {
  it("quick tier has neither critique nor refine nor router", () => {
    expect(TIER_CONFIG.quick.hasCritique).toBe(false);
    expect(TIER_CONFIG.quick.hasRefine).toBe(false);
    expect(TIER_CONFIG.quick.usesRouter).toBe(false);
  });

  it("standard tier has critique but not refine", () => {
    expect(TIER_CONFIG.standard.hasCritique).toBe(true);
    expect(TIER_CONFIG.standard.hasRefine).toBe(false);
  });

  it("only smart tier uses the router (M.1)", () => {
    for (const tier of ALL_TIERS) {
      if (tier === "smart") {
        expect(TIER_CONFIG[tier].usesRouter).toBe(true);
      } else {
        expect(TIER_CONFIG[tier].usesRouter).toBe(false);
      }
    }
  });

  it("smart/deep/thorough/mega all have critique + refine", () => {
    for (const tier of ["smart", "deep", "thorough", "mega"] as const) {
      expect(TIER_CONFIG[tier].hasCritique).toBe(true);
      expect(TIER_CONFIG[tier].hasRefine).toBe(true);
    }
  });

  it("every tier has an operator-facing hint", () => {
    for (const tier of ALL_TIERS) {
      expect(TIER_CONFIG[tier].hint.length).toBeGreaterThan(0);
    }
  });
});

describe("TIER_CONFIG · mega per-run cap (H.3.4 invariant)", () => {
  it("mega budget estimate is at or under $0.25 per-run cap", () => {
    // H.6.2 MEGA_PER_RUN_CAP_USD = 0.25 · estimate must respect it
    expect(TIER_CONFIG.mega.budgetEstimateUsd).toBeLessThanOrEqual(0.25);
  });
});
