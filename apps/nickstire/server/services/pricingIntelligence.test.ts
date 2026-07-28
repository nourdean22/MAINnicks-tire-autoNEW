/**
 * Doctrine lock · revenue-truth-correction (2026-07-28)
 *
 * Pins the pricing-module truth pass:
 *
 *   1. THE PRICE RECOMMENDER IS DEAD. The old analyzePricing() scored
 *      invoice PAYMENT status as estimate "approval" and recommended
 *      ±10-15% price moves from it — with a directional bias (unpaid
 *      invoices read as declines → systematic "lower your prices"
 *      advice during slow-collections stretches). It must not return.
 *
 *   2. COACHING SCRIPTS CARRY NO FABRICATED FACTS. Every factual claim
 *      traces to shared/business.ts. The specific claims removed:
 *      "repair cost typically doubles", "loaner or shuttle", "7:30 AM"
 *      early drop-off (hours open 8), "20-30% less than dealership",
 *      "24 months warranty", stale "400+" review count, "3x better".
 */
import { describe, it, expect } from "vitest";
import * as pricingModule from "./pricingIntelligence";
import { analyzeObjections, getObjectionCoaching } from "./pricingIntelligence";
import { BUSINESS } from "@shared/business";

describe("price recommender stays dead", () => {
  it("module no longer exports analyzePricing (payment-status-as-approval recommender)", () => {
    expect((pricingModule as Record<string, unknown>).analyzePricing).toBeUndefined();
  });

  it("module no longer exports getServiceApprovalRates under the misleading name", () => {
    expect((pricingModule as Record<string, unknown>).getServiceApprovalRates).toBeUndefined();
  });
});

describe("getObjectionCoaching · every claim traces to canon", () => {
  const ALL_OBJECTIONS = [
    "price_concern", "timing", "shopping_around",
    "perceived_unnecessary", "trust_issue", "self_repair", "other",
  ];

  const FABRICATED_CLAIMS = [
    /typically doubles/i,
    /shuttle/i,
    /loaner/i,
    /7:30/,
    /20-30% less/i,
    /24 month/i,
    /400\+/,
    /3x better/i,
  ];

  for (const objection of ALL_OBJECTIONS) {
    it(`${objection} · no fabricated claims in script or tip`, () => {
      const { script, tip } = getObjectionCoaching(objection);
      for (const claim of FABRICATED_CLAIMS) {
        expect(script).not.toMatch(claim);
        expect(tip).not.toMatch(claim);
      }
    });
  }

  it("trust_issue cites the canonical review count, not a stale literal", () => {
    const { script } = getObjectionCoaching("trust_issue");
    expect(script).toContain(BUSINESS.reviews.countDisplay);
    expect(script).toContain(String(BUSINESS.reviews.rating));
  });

  it("price_concern cites the canonical financing providers", () => {
    const { script } = getObjectionCoaching("price_concern");
    for (const provider of BUSINESS.financing.providers) {
      expect(script).toContain(provider);
    }
  });
});

describe("analyzeObjections · reads real decline reasons", () => {
  it("normalizes and ranks stated reasons", () => {
    const result = analyzeObjections([
      { service: "Brakes", reason: "too expensive right now" },
      { service: "Tires", reason: "can't afford it this week" },
      { service: "Brakes", reason: "want a second opinion" },
    ]);
    expect(result[0].reason).toBe("price_concern");
    expect(result[0].count).toBe(2);
    expect(result[0].services).toContain("Brakes");
    expect(result[0].services).toContain("Tires");
    expect(result[1].reason).toBe("shopping_around");
  });
});
