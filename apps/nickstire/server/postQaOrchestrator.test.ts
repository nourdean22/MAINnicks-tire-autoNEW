/**
 * Post-QA orchestrator (Creative Compiler 2.0 Milestone 11) — wires the
 * rendered-QA findings -> repair router -> quality automation -> publish gate.
 * REQUEST_OPERATOR_DECISION maps to needs_paid_repair (a rendered block → paid
 * repair; publish held, NOT a publish-override — the M1 override refuses blocks).
 */
import { describe, it, expect } from "vitest";
import { orchestratePostQa, publishGateForDecision } from "./services/postQaOrchestrator";
import type { RenderedFinding } from "./services/renderedQa";

const finding = (code: RenderedFinding["code"], severity: "block" | "warn"): RenderedFinding => ({
  beatNumber: 1, code, severity, description: "x", preserve: [], change: [],
});

describe("publishGateForDecision maps every automation decision", () => {
  it("covers all 7 decisions", () => {
    expect(publishGateForDecision("PROCEED")).toBe("proceed");
    expect(publishGateForDecision("PROCEED_WITH_WARNING")).toBe("proceed");
    expect(publishGateForDecision("REPAIR_AUTOMATICALLY")).toBe("auto_repair");
    expect(publishGateForDecision("REQUEST_OPERATOR_DECISION")).toBe("needs_paid_repair");
    expect(publishGateForDecision("PAUSE_FOR_MISSING_EVIDENCE")).toBe("pause");
    expect(publishGateForDecision("PAUSE_FOR_PROVIDER")).toBe("pause");
    expect(publishGateForDecision("REJECT_OUTPUT")).toBe("reject");
  });
});

describe("orchestratePostQa (QA -> repair -> automation -> gate)", () => {
  it("clean render -> proceed", () => {
    const o = orchestratePostQa([]);
    expect(o.verdict.decision).toBe("PROCEED");
    expect(o.publishGate).toBe("proceed");
  });

  it("warnings only -> proceed with warning", () => {
    const o = orchestratePostQa([finding("CAPTION_OBSTRUCTION", "warn")]);
    expect(o.verdict.decision).toBe("PROCEED_WITH_WARNING");
    expect(o.publishGate).toBe("proceed");
  });

  it("a pixel block (paid regen) -> needs_paid_repair; the repair plan is paid", () => {
    const o = orchestratePostQa([finding("GENERATED_TEXT_ARTIFACT", "block")]);
    expect(o.publishGate).toBe("needs_paid_repair");
    expect(o.repairPlan.paidRegenerations).toBe(1);
    expect(o.repairPlan.deterministicFixes).toBe(0);
  });

  it("missing evidence takes precedence -> pause", () => {
    const o = orchestratePostQa([finding("GENERATED_TEXT_ARTIFACT", "block")], { missingEvidence: true });
    expect(o.verdict.decision).toBe("PAUSE_FOR_MISSING_EVIDENCE");
    expect(o.publishGate).toBe("pause");
  });

  it("unhealthy provider with a paid block -> pause", () => {
    const o = orchestratePostQa([finding("SUBJECT_CONTINUITY", "block")], { providerHealthy: false });
    expect(o.publishGate).toBe("pause");
  });

  it("repair cap reached with blocks remaining -> reject", () => {
    const o = orchestratePostQa([finding("MALFORMED_GEOMETRY", "block")], { repairAttempts: 2, maxRepairAttempts: 2 });
    expect(o.publishGate).toBe("reject");
  });

  // The 2026-08-05 incident pin: a pixel block on the FREE lane (template_stock,
  // $0 regen) must flow to auto_repair — deterministic labor — instead of the
  // operator-SPEND hold. Same findings, no free-lane signal: the historical
  // needs_paid_repair hold is preserved exactly.
  it("pixel block + free-lane regen (beatRegenCostsCredits:false) -> auto_repair, not needs_paid_repair", () => {
    const o = orchestratePostQa([finding("MALFORMED_GEOMETRY", "block")], { beatRegenCostsCredits: false });
    expect(o.verdict.decision).toBe("REPAIR_AUTOMATICALLY");
    expect(o.publishGate).toBe("auto_repair");
    expect(o.repairPlan.paidRegenerations).toBe(0);
  });

  it("same pixel block WITHOUT the free-lane signal still holds for the operator (unchanged default)", () => {
    const o = orchestratePostQa([finding("MALFORMED_GEOMETRY", "block")]);
    expect(o.publishGate).toBe("needs_paid_repair");
    expect(o.repairPlan.paidRegenerations).toBe(1);
  });

  it("free-lane regen with audio repair still needs the operator — audio is not covered by the beat-regen flag", () => {
    const o = orchestratePostQa([finding("MALFORMED_GEOMETRY", "block")], { beatRegenCostsCredits: false, audioDecision: "repair" });
    expect(o.publishGate).toBe("needs_paid_repair");
  });
});
