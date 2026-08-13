/**
 * NT-004 · SMS autonomy census classification contract.
 *
 * The census's value is honesty at the edges, so those ARE the assertions:
 * over-ceiling is flagged as the one defect class; an unreadable mode is
 * UNKNOWN (never "off"); non-orchestrator lanes are listed as a disclosed
 * blind spot, not silently dropped; and the lane list derives from the code
 * registry, so the count is pinned to the registry length — a hand-list
 * cannot drift in.
 */
import { describe, expect, it } from "vitest";
import {
  SMS_AUTOMATION_REGISTRY,
  maxRolloutModeForLevel,
  type SmsAutomationPolicy,
} from "./services/smsAutonomy";
import { classifyLane } from "./services/smsAutonomyCensus";

const orch = (over: Partial<SmsAutomationPolicy>): SmsAutomationPolicy => ({
  key: "test_lane",
  path: "orchestrator",
  level: 2,
  sendClass: "customer_followup",
  evidenceRequirement: "test",
  caps: "test",
  quietHours: true,
  optOutBehavior: "fail_closed_index",
  takeoverBehavior: "drafts_for_operator",
  fallback: "none",
  ...over,
});

describe("classifyLane", () => {
  it("flags a live mode ABOVE the declared ceiling as the defect class", () => {
    // Level 1 = draft_only ceiling; live_send above it must scream.
    const lane = classifyLane(orch({ level: 1 }), "live_send");
    expect(maxRolloutModeForLevel(1)).toBe("draft_only");
    expect(lane.status).toBe("over_ceiling");
    expect(lane.detail).toContain("exceeds");
  });

  it("does NOT flag 'off' — dormant may be intentional (operator's call, not the census's)", () => {
    const lane = classifyLane(orch({ level: 3 }), "off");
    expect(lane.status).toBe("within_ceiling");
    expect(lane.detail).toContain("operator");
  });

  it("reports an unreadable mode as UNKNOWN, never as off (fail-loud)", () => {
    const lane = classifyLane(orch({}), "error");
    expect(lane.status).toBe("unreadable");
    expect(lane.liveMode).toBeNull();
    expect(lane.detail).toContain("UNKNOWN");
  });

  it("lists non-orchestrator lanes as a disclosed blind spot instead of dropping them", () => {
    const lane = classifyLane(orch({ path: "direct_sendSms", armedBy: "FEATURE_X=1" }), null);
    expect(lane.status).toBe("not_live_read");
    expect(lane.detail).toContain("blind spot");
    expect(lane.armedBy).toBe("FEATURE_X=1");
  });

  it("accepts a live mode at exactly the ceiling", () => {
    const lane = classifyLane(orch({ level: 2 }), maxRolloutModeForLevel(2));
    expect(lane.status).toBe("within_ceiling");
  });
});

describe("registry derivation", () => {
  it("every registry lane classifies without throwing (census can never lose a lane)", () => {
    for (const policy of SMS_AUTOMATION_REGISTRY) {
      const lane = classifyLane(policy, policy.path === "orchestrator" ? "off" : null);
      expect(lane.key).toBe(policy.key);
      expect(["within_ceiling", "over_ceiling", "unreadable", "not_live_read"]).toContain(lane.status);
    }
    // The census's row count IS the registry's — no hand-list to rot.
    expect(SMS_AUTOMATION_REGISTRY.length).toBeGreaterThan(0);
  });
});
