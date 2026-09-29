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
