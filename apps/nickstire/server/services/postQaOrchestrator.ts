/**
 * Post-QA orchestrator (Creative Compiler 2.0 Milestone 11).
 *
 * Wires the previously-disconnected quality cores into ONE decision:
 *   rendered-QA findings -> repair router (what is cheaply fixable) ->
 *   quality automation (the 7-way decision) -> a publish gate.
 *
 * REQUEST_OPERATOR_DECISION maps to needs_paid_repair: a rendered BLOCK is a real
 * pixel defect, so publish is HELD and the operator authorizes a paid REGEN to
 * fix it — it is NOT publish-overridable. (The M1 exact-hash operator override
 * only accepts ADVISORY warn/repair findings; it refuses block findings, so
 * mapping a block to "operator override" was a gate nothing could satisfy —
 * review-audit taxonomy finding.)
 */
import { decideAutomation, type AutomationDecision, type AutomationVerdict } from "./qualityAutomation";
import { planRepairs, type RepairPlan } from "./repairRouter";
import { type RenderedFinding } from "./renderedQa";

export type PublishGate =
  | "proceed"           // advance to publish (still subject to hard gates)
  | "auto_repair"       // deterministic fixes only — run them, no operator needed
  | "needs_paid_repair" // rendered block needing paid regen — HOLD; operator authorizes a repair, NOT a publish-override
  | "pause"             // missing evidence or unhealthy provider — hold
  | "reject";           // unrecoverable

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
      return "needs_paid_repair";
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
    /** false when the active provider regenerates beats for $0 (template_stock)
     *  — pixel-defect repairs then classify as deterministic labor and flow to
     *  auto_repair instead of the operator-spend hold. Default true. */
    beatRegenCostsCredits?: boolean;
  } = {},
): PostQaOutcome {
  const blocks = findings.filter((f) => f.severity === "block");
  const warns = findings.filter((f) => f.severity === "warn");
  const repairPlan = planRepairs(blocks, { beatRegenCostsCredits: ctx.beatRegenCostsCredits });
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
