/**
 * Keystone: the silent stock fallback is DEAD at the publish door.
 *
 * 2026-08-20 · Higgsfield stock-fallback remediation, Phase 2. During the
 * Higgsfield outage the pipeline silently substituted template-stock footage
 * and auto-published it — 7 stock reels reached Instagram, indistinguishable
 * from paid renders because nothing durable recorded the substitution.
 *
 * evaluateReelPublishGate is the ONE door every autonomous reel publish
 * routes through. This proves the unbypassable guard: a reel whose clips
 * carry the `template-stock` storage-path artifact can NEVER be published —
 * and the guard fires BEFORE the RENDERED_QA_ENABLED policy switch, so
 * turning QA off cannot wave a stock reel through. Asserts on the ARTIFACT
 * (the storage path the generator stamps), not a settable flag.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let clips: string | null = null;
vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ clips }],
        }),
      }),
    }),
  }),
}));

import { evaluateReelPublishGate, reelClipsIncludeStock } from "./services/qualityGate";

const STOCK = JSON.stringify([
  "https://cdn.example/reels/template-stock/20260817-beat-1.mp4",
  "https://cdn.example/reels/template-stock/20260817-beat-2.mp4",
]);
const HIGGSFIELD = JSON.stringify([
  "https://higgsfield.cdn/abc-1.mp4",
  "https://higgsfield.cdn/abc-2.mp4",
]);
const MIXED = JSON.stringify([
  "https://higgsfield.cdn/abc-1.mp4",
  "https://cdn.example/reels/template-stock/20260817-beat-2.mp4",
]);

describe("reelClipsIncludeStock — the artifact signal", () => {
  it("flags a template-stock storage path", () => {
    expect(reelClipsIncludeStock(STOCK)).toBe(true);
  });
  it("flags a reel where even ONE beat fell back", () => {
    expect(reelClipsIncludeStock(MIXED)).toBe(true);
  });
  it("passes real Higgsfield CDN clips", () => {
    expect(reelClipsIncludeStock(HIGGSFIELD)).toBe(false);
  });
  it("is null/parse-safe (no clips = not provably stock)", () => {
    expect(reelClipsIncludeStock(null)).toBe(false);
    expect(reelClipsIncludeStock("not json")).toBe(false);
    expect(reelClipsIncludeStock("{}")).toBe(false);
  });
});

describe("evaluateReelPublishGate — stock reels can never publish", () => {
  beforeEach(() => {
    clips = null;
    process.env.RENDERED_QA_ENABLED = "true";
  });

  it("BLOCKS a stock-substituted reel", async () => {
    clips = STOCK;
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("stock_fallback");
    expect(g.source).toBe("stock_guard");
    expect(g.reason).toMatch(/stock fallback is dead|regenerate/i);
  });

  it("BLOCKS a mixed reel where a single beat fell back", async () => {
    clips = MIXED;
    const g = await evaluateReelPublishGate(1);
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("stock_fallback");
  });

  it("the guard fires BEFORE RENDERED_QA_ENABLED — turning QA off cannot wave stock through", async () => {
    clips = STOCK;
    process.env.RENDERED_QA_ENABLED = "false";
    const g = await evaluateReelPublishGate(1);
    // Without the keystone, QA-disabled returns allowed:true; the guard wins.
    expect(g.allowed).toBe(false);
    expect(g.gate).toBe("stock_fallback");
  });

  it("does NOT block a real reel — a clean reel proceeds past the guard", async () => {
    clips = HIGGSFIELD;
    process.env.RENDERED_QA_ENABLED = "false"; // short-circuit to a clean allow after the guard
    const g = await evaluateReelPublishGate(1);
    expect(g.gate).not.toBe("stock_fallback");
    expect(g.allowed).toBe(true);
  });
});
