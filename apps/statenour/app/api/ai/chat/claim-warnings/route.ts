/**
 * GET /api/ai/chat/claim-warnings · v10.0.160
 *
 * Returns active action-claim warnings for a conversation. Called by
 * the chat client after each assistant turn to render an inline
 * correction chip when Nick claimed an action without firing a tool.
 *
 * Phase MM (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/claim-warnings.readClaimWarnings` so this REST handler
 * AND the new `trpc.chat.claimWarnings` procedure call the same
 * function · drift impossible. Stays mounted for back-compat with any
 * non-tRPC consumer.
 *
 * Query: ?conversationId=<id>&limit=1 (default 1, max 10)
 * Owner-gated.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { readClaimWarnings } from "@/lib/services/claim-warnings";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId");
    if (!conversationId) {
      throw new ServiceError("conversationId required", 400);
    }
    const limitParam = parseInt(url.searchParams.get("limit") ?? "1", 10);
    const limit = Number.isFinite(limitParam) ? limitParam : 1;
    return readClaimWarnings({ conversationId, limit });
  },
  { auth: "owner" },
);
