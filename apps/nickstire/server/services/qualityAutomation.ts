/**
 * Quality-driven automation decision engine (directive Part XVIII §75) — given
 * a render's full quality picture, decide what the pipeline may do WITHOUT a
 * human. "Do not treat every warning as equivalent."
 *
 * This is the gate between "the pipeline produced something" and "act on it".
 * It composes the specialist critic panel, deterministic audio QA, evidence
 * state, and provider health into ONE decision. Pure — the inputs come from
 * the QA/panel/audio/evidence modules; this only decides.
 *
 * The directive's earned-autonomy discipline: taste/risk stays with the
 * operator. So even a clean render is REQUEST_OPERATOR_DECISION at the publish
 * boundary until autonomy is earned — auto-repair is allowed (low-risk labor),
 * auto-publish is not.
 */

export type AutomationDecision =
  | "PROCEED"                     // clean; advance to the next non-publish stage
  | "PROCEED_WITH_WARNING"        // minor warnings; advance but flag
  | "REPAIR_AUTOMATICALLY"        // block findings, all cheaply/deterministically fixable
  | "REQUEST_OPERATOR_DECISION"   // block findings needing paid regen / taste call
  | "PAUSE_FOR_MISSING_EVIDENCE"  // a claim lacks living evidence
  | "PAUSE_FOR_PROVIDER"          // provider unhealthy — can't reliably regen
  | "REJECT_OUTPUT";              // unrecoverable

export interface AutomationInput {
  /** any block finding => the render is not clean */
  blockFindings: number;
  warnFindings: number;
  /** of the block findings, how many route to a deterministic (free) fix */
  deterministicFixable: number;
  /** of the block findings, how many need a paid provider regenerate */
  paidRegenNeeded: number;
  audioDecision: "approve" | "repair";
  /** a campaign claim without a living evidence record */
  missingEvidence: boolean;
  providerHealthy: boolean;
  /** attempts already spent on this asset — cap protects against loops */
  repairAttempts: number;
  maxRepairAttempts: number;
}

export interface AutomationVerdict { decision: AutomationDecision; reason: string }

export function decideAutomation(input: AutomationInput): AutomationVerdict {
  // Evidence gate first — a render can be visually perfect and still make an
  // unsupported claim; that is never auto-advanceable.
  if (input.missingEvidence) {
    return { decision: "PAUSE_FOR_MISSING_EVIDENCE", reason: "a campaign claim has no living evidence record" };
  }

  const hasBlock = input.blockFindings > 0 || input.audioDecision === "repair";
  if (!hasBlock) {
    return input.warnFindings > 0
      ? { decision: "PROCEED_WITH_WARNING", reason: `${input.warnFindings} non-blocking warning(s)` }
      : { decision: "PROCEED", reason: "clean render; advance to the next non-publish stage" };
  }

  // There are blocks. If we've exhausted repair attempts, stop looping.
  if (input.repairAttempts >= input.maxRepairAttempts) {
    return { decision: "REJECT_OUTPUT", reason: `repair cap reached (${input.repairAttempts}/${input.maxRepairAttempts}) with blocks remaining` };
  }

  // Any repair needing a paid regen requires a working provider (audio repair
  // is a deterministic remix — it does NOT need the video provider).
  if (input.paidRegenNeeded > 0 && !input.providerHealthy) {
    return { decision: "PAUSE_FOR_PROVIDER", reason: "paid regeneration needed but provider is unhealthy" };
  }

  // All blocks deterministically fixable + audio ok => safe to auto-repair
  // (low-risk production labor the directive permits automating).
  const allFree = input.paidRegenNeeded === 0 && input.audioDecision !== "repair";
  if (allFree && input.deterministicFixable >= input.blockFindings) {
    return { decision: "REPAIR_AUTOMATICALLY", reason: "all block findings are deterministically fixable — auto-repair" };
  }

  // Paid regen or a taste call => the operator decides (taste/risk stays human).
  return { decision: "REQUEST_OPERATOR_DECISION", reason: `${input.paidRegenNeeded} paid regen(s)${input.audioDecision === "repair" ? " + audio repair" : ""} — operator call` };
}
