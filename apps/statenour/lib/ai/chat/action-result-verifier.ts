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
  // Cross-system shop writes
  "shop.updateLead",
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
