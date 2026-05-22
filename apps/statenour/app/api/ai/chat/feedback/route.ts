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
import { requireSession } from "@/lib/auth-guard";
import { logger as rootLogger } from "@/lib/logger";
import {
  recordMessageFeedback,
  InvalidFeedbackScoreError,
  MessageFeedbackNotFoundError,
} from "@/lib/services/chat-feedback";

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

  // Phase B.5 · score normalization + 3-tier messageId resolution +
  // the fire-and-forget BrainMemory / AuditEvent writes all live in
  // the shared `recordMessageFeedback` service · `trpc.chat.message
  // Feedback` calls the same function · drift impossible.
  try {
    const result = await recordMessageFeedback({
      messageId: body.messageId,
      score: body.score ?? null,
      reason: body.reason,
      snippet: body.snippet,
      conversationId: body.conversationId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof InvalidFeedbackScoreError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof MessageFeedbackNotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
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
