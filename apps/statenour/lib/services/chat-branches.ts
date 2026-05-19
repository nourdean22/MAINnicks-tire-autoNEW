/**
 * lib/services/chat-branches.ts · Phase DD (2026-05-18 PM)
 *
 * Sibling-cycle reader for the per-message regeneration UI. Returns
 * all assistant siblings under a single user message · ordered
 * oldest-first · used by `MessageBranchSwitcher` to power the
 * "‹ alt 2 of 3 ›" cycle controls.
 *
 * Extracted from `app/api/ai/chat/branches/[parentMessageId]/route.ts`
 * so the legacy REST endpoint AND the new tRPC procedure
 * `trpc.chat.branches` both call the same function · drift between
 * consumers is structurally impossible. Same shared-service pattern
 * as S.2 (system-health) / U.3 (lens-stats) / Y.1 (ai-cost) / Z
 * (chat-search).
 *
 * Edge cases:
 *   · parentMessageId not found → empty `siblings` array (NOT 404 ·
 *     caller might race the regen write)
 */

import { prisma } from "@/lib/prisma";

export interface ChatBranchSibling {
  id: string;
  content: string;
  parts: unknown;
  model: string | null;
  provider: string | null;
  latencyMs: number | null;
  firstTokenLatencyMs: number | null;
  costCents: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  streamingState: string | null;
  feedbackScore: number | null;
  attachmentsHash: string | null;
  editedAt: Date | null;
  createdAt: Date;
}

export interface ChatBranchesResult {
  parentMessageId: string;
  count: number;
  siblings: ChatBranchSibling[];
}

export async function readChatBranches(args: {
  parentMessageId: string;
}): Promise<ChatBranchesResult> {
  const siblings = await prisma.chatMessage.findMany({
    where: {
      parentMessageId: args.parentMessageId,
      role: "assistant",
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      content: true,
      parts: true,
      model: true,
      provider: true,
      latencyMs: true,
      firstTokenLatencyMs: true,
      costCents: true,
      promptTokens: true,
      completionTokens: true,
      streamingState: true,
      feedbackScore: true,
      attachmentsHash: true,
      editedAt: true,
      createdAt: true,
    },
  });

  return {
    parentMessageId: args.parentMessageId,
    count: siblings.length,
    siblings,
  };
}
