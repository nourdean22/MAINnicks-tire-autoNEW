/**
 * Plain words for a review row (job 2026-10-25-attribution-self-learning).
 *
 * vapi_call_logs.customerName is empty on every one of 5,355 calls (measured 2026-10-25),
 * so the person's name comes from the matched invoice, through the house greetingName
 * rules ("AIKEN, DAVID" reads David; "Unknown" and a business read as no name). What the
 * caller asked for is the call's serviceMention, else the first sentence of the AI summary.
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
  it("prefers the recorded service mention", () => {
    expect(askedForWords("brake pads", "Caller asked about tires.")).toBe("brake pads");
  });

  it("falls back to the first sentence of the summary, capped, no trailing period", () => {
    const summary = "Caller asked about an oil change and pricing. They said they would come Thursday.";
    expect(askedForWords("  ", summary)).toBe("Caller asked about an oil change and pricing");
    expect(askedForWords(null, "x".repeat(200))!.length).toBeLessThanOrEqual(90);
  });

  it("treats placeholder mentions as no mention", () => {
    expect(askedForWords("unknown", "Caller asked about a tire rotation.")).toBe("Caller asked about a tire rotation");
    expect(askedForWords("general inquiry", null)).toBeNull();
    expect(askedForWords(null, null)).toBeNull();
  });
});
