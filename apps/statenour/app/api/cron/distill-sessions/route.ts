/**
 * GET /api/cron/distill-sessions — fold idle chat sessions into
 * distilled memory summaries.
 *
 * Apr 18. RESTORED 2026-08-06 after being deleted in cfc6b38b
 * ("chore · wave AE · cron prune · 107 → 35"). The prune removed this
 * route but not its consumers, which left the whole lane dead:
 *
 *   - `chat_summary` stopped accumulating (34 rows, newest 2026-06-26).
 *   - `nick_current_concerns` was NEVER written — 0 rows in prod. It is
 *     upserted by `updateNickCurrentConcerns`, which is only reachable from
 *     `distillConversation`, which only `distillIdleSessions` calls.
 *   - Consequently `buildConcernsContextBlock()` returned "" on every turn:
 *     the /chat "concerns" block fired 0 times in 1,128 measured turns.
 *
 * Two live readers were left waiting on a producer that no longer existed —
 * `lib/services/chat/brain-context.ts` (the concerns context block) and
 * `lib/brain/proactive-pushes.ts` (`fireAfternoonPush`, whose comment even
 * says it "falls back to silent when no concerns exist"). Both were silently
 * degrading rather than failing, which is why nothing surfaced it.
 *
 * SCHEDULE CHANGE FROM THE ORIGINAL: this ran every 30 minutes via
 * vercel.json. That mechanism is gone — the current architecture fans crons
 * out through lib/inngest/jobs.ts — so it is registered in EVENING_JOBS and
 * runs nightly instead. That is ample at this conversation volume, and the
 * eligibility rules below are all "since last distill", so a longer gap just
 * means each run picks up more of the backlog rather than missing anything.
 *
 * Each run picks up to 10 conversations that:
 *   • have >= 4 messages
 *   • have been idle >= 30 min
 *   • are younger than 30 days
 *   • haven't been distilled since their last message
 *
 * Writes one BrainMemory row per session (category "chat_summary",
 * key = conversationId) plus the rolling `nick_current_concerns` aggregate.
 * Downstream: the embed-backfill cron indexes these into VectorEmbedding, so
 * contextual-recall + chat-recall surface them in future chats.
 *
 * COST: bounded. One LLM call per distilled conversation, capped at 10 per
 * run by the batch size below, and only for conversations that have actually
 * changed since their last distill.
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
