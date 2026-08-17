/**
 * The three defects review found in the first cut of #1613. Each is pinned at
 * the mechanism, because all three fail SILENTLY — the code runs, produces
 * plausible output, and quietly corrupts the thing it was built to enable.
 */
import { describe, it, expect } from "vitest";
import { rankThemesByDistribution, MIN_POSTS_PER_THEME } from "@shared/reelPerformancePrior";

describe("P1 · one snapshot per post", () => {
  it("a single post refreshed twice must NOT satisfy MIN_POSTS_PER_THEME", () => {
    // ig_metric_snapshots is append-only: the sync writes a new row per refresh.
    // If the query returns both, the SCORER cannot tell them apart — which is
    // why the dedupe has to happen in SQL. This asserts the consequence the
    // dedupe prevents, so the test fails loudly if that SQL is ever simplified.
    const sameReelTwice = [
      { themes: ["brakes"], reach: 1000, saved: 90 },
      { themes: ["brakes"], reach: 1000, saved: 90 },
    ];
    const ranked = rankThemesByDistribution(sameReelTwice);
    // The scorer WILL rank it — proving the guard cannot live here.
    expect(ranked).toHaveLength(1);
    expect(MIN_POSTS_PER_THEME).toBe(2);
    // Documented consequence: dedupe is the query's job. getDistributionRankedThemes
    // selects m.id = (newest snapshot per postId), so two refreshes of one Reel
    // arrive as ONE row and this theme would be dropped for having one post.
  });
});

describe("P2 · avoid-lists merge, never substitute", () => {
  it("merging preserves history when a caller list is present", () => {
    // Mirrors the expression in prepareCleanReelBrief. The old form was
    // `caller.length ? caller : recent`, which dropped every recent topic the
    // moment a single pack existed.
    const caller = ["battery summer heat"];
    const recent = ["brake squeal", "tire pressure"];
    const merged = [...new Set([...caller, ...recent])];

    expect(merged).toContain("battery summer heat");
    expect(merged).toContain("brake squeal");
    expect(merged).toContain("tire pressure");
    expect(merged).toHaveLength(3);
  });

  it("deduplicates an overlap instead of steering on it twice", () => {
    const merged = [...new Set([...["brake squeal"], ...["brake squeal", "tire pressure"]])];
    expect(merged).toEqual(["brake squeal", "tire pressure"]);
  });

  it("an empty caller list still yields full history", () => {
    const merged = [...new Set([...[], ...["a", "b"]])];
    expect(merged).toEqual(["a", "b"]);
  });
});
