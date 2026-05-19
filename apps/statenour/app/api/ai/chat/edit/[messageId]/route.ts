/**
 * Message edit API — PATCH (rewrite) + GET (history view) + DELETE (truncate).
 *
 * v7.6 · C9 · Apr 29 · ChatMessage Batch A.
 *
 * Phase JJ (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/chat-edit.ts` (`readMessageEditView` + `editChatMessage`)
 * so both this REST endpoint AND the new `trpc.chat.editHistory` query +
 * `trpc.chat.editMessage` mutation call the same functions · drift
 * between the two consumers is structurally impossible. Stays mounted
 * for back-compat with any non-tRPC consumer.
 *
 * PATCH /api/ai/chat/edit/[messageId]
 *   Body: { content: string }
 *   Effect: prepend prior content to editHistory[], set editedAt = now,
 *           replace content + searchableContent + parts (synthesized
 *           text part). Edit history capped to last 10 versions.
 *
 * GET /api/ai/chat/edit/[messageId]
 *   Returns: { content, editedAt, editHistory: [{at, prevContent}] }
 *   For the "see prior versions" drawer.
 *
 * DELETE /api/ai/chat/edit/[messageId] · v10.0.28
 *   Hard-deletes the target message AND every subsequent message in
 *   the same conversation. Kept on REST (separate concern · not migrated
 *   in Phase JJ).
 *
 * Auth: session (each chat is private to Nour).
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import { logUpdate } from "@/lib/db/entity-audit";
import {
  readMessageEditView,
  editChatMessage,
  MessageNotFoundError,
  ConcurrentEditError,
  EmptyContentError,
  ContentTooLongError,
} from "@/lib/services/chat-edit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

interface EditBody {
  content?: string;
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;
  if (!messageId) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

  try {
    return NextResponse.json(await readMessageEditView({ messageId }));
  } catch (err) {
    if (err instanceof MessageNotFoundError) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "fetch failed" },
      { status: 500 },
    );
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;
  if (!messageId) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

  let body: EditBody;
  try {
    body = (await req.json()) as EditBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  try {
    const result = await editChatMessage({
      messageId,
      content: body.content ?? "",
    });
    if (result.unchanged) {
      return NextResponse.json({ ok: true, unchanged: true, messageId });
    }
    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      content: result.content,
      editedAt: result.editedAt,
      editHistoryCount: result.editHistoryCount,
    });
  } catch (err) {
    if (err instanceof EmptyContentError) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }
    if (err instanceof ContentTooLongError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof MessageNotFoundError) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }
    if (err instanceof ConcurrentEditError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    const code = (err as { code?: string }).code;
    if (code === "P2025") {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "edit failed" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/ai/chat/edit/[messageId] · v10.0.28
 *
 * Hard-deletes the target message AND every subsequent message in
 * the same conversation. Used by the chat page's `onDelete` long-
 * press action — pre-v10.0.28 the client truncated `messages` state
 * locally without calling the server, so the deleted messages
 * reappeared on next reload (server/client drift).
 *
 * Why "and subsequent": the user is removing a turn from history.
 * Keeping later messages without their context creates an
 * orphan reply chain that doesn't make sense on reload.
 *
 * Phase JJ · NOT migrated to tRPC · separate concern (not used by
 * MessageEditControls · used by chat page). Stays on REST.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ messageId: string }> },
) {
  try {
    await requireSession(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { messageId } = await params;
  if (!messageId) {
    return NextResponse.json({ error: "messageId required" }, { status: 400 });
  }

  try {
    const target = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, createdAt: true, content: true },
    });
    if (!target) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }

    // Delete this message + every later message in the same convo.
    const result = await prisma.chatMessage.deleteMany({
      where: {
        conversationId: target.conversationId,
        createdAt: { gte: target.createdAt },
      },
    });

    void logUpdate(
      "chatMessage",
      target.id,
      { content: target.content },
      { content: null },
      {
        source: "api:ai/chat/edit.DELETE",
        reason: `user deleted message + ${result.count - 1} subsequent`,
      },
    );

    return NextResponse.json({
      ok: true,
      messageId,
      deletedCount: result.count,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
