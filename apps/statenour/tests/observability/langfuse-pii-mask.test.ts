/**
 * 07-SN-08 (audit round 3) - Langfuse spans carry prompts, tool results and
 * replies, and those carry shop customers' phone numbers and email addresses.
 * maskLangfuseData redacted only API keys and bearer tokens.
 */
import { describe, expect, it } from "vitest";

import { maskLangfuseData } from "@/lib/observability/langfuse";

describe("maskLangfuseData - customer PII never leaves the process", () => {
  it.each([
    ["+1 216-555-0100", "call +1 216-555-0100 today"],
    ["(216) 555-0100", "call (216) 555-0100 today"],
    ["216.555.0100", "call 216.555.0100 today"],
    ["2165550100", '{"phone":"2165550100"}'],
    ["+12165550100", "to +12165550100"],
    ["a@b.co", "email a@b.co please"],
    ["pat.sender@vendor.example", "from pat.sender@vendor.example"],
    // red-team probe: an international number with a + was not masked
    ["+44 20 7946 0958", "call +44 20 7946 0958"],
  ])("drops %s", (needle, text) => {
    const out = maskLangfuseData(text) as string;
    expect(out).not.toContain(needle);
  });

  it("secrets are still masked first", () => {
    expect(maskLangfuseData("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123")).toBe("Authorization: Bearer [REDACTED]");
  });

  it("CONTROL - ordinary text, prices, dates and number lists are unchanged", () => {
    for (const text of [
      "brake pads $120",
      "the desk-lamp task-list is fine",
      "rotate tires at 5000 miles, 2 hours, 45 minutes",
      "2026-10-10 at 14:30",
      "120 130 140 150",
      // red-team probes: ids and scores in span metadata were masked as phones
      "id 123e4567-e89b-12d3-a456-426614174000",
      '{"similarity":0.8723456789012,"cost":0.0000123456789}',
      "version 10.0.529.106",
    ]) {
      expect(maskLangfuseData(text), text).toBe(text);
    }
  });

  it("a 1 MB blob with no '@' is masked in linear time", () => {
    const t = Date.now();
    maskLangfuseData("A".repeat(1_000_000));
    maskLangfuseData("1".repeat(1_000_000));
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
