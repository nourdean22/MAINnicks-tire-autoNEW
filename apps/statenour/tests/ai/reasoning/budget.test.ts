/**
 * tests/ai/reasoning/budget.test.ts · Phase P.1 (2026-05-18 PM)
 *
 * Tests for budget cap calculation · the constants and pure helpers
 * (estimateTierCost) · NOT the Prisma-touching functions which need
 * a live DB. The pure logic is the highest-value test surface · cap
 * calculation bugs would let mega runs sneak past the daily cap.
 */

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DAILY_CAP_USD,
  MEGA_PER_RUN_CAP_USD,
  RESERVATION_TTL_MS,
  BUDGET_READ_FAILED,
  __internals,
} from "@/lib/ai/reasoning/budget";

describe("budget · constants", () => {
  it("daily cap is $1.00 (operator-observable default)", () => {
    expect(DEFAULT_DAILY_CAP_USD).toBe(1.0);
  });

  it("mega per-run cap is $0.25 (H.6.2 invariant)", () => {
    expect(MEGA_PER_RUN_CAP_USD).toBe(0.25);
  });

  it("reservation TTL is 10 minutes (outlasts slowest mega run + slack)", () => {
    expect(RESERVATION_TTL_MS).toBe(10 * 60 * 1000);
  });

  it("BUDGET_READ_FAILED is a unique symbol (H.7.2 fail-closed sentinel)", () => {
    expect(typeof BUDGET_READ_FAILED).toBe("symbol");
  });
});

describe("estimateTierCost · matches TIER_CONFIG (O.1 single source)", () => {
  it("mega is the most expensive estimate", () => {
    const mega = __internals.estimateTierCost("mega");
    const thorough = __internals.estimateTierCost("thorough");
    const deep = __internals.estimateTierCost("deep");
    expect(mega).toBeGreaterThan(thorough);
    expect(thorough).toBeGreaterThan(deep);
  });

  it("quick is the cheapest", () => {
    const quick = __internals.estimateTierCost("quick");
    const standard = __internals.estimateTierCost("standard");
    expect(quick).toBeLessThan(standard);
  });

  it("smart sits between standard and deep (M.1 invariant)", () => {
    const standard = __internals.estimateTierCost("standard");
    const smart = __internals.estimateTierCost("smart");
    const deep = __internals.estimateTierCost("deep");
    expect(smart).toBeGreaterThan(standard);
    expect(smart).toBeLessThan(deep);
  });

  it("mega estimate respects MEGA_PER_RUN_CAP_USD", () => {
    expect(__internals.estimateTierCost("mega")).toBeLessThanOrEqual(
      MEGA_PER_RUN_CAP_USD,
    );
  });
});
