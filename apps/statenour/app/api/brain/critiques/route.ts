/**
 * GET /api/brain/critiques · v10.0.104 · 2026-05-02.
 *
 * Returns BrainMemory rows category=reply_to_improve produced by
 * the nightly self-critique cron. Each row already has structured
 * score metadata; we join the chat_message to surface the original
 * reply text so the UI can show "what Nick said" + "what was
 * scored low" side-by-side.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

interface Score {
  specificity: number;
  cliche: number;
  antiNour: number;
  length: number;
  composite: number;
}

interface CritiqueItem {
  id: string;
  messageId: string;
  conversationId: string | null;
  score: Score | null;
  critiquedAt: string | null;
  reply: string;
  flaggedAt: string;
  contentSummary: string;
  /**
   * v10.0.107 audit fix · true when neither metadata.messageId nor
   * a key prefixed `improve:` was found. The row is rendered but
   * UI can badge it differently so the user knows "this should have
   * been a real critique but the writer dropped its anchor."
   */
  dataCorrupt: boolean;
}

export const GET = apiHandler(
  async () => {
    const flagged = await prisma.brainMemory.findMany({
      where: { category: "reply_to_improve", deletedAt: null },
      orderBy: { confidence: "desc" }, // confidence = 1 - score/100, so high conf = worst score
      select: {
        id: true,
        key: true,
        content: true,
        confidence: true,
        metadata: true,
        createdAt: true,
      },
      take: 25,
    });

    // Pull chat messages for the flagged IDs in one batch
    const messageIds = flagged
      .map((f) => {
        const meta = f.metadata as { messageId?: string } | null;
        return meta?.messageId;
      })
      .filter((x): x is string => typeof x === "string");

    const messages =
      messageIds.length > 0
        ? await prisma.chatMessage
            .findMany({
              where: { id: { in: messageIds } },
              select: { id: true, content: true },
            })
            .catch(() => [] as Array<{ id: string; content: string }>)
        : [];
    const messageMap = new Map(messages.map((m) => [m.id, m.content]));

    const items: CritiqueItem[] = flagged.map((f) => {
      const meta = (f.metadata ?? {}) as {
        messageId?: string;
        conversationId?: string;
        score?: Score;
        critiquedAt?: string;
      };
      // v10.0.107 audit fix · only fall back to f.key if it actually
      // matches the writer's prefix convention. Pre-fix, an arbitrary
      // key (e.g. from a future writer or a manual insert) would be
      // silently used as a messageId, then messageMap.get(...) would
      // return the sentinel string. Now we mark such rows dataCorrupt
      // so the UI can badge them.
      let messageId = "";
      let dataCorrupt = false;
      if (typeof meta.messageId === "string" && meta.messageId.length > 0) {
        messageId = meta.messageId;
      } else if (f.key.startsWith("improve:")) {
        messageId = f.key.slice("improve:".length);
      } else {
        dataCorrupt = true;
      }
      return {
        id: f.id,
        messageId,
        conversationId: meta.conversationId ?? null,
        score: meta.score ?? null,
        critiquedAt: meta.critiquedAt ?? null,
        reply: messageId
          ? messageMap.get(messageId) ?? "(reply not found — message may have been deleted)"
          : "(critique row missing messageId anchor)",
        flaggedAt: f.createdAt.toISOString(),
        contentSummary: f.content.slice(0, 240),
        dataCorrupt,
      };
    });

    // Aggregate stats
    const scored = items.filter((i) => i.score !== null);
    const avgComposite =
      scored.length > 0
        ? Math.round(
            scored.reduce((s, i) => s + (i.score?.composite ?? 0), 0) /
              scored.length,
          )
        : null;

    return {
      generatedAt: new Date().toISOString(),
      totals: {
        flagged: items.length,
        avgComposite,
      },
      items,
    };
  },
  { auth: "owner" },
);
