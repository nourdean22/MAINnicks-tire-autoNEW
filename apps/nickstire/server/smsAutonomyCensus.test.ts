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
import { describe, expect, it, vi } from "vitest";

// runSmsAutonomyCensus deps: dispatcher reader + db availability probe.
const getRolloutModeMock = vi.fn();
let dbHandle: unknown = {};
vi.mock("./services/smsOrchestrator", () => ({
  getRolloutMode: (...args: unknown[]) => getRolloutModeMock(...args),
}));
vi.mock("./db", () => ({ getDbTyped: async () => dbHandle }));
import {
  SMS_AUTOMATION_REGISTRY,
  maxRolloutModeForLevel,
  type SmsAutomationPolicy,
} from "./services/smsAutonomy";
import { classifyLane, runSmsAutonomyCensus } from "./services/smsAutonomyCensus";

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

describe("runSmsAutonomyCensus DB-down honesty (self-review fix)", () => {
  it("stamps every live-read lane with the unenforceable-ladder caveat when the DB is unreachable", async () => {
    dbHandle = null;
    // What the dispatcher's reader actually returns in that state:
    getRolloutModeMock.mockResolvedValue("legacy_passthrough");
    const census = await runSmsAutonomyCensus();
    expect(census.dbAvailable).toBe(false);
    const liveRead = census.lanes.filter((l) => l.liveMode !== null);
    expect(liveRead.length).toBeGreaterThan(0);
    for (const lane of liveRead) {
      // Rendered bare, legacy_passthrough looks like an operator choice —
      // the caveat is what makes the reading honest.
      expect(lane.detail).toContain("unenforceable");
    }
  });

  it("adds NO caveat when the DB answered (normal reading stands clean)", async () => {
    dbHandle = {};
    getRolloutModeMock.mockResolvedValue("off");
    const census = await runSmsAutonomyCensus();
    expect(census.dbAvailable).toBe(true);
    for (const lane of census.lanes) {
      expect(lane.detail).not.toContain("unenforceable");
    }
  });

  it("a throwing reader yields unreadable lanes, never a fabricated mode", async () => {
    dbHandle = {};
    getRolloutModeMock.mockRejectedValue(new Error("boom"));
    const census = await runSmsAutonomyCensus();
    const orch = census.lanes.filter((l) => l.path === "orchestrator");
    expect(orch.every((l) => l.status === "unreadable" && l.liveMode === null)).toBe(true);
    expect(census.summary.unreadable).toBe(orch.length);
  });
});
