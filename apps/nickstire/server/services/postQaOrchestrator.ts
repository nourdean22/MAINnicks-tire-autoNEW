/**
 * Post-QA orchestrator (Creative Compiler 2.0 Milestone 11).
 *
 * Wires the previously-disconnected quality cores into ONE decision:
 *   rendered-QA findings -> repair router (what is cheaply fixable) ->
 *   quality automation (the 7-way decision) -> a publish gate.
 *
 * REQUEST_OPERATOR_DECISION maps to needs_operator_override — the M1 operator
 * quality-override is exactly what satisfies that gate. This is the seam that
 * makes quality automation the ACTUAL post-QA decision, not a pure function
 * nobody calls.
 */
import { decideAutomation, type AutomationDecision, type AutomationVerdict } from "./qualityAutomation";
import { planRepairs, type RepairPlan } from "./repairRouter";
import { type RenderedFinding } from "./renderedQa";

export type PublishGate =
  | "proceed"                  // advance to publish (still subject to hard gates)
  | "auto_repair"              // deterministic fixes only — run them, no operator needed
  | "needs_operator_override"  // paid regen / taste call — requires an M1 override to publish
  | "pause"                    // missing evidence or unhealthy provider — hold
  | "reject";                  // unrecoverable

export interface PostQaOutcome {
  verdict: AutomationVerdict;
  repairPlan: RepairPlan;
  publishGate: PublishGate;
}

export function publishGateForDecision(decision: AutomationDecision): PublishGate {
  switch (decision) {
    case "PROCEED":
    case "PROCEED_WITH_WARNING":
      return "proceed";
    case "REPAIR_AUTOMATICALLY":
      return "auto_repair";
    case "REQUEST_OPERATOR_DECISION":
      return "needs_operator_override";
    case "PAUSE_FOR_MISSING_EVIDENCE":
    case "PAUSE_FOR_PROVIDER":
      return "pause";
    case "REJECT_OUTPUT":
      return "reject";
  }
}

/**
 * Run the full post-render decision from a set of rendered-QA findings. Pure and
 * synchronous — the caller supplies the runtime context (audio verdict, evidence
 * state, provider health, repair attempts).
 */
export function orchestratePostQa(
  findings: RenderedFinding[],
  ctx: {
    audioDecision?: "approve" | "repair";
    missingEvidence?: boolean;
    providerHealthy?: boolean;
    repairAttempts?: number;
    maxRepairAttempts?: number;
  } = {},
): PostQaOutcome {
  const blocks = findings.filter((f) => f.severity === "block");
  const warns = findings.filter((f) => f.severity === "warn");
  const repairPlan = planRepairs(blocks);
  const verdict = decideAutomation({
    blockFindings: blocks.length,
    warnFindings: warns.length,
    deterministicFixable: repairPlan.deterministicFixes,
    paidRegenNeeded: repairPlan.paidRegenerations,
    audioDecision: ctx.audioDecision ?? "approve",
    missingEvidence: ctx.missingEvidence ?? false,
    providerHealthy: ctx.providerHealthy ?? true,
    repairAttempts: ctx.repairAttempts ?? 0,
    maxRepairAttempts: ctx.maxRepairAttempts ?? 2,
  });
  return { verdict, repairPlan, publishGate: publishGateForDecision(verdict.decision) };
}
