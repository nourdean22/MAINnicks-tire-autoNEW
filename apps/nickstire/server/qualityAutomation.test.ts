/**
 * Quality-driven automation (milestone 15 §75) — one decision from the full
 * quality picture. "Do not treat every warning as equivalent." Auto-repair is
 * low-risk labor the pipeline may automate; paid regen and taste stay with the
 * operator; unsupported claims and provider outages pause.
 */
import { describe, expect, it } from "vitest";
import { decideAutomation, type AutomationInput } from "./services/qualityAutomation";

const inp = (over: Partial<AutomationInput>): AutomationInput => ({
  blockFindings: 0, warnFindings: 0, deterministicFixable: 0, paidRegenNeeded: 0,
  audioDecision: "approve", missingEvidence: false, providerHealthy: true,
  repairAttempts: 0, maxRepairAttempts: 2, ...over,
});

describe("decideAutomation", () => {
  it("clean render -> PROCEED", () => {
    expect(decideAutomation(inp({})).decision).toBe("PROCEED");
  });
  it("warnings only -> PROCEED_WITH_WARNING", () => {
    expect(decideAutomation(inp({ warnFindings: 2 })).decision).toBe("PROCEED_WITH_WARNING");
  });
  it("missing evidence pauses EVEN a visually clean render", () => {
    expect(decideAutomation(inp({ missingEvidence: true })).decision).toBe("PAUSE_FOR_MISSING_EVIDENCE");
  });
  it("all-deterministic blocks -> REPAIR_AUTOMATICALLY (low-risk labor)", () => {
    expect(decideAutomation(inp({ blockFindings: 2, deterministicFixable: 2 })).decision).toBe("REPAIR_AUTOMATICALLY");
  });
  it("a paid-regen block -> REQUEST_OPERATOR_DECISION (taste/risk stays human)", () => {
    expect(decideAutomation(inp({ blockFindings: 1, paidRegenNeeded: 1 })).decision).toBe("REQUEST_OPERATOR_DECISION");
  });
  it("paid regen needed but provider down -> PAUSE_FOR_PROVIDER", () => {
    expect(decideAutomation(inp({ blockFindings: 1, paidRegenNeeded: 1, providerHealthy: false })).decision).toBe("PAUSE_FOR_PROVIDER");
  });
  it("audio repair alone does NOT pause for provider (deterministic remix)", () => {
    const d = decideAutomation(inp({ audioDecision: "repair", providerHealthy: false })).decision;
    expect(d).toBe("REQUEST_OPERATOR_DECISION");
  });
  it("repair cap reached with blocks remaining -> REJECT_OUTPUT (no infinite loop)", () => {
    expect(decideAutomation(inp({ blockFindings: 1, deterministicFixable: 1, repairAttempts: 2, maxRepairAttempts: 2 })).decision).toBe("REJECT_OUTPUT");
  });
  it("evidence gate takes precedence over block findings", () => {
    expect(decideAutomation(inp({ blockFindings: 3, paidRegenNeeded: 3, missingEvidence: true })).decision).toBe("PAUSE_FOR_MISSING_EVIDENCE");
  });
});
