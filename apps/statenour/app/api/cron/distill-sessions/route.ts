/**
 * GET /api/cron/distill-sessions — fold idle chat sessions into
 * distilled memory summaries.
 *
 * Apr 18. Runs every 30 minutes via vercel.json.
 *
 * Each run picks up to 10 conversations that:
 *   • have ≥ 4 messages
 *   • have been idle ≥ 30 min
 *   • are younger than 30 days
 *   • haven't been distilled since their last message
 *
 * Writes one BrainMemory row per session (category "chat_summary",
 * key = conversationId). Downstream: the embed-backfill cron picks
 * these up and indexes them into VectorEmbedding, so contextual-recall
 * + chat-recall surface them in future chats — turning every past
 * conversation into retrievable durable memory.
 */
import { cronHandler } from "@/lib/utils/http";
import { distillIdleSessions } from "@/lib/brain/session-distiller";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;

export const GET = cronHandler(async () => {
  const started = Date.now();
  const result = await distillIdleSessions(10);

  // Write a brain_insight event when we actually distilled something
  // new — makes the "Nick noticed today" ticker rotation aware that
  // the brain got smarter. Silent when no work was done.
  if (result.distilled > 0) {
    await prisma.auditEvent
      .create({
        data: {
          actor: "session_distiller",
          eventType: "brain_insight",
          detail: `Distilled ${result.distilled} past chat session${result.distilled > 1 ? "s" : ""} into durable memory`,
          payload: {
            ...result,
            durationMs: Date.now() - started,
          },
        },
      })
      .catch(() => {});
  }

  return {
    ...result,
    durationMs: Date.now() - started,
  };
});
