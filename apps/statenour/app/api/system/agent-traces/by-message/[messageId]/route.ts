/**
 * GET /api/system/agent-traces/by-message/[messageId] · v10.0.515 · #7 reasoning-trace UI
 *
 * Resolves a ChatMessage to its agent-trace chain. The link lives
 * in `ChatMessage.tokenUsage.traceId` (added v10.0.515) so this
 * route never needs a schema migration. Pre-v10.0.515 assistant
 * rows return `traceId: null` and the UI shows "trace unavailable"
 * for those — the new ones get the full chain.
 *
 * Mirrors /api/system/agent-traces/[traceId] but accepts a
 * messageId instead. Used by the chat-side "Why this answer"
 * collapsible card under each assistant message.
 *
 * Owner-gated. Read-only. Returns the same shape as the trace-id
 * variant so the UI can reuse one renderer.
 *
 * Cross-domain residuals slice (2026-05-22) · the resolution logic
 * moved to `lib/services/agent-trace-by-message.buildAgentTraceByMessage`
 * so this route AND the `system.agentTraceByMessage` tRPC procedure call
 * the SAME function · drift structurally impossible. The service throws
 * `ServiceError(400|404)` · apiHandler maps `.status` to the HTTP code.
 */

import { apiHandler } from "@/lib/utils/http";
import { buildAgentTraceByMessage } from "@/lib/services/agent-trace-by-message";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (req, { params }) => {
    const { messageId } = await params!;
    const url = new URL(req.url);
    const conversationId =
      url.searchParams.get("conversationId") ?? undefined;
    return buildAgentTraceByMessage(messageId, conversationId);
  },
  { auth: "owner" },
);
