/**
 * GET /api/ai/chat/claim-warnings · v10.0.160
 *
 * Returns active action-claim warnings for a conversation. Called by
 * the chat client after each assistant turn to render an inline
 * correction chip when Nick claimed an action without firing a tool.
 *
 * The warning is logged at stream-finalize time (lib/services/chat/
 * persist-assistant-turn.ts) and persisted as a BrainMemory row with
 * category="chat_claim_warn". This route reads the most recent one
 * per conversation. Owner-gated.
 *
 * Query: ?conversationId=<id>&limit=1 (default 1, max 10)
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";

interface ClaimWarningPayload {
  id: string;
  traceId: string | null;
  createdAt: string;
  claims: Array<{
    verb: string;
    snippet: string;
    expectedTool: string;
  }>;
  toolsActuallyFired: string[];
  textPreview: string;
}

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const conversationId = url.searchParams.get("conversationId");
    if (!conversationId) {
      throw new ServiceError("conversationId required", 400);
    }
    const limitParam = parseInt(url.searchParams.get("limit") ?? "1", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(limitParam, 10))
      : 1;

    const rows = await prisma.brainMemory.findMany({
      where: {
        category: "chat_claim_warn",
        deletedAt: null,
      },
      orderBy: { createdAt: "desc" },
      take: 50, // pull more then filter — `metadata.conversationId` isn't indexed
    });

    const matches: ClaimWarningPayload[] = [];
    for (const r of rows) {
      const md = r.metadata as
        | {
            conversationId?: string;
            traceId?: string;
            claims?: Array<{ verb: string; snippet: string; expectedTool: string }>;
            toolsActuallyFired?: string[];
            textPreview?: string;
          }
        | null;
      if (md?.conversationId !== conversationId) continue;
      matches.push({
        id: r.id,
        traceId: md?.traceId ?? null,
        createdAt: r.createdAt.toISOString(),
        claims: md?.claims ?? [],
        toolsActuallyFired: md?.toolsActuallyFired ?? [],
        textPreview: md?.textPreview ?? "",
      });
      if (matches.length >= limit) break;
    }

    return { warnings: matches };
  },
  { auth: "owner" },
);
