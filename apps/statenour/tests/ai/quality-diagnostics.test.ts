import { describe, expect, it } from "vitest";
import {
  CRITIC_HEURISTIC_NOTE,
  criticDiagnosticLine,
  qualityHasIssue,
  receiptHasIssue,
  truthWarningCount,
} from "@/lib/ai/chat/quality-diagnostics";

describe("quality diagnostic truth semantics", () => {
  it("treats a high heuristic critic with no evidence warnings as clean", () => {
    expect(
      qualityHasIssue({
        critic: { overall: 92, specificity: 80, cliche: 100, antiNour: 100, length: 100 },
        gate: { severity: 0 },
        factCheck: { unverified: 0 },
      }),
    ).toBe(false);
  });

  it("surfaces an unverified action even when the style critic is perfect", () => {
    const payload = {
      critic: { overall: 100, specificity: 100, cliche: 100, antiNour: 100, length: 100 },
      receipt: {
        ok: false,
        offenders: [{ toolName: "createTask", status: "partial" }],
      },
    };

    expect(receiptHasIssue(payload)).toBe(true);
    expect(qualityHasIssue(payload)).toBe(true);
  });

  it("surfaces truth-guard flags even when the style critic is clean", () => {
    const payload = {
      critic: { overall: 95 },
      truth: { flags: [{ kind: "stale_state" }] },
    };

    expect(truthWarningCount(payload)).toBe(1);
    expect(qualityHasIssue(payload)).toBe(true);
  });

  it("does not turn missing receipt evidence into a receipt failure", () => {
    expect(qualityHasIssue({ critic: { overall: 95 }, receipt: {} })).toBe(false);
  });

  it("labels critic axes as heuristic signals rather than calibrated perfection", () => {
    const line = criticDiagnosticLine({
      overall: 87,
      specificity: 30,
      cliche: 100,
      antiNour: 100,
      length: 80,
      wordCount: 43,
    });

    expect(line).toContain("critic heuristic");
    expect(line).toContain("specificity-signal=30");
    expect(line).toContain("cliche-avoidance=100");
    expect(line).toContain("voice-guard=100");
    expect(CRITIC_HEURISTIC_NOTE).toContain("not calibrated perfection");
  });
});
