import { describe, it, expect, vi, beforeEach } from "vitest";
import { evaluateReadiness } from "@/lib/health-governor/readiness";
import { checkAction } from "@/lib/health-governor/action-guard";

// Mock out database calls for the action guard tests
const mockGetLatestGovernorDecision = vi.fn();
vi.mock("@/lib/health-governor/health-governor-guardrails", () => ({
  getLatestGovernorDecision: () => mockGetLatestGovernorDecision(),
}));

// Mock out prisma write calls inside action-guard override audit
vi.mock("@/lib/prisma", () => ({
  prisma: {
    entityAudit: {
      create: vi.fn().mockResolvedValue({ id: "mock-id" }),
    },
  },
}));

describe("Health Governor Readiness Scoring", () => {
  it("Stable baseline is computed when all metrics are nominal", () => {
    const decision = evaluateReadiness({
      sleepHours: 7.2,
      energyLevel: 3,
      focusQuality: 5,
      driftLevel: 5,
      sorenessScore: 0,
      injuryFlag: false,
      workoutCompletedToday: null,
    });

    expect(decision.mode).toBe("STABLE");
    expect(decision.score).toBeGreaterThanOrEqual(70);
    expect(decision.blockedActions).toHaveLength(0);
    expect(decision.recommendedCommand).toBe("/execute");
  });

  it("Optimized mode triggers under peak conditions", () => {
    const decision = evaluateReadiness({
      sleepHours: 8.0,
      energyLevel: 5,
      focusQuality: 8,
      driftLevel: 2,
      sorenessScore: 2,
      injuryFlag: false,
      workoutCompletedToday: true,
    });

    expect(decision.mode).toBe("OPTIMIZED");
    expect(decision.score).toBeGreaterThanOrEqual(80);
    expect(decision.blockedActions).toHaveLength(0);
    expect(decision.recommendedCommand).toBe("/expand");
    expect(decision.promptGuardrailText).toContain("OPTIMIZED MODE ACTIVE");
  });

  it("Lockdown mode triggers on severe sleep deprivation (<5h)", () => {
    const decision = evaluateReadiness({
      sleepHours: 4.5,
      energyLevel: 3,
      focusQuality: 5,
      driftLevel: 4,
      sorenessScore: 0,
      injuryFlag: false,
      workoutCompletedToday: null,
    });

    expect(decision.mode).toBe("LOCKDOWN");
    expect(decision.score).toBeLessThan(40);
    expect(decision.blockedActions).toContain("deploy");
    expect(decision.blockedActions).toContain("launch_campaign");
    expect(decision.recommendedCommand).toBe("/rest");
    expect(decision.promptGuardrailText).toContain("LOCKDOWN MODE ACTIVE");
  });

  it("Lockdown mode triggers on active injury", () => {
    const decision = evaluateReadiness({
      sleepHours: 8.0,
      energyLevel: 4,
      focusQuality: 7,
      driftLevel: 3,
      sorenessScore: 0,
      injuryFlag: true,
      workoutCompletedToday: null,
    });

    expect(decision.mode).toBe("LOCKDOWN");
    expect(decision.blockedActions).toContain("deploy");
    expect(decision.recommendedCommand).toBe("/rest");
  });

  it("Shadow mode triggers on moderate sleep deprivation (<6h)", () => {
    const decision = evaluateReadiness({
      sleepHours: 5.5,
      energyLevel: 3,
      focusQuality: 5,
      driftLevel: 4,
      sorenessScore: 0,
      injuryFlag: false,
      workoutCompletedToday: null,
    });

    expect(decision.mode).toBe("SHADOW_MODE");
    expect(decision.blockedActions).toContain("deploy");
    expect(decision.blockedActions).not.toContain("social_post"); // social_post allowed in shadow, blocked in lockdown
    expect(decision.recommendedCommand).toBe("/strict");
    expect(decision.promptGuardrailText).toContain("SHADOW MODE ACTIVE");
  });

  it("Recovery Lock triggers on elevated muscle soreness (>=7)", () => {
    const decision = evaluateReadiness({
      sleepHours: 7.5,
      energyLevel: 4,
      focusQuality: 6,
      driftLevel: 4,
      sorenessScore: 8,
      injuryFlag: false,
      workoutCompletedToday: null,
    });

    expect(decision.mode).toBe("RECOVERY_LOCK");
    expect(decision.blockedActions).toContain("hard_physical_training");
    expect(decision.recommendedCommand).toBe("/rest");
    expect(decision.promptGuardrailText).toContain("RECOVERY LOCK ACTIVE");
  });
});

describe("Action Guarding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Allows actions in STABLE mode", async () => {
    mockGetLatestGovernorDecision.mockResolvedValue({
      mode: "STABLE",
      blockedActions: [],
      allowedActions: ["deploy"],
      reasons: [],
    });

    const res = await checkAction("deploy");
    expect(res.allowed).toBe(true);
    expect(res.blocked).toBe(false);
  });

  it("Strictly blocks deploy in LOCKDOWN mode, preventing overrides", async () => {
    mockGetLatestGovernorDecision.mockResolvedValue({
      mode: "LOCKDOWN",
      blockedActions: ["deploy"],
      reasons: ["Extreme fatigue"],
    });

    // Try normal attempt
    const res = await checkAction("deploy", false);
    expect(res.allowed).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.warning).toContain("strictly BLOCKED");

    // Try override attempt
    const overrideRes = await checkAction("deploy", true);
    expect(overrideRes.allowed).toBe(false);
    expect(overrideRes.blocked).toBe(true);
    expect(overrideRes.warning).toContain("strictly BLOCKED");
  });

  it("Blocks deploy in SHADOW_MODE but allows override with audit logging", async () => {
    mockGetLatestGovernorDecision.mockResolvedValue({
      mode: "SHADOW_MODE",
      blockedActions: ["deploy"],
      reasons: ["Sleep deficit"],
    });

    // Normal attempt is blocked
    const res = await checkAction("deploy", false);
    expect(res.allowed).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.warning).toContain("blocked under SHADOW_MODE");

    // Override attempt is allowed
    const overrideRes = await checkAction("deploy", true);
    expect(overrideRes.allowed).toBe(true);
    expect(overrideRes.blocked).toBe(false);
    expect(overrideRes.warning).toContain("overridden by operator");
  });
});
