/**
 * Business-knowledge load gates · 2026-06-10 prompt-budget trim armor.
 *
 * The trim moved SMS_VOICE / EQUIPMENT_AUTHORITY / CLEVELAND_IDENTITY
 * out of the always-on business foundation. Pins:
 *   1. detectSmsIntent — the ONLY delivery path for the SMS tone card
 *      outside content mode (detectContentIntent has no sms keywords)
 *   2. an SMS-drafting ask still gets SMS VOICE on the business tier
 *   3. a plain business ask gets NONE of the three moved cards (the
 *      saving is real) but keeps the foundation (BRAND VOICE etc.)
 *   4. content mode carries all three (no capability lost)
 *
 * Pure data + regex — no mocks needed.
 */

import { describe, it, expect } from "vitest";

// No mocks — content-intent.ts is a zero-import pure module, so these
// gates run against the REAL content detector.
import { detectSmsIntent, getBusinessKnowledge } from "@/lib/ai/business-knowledge";

describe("detectSmsIntent", () => {
  it("fires on sms/text/win-back asks", () => {
    expect(detectSmsIntent("draft an sms for the winback list")).toBe(true);
    expect(detectSmsIntent("send a text to the customer about the brakes")).toBe(true);
    expect(detectSmsIntent("texting campaign for stale leads")).toBe(true);
    expect(detectSmsIntent("win-back message for old customers")).toBe(true);
  });

  it("stays quiet on ordinary asks and null", () => {
    expect(detectSmsIntent("what's revenue today")).toBe(false);
    expect(detectSmsIntent("write me an instagram post")).toBe(false);
    expect(detectSmsIntent(null)).toBe(false);
    expect(detectSmsIntent(undefined)).toBe(false);
    // "context" / "textbook" must not substring-match "text".
    expect(detectSmsIntent("give me more context on the lead")).toBe(false);
  });
});

describe("getBusinessKnowledge load gates", () => {
  it("SMS ask on business tier gets the SMS VOICE card (own gate, not content mode)", () => {
    const out = getBusinessKnowledge("business", "draft the sms blast for winback");
    expect(out).toContain("SMS VOICE");
  });

  it("plain business ask loads NONE of the three moved cards but keeps the foundation", () => {
    const out = getBusinessKnowledge("business", "how did the shop do this week");
    expect(out).not.toContain("SMS VOICE");
    expect(out).not.toContain("EQUIPMENT AUTHORITY");
    expect(out).not.toContain("CLEVELAND IDENTITY");
    // Foundation survives the trim.
    expect(out).toContain("BRAND VOICE");
    expect(out).toContain("HARD RULES");
  });

  it("content mode carries all three moved cards", () => {
    const out = getBusinessKnowledge("business", "write me an instagram post about brakes");
    expect(out).toContain("SMS VOICE");
    expect(out).toContain("EQUIPMENT AUTHORITY");
    expect(out).toContain("CLEVELAND IDENTITY");
  });

  it("core tier stays ops-card-only", () => {
    const out = getBusinessKnowledge("core", "hey");
    expect(out).toContain("OPS CARD");
    expect(out).not.toContain("BRAND VOICE");
  });
});
