import { describe, expect, it, afterEach } from "vitest";
import { publishToSocial } from "./services/socialPublish";

/**
 * Phase-0 safety gate: publishToSocial is the single gated door to a live IG
 * Reel. Both assertions short-circuit BEFORE postInstagramReel, so no network
 * call is made. Proves an accidental live reel post is impossible unless the
 * operator explicitly arms REEL_PUBLISH_ENABLED AND the caption is claim-safe.
 */
describe("publishToSocial — reel publish gate", () => {
  const orig = process.env.REEL_PUBLISH_ENABLED;
  afterEach(() => {
    if (orig === undefined) delete process.env.REEL_PUBLISH_ENABLED;
    else process.env.REEL_PUBLISH_ENABLED = orig;
  });

  it("refuses a reel when REEL_PUBLISH_ENABLED is not 'true' (default OFF)", async () => {
    delete process.env.REEL_PUBLISH_ENABLED;
    const out = await publishToSocial({
      platforms: ["instagram"],
      caption: "Fresh set of tires going on today.",
      videoUrl: "https://example.com/reel.mp4",
    });
    const ig = out.results.find((r) => r.platform === "instagram");
    expect(ig?.success).toBe(false);
    expect(ig?.error).toContain("disabled");
  });

  it("refuses a reel whose caption contains a price even when armed", async () => {
    process.env.REEL_PUBLISH_ENABLED = "true";
    const out = await publishToSocial({
      platforms: ["instagram"],
      caption: "Full synthetic oil change only $39.99 this week!",
      videoUrl: "https://example.com/reel.mp4",
    });
    const ig = out.results.find((r) => r.platform === "instagram");
    expect(ig?.success).toBe(false);
    expect(ig?.error).toContain("claim-safety");
  });
});
