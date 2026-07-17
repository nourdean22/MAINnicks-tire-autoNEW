/**
 * Autonomy control plane (Wave A) — the deterministic policy engine that
 * decides before every costly or externally visible action. These tests are
 * the auditable spec: every DENY path, the approval matrix, and the default
 * posture that encodes today's real operating truth.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  DEFAULT_AUTONOMY_POLICY,
  evaluateAutonomyAction,
  validateAutonomyPolicyShape,
  type AutonomyPolicy,
} from "../client/src/lib/autonomyPolicy";

const policy = (over: Partial<AutonomyPolicy> = {}): AutonomyPolicy => ({
  ...DEFAULT_AUTONOMY_POLICY,
  ...over,
  emergencyControls: { ...DEFAULT_AUTONOMY_POLICY.emergencyControls, ...(over.emergencyControls ?? {}) },
  limits: { ...DEFAULT_AUTONOMY_POLICY.limits, ...(over.limits ?? {}) },
});

afterEach(() => {
  vi.doUnmock("./db");
  vi.resetModules();
});

describe("default posture", () => {
  it("encodes today's truth: produce mode, nothing auto-publishes, all risk flags require approval", () => {
    expect(DEFAULT_AUTONOMY_POLICY.operatingMode).toBe("produce");
    expect(Object.values(DEFAULT_AUTONOMY_POLICY.formatPermissions)).not.toContain("auto");
    expect(Object.values(DEFAULT_AUTONOMY_POLICY.alwaysRequireApproval).every(Boolean)).toBe(true);
    expect(DEFAULT_AUTONOMY_POLICY.emergencyControls.globalKillSwitch).toBe(false);
    expect(validateAutonomyPolicyShape(DEFAULT_AUTONOMY_POLICY)).toBe(true);
  });

  it("publish is DENIED under the default policy (mode produce < controlled_publish)", () => {
    const d = evaluateAutonomyAction(DEFAULT_AUTONOMY_POLICY, { type: "publish", format: "reel" });
    expect(d.decision).toBe("DENY");
    expect(d.reasoningCodes[0]).toMatch(/^MODE_FORBIDS:publish/);
  });
});

describe("kill switches are absolute", () => {
  it("global kill switch denies everything", () => {
    const p = policy({ emergencyControls: { ...DEFAULT_AUTONOMY_POLICY.emergencyControls, globalKillSwitch: true } });
    for (const type of ["generate_campaign", "enqueue_render", "schedule_post", "publish"] as const) {
      expect(evaluateAutonomyAction(p, { type }).reasoningCodes).toContain("GLOBAL_KILL_SWITCH");
    }
  });

  it("generation kill switch denies spend but not scheduling decisions", () => {
    const p = policy({
      operatingMode: "controlled_publish",
      emergencyControls: { ...DEFAULT_AUTONOMY_POLICY.emergencyControls, generationKillSwitch: true },
    });
    expect(evaluateAutonomyAction(p, { type: "enqueue_render" }).reasoningCodes).toContain("GENERATION_KILL_SWITCH");
    expect(evaluateAutonomyAction(p, { type: "publish", format: "reel" }).decision).not.toBe("DENY");
  });

  it("platform kill switch denies that platform only", () => {
    const p = policy({
      operatingMode: "controlled_publish",
      emergencyControls: { ...DEFAULT_AUTONOMY_POLICY.emergencyControls, platformKillSwitches: { instagram: true } },
    });
    expect(evaluateAutonomyAction(p, { type: "publish", format: "reel", platform: "instagram" }).reasoningCodes).toContain("PLATFORM_KILL_SWITCH:instagram");
    expect(evaluateAutonomyAction(p, { type: "publish", format: "reel", platform: "facebook" }).decision).not.toBe("DENY");
  });
});

describe("hard limits", () => {
  it("daily budget denies before the spend, counting the new action's cost", () => {
    const d = evaluateAutonomyAction(DEFAULT_AUTONOMY_POLICY, {
      type: "enqueue_render",
      estimatedCostUsd: 2,
      today: { generationCostUsd: 9 },
    });
    expect(d.reasoningCodes).toContain("BUDGET_DAILY_EXCEEDED");
  });

  it("feed cadence cap and spacing deny publishes", () => {
    const p = policy({ operatingMode: "controlled_publish" });
    expect(
      evaluateAutonomyAction(p, { type: "publish", format: "reel", today: { feedPostsPublished: 2 } }).reasoningCodes,
    ).toContain("CADENCE_FEED_CAP");
    expect(
      evaluateAutonomyAction(p, { type: "publish", format: "reel", today: { hoursSinceLastFeedPost: 1 } }).reasoningCodes,
    ).toContain("CADENCE_SPACING");
  });

  it("repair and model-call caps deny", () => {
    expect(
      evaluateAutonomyAction(DEFAULT_AUTONOMY_POLICY, { type: "enqueue_render", today: { repairAttemptsForAsset: 2 } }).reasoningCodes,
    ).toContain("REPAIR_CAP");
    expect(
      evaluateAutonomyAction(DEFAULT_AUTONOMY_POLICY, { type: "generate_campaign", today: { modelCallsThisCampaign: 40 } }).reasoningCodes,
    ).toContain("MODEL_CALL_CAP");
  });
});

describe("minimum scores", () => {
  it("a measured score below its bar denies with the exact shortfall", () => {
    const d = evaluateAutonomyAction(DEFAULT_AUTONOMY_POLICY, {
      type: "enqueue_render",
      scores: { briefQuality: 65 },
    });
    expect(d.decision).toBe("DENY");
    expect(d.reasoningCodes).toContain("SCORE_BELOW_MIN:briefQuality:65<70");
  });

  it("scores at the bar pass", () => {
    const d = evaluateAutonomyAction(DEFAULT_AUTONOMY_POLICY, { type: "enqueue_render", scores: { briefQuality: 70 } });
    expect(d.decision).toBe("ALLOW");
  });
});

describe("approval matrix accumulates every reason", () => {
  it("risk flags + approval-required format collect into one REQUIRE_APPROVAL", () => {
    const p = policy({ operatingMode: "controlled_publish" });
    const d = evaluateAutonomyAction(p, {
      type: "publish",
      format: "reel",
      flags: { prices: true, safetyClaims: true },
    });
    expect(d.decision).toBe("REQUIRE_APPROVAL");
    expect(d.reasoningCodes).toEqual(expect.arrayContaining(["APPROVAL:prices", "APPROVAL:safetyClaims", "APPROVAL:format:reel"]));
  });

  it("manual format permission is a DENY, not an approval", () => {
    const p = policy({ operatingMode: "controlled_publish" });
    const d = evaluateAutonomyAction(p, { type: "publish", format: "paidAd" });
    expect(d.decision).toBe("DENY");
    expect(d.reasoningCodes).toContain("FORMAT_PERMISSION_MANUAL:paidAd");
  });

  it("clean in-policy generation is ALLOW with WITHIN_POLICY", () => {
    const d = evaluateAutonomyAction(DEFAULT_AUTONOMY_POLICY, { type: "generate_campaign" });
    expect(d).toEqual({ decision: "ALLOW", reasoningCodes: ["WITHIN_POLICY"], policyVersion: 1 });
  });
});

describe("service degradation", () => {
  it("getActivePolicy falls back to DEFAULT when storage is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: vi.fn().mockResolvedValue(null) }));
    vi.resetModules();
    const { getActivePolicy, clearPolicyCache } = await import("./services/autonomyControl");
    clearPolicyCache();
    const p = await getActivePolicy();
    expect(p.version).toBe(DEFAULT_AUTONOMY_POLICY.version);
    expect(p.operatingMode).toBe("produce");
  });
});
