import { beforeEach, describe, expect, it, vi } from "vitest";

const postInstagramReelMock = vi.fn(async () => ({ success: true, postId: "ig-trial-1" }));
const postToFacebookMock = vi.fn(async () => ({ success: true, postId: "fb-1" }));

vi.mock("./services/metaSocial", async (importOriginal) => {
  const real = await importOriginal<typeof import("./services/metaSocial")>();
  return {
    ...real,
    postInstagramReel: (...a: unknown[]) => postInstagramReelMock(...a),
    postToFacebook: (...a: unknown[]) => postToFacebookMock(...a),
  };
});

import { publishToSocial } from "./services/socialPublish";

const VIDEO = "https://nickstire.org/generated/reels/trial-test.mp4";
const CAPTION = "A Cleveland pothole can tell you a lot about alignment.";

describe("Trial Reel publish wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REEL_PUBLISH_ENABLED = "true";
  });

  it("forwards MANUAL trial mode through the shared publish choke point", async () => {
    const out = await publishToSocial({
      platforms: ["instagram"],
      videoUrl: VIDEO,
      caption: CAPTION,
      actor: "operator",
      trialReel: { graduationStrategy: "MANUAL" },
    });

    expect(out.igPostId).toBe("ig-trial-1");
    expect(postInstagramReelMock).toHaveBeenCalledTimes(1);
    expect(postInstagramReelMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      videoUrl: VIDEO,
      trialReel: { graduationStrategy: "MANUAL" },
    }));
  });

  it("fails closed before Meta when Trial mode attempts a Facebook cross-post", async () => {
    const out = await publishToSocial({
      platforms: ["instagram", "facebook"],
      videoUrl: VIDEO,
      caption: CAPTION,
      actor: "operator",
      trialReel: { graduationStrategy: "MANUAL" },
    });

    expect(out.results).toHaveLength(2);
    expect(out.results.every((r) => r.success === false)).toBe(true);
    expect(out.results.every((r) => /Instagram Reel video/.test(r.error ?? ""))).toBe(true);
    expect(postInstagramReelMock).not.toHaveBeenCalled();
    expect(postToFacebookMock).not.toHaveBeenCalled();
  });

  it("fails closed before Meta when Trial mode is attached to a Story", async () => {
    const out = await publishToSocial({
      platforms: ["instagram"],
      videoUrl: VIDEO,
      caption: CAPTION,
      isStory: true,
      actor: "operator",
      trialReel: { graduationStrategy: "MANUAL" },
    });

    expect(out.results[0]).toMatchObject({ platform: "instagram", success: false });
    expect(postInstagramReelMock).not.toHaveBeenCalled();
  });

  it("fails closed before Meta when Trial mode includes carousel media alongside the video", async () => {
    const out = await publishToSocial({
      platforms: ["instagram"],
      videoUrl: VIDEO,
      imageUrls: [
        "https://nickstire.org/generated/reels/frame-a.jpg",
        "https://nickstire.org/generated/reels/frame-b.jpg",
      ],
      caption: CAPTION,
      actor: "operator",
      trialReel: { graduationStrategy: "MANUAL" },
    });

    expect(out.results[0]).toMatchObject({
      platform: "instagram",
      success: false,
    });
    expect(out.results[0]?.error).toMatch(/exactly one Instagram Reel video/i);
    expect(postInstagramReelMock).not.toHaveBeenCalled();
  });

  it("fails closed before Meta when Trial mode includes a static image alongside the video", async () => {
    const out = await publishToSocial({
      platforms: ["instagram"],
      videoUrl: VIDEO,
      imageUrl: "https://nickstire.org/generated/reels/poster.jpg",
      caption: CAPTION,
      actor: "operator",
      trialReel: { graduationStrategy: "MANUAL" },
    });

    expect(out.results[0]).toMatchObject({
      platform: "instagram",
      success: false,
    });
    expect(postInstagramReelMock).not.toHaveBeenCalled();
  });

  it("leaves the ordinary Reel path unchanged when trial mode is omitted", async () => {
    await publishToSocial({
      platforms: ["instagram"],
      videoUrl: VIDEO,
      caption: CAPTION,
      actor: "operator",
    });

    expect(postInstagramReelMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      videoUrl: VIDEO,
    }));
    expect((postInstagramReelMock.mock.calls[0]?.[0] as { trialReel?: unknown }).trialReel).toBeUndefined();
  });
});
