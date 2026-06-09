/**
 * Verifies the integration-failure message scrubber redacts secret/token-shaped
 * substrings before they reach the read-only admin Site-Health tile. (The raw
 * errorDetails payload is excluded at the query level; this guards errorMessage.)
 */
import { describe, it, expect } from "vitest";
import { scrubMessage } from "./integration-failures";

describe("scrubMessage — secret/token redaction", () => {
  it("redacts Bearer tokens", () => {
    const out = scrubMessage("auth failed: Bearer abc123XYZ_token.value rejected");
    expect(out).not.toContain("abc123XYZ_token.value");
    expect(out).toMatch(/redacted/i);
  });

  it("redacts key= / token: / secret= assignments", () => {
    expect(scrubMessage("request failed apiKey=sk_live_9999abcd0000")).toMatch(/redacted/i);
    expect(scrubMessage("token: AAAAfoobarbazqux")).toMatch(/redacted/i);
    expect(scrubMessage('access_token="zzzPRIVATEzzz"')).not.toContain("zzzPRIVATEzzz");
  });

  it("redacts Google-style API keys", () => {
    expect(scrubMessage("GET maps failed AIzaSyD-1234567890abcdefghijkl")).toContain("[redacted-key]");
  });

  it("redacts long hex runs (SID / hash / key shape)", () => {
    // deadbeef… is an obvious fake hex placeholder — NOT a provider-token shape,
    // so GitHub push-protection won't flag it — that still trips the 32+-hex rule.
    const out = scrubMessage("call id deadbeefdeadbeefdeadbeefdeadbeef failed");
    expect(out).toContain("[redacted-hash]");
    expect(out).not.toContain("deadbeefdeadbeefdeadbeefdeadbeef");
  });

  it("truncates to <= 160 chars", () => {
    expect(scrubMessage("x".repeat(500)).length).toBeLessThanOrEqual(160);
  });

  it("leaves an ordinary error message readable", () => {
    const out = scrubMessage("Google Sheets API quota exceeded (HTTP 429)");
    expect(out).toContain("quota exceeded");
    expect(out).toContain("429");
  });

  it("handles empty / non-string input safely", () => {
    expect(scrubMessage("")).toBe("");
    // @ts-expect-error — runtime guard for null
    expect(scrubMessage(null)).toBe("");
  });
});
