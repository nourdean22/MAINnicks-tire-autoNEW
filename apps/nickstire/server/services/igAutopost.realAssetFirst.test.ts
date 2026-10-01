/**
 * igAutopost image selection — §K.3 real-asset-first.
 *
 * `selectPostImage` is the one seam runIgAutopost calls for pixels. The
 * real-asset lookup is mocked at the module boundary (so this proves
 * igAutopost actually imports and consults it); provider resolution and
 * generation are injected so no DB, poster renderer or image provider runs.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const { findRealAssetFor } = vi.hoisted(() => ({ findRealAssetFor: vi.fn() }));
vi.mock("./realAssetFirst", () => ({ findRealAssetFor, REAL_ASSET_MIN_SCORE: 0.6 }));

import { selectPostImage } from "./igAutopost";

const post = { caption: "Grinding when you brake?\nThat is metal on metal.", imagePrompt: "scored brake rotor on a lift", visualConcept: "rotor close-up", conceptKey: "grinding-brakes" };
const matched = (mimeType: string) => ({
  state: "matched",
  match: { assetId: "ma_rotor", runtimeUrl: `https://cdn.example/rotor.${mimeType === "image/png" ? "png" : "jpg"}`, mimeType, score: 0.83, why: ["subject rotor matches"], enrichment: {} },
  why: ["need: subjects=rotor service=/brakes", "subject rotor matches", "score 0.83 ≥ 0.6"],
});
const posterOut = { url: "https://cdn.example/poster.jpg", format: "jpeg" as const, kind: "poster" as const };
const aiOut = { url: "https://cdn.example/ai.jpg", format: "jpeg" as const, kind: "ai" as const };

afterEach(() => { findRealAssetFor.mockReset(); });

describe("selectPostImage", () => {
  it("POSITIVE CONTROL: AI provider + matched real asset → kind real, asset url, NO generation", async () => {
    findRealAssetFor.mockResolvedValue(matched("image/jpeg"));
    const generate = vi.fn(async () => aiOut);
    const image = await selectPostImage(post, { resolveProvider: async () => "gemini", generate });
    expect(image).toMatchObject({ kind: "real", url: "https://cdn.example/rotor.jpg", realAssetId: "ma_rotor", format: "jpeg" });
    expect(image.why).toContain("subject rotor matches");
    expect(generate).not.toHaveBeenCalled();
    expect(findRealAssetFor).toHaveBeenCalledWith(
      expect.objectContaining({ topic: expect.stringContaining("grinding-brakes rotor close-up Grinding when you brake?") }),
      { minScore: 0.6 },
    );
  });

  it("a non-JPEG real asset is transcoded through the existing JPEG path", async () => {
    findRealAssetFor.mockResolvedValue(matched("image/png"));
    const toJpeg = vi.fn(async () => "https://cdn.example/rotor-converted.jpg");
    const image = await selectPostImage(post, { resolveProvider: async () => "gemini", generate: vi.fn(async () => aiOut), toJpeg });
    expect(toJpeg).toHaveBeenCalledWith("https://cdn.example/rotor.png");
    expect(image).toMatchObject({ kind: "real", url: "https://cdn.example/rotor-converted.jpg" });
  });

  it("AI provider + no match → generates as before (passes the resolved provider through)", async () => {
    findRealAssetFor.mockResolvedValue({ state: "no_match", match: null, why: ["best 0.2 < 0.6"] });
    const generate = vi.fn(async () => aiOut);
    const image = await selectPostImage(post, { resolveProvider: async () => "gemini", generate });
    expect(image.kind).toBe("ai");
    expect(generate).toHaveBeenCalledWith(post.imagePrompt, { caption: post.caption, provider: "gemini" });
  });

  it("a pool-read ERROR falls through to generation (the post is never imageless) — but is not 'no match'", async () => {
    findRealAssetFor.mockResolvedValue({ state: "error", match: null, why: [], error: "ECONNRESET" });
    const generate = vi.fn(async () => aiOut);
    expect((await selectPostImage(post, { resolveProvider: async () => "openai", generate })).kind).toBe("ai");
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("poster default (adrender) never consults the pool — unchanged behaviour", async () => {
    const generate = vi.fn(async () => posterOut);
    const image = await selectPostImage(post, { resolveProvider: async () => "adrender", generate });
    expect(image.kind).toBe("poster");
    expect(findRealAssetFor).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledWith(post.imagePrompt, { caption: post.caption, provider: "adrender" });
  });

  it("a matched asset that cannot be prepared (transcode throws) falls back to generation", async () => {
    findRealAssetFor.mockResolvedValue(matched("image/heic"));
    const generate = vi.fn(async () => aiOut);
    const image = await selectPostImage(post, { resolveProvider: async () => "gemini", generate, toJpeg: async () => { throw new Error("heic unsupported"); } });
    expect(image.kind).toBe("ai");
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
