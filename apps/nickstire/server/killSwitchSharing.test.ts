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
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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

  /**
   * UNKNOWABLE STATE SPLITS BY ACTOR.  (Review catch, P1.)
   *
   * The first version of this guard failed OPEN for everyone — inherited from
   * the inline code it replaced. For a human publishing by hand that is right:
   * they can see the situation and decide. For an unattended cron it is exactly
   * backwards, because a storage blip makes the operator's emergency stop
   * INVISIBLE to the one publisher nobody is watching — which is the precise
   * failure this whole change exists to prevent.
   *
   * autonomyControl already encodes the rule at its own boundary: "Automated
   * actors fail CLOSED; operators proceed loud."
   */
  describe("when the switch state cannot be read", () => {
    it("the OPERATOR proceeds — a storage blip must not take manual publishing down", async () => {
      throwOnRead = true;
      await expect(killSwitchBlockedPlatforms(["instagram", "facebook"], {}, "operator")).resolves.toEqual([]);
    });

    it("defaults to operator behaviour, so publishToSocial's callers are unchanged", async () => {
      throwOnRead = true;
      await expect(killSwitchBlockedPlatforms(["instagram", "facebook"])).resolves.toEqual([]);
    });

    it("the AUTOMATED caller STOPS — 'we could not check' is not a reason to publish", async () => {
      throwOnRead = true;
      await expect(killSwitchBlockedPlatforms(["instagram", "facebook"], {}, "automated"))
        .resolves.toEqual(["instagram", "facebook"]);
    });

    it("stops the automated caller when storage is merely UNREACHABLE, not throwing", async () => {
      // getEmergencyControlsFresh answers with defaults and flags the source.
      // The controls look all-off, which is indistinguishable from a real stop
      // sitting in storage — so the cron must not trust them.
      source = "fallback_unreachable";
      await expect(killSwitchBlockedPlatforms(["instagram"], {}, "automated")).resolves.toEqual(["instagram"]);
    });

    it("and the operator still proceeds in that same state", async () => {
      source = "fallback_unreachable";
      await expect(killSwitchBlockedPlatforms(["instagram"], {}, "operator")).resolves.toEqual([]);
    });

    it("audits the fail-closed stop with a code that says WHY", async () => {
      source = "fallback_unreachable";
      await killSwitchBlockedPlatforms(["instagram"], { caller: "igAutopost" }, "automated");
      expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
        decision: "DENY",
        reasoningCodes: expect.arrayContaining(["KILL_SWITCH_STATE_UNKNOWN"]),
      }));
    });

    it("a failing audit does NOT flip the stop back open", async () => {
      // The record is evidence, not the decision. If it were inside the same
      // try as the verdict, an audit outage would silently resume publishing.
      source = "fallback_unreachable";
      recordAuditEvent.mockRejectedValueOnce(new Error("audit sink down") as never);
      await expect(killSwitchBlockedPlatforms(["instagram", "facebook"], {}, "automated"))
        .resolves.toEqual(["instagram", "facebook"]);
    });
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

  /**
   * The actor now rides on PublishInput, so the unattended callers of the door
   * (the reel cron, the inventory queue drain) fail CLOSED on an unreadable
   * kill switch, exactly as igAutopost already did. Admin paths are untouched:
   * omitting `actor` still means "operator".
   */
  it("an AUTOMATED caller is stopped when the switch state is unreadable", async () => {
    throwOnRead = true;
    const { results } = await publishToSocial({
      platforms: ["instagram"], caption: "hi", imageUrl: "https://x/y.png", actor: "automated",
    });
    expect(postToInstagram).not.toHaveBeenCalled();
    expect(results[0].error).toBe(KILL_SWITCH_ERROR);
  });

  it("an OPERATOR caller still publishes in that same state", async () => {
    throwOnRead = true;
    await publishToSocial({ platforms: ["instagram"], caption: "hi", imageUrl: "https://x/y.png", actor: "operator" });
    expect(postToInstagram).toHaveBeenCalledTimes(1);
  });

  it("omitting actor keeps the OLD behaviour — no existing caller changes", async () => {
    throwOnRead = true;
    await publishToSocial({ platforms: ["instagram"], caption: "hi", imageUrl: "https://x/y.png" });
    expect(postToInstagram).toHaveBeenCalledTimes(1);
  });

  it("the actor does NOT override a real switch — automated still publishes when nothing is stopped", async () => {
    await publishToSocial({ platforms: ["instagram"], caption: "hi", imageUrl: "https://x/y.png", actor: "automated" });
    expect(postToInstagram).toHaveBeenCalledTimes(1);
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

describe("every unattended publishToSocial caller declares actor: automated", () => {
  /**
   * The actor rode onto PublishInput for the reel cron and the inventory
   * drain — and MISSED the scheduled-posts executor, which ran with the
   * operator default (fail-OPEN on unreadable switch state). This scan pins
   * every unattended caller so the next one cannot be missed silently.
   * Comments are stripped before counting: a source scan that reads its own
   * documentation has flagged prose as a defect three times in this repo.
   */
  const UNATTENDED_CALLERS = [
    "server/cron/jobs/dailyReelPost.ts",
    "server/services/scheduledPosts.ts",
  ];
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

  for (const rel of UNATTENDED_CALLERS) {
    it(`${rel} passes actor: "automated" on every publishToSocial call`, () => {
      const src = stripComments(readFileSync(resolve(process.cwd(), rel), "utf8"));
      const calls = src.match(/publishToSocial\(/g) ?? [];
      // Anti-vacuity: the caller must actually call the door, or this test
      // proves nothing about it.
      expect(calls.length).toBeGreaterThan(0);
      const declared = src.match(/actor:\s*"automated"/g) ?? [];
      expect(declared.length).toBe(calls.length);
    });
  }
});
