/**
 * One SSOT persona for SMS. The live drafter and the fine-tune corpus exporter
 * both import NICK_SMS_SYSTEM_PROMPT, so they can never drift. This locks the two
 * things that actually mattered: one serving/training persona, the current
 * quoting-channel used-tire anchor, and hard guards against other repair prices.
 */
import { describe, it, expect } from "vitest";
import { BUSINESS } from "@shared/business";
import { USED_TIRE_QUOTE } from "@shared/pricing";
import { NICK_SMS_SYSTEM_PROMPT } from "./services/nickSmsPersona";

describe("NICK_SMS_SYSTEM_PROMPT", () => {
  it("uses the operator-confirmed quoting-channel used-tire price plus canonical oil prices", () => {
    expect(NICK_SMS_SYSTEM_PROMPT).toContain(USED_TIRE_QUOTE.display);
    expect(NICK_SMS_SYSTEM_PROMPT).not.toContain(BUSINESS.usedTires.explanation);
    expect(NICK_SMS_SYSTEM_PROMPT).toContain(BUSINESS.oilChange.conventionalPrice);
    expect(NICK_SMS_SYSTEM_PROMPT).toContain(BUSINESS.oilChange.syntheticPrice);
  });

  it("keeps the website discovery floor out of SMS quoting", () => {
    expect(BUSINESS.usedTires.priceDisplay).toContain("$25");
    expect(NICK_SMS_SYSTEM_PROMPT).not.toContain(BUSINESS.usedTires.priceDisplay);
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
