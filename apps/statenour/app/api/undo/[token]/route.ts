/**
 * POST /api/undo/[token] · v10.0.529.97 · Wave 41
 *
 * One-shot undo for chat-driven mutating tools. After every undo-able
 * tool execute() captures the pre-mutation state into a BrainMemory
 * row (category="undo_token", expiresAt=now+30s) and returns the
 * token in its output. The tool-result card surfaces an "Undo" tap
 * affordance for 30s · tapping POSTs here.
 *
 * Supported tools (Wave 41 launch):
 *   · snoozeTask   · restore status, clear snoozedUntil
 *   · archiveGoal  · restore status, clear deletedAt
 *
 * Idempotent: multiple POSTs against the same token return the same
 * result (the row is soft-deleted on first successful revert; a
 * second attempt finds the consumedAt marker and returns ok=true
 * without re-running the revert).
 *
 * Errors:
 *   404 · token not found OR expired
 *   400 · token payload malformed (defensive · should never happen)
 *   200 · revert succeeded OR was already consumed
 *
 * Cross-domain residuals slice (2026-05-22) · the revert logic moved to
 * `lib/services/undo-token.consumeUndoToken` so this route AND the
 * `task.undo` tRPC procedure call the SAME function · drift structurally
 * impossible. The service throws `ServiceError(400|404)` · apiHandler
 * maps `.status` to the HTTP code so the 400/404/200 contract is
 * preserved.
 */

import { apiHandler } from "@/lib/utils/http";
import { consumeUndoToken } from "@/lib/services/undo-token";

export const runtime = "nodejs";

export const POST = apiHandler(
  async (_req, { params }) => {
    const { token } = await params!;
    return consumeUndoToken(token);
  },
  { auth: "owner" },
);
