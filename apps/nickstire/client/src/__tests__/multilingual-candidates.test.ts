/**
 * selectMultilingualCandidates — a worklist selector, not an automation
 * trigger (verified: neither Meta's Reels translation nor YouTube auto-dub
 * exposes a programmatic per-video API this repo's automation can call).
 *
 * engagementRate fixtures are deliberately on the PERCENTAGE scale (5.0 =
 * 5%), matching what getTopPosts() actually returns — post-merge self-review
 * (2026-08-13) found the original fixtures used a 0-1 fraction production
 * data never produces, which hid a real double-scaling bug in the reason
 * string (a true 5.23% reel rendered "523.00%" to the operator).
 */
import { describe, it, expect } from "vitest";
import { selectMultilingualCandidates, type DubCandidateInput } from "../../../shared/multilingualCandidates";

function post(over: Partial<DubCandidateInput> = {}): DubCandidateInput {
  return {
    postId: "p1",
    mediaProductType: "REELS",
    caption: "some caption",
    engagementRate: 5,
    reach: 500,
    saved: 2,
    shares: 1,
    ...over,
  };
}

describe("selectMultilingualCandidates", () => {
  it("only considers REELS — a carousel/image winner is not a dub candidate", () => {
    const posts = [post({ postId: "img", mediaProductType: "IMAGE", engagementRate: 90 }), post({ postId: "reel" })];
    const c = selectMultilingualCandidates(posts);
    expect(c.map((x) => x.postId)).toEqual(["reel"]);
  });

  it("excludes a low-reach post even with a high engagement rate — not enough signal to trust", () => {
    const posts = [post({ postId: "thin", reach: 5, engagementRate: 99 }), post({ postId: "real", reach: 500, engagementRate: 5 })];
    const c = selectMultilingualCandidates(posts);
    expect(c.map((x) => x.postId)).toEqual(["real"]);
  });

  it("ranks by engagement rate, highest first, and respects the limit", () => {
    const posts = [post({ postId: "a", engagementRate: 3 }), post({ postId: "b", engagementRate: 8 }), post({ postId: "c", engagementRate: 5 })];
    const c = selectMultilingualCandidates(posts, { limit: 2 });
    expect(c.map((x) => x.postId)).toEqual(["b", "c"]);
  });

  it("attaches a human-readable reason citing the real numbers, WITHOUT re-scaling an already-percentage rate", () => {
    const c = selectMultilingualCandidates([post({ engagementRate: 5.23, reach: 800 })]);
    expect(c[0].reason).toContain("5.23%");
    expect(c[0].reason).not.toContain("523");
    expect(c[0].reason).toContain("800");
  });

  it("null reach is treated as zero — never assumed to qualify", () => {
    const c = selectMultilingualCandidates([post({ reach: null })]);
    expect(c).toHaveLength(0);
  });
});
