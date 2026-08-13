/**
 * NT-002 · getReelGenerationSignal is REELS-first with a DISCLOSED fallback.
 *
 * The defect this pins (flagged 2026-07-31, fixed 2026-08-13): the reel
 * generator's performance feedback ranked the top-8 posts by engagementRate
 * with no media filter — measured 5/8 of the "reel" training signal was
 * carousels/images, so reel briefs were being steered by the save-optimised
 * behaviors of a different format. The load-bearing assertions here are the
 * QUERY SHAPE (reels filtered first) and the HONESTY of the fallback
 * (`signalSource` says which population taught the themes).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

let database: unknown = null;

vi.mock("./lib/db-helper", () => ({
  db: async () => database,
  dbTyped: async () => database,
  requireDb: async () => database,
}));

vi.mock("./instagram", () => ({
  getInstagramPosts: async () => [],
  getInstagramAccount: async () => null,
  writeInstagramCache: vi.fn(),
}));

vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn(async () => {
    throw new Error("no LLM provider in tests");
  }),
}));

import { getReelGenerationSignal, MIN_REEL_SIGNAL_ROWS, pickTopThemes } from "./pipelines/instagram-data";

/**
 * Minimal awaitable drizzle-chain stub. Every builder method returns the
 * chain; awaiting it resolves rows chosen by which methods were called:
 *   groupBy → the best-posting-times aggregate (empty here — not under test)
 *   where   → the REELS-filtered query
 *   neither → the unfiltered all-media query
 */
function makeDb(reelRows: unknown[], allRows: unknown[]) {
  const select = () => {
    const flags = { where: false, groupBy: false };
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit", "groupBy", "having"]) {
      c[m] = (..._args: unknown[]) => {
        if (m === "where") flags.where = true;
        if (m === "groupBy") flags.groupBy = true;
        return c;
      };
    }
    (c as { then: unknown }).then = (
      resolve: (rows: unknown[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => {
      const rows = flags.groupBy ? [] : flags.where ? reelRows : allRows;
      return Promise.resolve(rows).then(resolve, reject);
    };
    return c;
  };
  return { select };
}

const reelThemed = (theme: string) => ({ themesJson: JSON.stringify([theme]) });

afterEach(() => {
  database = null;
});

describe("getReelGenerationSignal (NT-002)", () => {
  it("uses ONLY reel rows when enough exist, and says so", async () => {
    database = makeDb(
      Array.from({ length: MIN_REEL_SIGNAL_ROWS }, () => reelThemed("winter tires")),
      Array.from({ length: 8 }, () => reelThemed("carousel bait")),
    );
    const sig = await getReelGenerationSignal();
    expect(sig.signalSource).toBe("reels");
    expect(sig.topThemes).toContain("winter tires");
    // The contamination this fix removes: all-media themes must NOT leak in.
    expect(sig.topThemes).not.toContain("carousel bait");
  });

  it("falls back to all-media below the floor — DISCLOSED, never silent", async () => {
    database = makeDb(
      Array.from({ length: MIN_REEL_SIGNAL_ROWS - 1 }, () => reelThemed("reel only")),
      Array.from({ length: 8 }, () => reelThemed("all media")),
    );
    const sig = await getReelGenerationSignal();
    expect(sig.signalSource).toBe("all_media");
    expect(sig.topThemes).toContain("all media");
  });

  it("degrades to none without a database (defaults keep zero behavior change)", async () => {
    database = null;
    const sig = await getReelGenerationSignal();
    expect(sig).toEqual({ topThemes: [], bestPostHour: null, signalSource: "none" });
  });
});

// ── Phase 5.4 · pickTopThemes (pre-existing suite, kept verbatim) ───────────
describe("pickTopThemes (Phase 5.4 feedback)", () => {
  it("ranks themes by frequency, most-frequent first", () => {
    const rows = [
      { themesJson: JSON.stringify(["promo", "seasonal"]) },
      { themesJson: JSON.stringify(["promo", "educational"]) },
      { themesJson: JSON.stringify(["promo"]) },
    ];
    expect(pickTopThemes(rows)).toEqual(["promo", "seasonal", "educational"]);
    expect(pickTopThemes(rows)[0]).toBe("promo");
  });

  it("skips the no-caption sentinel and tolerates bad/null JSON", () => {
    const rows = [
      { themesJson: "not json at all" },
      { themesJson: null },
      { themesJson: JSON.stringify(["no-caption", "brakes"]) },
    ];
    expect(pickTopThemes(rows)).toEqual(["brakes"]);
  });

  it("returns [] for empty input (no analytics data yet)", () => {
    expect(pickTopThemes([])).toEqual([]);
  });

  it("caps to the requested limit", () => {
    const rows = [{ themesJson: JSON.stringify(["a", "b", "c", "d", "e"]) }];
    expect(pickTopThemes(rows, 3)).toHaveLength(3);
  });
});
