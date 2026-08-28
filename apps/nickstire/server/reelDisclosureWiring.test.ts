/**
 * The AI-disclosure flag must actually REACH Meta, not merely exist as a
 * parameter.
 *
 * WHAT THIS PINS. `postInstagramReel` gained an optional `isAiGenerated` that
 * adds Meta's `is_ai_generated` to the REELS container - and the sole production
 * caller in `publishToSocial` did not pass it. The parameter type-checked, the
 * unit canaries on the gate passed, and every generated reel would still have
 * published with NO structured disclosure under a policy that permits penalties.
 * An optional field at a choke point is off by default, and "off by default" is
 * indistinguishable from "not implemented" once it ships.
 *
 * So the assertion here is on the ARGUMENT ACTUALLY RECEIVED by the Meta call,
 * not on the shape of the function that would receive it.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const postInstagramReelMock = vi.fn(async () => ({ success: true, postId: "ig-test-1" }));

vi.mock("./services/metaSocial", async (importOriginal) => {
  const real = await importOriginal<typeof import("./services/metaSocial")>();
  return { ...real, postInstagramReel: (...a: unknown[]) => postInstagramReelMock(...a) };
});

import { publishToSocial } from "./services/socialPublish";

const CLEAN_CAPTION = "Three signs a wheel bearing is failing. Stop by when you are ready.";
const VIDEO = "https://nickstire.org/generated/reels/reel-test.mp4";

describe("is_ai_generated reaches the Meta call", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REEL_PUBLISH_ENABLED = "true";
  });

  it("forwards isAiGenerated=true through publishToSocial to postInstagramReel", async () => {
    await publishToSocial({
      platforms: ["instagram"],
      videoUrl: VIDEO,
      caption: CLEAN_CAPTION,
      actor: "operator",
      isAiGenerated: true,
    });
    expect(postInstagramReelMock).toHaveBeenCalledTimes(1);
    const arg = postInstagramReelMock.mock.calls[0][0] as { isAiGenerated?: boolean };
    expect(arg.isAiGenerated).toBe(true);
  });

  // POSITIVE CONTROL: real footage must NOT be labelled as AI. A wiring that
  // hard-coded true would pass the test above and mislabel every real reel.
  it("does NOT set the flag for real footage", async () => {
    await publishToSocial({
      platforms: ["instagram"],
      videoUrl: VIDEO,
      caption: CLEAN_CAPTION,
      actor: "operator",
      isAiGenerated: false,
    });
    const arg = postInstagramReelMock.mock.calls[0]?.[0] as { isAiGenerated?: boolean };
    expect(arg?.isAiGenerated).toBe(false);
  });

  it("omitting the flag reaches the boundary as undefined, never silently true", async () => {
    await publishToSocial({ platforms: ["instagram"], videoUrl: VIDEO, caption: CLEAN_CAPTION, actor: "operator" });
    const arg = postInstagramReelMock.mock.calls[0]?.[0] as { isAiGenerated?: boolean };
    expect(arg?.isAiGenerated).toBeUndefined();
  });
});
