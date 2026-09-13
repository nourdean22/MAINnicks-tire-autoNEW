/**
 * Action-result verifier · action-block fabrication guard.
 *
 * The SDK-tool fabrication stack (action-claim-detector.ts +
 * environment-verifier.ts) only inspects `capturedToolCalls` — the
 * AI-SDK streamText tool calls. But Nick's action BLOCKS
 * (```action {"type":"task.create"}```) run through a DIFFERENT path:
 * parseActions() → executeActions() in runDeferredBackgroundWork. Their
 * ActionResult[] receipts (success/error) are logged + audited but never
 * reconciled against Nick's prose — so a write that SILENTLY FAILS while
 * Nick narrates "done" never warns the operator. That is the same
 * trust-killer the SDK-tool guard was built for (the Bay 5 Revive case),
 * just on the action-block side.
 *
 * This module is the analog of detectActionClaimsWithoutTools: given the
 * action receipts + the assistant text, return the failed MUTATION
 * actions that Nick's prose claimed completed. The caller writes a
 * `chat_claim_warn` BrainMemory row, which the existing correction-chip
 * surface (claim-warnings.ts → /api/ai/chat/claim-warnings →
 * action-claim-warning.tsx) renders below the bubble.
 *
 * Pure — no IO. Trivial to unit-test.
 */

import { detectActionClaims, type ActionClaim } from "@/lib/ai/chat/action-claim-detector";

/**
 * Action-block types that cause a side effect — a write, a send, or a
 * state change. A silent failure of one of these while Nick claims
 * success is the fabrication we guard against.
 *
 * Pure READS are deliberately excluded (shop.get*, system.health/brainStats,
 * memory.search, *.get*, task.status, simulation.run, arsenal.* research):
 * a failed read is surfaced naturally ("I couldn't pull that up") and is
 * not a fabricated side effect — flagging it would be noise.
 *
 * Mirrors the side-effecting cases in nick-agent.ts `executeAction`.
 */
export const MUTATION_ACTIONS: ReadonlySet<string> = new Set([
  // Tasks / loops
  "task.create",
  "loop.create",
  "task.complete",
  "loop.close",
  // Commitments
  "commitment.create",
  "commitment.update",
  // Decisions / alerts
  "decision.log",
  "alert.resolve",
  // Memory
  "memory.remember",
  "memory.forget",
  // Habits
  "habit.toggle",
  // People
  "person.update",
  "person.create",
  // Cross-system shop writes.
  // shop.updateLead was removed with its handler — nothing can emit it any more.
  // shop.sendSms STAYS: the handler is gone, but lib/ai/tools/social.ts still
  // stamps PENDING ActionReceipt rows with that name and audit-todays-leads
  // still writes it as an approval toolId, so it must keep its write
  // classification even though execution now fails loudly.
  "shop.sendSms",
  // System operator writes
  "system.syncNow",
  "system.clearAlerts",
  // Sends / planning
  "telegram.send",
  "mission.plan",
  // Camera writes
  "camera.resolveAlert",
  // Google / Gmail / Reviews writes
  "google.proposeEvent",
  "gmail.draftReply",
  "gmail.createDraft",
  "gmail.sendDraft",
  "google.draftReviewResponse",
  "google.markReviewResponded",
  // Browser writes
  "arsenal.browserCreateSession",
  "arsenal.browserCloseSession",
]);

/** The success/error shape executeActions() returns per action. */
export interface ActionExecResult {
  action: string;
  success: boolean;
  error?: string;
  /**
   * Shadow-only strict truth: true only when an independent postcondition or
   * read-back confirmed the intended world state. Existing executeActions()
   * rows omit this, so successful mutations remain provider-accepted only.
   */
  verified?: boolean;
}

/**
 * Return the failed MUTATION actions that Nick's prose claimed
 * completed — the action-block analog of detectActionClaimsWithoutTools.
 *
 * Two gates keep this precise and noise-free:
 *   1. MUTATION only — a failed read is not a fabricated side effect.
 *   2. Prose claimed completion — `detectActionClaims` must find a
 *      completion verb. This suppresses intentional guard failures:
 *      the people-gate returns person.update success:false with an
 *      "ask first" error when no person matches, but in that case Nick's
 *      prose asks first (no completion verb) → no warning. Hedged prose
 *      ("I could add it if you want") is likewise dropped by the detector.
 *
 * Pure — no IO.
 */
export function detectFailedActionClaims(
  results: ReadonlyArray<ActionExecResult>,
  assistantText: string,
): ActionClaim[] {
  const failedMutations = results.filter(
    (r) => !r.success && MUTATION_ACTIONS.has(r.action),
  );
  if (failedMutations.length === 0) return [];

  // Only warn when Nick's prose actually claimed a completed action.
  if (detectActionClaims(assistantText).claims.length === 0) return [];

  return failedMutations.map((r) => ({
    verb: r.action,
    snippet: `Nick ran a "${r.action}" action that did not complete: ${r.error ?? "unknown error"}`,
    expectedTool: r.action,
  }));
}

