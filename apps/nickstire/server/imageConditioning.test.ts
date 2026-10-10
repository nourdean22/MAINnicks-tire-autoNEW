/**
 * Image conditioning (milestone 6) — the identity-drift killer's arg builder.
 * The baseline's worst visual failure was independent per-beat generation with
 * no shared anchor; --start-image anchors each clip. Flag-gated until a paid
 * seedance image-render proves it live.
 */
import { afterEach, describe, expect, it } from "vitest";
import { buildSeedanceArgs, resolveClipModel } from "./services/higgsfieldStudio";

const prev = process.env.REEL_IMAGE_CONDITIONING;
afterEach(() => {
  if (prev === undefined) delete process.env.REEL_IMAGE_CONDITIONING;
  else process.env.REEL_IMAGE_CONDITIONING = prev;
});

describe("buildSeedanceArgs — REEL_CLIP_MODEL (2026-10-10)", () => {
  afterEach(() => { delete process.env.REEL_CLIP_MODEL; });
  it("defaults to seedance1_5 when the variable is unset or empty", () => {
    delete process.env.REEL_CLIP_MODEL;
    expect(buildSeedanceArgs("x").slice(0, 3)).toEqual(["generate", "create", "seedance1_5"]);
    process.env.REEL_CLIP_MODEL = "  ";
    expect(buildSeedanceArgs("x")[2]).toBe("seedance1_5");
  });
  it("renders with an allowlisted model and keeps the rest of the request identical", () => {
    process.env.REEL_CLIP_MODEL = "seedance_2_5";
    const a = buildSeedanceArgs("x");
    expect(a.slice(0, 3)).toEqual(["generate", "create", "seedance_2_5"]);
    expect(a).toContain("--resolution");
    expect(a[a.indexOf("--resolution") + 1]).toBe("1080p");
    expect(a[a.indexOf("--aspect_ratio") + 1]).toBe("9:16");
    process.env.REEL_CLIP_MODEL = "kling3_0_turbo";
    expect(buildSeedanceArgs("x")[2]).toBe("kling3_0_turbo");
  });
  it("a model that is not allowlisted never reaches the CLI — the default renders instead", () => {
    process.env.REEL_CLIP_MODEL = "seedance_9";
    expect(buildSeedanceArgs("x")[2]).toBe("seedance1_5");
    expect(resolveClipModel({ REEL_CLIP_MODEL: "sora2" } as NodeJS.ProcessEnv)).toBe("seedance1_5");
  });
  it("seedance_2_5 names its mode: omni_reference with a start image, t2v without; bitrate high (CLI exit 4 on job 2070004)", () => {
    process.env.REEL_CLIP_MODEL = "seedance_2_5";
    process.env.REEL_IMAGE_CONDITIONING = "true";
    const withImage = buildSeedanceArgs("x", { startImageUrl: "https://x/hero.jpg" });
    expect(withImage[withImage.indexOf("--mode") + 1]).toBe("omni_reference");
    expect(withImage).toContain("--start-image");
    expect(withImage[withImage.indexOf("--bitrate_mode") + 1]).toBe("high");
    expect(withImage.indexOf("--mode")).toBeLessThan(withImage.indexOf("--json"));
    const textOnly = buildSeedanceArgs("x", {});
    expect(textOnly[textOnly.indexOf("--mode") + 1]).toBe("t2v");
    delete process.env.REEL_IMAGE_CONDITIONING;
    // flag off: no start image reaches the CLI, so the mode must be t2v even when a URL is offered
    expect(buildSeedanceArgs("x", { startImageUrl: "https://x/hero.jpg" })).toContain("t2v");
    // the incumbent model has no --mode flag; never send one
    process.env.REEL_CLIP_MODEL = "seedance1_5";
    expect(buildSeedanceArgs("x", { startImageUrl: "https://x/hero.jpg" })).not.toContain("--mode");
  });

  it("an explicit model argument wins over the environment", () => {
    process.env.REEL_CLIP_MODEL = "seedance_2_5";
    expect(buildSeedanceArgs("x", { model: "seedance1_5" })[2]).toBe("seedance1_5");
  });
});

describe("buildSeedanceArgs", () => {
  it("is text-only when the flag is off, even with a start image (prod-safe default)", () => {
    delete process.env.REEL_IMAGE_CONDITIONING;
    const args = buildSeedanceArgs("a battery", { startImageUrl: "https://x/hero.jpg" });
    expect(args).not.toContain("--start-image");
    expect(args).toContain("--prompt");
    expect(args.slice(0, 3)).toEqual(["generate", "create", "seedance1_5"]);
    // --wait is gone on purpose (2026-10-10, B1): the create returns a job id
    // that is polled through `generate get`, so a timeout holds a handle.
    expect(args).not.toContain("--wait");
    expect(args).toContain("--json");
  });

  it("appends --start-image ONLY when the flag is on AND an image is supplied", () => {
    process.env.REEL_IMAGE_CONDITIONING = "true";
    const args = buildSeedanceArgs("a battery", { startImageUrl: "https://x/hero.jpg" });
    const idx = args.indexOf("--start-image");
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe("https://x/hero.jpg");
    // image flag precedes the terminal --json
    expect(idx).toBeLessThan(args.indexOf("--json"));
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
