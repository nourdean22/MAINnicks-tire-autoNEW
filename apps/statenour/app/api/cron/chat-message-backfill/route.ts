/**
 * /api/cron/chat-message-backfill — fill ChatMessage Batch A columns on legacy rows.
 *
 * v7.6 · C4/16 · Apr 29.
 *
 * Migration C1 added 16 new columns to chat_messages. Existing rows
 * are valid (NULL is acceptable for nullable columns), but the chat
 * UI gets a richer experience when the legacy rows have:
 *   · `parts` derived from existing `content` + `attachments`
 *   · `searchableContent` populated for FTS hits on old conversations
 *   · `attachmentsHash` filled for dedup recognition
 *   · `provider` / `model` / token stats extracted from `tokenUsage` JSON
 *
 * Strategy: fixed-batch incremental. Each cron run processes up to
 * BATCH_SIZE rows where `parts IS NULL` (cheap unique work-detector).
 * Self-throttling — runs until no work or hits BATCH_SIZE. Safe to
 * trigger N times; exits cleanly when complete.
 *
 * Schedule: vercel.json registers this for every 6h until it reports
 * `{ remaining: 0 }`. After backfill is complete the cron can be
 * removed (idempotent in the meantime).
 *
 * Runs ~20-50 rows/sec on Neon free-tier (limited by per-row update
 * round-trip). Estimated time to backfill the entire ChatMessage
 * table at 30K rows: ~10-20 min spread across cron runs.
 */

import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/chat-message-backfill");
import {
  extractParts,
  extractAttachments,
  computeAttachmentsHash,
  buildSearchableContent,
} from "@/lib/ai/chat/message-fields";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BATCH_SIZE = 250;

type LegacyRow = {
  id: string;
  role: string;
  content: string;
  attachments: unknown;
  tokenUsage: unknown;
  model: string | null;
};

interface BackfillStats {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
  remaining: number;
  durationMs: number;
}

export const GET = cronHandler(async () => {
  const startedAt = Date.now();
  const stats: BackfillStats = {
    processed: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    remaining: 0,
    durationMs: 0,
  };

  // Pull the work batch — rows with no `parts` set yet (the canonical
  // "this row hasn't been backfilled" predicate). NULLS FIRST default
  // ordering means we hit oldest-first which keeps the backfill stable
  // across runs.
  // Use raw SQL for the JSON-null filter — Prisma's typed `equals: null`
  // is finicky on Json fields across versions, raw IS NULL is universal.
  const rows = (await prisma.$queryRaw<LegacyRow[]>`
    SELECT id, role, content, attachments, "token_usage" AS "tokenUsage", model
    FROM chat_messages
    WHERE parts IS NULL
    ORDER BY created_at ASC
    LIMIT ${BATCH_SIZE}
  `);

  for (const row of rows) {
    stats.processed++;
    try {
      // ── Build derived parts tree from legacy content + attachments ──
      const legacyAtts = Array.isArray(row.attachments)
        ? (row.attachments as Array<Record<string, unknown>>)
        : [];
      const synthParts: Array<Record<string, unknown>> = [];
      if (row.content && row.content.trim().length > 0) {
        synthParts.push({ type: "text", text: row.content });
      }
      for (const a of legacyAtts) {
        if (!a || typeof a !== "object") continue;
        const ao = a as Record<string, unknown>;
        if (ao.type === "file" && typeof ao.url === "string") {
          synthParts.push({
            type: "file",
            url: ao.url,
            mediaType: typeof ao.mediaType === "string" ? ao.mediaType : undefined,
            filename: typeof ao.filename === "string" ? ao.filename : undefined,
          });
        }
      }
      const parts = extractParts(synthParts, row.content);
      const attachments = extractAttachments(parts);
      const attachmentsHash = computeAttachmentsHash(attachments);
      const searchableContent = buildSearchableContent(parts, row.content);

      // ── Pull provider / token stats from legacy tokenUsage Json ──
      const usage = (row.tokenUsage ?? null) as Record<string, unknown> | null;
      const provider = typeof usage?.provider === "string" ? (usage.provider as string).slice(0, 32) : null;
      const promptTokens =
        typeof usage?.promptTokens === "number" ? (usage.promptTokens as number) : null;
      const completionTokens =
        typeof usage?.completionTokens === "number" ? (usage.completionTokens as number) : null;

      const update: Record<string, unknown> = {
        parts: parts as unknown as Parameters<typeof prisma.chatMessage.update>[0]["data"]["parts"],
        searchableContent: searchableContent ?? undefined,
        attachmentsHash: attachmentsHash ?? undefined,
      };
      if (provider) update.provider = provider;
      if (promptTokens !== null) update.promptTokens = promptTokens;
      if (completionTokens !== null) update.completionTokens = completionTokens;

      await prisma.chatMessage.update({
        where: { id: row.id },
        data: update as Parameters<typeof prisma.chatMessage.update>[0]["data"],
      });
      stats.updated++;
    } catch (err) {
      stats.errors++;
      log.warn("row_failed", { rowId: row.id, err: err instanceof Error ? err.message : String(err) });
    }
  }

  // How much work remains so the cron can self-schedule. Same raw-SQL
  // pattern for JSON IS NULL.
  const remainingRows = await prisma.$queryRaw<Array<{ c: bigint }>>`
    SELECT COUNT(*)::bigint AS c FROM chat_messages WHERE parts IS NULL
  `.catch(() => [{ c: 0n }] as Array<{ c: bigint }>);
  stats.remaining = Number(remainingRows[0]?.c ?? 0);

  stats.durationMs = Date.now() - startedAt;

  // Also backfill ChatConversation.messageCount + lastActiveAt for
  // legacy conversations. One-shot pass per cron run; the SQL is
  // cheap enough to run every time even at scale (uses indexes).
  await prisma.$executeRawUnsafe(`
    UPDATE chat_conversations c
       SET message_count = sub.cnt,
           last_active_at = sub.last_at
      FROM (
        SELECT conversation_id,
               COUNT(*)::int AS cnt,
               MAX(created_at) AS last_at
          FROM chat_messages
         GROUP BY conversation_id
      ) sub
     WHERE c.id = sub.conversation_id
       AND (c.message_count = 0 OR c.last_active_at IS NULL)
  `).catch((err: unknown) => {
    log.warn("conv_rollup_failed", { err: err instanceof Error ? err.message : String(err) });
  });

  return {
    ok: stats.errors === 0,
    ...stats,
    summary: `${stats.updated}/${stats.processed} rows backfilled · ${stats.remaining} remaining · ${stats.durationMs}ms`,
  };
});
