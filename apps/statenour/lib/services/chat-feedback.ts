/**
 * lib/services/chat-feedback.ts · Phase B.5 (2026-05-22 ·
 * legacy-modernizer REST→tRPC chat slice)
 *
 * Per-message feedback service · extracted from
 * `app/api/ai/chat/feedback/route.ts` so the legacy REST endpoint AND
 * the new `trpc.chat.messageFeedback` mutation both call this single
 * function · drift between the two consumers is structurally
 * impossible. Same shared-service pattern as Z / DD / EE / GG.
 *
 * Records a thumbs up/down on an assistant message · feeds the router
 * learning loop ground truth. On a non-null score it ALSO writes a
 * fire-and-forget BrainMemory row (today's contextual recall reads
 * it) + an AuditEvent row (the nightly learner cron joins on it).
 *
 * Behaviour preserved verbatim from the route (v10.0.515-518):
 *   · score null / 0 → clears the score
 *   · score ±1       → sets it
 *   · invalid score  → InvalidFeedbackScoreError (route 400)
 *   · 3-tier messageId resolution:
 *       1. by exact id
 *       2. by conversationId · latest assistant
 *       3. latest assistant message created in the last 60s
 *   · unresolved id  → MessageFeedbackNotFoundError (route 404)
 */

import { sendLangfuseScore } from "@/lib/observability/langfuse-scores";
import { prisma } from "@/lib/prisma";

/** Thrown when the score isn't -1 / 0 / 1 / null. Route → 400. */
export class InvalidFeedbackScoreError extends Error {
  constructor(message = "score must be -1, 0, 1, or null") {
    super(message);
    this.name = "InvalidFeedbackScoreError";
  }
}

/** Thrown when no message resolves via any of the 3 fallback tiers. */
export class MessageFeedbackNotFoundError extends Error {
  constructor(message = "message not found") {
    super(message);
    this.name = "MessageFeedbackNotFoundError";
  }
}

export interface MessageFeedbackArgs {
  messageId: string;
  /** -1 / 0 / 1 / null · 0 and null both clear. */
  score: number | null;
  /** Optional follow-up reason (#6 preference loop). */
  reason?: string;
  /** First ~200 chars of the offending reply. */
  snippet?: string;
  /** Fresh-stream fallback · resolve latest assistant in this convo. */
  conversationId?: string;
}

export interface MessageFeedbackResult {
  ok: true;
  messageId: string;
  feedbackScore: number | null;
}

export async function recordMessageFeedback(
  args: MessageFeedbackArgs,
): Promise<MessageFeedbackResult> {
  // score: null clears, 0 also clears, ±1 set
  const rawScore = args.score;
  let nextScore: number | null;
  if (rawScore == null || rawScore === 0) {
    nextScore = null;
  } else if (rawScore === 1 || rawScore === -1) {
    nextScore = rawScore;
  } else {
    throw new InvalidFeedbackScoreError();
  }

  // 3-tier messageId resolution (see header comment).
  let existing = await prisma.chatMessage.findUnique({
    where: { id: args.messageId },
    select: { id: true, conversationId: true, role: true },
  });
  if (!existing && args.conversationId) {
    existing = await prisma.chatMessage.findFirst({
      where: { conversationId: args.conversationId, role: "assistant" },
      orderBy: { createdAt: "desc" },
      select: { id: true, conversationId: true, role: true },
    });
  }
  if (!existing) {
    existing = await prisma.chatMessage.findFirst({
      where: {
        role: "assistant",
        createdAt: { gte: new Date(Date.now() - 60_000) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, conversationId: true, role: true },
    });
  }
  if (!existing) {
    throw new MessageFeedbackNotFoundError();
  }

  const updated = await prisma.chatMessage.update({
    where: { id: existing.id },
    data: { feedbackScore: nextScore },
    select: { id: true, feedbackScore: true, conversationId: true },
  });

  // Fire-and-forget: persist a brain_memory note + AuditEvent for the
  // learning loop. Negative feedback gets higher confidence.
  if (nextScore != null) {
    const fullMsg = await prisma.chatMessage
      .findUnique({
        where: { id: updated.id },
        select: { tokenUsage: true, model: true, content: true },
      })
      .catch(() => null);
    const usage = (fullMsg?.tokenUsage ?? {}) as Record<string, unknown>;

    const reason =
      typeof args.reason === "string" && args.reason.length > 0
        ? args.reason.slice(0, 1000)
        : null;
    const snippet =
      typeof args.snippet === "string" && args.snippet.length > 0
        ? args.snippet.slice(0, 200)
        : (fullMsg?.content ?? "").slice(0, 200);

    const payload = {
      messageId: updated.id,
      conversationId: updated.conversationId,
      score: nextScore,
      rating: nextScore > 0 ? "up" : "down",
      reason,
      snippet,
      model: fullMsg?.model ?? null,
      provider: typeof usage.provider === "string" ? usage.provider : null,
      persona: typeof usage.persona === "string" ? usage.persona : null,
      traceId: typeof usage.traceId === "string" ? usage.traceId : null,
      at: new Date().toISOString(),
    };

    // U6 (2026-09-08) · the same verdict reaches Langfuse as a score on the
    // turn's trace, so prompt/model quality can be asked THERE. Fire-and-forget.
    void sendLangfuseScore({ traceId: payload.traceId, name: "operator_thumb", value: nextScore, comment: reason ?? undefined });

    // Q-32 · a thumbs-down is deterministic high-value review material.
    // Queue the existing TRACE in the single configured Langfuse annotation
    // queue. Missing queue config is a clean no-op.
    if (nextScore < 0 && payload.traceId) {
      void import("@/lib/observability/langfuse-annotation-queue")
        .then(({ enqueueLangfuseTraceForAnnotation }) =>
          enqueueLangfuseTraceForAnnotation(payload.traceId),
        )
        .catch(() => false);
    }

    // Brain memory · today's contextual recall reads this.
    void prisma.brainMemory
      .create({
        data: {
          category: "chat_feedback",
          key: `feedback:${updated.id}`,
          source: "chat_ui",
          content: `score=${nextScore} on message ${updated.id} in conv ${updated.conversationId.slice(0, 8)}${reason ? ` · reason: ${reason}` : ""}`,
          confidence: nextScore < 0 ? 0.85 : 0.6,
          metadata: payload as unknown as Parameters<
            typeof prisma.brainMemory.create
          >[0]["data"]["metadata"],
        },
      })
      .catch(() => undefined);

    // AuditEvent stream for the learner cron · append-only · pinned
    // to messageId so the cron can join back to ChatMessage.
    void prisma.auditEvent
      .create({
        data: {
          actor: "operator",
          eventType: "chat_feedback",
          detail: `${payload.rating} · ${updated.id}`,
          payload,
        },
      })
      .catch(() => undefined);
  }

  return {
    ok: true,
    messageId: updated.id,
    feedbackScore: updated.feedbackScore,
  };
}
