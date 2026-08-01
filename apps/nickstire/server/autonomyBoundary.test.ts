/**
 * Boundary enforcement + trajectory tests (the #814/#815 review lesson: unit
 * tests validated components, not the production path). These cover:
 * - visualWorld + genomeId surviving the SERVICE enqueue into the persisted
 *   reel-job payload (the exact place #814's feature previously died)
 * - actor semantics: operator approval vs cron fail-closed
 * - strict policy schema rejecting incomplete/invalid policies
 * - Cleveland day boundary
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveBoundaryOutcome, DEFAULT_AUTONOMY_POLICY } from "../client/src/lib/autonomyPolicy";
import { autonomyPolicyStrictSchema, clevelandDayStart } from "./services/autonomyControl";
import { SAMPLE_REEL_BRIEFS } from "../client/src/lib/facelessReelStudioSamples";
import { buildReferenceFramePrompt, compileLockedInvariants } from "./services/visualWorld";

afterEach(() => {
  vi.doUnmock("./db");
  vi.doUnmock("./services/autonomyControl");
  vi.resetModules();
});

describe("resolveBoundaryOutcome (actor semantics)", () => {
  const approval = { decision: "REQUIRE_APPROVAL" as const, reasoningCodes: ["APPROVAL:prices"], policyVersion: 1 };
  it("an operator's own tap satisfies REQUIRE_APPROVAL and is marked as such", () => {
    expect(resolveBoundaryOutcome(approval, "operator")).toBe("proceed_operator_approved");
  });
  it("cron and autonomous actors CANNOT satisfy REQUIRE_APPROVAL", () => {
    expect(resolveBoundaryOutcome(approval, "cron")).toBe("blocked");
    expect(resolveBoundaryOutcome(approval, "autonomous_system")).toBe("blocked");
  });
  it("DENY blocks every actor; ALLOW proceeds", () => {
    const deny = { decision: "DENY" as const, reasoningCodes: ["GLOBAL_KILL_SWITCH"], policyVersion: 1 };
    const allow = { decision: "ALLOW" as const, reasoningCodes: ["WITHIN_POLICY"], policyVersion: 1 };
    expect(resolveBoundaryOutcome(deny, "operator")).toBe("blocked");
    expect(resolveBoundaryOutcome(allow, "cron")).toBe("proceed");
  });
});

describe("strict policy schema (the #815 P2)", () => {
  it("accepts the DEFAULT policy", () => {
    expect(autonomyPolicyStrictSchema.safeParse(DEFAULT_AUTONOMY_POLICY).success).toBe(true);
  });
  it("rejects a policy missing a nested limits key (would silently drop the cap)", () => {
    const { maxGenerationCostPerDayUsd: _dropped, ...limits } = DEFAULT_AUTONOMY_POLICY.limits;
    const res = autonomyPolicyStrictSchema.safeParse({ ...DEFAULT_AUTONOMY_POLICY, limits });
    expect(res.success).toBe(false);
  });
  it("rejects negative limits, out-of-range scores, and unknown keys", () => {
    expect(
      autonomyPolicyStrictSchema.safeParse({
        ...DEFAULT_AUTONOMY_POLICY,
        limits: { ...DEFAULT_AUTONOMY_POLICY.limits, maxFeedPostsPerDay: -1 },
      }).success,
    ).toBe(false);
    expect(
      autonomyPolicyStrictSchema.safeParse({
        ...DEFAULT_AUTONOMY_POLICY,
        minimumScores: { ...DEFAULT_AUTONOMY_POLICY.minimumScores, briefQuality: 90 },
      }).success,
    ).toBe(false);
    expect(
      autonomyPolicyStrictSchema.safeParse({ ...DEFAULT_AUTONOMY_POLICY, surprise: true }).success,
    ).toBe(false);
  });
});

describe("clevelandDayStart", () => {
  it("returns the shop-local midnight for a known instant (EDT, UTC-4)", () => {
    // 2026-07-17 03:00 UTC = 2026-07-16 23:00 in Cleveland → day start = Jul 16 00:00 EDT = Jul 16 04:00 UTC
    const d = clevelandDayStart(new Date("2026-07-17T03:00:00Z"));
    expect(d.toISOString()).toBe("2026-07-16T04:00:00.000Z");
  });
  it("rolls the day at Cleveland midnight, not UTC midnight", () => {
    // 2026-07-17 05:00 UTC = 2026-07-17 01:00 EDT → day start = Jul 17 04:00 UTC
    const d = clevelandDayStart(new Date("2026-07-17T05:00:00Z"));
    expect(d.toISOString()).toBe("2026-07-17T04:00:00.000Z");
  });
});

describe("trajectory: visualWorld + genomeId survive the SERVICE enqueue into the persisted payload", () => {
  it("every prompt in the reel-job payload carries the locked invariants; genomeId persists", async () => {
    const base = SAMPLE_REEL_BRIEFS[0];
    const framePrompt = buildReferenceFramePrompt(base, "bold");
    // Mimic EXACTLY what the fixed router whitelist emits (briefClean + id):
    const briefClean = {
      id: "draft_test",
      campaignKeyword: base.campaignKeyword,
      topic: base.topic,
      storyboardBeats: base.storyboardBeats,
      hashtags: base.hashtags,
      selectedCaption: base.selectedCaption,
      sourceType: "manual",
      sourceNotes: base.sourceNotes,
      mechanicTruth: base.mechanicTruth,
      winningConceptId: base.winningConceptId,
      concepts: base.concepts,
      voiceoverScript: base.voiceoverScript,
      captionHooks: base.captionHooks,
      motionLens: base.motionLens,
      objectCharacter: base.objectCharacter,
      archetype: base.archetype,
      genomeId: "genome_trajectory_test",
      visualWorld: {
        style: "bold",
        heroFrameUrl: "https://img.test/hero.jpg",
        framePrompt,
        lockedInvariants: compileLockedInvariants(base, "bold", framePrompt),
      },
    };

    const captured: Array<Record<string, unknown>> = [];
    const fakeDb = {
      select: () => ({ from: () => ({ where: () => Promise.resolve([{ n: 0 }]) }) }),
      insert: () => ({ values: (v: Record<string, unknown>) => { captured.push(v); return Promise.resolve({ insertId: 42 }); } }),
    };
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(fakeDb) }));
    vi.resetModules();
    const { enqueueReelJob } = await import("./services/reelPipeline");

    const { jobId } = await enqueueReelJob(briefClean as never, "admin", {
      objective: "DISCOVERY", disclosureMode: "visibly_animated", ctaType: "NONE",
    });

    expect(jobId).toBe(42);
    const jobRow = captured.find((c) => typeof c.payload === "string");
    expect(jobRow).toBeTruthy();
    const payload = JSON.parse(jobRow!.payload as string);
    expect(payload.genomeId).toBe("genome_trajectory_test");
    expect(payload.visualWorld.heroFrameUrl).toBe("https://img.test/hero.jpg");
    expect(payload.promptPack.length).toBeGreaterThan(0);
    for (const beat of payload.promptPack) {
      expect(beat.prompt).toContain("operator-approved reference frame");
    }
  });

  it("cron enqueue FAILS CLOSED when kill-switch state is unverifiable (storage unreachable)", async () => {
    const throwingDb = {
      select: () => ({ from: () => ({ where: () => Promise.reject(new Error("conn refused")), orderBy: () => ({ limit: () => Promise.reject(new Error("conn refused")) }) }) }),
      insert: () => ({ values: () => Promise.resolve({ insertId: 1 }) }),
    };
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(throwingDb) }));
    vi.resetModules();
    const { enqueueReelJob } = await import("./services/reelPipeline");
    const base = SAMPLE_REEL_BRIEFS[0];
    await expect(enqueueReelJob({ ...base, id: "x" } as never, "cron", {
      objective: "DISCOVERY", disclosureMode: "visibly_animated", ctaType: "NONE",
    })).rejects.toThrow(/fail closed/);
  });
});
