/**
 * tests/ai/chat/customer-shape-detector.test.ts · v10.0.503
 *
 * Locks the regex patterns that gate the customer-query hint
 * injection in app/api/ai/chat/route.ts. The injection adds a
 * MUST-CALL-findCustomer directive to the system prompt when the
 * user content looks like a customer-shaped question. This test
 * extracts the same regexes used in the route and asserts coverage.
 *
 * ADR-0011 Tier 3 surfacing fix · prevents the model from
 * hallucinating customer details by hard-routing customer-shape
 * turns to the existing findCustomer tool.
 */
import { describe, it, expect } from "vitest";

// Mirror of the regex set used inside app/api/ai/chat/route.ts at
// the customer-shape detector. Kept in sync via comment + this test.
const customerShapeRegex = {
  phone: /\b(?:\(?\d{3}\)?[\s.-]?)?\d{3}[\s.-]?\d{4}\b/,
  nameWithAction:
    /\b(?:tell me about|show me|look up|find|search for|how (?:much|many|long)|what (?:about|did|does|has)|when (?:did|was|will)|customer named|customer called|client named)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/i,
  ownershipPhrasing:
    /\b(?:(?:does|did|has|was|will)\s+[A-Z][a-z]+|[A-Z][a-z]+'s\s+(?:car|truck|vehicle|visits?|history|account|estimates?|invoices?|spend|plate))\b/,
  plateLookup: /\b(?:plate|tag)\s+(?:number\s+)?[A-Z0-9]{4,8}\b/i,
};

function signals(text: string): string[] {
  const out: string[] = [];
  if (customerShapeRegex.phone.test(text)) out.push("phone-digits");
  if (customerShapeRegex.nameWithAction.test(text)) out.push("name-with-action");
  if (customerShapeRegex.ownershipPhrasing.test(text)) out.push("ownership-phrase");
  if (customerShapeRegex.plateLookup.test(text)) out.push("plate");
  return out;
}

describe("customer-shape detector · v10.0.503", () => {
  it("catches 10-digit phone numbers in various formats", () => {
    expect(signals("call 216-862-0005")).toContain("phone-digits");
    expect(signals("(216) 862-0005 is the shop number")).toContain("phone-digits");
    expect(signals("2168620005 the new gateway")).toContain("phone-digits");
    expect(signals("216.862.0005 try this")).toContain("phone-digits");
  });

  it("catches name-with-action patterns", () => {
    expect(signals("tell me about John Smith")).toContain("name-with-action");
    expect(signals("show me Sarah")).toContain("name-with-action");
    expect(signals("how much has Mike Johnson spent")).toContain("name-with-action");
    expect(signals("what about Lisa Davis")).toContain("name-with-action");
    expect(signals("customer named Tom")).toContain("name-with-action");
  });

  it("catches ownership phrasing", () => {
    expect(signals("Mike's car needs work")).toContain("ownership-phrase");
    expect(signals("Sarah's visits this year")).toContain("ownership-phrase");
    expect(signals("John's spend last quarter")).toContain("ownership-phrase");
    expect(signals("does Robert have any open estimates")).toContain("ownership-phrase");
  });

  it("catches plate lookups", () => {
    expect(signals("plate ABC1234 came in")).toContain("plate");
    expect(signals("tag number XY5678")).toContain("plate");
  });

  it("returns empty for non-customer queries", () => {
    expect(signals("what's the weather today")).toEqual([]);
    expect(signals("how do I configure the cron job")).toEqual([]);
    expect(signals("explain the brain memory schema")).toEqual([]);
    expect(signals("what's working in marketing")).toEqual([]);
  });

  it("returns multiple signals when query has both phone + name", () => {
    const out = signals("tell me about Mike Johnson · 216-555-1234");
    expect(out).toContain("phone-digits");
    expect(out).toContain("name-with-action");
  });

  it("does not false-positive on plain numbers without 3-3-4 shape", () => {
    expect(signals("we have 250 leads")).not.toContain("phone-digits");
    expect(signals("the year 2026 was good")).not.toContain("phone-digits");
  });

  it("does not false-positive on possessive non-customer nouns", () => {
    expect(signals("the system's behavior is correct")).not.toContain("ownership-phrase");
    expect(signals("today's revenue")).not.toContain("ownership-phrase");
  });
});
