/**
 * R3-16 item 7 (review R3 wave A, finding 8) - maskPii runs on the processor's
 * STRINGIFIED span data. Its bare-digit arm turned a JSON number into a bare
 * [PHONE] token ({"startedAt":[PHONE]}), so the payload stopped being JSON and
 * Langfuse showed the whole input/output as raw text. Masking must keep a JSON
 * payload valid JSON and still drop the PII.
 */
import { describe, expect, it } from "vitest";

import { maskLangfuseData } from "@/lib/observability/langfuse";

const mask = (s: string) => maskLangfuseData(s) as string;

describe("maskLangfuseData - a JSON payload stays JSON", () => {
  it("a numeric 13-digit value is masked and the payload still parses", () => {
    const out = mask(JSON.stringify({ startedAt: 1728600000000, tokens: 1234 }));
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out)).toEqual({ startedAt: "[PHONE]", tokens: 1234 });
  });

  it("a numeric phone beside a string phone and an email: all masked, still JSON", () => {
    const out = mask(JSON.stringify({ phone: 2165550100, note: "call 216-555-0100", list: [{ to: "pat@vendor.example", n: 12165550100 }] }));
    const parsed = JSON.parse(out);
    expect(out).not.toContain("2165550100");
    expect(out).not.toContain("216-555-0100");
    expect(out).not.toContain("pat@vendor.example");
    expect(parsed.list[0].n).toBe("[PHONE]");
  });

  it("CONTROL - JSON with PII only inside strings keeps its exact formatting", () => {
    const text = '{\n  "phone": "2165550100",\n  "ok": true\n}';
    expect(mask(text)).toBe('{\n  "phone": "[PHONE]",\n  "ok": true\n}');
  });

  it("CONTROL - JSON with no PII is returned byte-identical", () => {
    const text = '{ "similarity": 0.8723456789012, "count": 120, "big": 12345678901234567890123 }';
    expect(mask(text)).toBe(text);
  });

  it("CONTROL - plain text is masked as before", () => {
    expect(mask("call 2165550100 today")).toBe("call [PHONE] today");
  });
});
