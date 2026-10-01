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

  it("identifies as the shop assistant instead of impersonating Nick", () => {
    expect(NICK_SMS_SYSTEM_PROMPT).toMatch(/texting assistant for Nick's Tire & Auto/i);
    expect(NICK_SMS_SYSTEM_PROMPT).toMatch(/never impersonate Nick/i);
    expect(NICK_SMS_SYSTEM_PROMPT).not.toMatch(/You are Nick, the owner-operator/i);
  });

  it("pins thread continuity and one-question behavior from the customer corpus audit", () => {
    expect(NICK_SMS_SYSTEM_PROMPT).toMatch(/answer the customer's latest message first/i);
    expect(NICK_SMS_SYSTEM_PROMPT).toMatch(/Ask at most one question per reply/i);
    expect(NICK_SMS_SYSTEM_PROMPT).toMatch(/If the customer gives a tire size, answer that size directly/i);
    expect(NICK_SMS_SYSTEM_PROMPT).toMatch(/spam, solicitation, wrong-number/i);
  });
});
