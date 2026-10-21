import { describe, expect, it } from "vitest";
import { jsonArray, transcriptCoverage } from "./conversationQuality";

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