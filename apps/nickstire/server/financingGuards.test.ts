/**
 * Phase 2 poka-yoke guards on the financing hand-off (the only real lender
 * hand-off in the app: snap.submit → POST api.snapfinance.com).
 *
 * Each guard is asserted by its REJECTION — a bad state must be
 * unrepresentable at the server boundary, not merely discouraged in the UI:
 *   1. partner-required fields (name, phone, amount, service);
 *   2. the disclosure attestation (disclosureAcknowledged must be true);
 *   3. the Acima credit-vocabulary kernel rule (lease-to-own may never be
 *      presented as financing/credit/a loan — merchant terms + FTC Reg M).
 */
import { describe, expect, it } from "vitest";
import { snapSubmitInput } from "./routers/snap";
import { findVoiceViolations } from "../shared/voice";

const VALID = {
  customerName: "Jane Driver",
  customerPhone: "2168620005",
  amount: 1200,
  service: "4 tires + alignment",
  disclosureAcknowledged: true as const,
};

describe("snap.submit partner-required fields", () => {
  it("accepts a complete application", () => {
    expect(snapSubmitInput.safeParse(VALID).success).toBe(true);
  });

  it("rejects a missing amount", () => {
    const { amount: _drop, ...rest } = VALID;
    expect(snapSubmitInput.safeParse(rest).success).toBe(false);
  });

  it("rejects a zero amount — a $0 application is not submittable", () => {
    expect(snapSubmitInput.safeParse({ ...VALID, amount: 0 }).success).toBe(false);
  });

  it("rejects a missing or empty service description", () => {
    const { service: _drop, ...rest } = VALID;
    expect(snapSubmitInput.safeParse(rest).success).toBe(false);
    expect(snapSubmitInput.safeParse({ ...VALID, service: "  " }).success).toBe(false);
  });

  it("rejects a blank customer name and a too-short phone", () => {
    expect(snapSubmitInput.safeParse({ ...VALID, customerName: "  " }).success).toBe(false);
    expect(snapSubmitInput.safeParse({ ...VALID, customerPhone: "123" }).success).toBe(false);
  });
});

describe("snap.submit disclosure attestation", () => {
  it("rejects when the disclosure is not acknowledged", () => {
    const parsed = snapSubmitInput.safeParse({ ...VALID, disclosureAcknowledged: false });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toMatch(/disclosure/i);
    }
  });

  it("rejects when the field is absent entirely", () => {
    const { disclosureAcknowledged: _drop, ...rest } = VALID;
    expect(snapSubmitInput.safeParse(rest).success).toBe(false);
  });
});

describe("positioning.acima-credit-language kernel rule", () => {
  const fires = (text: string) =>
    findVoiceViolations(text, { surface: "web" }).some(
      (v) => v.ruleId === "positioning.acima-credit-language",
    );

  it("blocks direct conflation of Acima with credit vocabulary", () => {
    expect(fires("Ask about Acima financing at the counter")).toBe(true);
    expect(fires("Get financing through Acima today")).toBe(true);
    expect(fires("Acima's credit program covers repairs")).toBe(true);
    expect(fires("a loan from Acima")).toBe(true);
  });

  it("spares the approved lease-to-own vocabulary and plain provider lists", () => {
    expect(fires("Acima lease-to-own — $10 initial payment")).toBe(false);
    expect(fires("Payment programs: Acima, Snap Finance, Koalafi")).toBe(false);
    // Incumbent site copy shape (AutoRepairNearMePage): attribution runs to the
    // list, not to Acima directly — deliberately NOT a violation, because
    // lender names in customer copy are intentional (shared/financing.ts).
    expect(fires("$10 down financing via Snap, Acima, Koalafi")).toBe(false);
  });

  it("does not apply on the admin surface", () => {
    const hits = findVoiceViolations("Acima financing dashboard", { surface: "admin" });
    expect(hits.filter((v) => v.ruleId === "positioning.acima-credit-language")).toEqual([]);
  });
});