/**
 * PHANTOM action claims — prose that claims a domain-specific side effect
 * while NO action of that type was emitted at all (neither success nor
 * failure appears in `results`).
 *
 * WHY THIS EXISTS — the 2026-08-25 person confabulation, verbatim from prod
 * (chat message 15:17:56Z; the AuditEvent window holds no person action and
 * person_profiles was unchanged):
 *
 *     "Done — both profiles created."
 *
 * Zero tool calls, zero action blocks. It slipped BOTH existing guards by
 * the same asymmetry: detectActionClaimsWithoutTools is vocab-gated and had
 * no person/profile entry (and there is no person nourTool it could expect),
 * while detectFailedActionClaims above requires a FAILED row in `results` —
 * an action never emitted produces no row, so canClaimDone returned true
 * over a fabricated "Done". Claimed-but-FAILED was guarded;
 * claimed-but-NEVER-EMITTED was not. Worse, the fabricated confirmation
 * also invented content the operator never said.
 *
 * Scope is deliberately narrow: one pattern table for action-block domains
 * with no SDK-tool counterpart, starting with person.create (the measured
 * case). Wired to the chat_claim_warn correction chip — NOT into
 * canClaimDone — so a false positive costs a visible warning, never a
 * mutated reply. Escalating into canClaimDone is a recorded next lever
 * (docs/CHAT-PIPELINE-STUDY-2026-08-27.md).
 *
 * Pure — no IO.
 */
export const PHANTOM_CLAIM_PATTERNS: ReadonlyArray<{ regex: RegExp; action: string }> = [
  // "both profiles created" · "profile added" · "person saved"
  { regex: /\b(?:profiles?|person)\b.{0,40}\b(?:created|added|updated|saved)\b/i, action: "person.create" },
  // "created profiles for Hamda and Nathan" · "added them to your people"
  { regex: /\b(?:created|added|saved)\b.{0,50}\b(?:profiles?|to (?:your|my|the) people)\b/i, action: "person.create" },
];

/** Minimal per-sentence guards, mirroring the detector's hedge intent. */
const PHANTOM_HEDGE =
  /\b(?:would|could|can|might|want me to|if you|i(?:'ll| will)|shall i|do you want)\b/i;
const PHANTOM_SECOND_PERSON =
  /\byou(?:'ve| have| had)?\s+(?:\w+\s+)?(?:added|created|updated|saved)\b/i;

export function detectPhantomActionClaims(
  results: ReadonlyArray<ActionExecResult>,
  assistantText: string,
): ActionClaim[] {
  const emitted = new Set(results.map((r) => r.action));
  const claims: ActionClaim[] = [];
  // Sentence-level, like the detector: a hedge in one sentence must not
  // suppress a bare claim in another.
  const sentences = assistantText.split(/(?<=[.!?])\s+|\n+/);
  for (const sentence of sentences) {
    if (PHANTOM_HEDGE.test(sentence) || PHANTOM_SECOND_PERSON.test(sentence)) continue;
    for (const p of PHANTOM_CLAIM_PATTERNS) {
      if (!p.regex.test(sentence)) continue;
      if (emitted.has(p.action)) continue; // emitted (success OR failure) → the guards above own it
      if (claims.some((c) => c.expectedTool === p.action)) continue; // one warn per action type
      claims.push({
        verb: p.action,
        snippet: sentence.trim().slice(0, 160),
        expectedTool: p.action,
      });
    }
  }
  return claims;
}

export interface ActionDoneShadowVerdict {
  /** Generic completion language was detected in the assistant prose. */
  completionClaimDetected: boolean;
  /** Strict mutation completion was actually evaluable for this turn. */
  strictRelevant: boolean;
  /** Existing production behavior: failed claimed mutations block Done. */
  legacyDoneEligible: boolean;
  /**
   * null = no mutation/phantom completion claim to evaluate.
   * false = strict completion is not proven.
   * true = every claimed emitted mutation carries independent verification.
   */
  strictDoneEligible: boolean | null;
  /** Legacy would allow Done while strict truth would not. */
  legacyStrictGap: boolean;
  failedMutations: string[];
  providerAcceptedMutations: string[];
  verifiedMutations: string[];
  phantomClaims: ActionClaim[];
}

/**
 * Shadow-only action-block completion compiler.
 *
 * This does NOT rewrite prose and does NOT change current canClaimDone()
 * behavior. It exists so the deferred action path can measure the migration
 * from executor-success to independently-verified success before enforcement.
 */
export function compareActionDoneShadow(
  results: ReadonlyArray<ActionExecResult>,
  assistantText: string,
): ActionDoneShadowVerdict {
  const completionClaimDetected = detectActionClaims(assistantText).claims.length > 0;
  const mutationResults = results.filter((r) => MUTATION_ACTIONS.has(r.action));
  const failedMutations = mutationResults.filter((r) => !r.success).map((r) => r.action);
  const verifiedMutations = mutationResults
    .filter((r) => r.success && r.verified === true)
    .map((r) => r.action);
  const providerAcceptedMutations = mutationResults
    .filter((r) => r.success && r.verified !== true)
    .map((r) => r.action);
  const phantomClaims = detectPhantomActionClaims(results, assistantText);
  const legacyDoneEligible = detectFailedActionClaims(results, assistantText).length === 0;

  let strictDoneEligible: boolean | null = null;
  if (phantomClaims.length > 0) {
    strictDoneEligible = false;
  } else if (completionClaimDetected && mutationResults.length > 0) {
    strictDoneEligible = failedMutations.length === 0 && providerAcceptedMutations.length === 0;
  }

  return {
    completionClaimDetected,
    strictRelevant: strictDoneEligible !== null,
    legacyDoneEligible,
    strictDoneEligible,
    legacyStrictGap: legacyDoneEligible && strictDoneEligible === false,
    failedMutations,
    providerAcceptedMutations,
    verifiedMutations,
    phantomClaims,
  };
}

/**
 * Determines if the action results allow claiming completion in prose.
 * Wired directly into the live chat-finalize loop to prevent fake completion claims.
 *
 * IMPORTANT: legacy behavior is intentionally retained while the strict shadow
 * verdict is measured. Successful mutation execution alone still returns true.
 */
export function canClaimDone(
  results: ReadonlyArray<ActionExecResult>,
  assistantText: string,
): boolean {
  return compareActionDoneShadow(results, assistantText).legacyDoneEligible;
}
