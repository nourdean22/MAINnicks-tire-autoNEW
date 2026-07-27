/**
 * The emergency stop, extracted so the autonomous poster can share it.
 *
 * WHY IT WAS EXTRACTED RATHER THAN COPIED
 * `igAutopost` runs on cron with no human watching and does its own two-platform
 * dispatch. It cannot simply call publishToSocial without also inheriting the
 * feed cap, which is a live policy question (measured: the operator's policy
 * says maxFeedPostsPerDay 2; the autoposter has been doing 3/day). It CAN honour
 * the same stop — so the stop moved into a shared function instead of being
 * re-implemented, because two copies of a safety check drift.
 *
 * These tests pin two things:
 *   1. the guard's decisions, including that it FAILS OPEN, and
 *   2. that pulling it out of publishToSocial changed none of publishToSocial's
 *      behaviour. An extraction that silently alters the door is worse than the
 *      duplication it replaced.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

type Controls = {
  globalKillSwitch: boolean;
  generationKillSwitch: boolean;
  publishingKillSwitch: boolean;
  platformKillSwitches: Record<string, boolean>;
};
const OFF: Controls = {
  globalKillSwitch: false, generationKillSwitch: false,
  publishingKillSwitch: false, platformKillSwitches: {},
};

let controls: Controls = { ...OFF };
let source = "storage";
let throwOnRead = false;
const recordAuditEvent = vi.fn(async () => {});

vi.mock("./services/autonomyControl", () => ({
  getEmergencyControlsFresh: async () => {
    if (throwOnRead) throw new Error("storage exploded");
    return { controls, source };
  },
  recordAuditEvent: (...a: unknown[]) => recordAuditEvent(...(a as [])),
}));

const postToFacebook = vi.fn(async () => ({ success: true, postId: "fb_1" }));
const postToInstagram = vi.fn(async () => ({ success: true, postId: "ig_1" }));
vi.mock("./services/metaSocial", () => ({
  postToFacebook: (...a: unknown[]) => postToFacebook(...(a as [])),
  postToInstagram: (...a: unknown[]) => postToInstagram(...(a as [])),
  postInstagramReel: vi.fn(async () => ({ success: true })),
  postInstagramCarousel: vi.fn(async () => ({ success: true, postId: "ig_c" })),
  postInstagramStory: vi.fn(async () => ({ success: true })),
}));
// The cadence governor is a separate gate with its own tests and needs a DB.
vi.mock("./services/contentGovernor", () => ({ assertPublishCadence: async () => {} }));

import { killSwitchBlockedPlatforms, publishToSocial, KILL_SWITCH_ERROR } from "./services/socialPublish";

beforeEach(() => {
  controls = { ...OFF, platformKillSwitches: {} };
  source = "storage";
  throwOnRead = false;
  recordAuditEvent.mockClear();
  postToFacebook.mockClear();
  postToInstagram.mockClear();
});

describe("killSwitchBlockedPlatforms decides correctly", () => {
  it("blocks NOTHING when every switch is off — the measured live state", async () => {
    // This is why wiring igAutopost to it is a zero-behaviour-change edit today:
    // the live policy had all four false when this landed.
    await expect(killSwitchBlockedPlatforms(["instagram", "facebook"])).resolves.toEqual([]);
  });

  it("records NO audit event when it blocks nothing (a DENY log must mean a denial)", async () => {
    await killSwitchBlockedPlatforms(["instagram", "facebook"]);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });

  it("the global switch stops every platform", async () => {
    controls.globalKillSwitch = true;
    await expect(killSwitchBlockedPlatforms(["instagram", "facebook"])).resolves.toEqual(["instagram", "facebook"]);
  });

  it("the publishing switch stops every platform", async () => {
    controls.publishingKillSwitch = true;
    await expect(killSwitchBlockedPlatforms(["instagram", "facebook"])).resolves.toEqual(["instagram", "facebook"]);
  });

  it("a per-platform switch stops ONLY that platform", async () => {
    controls.platformKillSwitches = { instagram: true };
    await expect(killSwitchBlockedPlatforms(["instagram", "facebook"])).resolves.toEqual(["instagram"]);
  });

  it("writes a DENY audit event naming the switch that fired", async () => {
    controls.globalKillSwitch = true;
    await killSwitchBlockedPlatforms(["instagram"], { caller: "igAutopost" });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "publish",
      decision: "DENY",
      reasoningCodes: expect.arrayContaining(["GLOBAL_KILL_SWITCH", "platform:instagram"]),
      context: expect.objectContaining({ caller: "igAutopost" }),
    }));
  });

  it("distinguishes WHICH switch fired — publishing is not reported as global", async () => {
    controls.publishingKillSwitch = true;
    await killSwitchBlockedPlatforms(["facebook"]);
    const codes = recordAuditEvent.mock.calls[0][0].reasoningCodes as string[];
    expect(codes).toContain("PUBLISHING_KILL_SWITCH");
    expect(codes).not.toContain("GLOBAL_KILL_SWITCH");
  });

  it("FAILS OPEN when the switch state cannot be read", async () => {
    // Deliberate, and inherited from the original inline code: a storage blip
    // must not take publishing down. The caller's other gates still govern, and
    // publishToSocial logs the unverifiable state.
    throwOnRead = true;
    await expect(killSwitchBlockedPlatforms(["instagram", "facebook"])).resolves.toEqual([]);
    expect(recordAuditEvent).not.toHaveBeenCalled();
  });
});

describe("extracting it did not change publishToSocial", () => {
  it("a full block returns the switch error and never touches Meta", async () => {
    controls.globalKillSwitch = true;
    const { results } = await publishToSocial({ platforms: ["facebook", "instagram"], caption: "hi", imageUrl: "https://x/y.png" });
    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.success).toBe(false);
      expect(r.error).toBe(KILL_SWITCH_ERROR);
    }
    expect(postToFacebook).not.toHaveBeenCalled();
    expect(postToInstagram).not.toHaveBeenCalled();
  });

  it("a PARTIAL block still publishes the platform that is not stopped", async () => {
    // The original code rebuilt `input` with the remaining platforms. This is
    // the behaviour most likely to be lost in an extraction, so it is pinned.
    controls.platformKillSwitches = { instagram: true };
    const { results } = await publishToSocial({ platforms: ["facebook", "instagram"], caption: "hi", imageUrl: "https://x/y.png" });
    expect(postToFacebook).toHaveBeenCalledTimes(1);
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(results.find((r) => r.platform === "instagram")?.error).toBe(KILL_SWITCH_ERROR);
    expect(results.find((r) => r.platform === "facebook")?.success).toBe(true);
  });

  it("publishes normally when nothing is stopped", async () => {
    const { results } = await publishToSocial({ platforms: ["facebook"], caption: "hi", imageUrl: "https://x/y.png" });
    expect(postToFacebook).toHaveBeenCalledTimes(1);
    expect(results[0].success).toBe(true);
  });

  it("carries the Facebook link — the field whose absence created the bypass", async () => {
    await publishToSocial({ platforms: ["facebook"], caption: "hi", link: "https://nickstire.org/tires" });
    expect(postToFacebook).toHaveBeenCalledWith(expect.objectContaining({ link: "https://nickstire.org/tires" }));
  });

  it("Instagram is unaffected by link (the Graph API has no link field for feed posts)", async () => {
    await publishToSocial({ platforms: ["instagram"], caption: "hi", imageUrl: "https://x/y.png", link: "https://nickstire.org" });
    expect(postToInstagram).toHaveBeenCalledWith({ imageUrl: "https://x/y.png", caption: "hi" });
  });
});
