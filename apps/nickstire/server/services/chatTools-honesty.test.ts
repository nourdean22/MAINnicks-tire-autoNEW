/**
 * Chat honesty drift-guards (2026-07-11).
 *
 * 1. Price quotes the customer chatbot gives MUST match the canonical
 *    operator-confirmed numbers in @shared/pricing.ts. The PRICE_MAP
 *    previously hardcoded drifted values (oil $35 vs $49, brakes $350
 *    vs $299, e-check $200 vs $189) — the bot quoted prices the shop
 *    doesn't honor.
 * 2. check_financing must NEVER claim eligibility/approval — the tool
 *    previously returned `eligible: true` unconditionally and claimed
 *    "in-house financing" when providers are third parties.
 */
import { describe, it, expect } from "vitest";
import { executeTool } from "./chatTools";
import { OIL_PRICE, BRAKE_PRICE, SERVICE_PRICE, DIAGNOSTIC_PRICE } from "@shared/pricing";
import { BUSINESS } from "@shared/business";

describe("chat price quotes track canonical shared/pricing.ts", () => {
  it("oil change quotes the canonical floor/ceiling", async () => {
    const r = JSON.parse(await executeTool("get_price_estimate", { service: "oil change" }));
    expect(r.lowEstimate).toBe(OIL_PRICE.conventional);
    expect(r.highEstimate).toBe(OIL_PRICE.fullSynthetic);
  });

  it("brakes quote the canonical pads range", async () => {
    const r = JSON.parse(await executeTool("get_price_estimate", { service: "brake pads" }));
    expect(r.lowEstimate).toBe(BRAKE_PRICE.padsStarting);
    expect(r.highEstimate).toBe(BRAKE_PRICE.padsMax);
  });

  it("e-check quotes the canonical starting price", async () => {
    const r = JSON.parse(await executeTool("get_price_estimate", { service: "e-check repair" }));
    expect(r.lowEstimate).toBe(SERVICE_PRICE.eCheckFixStarting);
  });

  // 2026-10-01 (#2868): one diagnostic fee, $49 waived with the repair, and
  // one new-tire floor, $89. The tool quoted $75-$150 and $80-$250 after both.
  it("diagnostic and check-engine quote the one diagnostic fee, waived with the repair", async () => {
    for (const service of ["diagnostic", "check engine light"]) {
      const r = JSON.parse(await executeTool("get_price_estimate", { service }));
      expect(r.lowEstimate, service).toBe(DIAGNOSTIC_PRICE.fee);
      expect(r.highEstimate, service).toBe(DIAGNOSTIC_PRICE.fee);
      expect(r.note, service).toContain(DIAGNOSTIC_PRICE.waiver);
    }
  });

  it("new tires quote the canonical floor", async () => {
    const r = JSON.parse(await executeTool("get_price_estimate", { service: "new tires" }));
    expect(r.lowEstimate).toBe(BUSINESS.newTires.startingDollars);
  });
});

describe("check_financing never fabricates approval", () => {
  it("returns no eligibility claim and names the real third-party deciders", async () => {
    const r = JSON.parse(await executeTool("check_financing", { estimatedTotal: 600 }));
    expect("eligible" in r).toBe(false); // the fabrication field must stay gone
    expect(r.programAvailable).toBe(true);
    expect(r.approvalDecidedBy).toContain(BUSINESS.financing.providers[0]);
    expect(r.approvalDecidedBy.toLowerCase()).toContain("cannot pre-approve");
    expect(JSON.stringify(r).toLowerCase()).not.toContain("in-house");
    // 2026-10-01: total / months is zero-cost math; lease-to-own costs more.
    expect(JSON.stringify(r)).not.toMatch(/\/mo\b|illustrativePlans/);
    expect(r.costNote).toMatch(/total cost/i);
  });
});
