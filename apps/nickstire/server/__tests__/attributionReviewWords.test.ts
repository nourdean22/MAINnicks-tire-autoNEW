/**
 * Plain words for a review row (job 2026-10-25-attribution-self-learning).
 *
 * vapi_call_logs.customerName is empty on every one of 5,355 calls (measured 2026-10-25),
 * so the person's name comes from the matched invoice, through the house greetingName
 * rules ("AIKEN, DAVID" reads David; "Unknown" and a business read as no name). What the
 * caller asked for is the call's recorded serviceMention and nothing else: the free-text AI
 * summary can carry a name or a number, so it never reaches the browser (Codex on PR 3271).
 */
import { describe, expect, it } from "vitest";

import { askedForWords, firstNameWords } from "../lib/attributionReviewWords";

describe("firstNameWords", () => {
  it("takes the first word of a house greeting and refuses the 'there' fallback", () => {
    expect(firstNameWords("David Aiken")).toBe("David");
    expect(firstNameWords("Mary-Jo Smith")).toBe("Mary-Jo");
    expect(firstNameWords("there")).toBeNull();
    expect(firstNameWords("")).toBeNull();
  });
});

describe("askedForWords", () => {
  it("returns the recorded service mention, trimmed and capped", () => {
    expect(askedForWords("  brake  pads ")).toBe("brake pads");
    expect(askedForWords("x".repeat(200))!.length).toBe(90);
  });

  it("treats a placeholder or empty mention as no mention, never reaching for the summary", () => {
    expect(askedForWords("unknown")).toBeNull();
    expect(askedForWords("general inquiry")).toBeNull();
    expect(askedForWords(null)).toBeNull();
    expect(askedForWords.length).toBe(1);
  });
});
