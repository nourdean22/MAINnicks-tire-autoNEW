import { describe, expect, it } from "vitest";
import { conversationSourceLabel, cutAtMarkerBoundary, isNonSpeechText, jsonArray, transcriptCoverage } from "./conversationQuality";

describe("conversationSourceLabel", () => {
  it("names each microphone in words and lets an unknown source name itself", () => {
    expect(conversationSourceLabel("eufy-office")).toBe("Office");
    expect(conversationSourceLabel("shop-floor")).toBe("Shop floor");
    expect(conversationSourceLabel("bay-3")).toBe("bay-3");
  });
});

describe("jsonArray", () => {
  it("accepts parsed arrays and JSON strings, but not malformed JSON", () => {
    expect(jsonArray([{ x: 1 }])).toHaveLength(1);
    expect(jsonArray('[{"x":1}]')).toHaveLength(1);
    expect(jsonArray("{not-json")).toEqual([]);
    expect(jsonArray({ x: 1 })).toEqual([]);
  });
});

describe("transcriptCoverage", () => {
  it("uses interval union so overlaps are not double-counted", () => {
    expect(transcriptCoverage([
      { start: 0, end: 5 },
      { start: 4, end: 10 },
    ], 20)).toBeCloseTo(0.5, 6);
  });

  it("distinguishes unknown duration from known zero coverage", () => {
    expect(transcriptCoverage([], null)).toBeNull();
    expect(transcriptCoverage([], 10)).toBe(0);
  });

  it("accepts transcript JSON strings and treats malformed strings as no coverage", () => {
    expect(transcriptCoverage('[{"start":1,"end":5}]', 10)).toBeCloseTo(0.4, 6);
    expect(transcriptCoverage("{bad", 10)).toBe(0);
  });

  it("clamps intervals to the clip bounds", () => {
    expect(transcriptCoverage([
      { start: -5, end: 4 },
      { start: 8, end: 20 },
    ], 10)).toBeCloseTo(0.6, 6);
  });
});

describe("transcriptCoverage: non-speech tokens are not covered speech (job 2026-10-21-shop-ears-v2, l)", () => {
  it("a clip of bangs with one short word does not read 94% covered", () => {
    const segs = [
      { start: 0, end: 4, text: "[BLANK_AUDIO]" },
      { start: 4, end: 7, text: " (banging) " },
      { start: 7, end: 9.4, text: "[MUSIC]" },
      { start: 9.4, end: 10, text: "okay" },
    ];
    expect(transcriptCoverage(segs, 10)).toBeCloseTo(0.06, 6);
  });

  it("CONTROL: real words still count, and a line mixing a token with words is speech", () => {
    expect(transcriptCoverage([{ start: 0, end: 5, text: "the tire is flat" }, { start: 5, end: 9, text: "(laughs) yeah it is" }], 10)).toBeCloseTo(0.9, 6);
  });

  it("an empty text is not speech either; a segment without a text field still counts as before", () => {
    expect(transcriptCoverage([{ start: 0, end: 5, text: "  " }], 10)).toBe(0);
    expect(transcriptCoverage([{ start: 0, end: 5 }], 10)).toBeCloseTo(0.5, 6);
  });
});

describe("isNonSpeechText: a sound tag, not any bracketed line (skeptic review of #3213, S5)", () => {
  it("short sound descriptions and whisper tags are noise", () => {
    for (const t of ["[BLANK_AUDIO]", "(door slams)", "[Music]", " (banging) ", "*engine revving*", "♪", ""]) expect(isNonSpeechText(t), t).toBe(true);
  });
  it("a speaker line or a long sentence in brackets is speech", () => {
    for (const t of ["(Customer: I'm going to Firestone)", "(the customer said they would come back next week)", "(laughs) yeah it is"]) expect(isNonSpeechText(t), t).toBe(false);
  });
});

describe("cutAtMarkerBoundary", () => {
  it("never leaves an (inferred: or [inaudible: open, and leaves short text alone", () => {
    expect(cutAtMarkerBoundary("short (inferred: x)", 300)).toBe("short (inferred: x)");
    const cut = cutAtMarkerBoundary("a".repeat(280) + " (inferred: a long guess that runs past the line)", 300);
    expect(cut.endsWith(" (cut)")).toBe(true);
    expect(cut).not.toContain("(inferred:");
    expect(cut.length).toBeLessThanOrEqual(300);
  });
});
