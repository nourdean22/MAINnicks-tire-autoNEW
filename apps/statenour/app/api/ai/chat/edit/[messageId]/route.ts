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
import { requireSession } from "@/lib/auth-guard";
import {
  readMessageEditView,
  editChatMessage,
  deleteMessageCascade,
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
 * press action.
 *
 * Why "and subsequent": the user is removing a turn from history.
 * Keeping later messages without their context creates an
 * orphan reply chain that doesn't make sense on reload.
 *
 * hooks-lib REST→tRPC slice (2026-05-22) · the cascade-delete logic
 * moved verbatim to `lib/services/chat-edit.deleteMessageCascade` so
 * this legacy REST consumer AND the new `chat.deleteMessage` tRPC
 * mutation can't drift. `useChatMessageActions` now fires tRPC; this
 * route stays mounted as the coexistence / rollback path.
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
    const result = await deleteMessageCascade({ messageId });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof MessageNotFoundError) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "delete failed" },
      { status: 500 },
    );
  }
}
