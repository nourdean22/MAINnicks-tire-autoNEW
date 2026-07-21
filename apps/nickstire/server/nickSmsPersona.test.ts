/**
 * One SSOT persona for SMS. The live drafter and the fine-tune corpus exporter
 * both import NICK_SMS_SYSTEM_PROMPT, so they can never drift. This locks the two
 * things that actually mattered: the price comes from the BUSINESS SSOT (not a
 * hardcode), and the used-tire floor is $25 — not the drifted "from $60".
 */
import { describe, it, expect } from "vitest";
import { BUSINESS } from "@shared/business";
import { NICK_SMS_SYSTEM_PROMPT } from "./services/nickSmsPersona";

describe("NICK_SMS_SYSTEM_PROMPT", () => {
  it("interpolates the used-tire + oil prices from the BUSINESS SSOT", () => {
    expect(NICK_SMS_SYSTEM_PROMPT).toContain(BUSINESS.usedTires.explanation);
    expect(NICK_SMS_SYSTEM_PROMPT).toContain(BUSINESS.oilChange.conventionalPrice);
    expect(NICK_SMS_SYSTEM_PROMPT).toContain(BUSINESS.oilChange.syntheticPrice);
  });

  it("does not carry the drifted used-tire floor ('from $60 installed')", () => {
    expect(NICK_SMS_SYSTEM_PROMPT).not.toContain("from $60 installed");
  });

  it("keeps the core price-safety guardrail", () => {
    expect(NICK_SMS_SYSTEM_PROMPT).toMatch(/never guess a price/i);
    expect(NICK_SMS_SYSTEM_PROMPT).toMatch(/free check/i);
  });
});
