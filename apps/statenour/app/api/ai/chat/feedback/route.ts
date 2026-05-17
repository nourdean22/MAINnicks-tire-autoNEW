/**
 * POST /api/ai/chat/feedback — record per-message feedback.
 *
 * v7.6 · C7 · Apr 29 · ChatMessage Batch A.
 *
 * Body: { messageId: string, score: -1 | 0 | 1 | null }
 * Effect: updates chat_messages.feedback_score for the row.
 *
 * Why: gives the router learning loop ground truth. Over time we can
 * boost configurations (provider × model × routerReason × turn-shape)
 * that earn thumbs-up and de-prioritize ones that earn thumbs-down.
 *
 * Edge cases:
 *   · score === null  → clears the score
 *   · score === 0     → neutral (also clears)
 *   · score === 1/-1  → set
 *   · invalid score   → 400
 *   · non-existent id → 404
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/chat/feedback");

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

interface FeedbackBody {
  messageId?: string;
  score?: number | null;
  /** v10.0.515 · #6 preference loop · optional follow-up reason. */
  reason?: string;
  /** v10.0.515 · first ~200 chars of the offending reply. */
  snippet?: string;
  /**
   * v10.0.517 · fresh-stream fallback. useChat (AI SDK v6) assigns
   * its own id to assistant messages, which doesn't match the
   * Prisma cuid persist-assistant-turn writes. If lookup by
   * messageId 404s and conversationId is passed, resolve to the
   * latest assistant message in that conversation.
   */
  conversationId?: string;
}

export async function POST(req: Request) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: FeedbackBody;
  try {
    body = (await req.json()) as FeedbackBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!body.messageId || typeof body.messageId !== "string") {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

  // score: null clears, 0 also clears, ±1 set
  const rawScore = body.score;
  let nextScore: number | null;
  if (rawScore == null || rawScore === 0) {
    nextScore = null;
  } else if (rawScore === 1 || rawScore === -1) {
    nextScore = rawScore;
  } else {
    return NextResponse.json({ error: "score must be -1, 0, 1, or null" }, { status: 400 });
  }

  try {
    // v10.0.111 audit fix · single-user system today, but verifying
    // the message exists (and is the kind we accept feedback on) is
    // cheap and closes the door on cross-conversation feedback if a
    // second user account is ever introduced.
    //
    // v10.0.517 · fresh-stream fallback (see header comment).
    let existing = await prisma.chatMessage.findUnique({
      where: { id: body.messageId },
      select: { id: true, conversationId: true, role: true },
    });
    if (!existing && body.conversationId) {
      existing = await prisma.chatMessage.findFirst({
        where: { conversationId: body.conversationId, role: "assistant" },
        orderBy: { createdAt: "desc" },
        select: { id: true, conversationId: true, role: true },
      });
    }
    // v10.0.518 · ultimate fallback for fresh-stream feedback when
    // the chat page can't pass conversationId yet (first message of
    // a brand-new conversation). Single-operator system · "latest
    // assistant within the last 60s" resolves to the click target.
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
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }

    const updated = await prisma.chatMessage.update({
      where: { id: existing.id },
      data: { feedbackScore: nextScore },
      select: { id: true, feedbackScore: true, conversationId: true },
    });

    // Fire-and-forget: persist a brain_memory note for the learning
    // loop to mine later. Negative feedback gets higher confidence
    // (we want to learn from misses).
    if (nextScore != null) {
      // v10.0.515 · #6 preference loop · pull provider/model/persona/
      // traceId off the message's tokenUsage blob so the nightly
      // learner cron has the full turn signal pinned to each thumbs.
      const fullMsg = await prisma.chatMessage
        .findUnique({
          where: { id: updated.id },
          select: { tokenUsage: true, model: true, content: true },
        })
        .catch(() => null);
      const usage = (fullMsg?.tokenUsage ?? {}) as Record<string, unknown>;

      const reason =
        typeof body.reason === "string" && body.reason.length > 0
          ? body.reason.slice(0, 1000)
          : null;
      const snippet =
        typeof body.snippet === "string" && body.snippet.length > 0
          ? body.snippet.slice(0, 200)
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

      // Brain memory · today's contextual recall reads this.
      void prisma.brainMemory
        .create({
          data: {
            category: "chat_feedback",
            key: `feedback:${updated.id}`,
            source: "chat_ui",
            content: `score=${nextScore} on message ${updated.id} in conv ${updated.conversationId.slice(0, 8)}${reason ? ` · reason: ${reason}` : ""}`,
            confidence: nextScore < 0 ? 0.85 : 0.6,
            metadata: payload as unknown as Parameters<typeof prisma.brainMemory.create>[0]["data"]["metadata"],
          },
        })
        .catch(() => undefined);

      // v10.0.515 · #6 · AuditEvent stream for the learner cron
      // (Phase 2 work). Append-only · pinned to messageId so the
      // cron can join back to ChatMessage + AgentTrace by traceId.
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

    return NextResponse.json({ ok: true, messageId: updated.id, feedbackScore: updated.feedbackScore });
  } catch (err) {
    // v10.0.111 audit fix · do not echo Prisma error messages to
    // the client — Prisma's connection errors include the
    // DATABASE_URL string. Log full detail server-side.
    const code = (err as { code?: string }).code;
    if (code === "P2025") {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }
    log.warn("update_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return NextResponse.json(
      { error: "feedback update failed" },
      { status: 500 },
    );
  }
}
