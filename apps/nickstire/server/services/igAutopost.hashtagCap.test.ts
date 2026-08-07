/**
 * IG autopost hashtag cap · doctrine test (2026-08-07).
 *
 * The defect: this lane's parse layer clamped at 12 while Instagram's real cap
 * has been 5 since Dec 2025. The reel lane was corrected in #1257; the autopost
 * lane — which publishes ~2x/day — was not, and the generator prompt actively
 * ASKED for "6-10 lowercase hashtags".
 *
 * Prod receipt (read-only probe, 2026-08-07): 60 of the last 60 posted rows
 * carried 7-10 tags. 100% over cap. Distribution 7=10 · 8=34 · 9=13 · 10=3.
 * Instagram either rejects the post or silently strips the excess, and silent
 * stripping is the worse branch because nothing downstream ever learns.
 *
 * These tests pin the CONSTANT SHARED with the reel lane, not a second copy —
 * a forked limit is exactly how the two lanes drifted apart.
 */
import { describe, expect, it } from "vitest";
import { INSTAGRAM_HASHTAG_CAP, validateHashtagCap } from "../../client/src/lib/facelessReelStudio";
import { normalizeHashtags } from "./igAutopost";

// The REAL implementation, not a copy. The first version of this file mirrored
// the clamp inline and stayed green when the cap was mutated back to 12 —
// a test that exercises a duplicate asserts nothing about the shipped code.
const clamp = (raw: string[]): string[] => normalizeHashtags(raw).hashtags;

describe("igAutopost hashtag cap", () => {
  it("the cap is 5 and is the SAME constant the reel lane validates against", () => {
    expect(INSTAGRAM_HASHTAG_CAP).toBe(5);
    // If the two lanes ever fork again, this is the assertion that catches it.
    expect(validateHashtagCap(Array.from({ length: INSTAGRAM_HASHTAG_CAP }, (_, i) => `#t${i}`)).ok).toBe(true);
    expect(validateHashtagCap(Array.from({ length: INSTAGRAM_HASHTAG_CAP + 1 }, (_, i) => `#t${i}`)).ok).toBe(false);
  });

  it.each([
    ["the 10-tag shape posted on 2026-08-07 (rows 5100001, 5070001)", 10],
    ["the 8-tag modal shape (34 of the last 60)", 8],
    ["the 7-tag floor observed in prod", 7],
  ])("clamps %s to the cap", (_label, n) => {
    const raw = Array.from({ length: n }, (_, i) => `#tag${i}`);
    const out = clamp(raw);
    expect(out).toHaveLength(INSTAGRAM_HASHTAG_CAP);
    expect(validateHashtagCap(out).ok).toBe(true);
  });

  // The false-positive half matters more than the true-positive half: a clamp
  // that mangles compliant output is worse than the defect it fixes.
  it("leaves compliant output untouched — 0 through 5 tags pass through verbatim", () => {
    for (let n = 0; n <= INSTAGRAM_HASHTAG_CAP; n++) {
      const raw = Array.from({ length: n }, (_, i) => `tag${i}`);
      expect(clamp(raw)).toEqual(raw);
    }
  });

  it("normalizes while clamping — strips '#', trims, lowercases", () => {
    expect(clamp(["#Cleveland", "  EuclidOhio ", "#NicksTireAuto"])).toEqual([
      "cleveland",
      "euclidohio",
      "nickstireauto",
    ]);
  });

  it("drops empties rather than counting them toward the cap", () => {
    // "#" alone normalizes to "" — if it counted, a real tag would be lost.
    expect(clamp(["#", "cleveland", "  ", "brakes"])).toEqual(["cleveland", "brakes"]);
  });

  it("REPORTS what it dropped — the whole point is that stripping stops being silent", () => {
    const raw = Array.from({ length: 9 }, (_, i) => `tag${i}`);
    const { hashtags, dropped } = normalizeHashtags(raw);
    expect(hashtags).toHaveLength(INSTAGRAM_HASHTAG_CAP);
    expect(dropped).toEqual(["tag5", "tag6", "tag7", "tag8"]);
    // Compliant input must report nothing dropped, or the log cries wolf.
    expect(normalizeHashtags(["a", "b"]).dropped).toEqual([]);
  });

  it("survives a non-array payload — the LLM is not a contract", () => {
    expect(normalizeHashtags(undefined)).toEqual({ hashtags: [], dropped: [] });
    expect(normalizeHashtags("cleveland")).toEqual({ hashtags: [], dropped: [] });
    expect(normalizeHashtags([null, "cleveland"]).hashtags).toEqual(["cleveland"]);
  });
});
