/**
 * GET /api/brain/provenance/[messageId] · v10.0.91 · 2026-05-02.
 *
 * Reverse search: given a chat message ID, find the brain memories
 * MOST LIKELY to have shaped its generation. Useful for debugging
 * "why did Nick say that?" and for citation UI.
 *
 * Algorithm: pull the message's content, run hybrid memory recall
 * against the brain. Returns the same RecallReport shape as
 * /api/brain/recall but anchored to a specific message.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { recallMemoriesForQuery } from "@/lib/brain/memory-recall";
import { bdiTypeOf, bdiChainSummary, type BdiType } from "@/lib/brain/bdi";
import { coalaKindOf, type CoalaKind } from "@/lib/brain/coala";

export const GET = apiHandler(
  async (req, ctx) => {
    const params = await (ctx?.params as Promise<{ messageId: string }> | undefined);
    const messageId = params?.messageId;
    if (!messageId) throw new ServiceError("messageId required", 400);

    const msg = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        conversationId: true,
      },
    });
    if (!msg) throw new ServiceError(`Message not found: ${messageId}`, 404);

    // Use the message content as the recall query.
    // v10.0.95 audit fix: every Nick reply is auto-archived as a
    // BrainMemory category=nick_advice keyed `nick_advice_<msgId>`.
    // Pre-fix the top hit was always the message's own archive
    // (score ~1.4, dist=0). Pull a wider net + filter the
    // self-match before returning. Same logic catches any other
    // category that might key by msgId in the future.
    const recall = await recallMemoriesForQuery(msg.content, { limit: 15 });
    const filteredHits = recall.hits.filter(
      (h) => !h.key.includes(messageId),
    );
    const trimmed = filteredHits.slice(0, 10);

    // Optionally pull adjacent context (previous user turn for assistant
    // messages) to enrich the provenance — Nick's reply was a function
    // of the user message that preceded it.
    let userContext: string | null = null;
    if (msg.role === "assistant") {
      const prior = await prisma.chatMessage
        .findFirst({
          where: {
            conversationId: msg.conversationId,
            role: "user",
            createdAt: { lt: msg.createdAt },
          },
          orderBy: { createdAt: "desc" },
          select: { content: true },
        })
        .catch(() => null);
      userContext = prior?.content?.slice(0, 400) ?? null;
    }

    // v10.0.360 · BDI overlay · annotate each hit with its cognitive
    // role (belief / desire / intention / observation) so the UI can
    // show the structured reasoning chain instead of a flat list.
    // v10.0.367 · CoALA kind · semantic / episodic / procedural · the
    // memory-architecture layer (BDI is the cognitive role).
    const annotatedHits = trimmed.map((h) => ({
      ...h,
      bdi: bdiTypeOf({ category: h.category, content: h.content, confidence: h.confidence }) as BdiType,
      coala: coalaKindOf({ category: h.category }) as CoalaKind,
    }));

    // v10.0.384 · pull the post-stream feedback artifacts written by
    // the LLM-as-judge (v10.0.366) and adversarial critic (v10.0.369).
    // Both are keyed by the message ID. Operator-visible quality + the
    // counter-view if Nick made a recommendation.
    const { prisma: db } = await import("@/lib/prisma");
    const [judgment, objection] = await Promise.all([
      db.brainMemory
        .findFirst({
          where: { category: "reply_judgment", key: `judge_${messageId}`, deletedAt: null },
          select: { content: true, metadata: true, createdAt: true },
        })
        .catch(() => null),
      db.brainMemory
        .findFirst({
          where: { category: "adversarial_objection", key: `objection_${messageId}`, deletedAt: null },
          select: { content: true, metadata: true, createdAt: true },
        })
        .catch(() => null),
    ]);

    return {
      message: {
        id: msg.id,
        role: msg.role,
        contentPreview: msg.content.slice(0, 280),
        createdAt: msg.createdAt.toISOString(),
        conversationId: msg.conversationId,
      },
      userContext,
      recall: {
        scanned: recall.scanned,
        durationMs: recall.durationMs,
        selfMatchExcluded: recall.hits.length - filteredHits.length,
        hits: annotatedHits,
        // v10.0.360 · cognitive chain summary · "3 beliefs · 1 intention"
        bdiChain: bdiChainSummary(trimmed),
      },
      // v10.0.384 · post-stream feedback artifacts
      feedback: {
        judgment: judgment
          ? {
              summary: judgment.content,
              rubric: (judgment.metadata as { rubric?: unknown })?.rubric ?? null,
              composite: (judgment.metadata as { composite?: number })?.composite ?? null,
              flagForReview:
                (judgment.metadata as { flagForReview?: boolean })?.flagForReview ?? false,
              judgedAt: judgment.createdAt.toISOString(),
            }
          : null,
        objection: objection
          ? {
              summary: objection.content,
              severity: (objection.metadata as { severity?: number })?.severity ?? 1,
              foundFlaw: (objection.metadata as { foundFlaw?: boolean })?.foundFlaw ?? false,
              raisedAt: objection.createdAt.toISOString(),
            }
          : null,
      },
    };
  },
  { auth: "owner" },
);
