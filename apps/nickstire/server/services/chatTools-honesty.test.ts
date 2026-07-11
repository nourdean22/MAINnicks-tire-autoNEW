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
import { OIL_PRICE, BRAKE_PRICE, SERVICE_PRICE } from "@shared/pricing";
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
});

describe("check_financing never fabricates approval", () => {
  it("returns no eligibility claim and names the real third-party deciders", async () => {
    const r = JSON.parse(await executeTool("check_financing", { estimatedTotal: 600 }));
    expect("eligible" in r).toBe(false); // the fabrication field must stay gone
    expect(r.programAvailable).toBe(true);
    expect(r.approvalDecidedBy).toContain(BUSINESS.financing.providers[0]);
    expect(r.approvalDecidedBy.toLowerCase()).toContain("cannot pre-approve");
    expect(JSON.stringify(r).toLowerCase()).not.toContain("in-house");
  });
});
