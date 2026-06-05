import { describe, it, expect } from "vitest";
import { pickWholesaleCost } from "./gatewayClient";

/**
 * Regression guard for the 2026-06-05 customer overcharge bug.
 *
 * D&K's /quicksearch/cache INVERTS its field names: `selling_price` is the
 * dealer's wholesale COST, `cost_price` is the suggested RETAIL (= 2x cost).
 * pickWholesaleCost used to read `cost_price`, so every customer tire was
 * priced at cost x 4 (100% markup applied to 2x cost) — e.g. the NITTO
 * LT295/55R22 showed $1883 instead of $941.50. It must return the TRUE cost
 * (the lower of the two prices).
 */
const item = (pricing: Record<string, unknown>[]) => ({ pricing_data: pricing });

describe("pickWholesaleCost — D&K inverted pricing fields", () => {
  it("returns the dealer cost (selling_price), not the retail (cost_price)", () => {
    // Exact shapes from the live D&K response for size 295/55R22.
    expect(pickWholesaleCost(item([{ cost_price: 941.5, selling_price: 470.75 }]))).toBe(470.75);
    expect(pickWholesaleCost(item([{ cost_price: 1000, selling_price: 500 }]))).toBe(500);
    expect(pickWholesaleCost(item([{ cost_price: 746.7264, selling_price: 373.3632 }]))).toBe(373.3632);
  });

  it("stays correct even if D&K ever un-inverts the names (always the lower price = cost)", () => {
    expect(pickWholesaleCost(item([{ cost_price: 470.75, selling_price: 941.5 }]))).toBe(470.75);
  });

  it("falls back to the only positive price when one field is missing or zero", () => {
    expect(pickWholesaleCost(item([{ selling_price: 470.75 }]))).toBe(470.75);
    expect(pickWholesaleCost(item([{ cost_price: 941.5 }]))).toBe(941.5);
    expect(pickWholesaleCost(item([{ cost_price: 0, selling_price: 470.75 }]))).toBe(470.75);
  });

  it("returns 0 (caller filters $0 tires) when pricing is missing, empty, or non-numeric", () => {
    expect(pickWholesaleCost({})).toBe(0);
    expect(pickWholesaleCost({ pricing_data: [] })).toBe(0);
    expect(pickWholesaleCost(item([{ cost_price: "n/a", selling_price: "call" }]))).toBe(0);
  });
});
