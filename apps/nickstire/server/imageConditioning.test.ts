/**
 * Image conditioning (milestone 6) — the identity-drift killer's arg builder.
 * The baseline's worst visual failure was independent per-beat generation with
 * no shared anchor; --start-image anchors each clip. Flag-gated until a paid
 * seedance image-render proves it live.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildSeedanceArgs } from "./services/higgsfieldStudio";

const prev = process.env.REEL_IMAGE_CONDITIONING;
afterEach(() => {
  if (prev === undefined) delete process.env.REEL_IMAGE_CONDITIONING;
  else process.env.REEL_IMAGE_CONDITIONING = prev;
});

describe("buildSeedanceArgs", () => {
  it("is text-only when the flag is off, even with a start image (prod-safe default)", () => {
    delete process.env.REEL_IMAGE_CONDITIONING;
    const args = buildSeedanceArgs("a battery", { startImageUrl: "https://x/hero.jpg" });
    expect(args).not.toContain("--start-image");
    expect(args).toContain("--prompt");
    expect(args.slice(0, 3)).toEqual(["generate", "create", "seedance1_5"]);
    expect(args).toContain("--wait");
    expect(args).toContain("--json");
  });

  it("appends --start-image ONLY when the flag is on AND an image is supplied", () => {
    process.env.REEL_IMAGE_CONDITIONING = "true";
    const args = buildSeedanceArgs("a battery", { startImageUrl: "https://x/hero.jpg" });
    const idx = args.indexOf("--start-image");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("https://x/hero.jpg");
    // image flag precedes the terminal --wait/--json
    expect(idx).toBeLessThan(args.indexOf("--wait"));
  });

  it("flag on but no image -> still text-only (nothing to anchor on)", () => {
    process.env.REEL_IMAGE_CONDITIONING = "true";
    expect(buildSeedanceArgs("a battery", {})).not.toContain("--start-image");
  });

  it("flag on but a NON-image URL (mp4 clip) is REJECTED — --start-image needs an image", () => {
    process.env.REEL_IMAGE_CONDITIONING = "true";
    // the exact bug the acceptance-campaign setup surfaced: a chained clip URL
    expect(buildSeedanceArgs("a battery", { startImageUrl: "https://cdn/x/clip-3.mp4" })).not.toContain("--start-image");
    // an actual image is accepted
    expect(buildSeedanceArgs("a battery", { startImageUrl: "https://cdn/x/hero.jpg" })).toContain("--start-image");
  });

  it("always emits the fixed 9:16 / 4s / 1080p contract the assembler expects", () => {
    const args = buildSeedanceArgs("x");
    expect(args).toEqual(expect.arrayContaining(["--aspect_ratio", "9:16", "--duration", "4", "--resolution", "1080p"]));
  });
});
