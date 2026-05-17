/**
 * Message edit API — PATCH (rewrite) + GET (history view).
 *
 * v7.6 · C9 · Apr 29 · ChatMessage Batch A.
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
 * Auth: session (each chat is private to Nour).
 *
 * Edge cases:
 *   · empty content       → 400
 *   · content > 10K chars → 400 (sanity ceiling — long messages are unusual)
 *   · content unchanged   → 200 no-op (idempotent)
 *   · message not found   → 404
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth-guard";
import {
  extractParts,
  buildSearchableContent,
} from "@/lib/ai/chat/message-fields";
import { logUpdate } from "@/lib/db/entity-audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

const MAX_HISTORY_ENTRIES = 10;
const MAX_CONTENT_CHARS = 10_000;

interface EditBody {
  content?: string;
}

interface EditHistoryEntry {
  at: string;
  prevContent: string;
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
    const msg = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        content: true,
        editedAt: true,
        editHistory: true,
        role: true,
      },
    });
    if (!msg) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }
    return NextResponse.json({
      messageId: msg.id,
      role: msg.role,
      content: msg.content,
      editedAt: msg.editedAt,
      editHistory: Array.isArray(msg.editHistory) ? (msg.editHistory as unknown as EditHistoryEntry[]) : [],
    });
  } catch (err) {
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

  const newContent = (body.content ?? "").trim();
  if (!newContent) {
    return NextResponse.json({ error: "content required" }, { status: 400 });
  }
  if (newContent.length > MAX_CONTENT_CHARS) {
    return NextResponse.json(
      { error: `content too long (max ${MAX_CONTENT_CHARS} chars)` },
      { status: 400 },
    );
  }

  try {
    // v10.0.111 audit fix · optimistic-concurrency check via updateMany.
    // Pre-fix, two simultaneous edits from two devices would last-write-
    // win with neither write seeing the other's editHistory snapshot —
    // one version silently dropped. The fix scopes updateMany on the
    // editedAt value we just read, so a concurrent edit causes count=0
    // (not P2025 — that's an update-only error) and the client sees 409.
    const existing = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        content: true,
        editHistory: true,
        attachments: true,
        editedAt: true,
      },
    });
    if (!existing) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }

    // No-op when content didn't actually change. Don't pollute the
    // history with empty edits.
    if (existing.content === newContent) {
      return NextResponse.json({ ok: true, unchanged: true, messageId });
    }

    // Append the prior content to history (most recent first).
    const priorHistory = Array.isArray(existing.editHistory)
      ? (existing.editHistory as unknown as EditHistoryEntry[])
      : [];
    const nextHistory: EditHistoryEntry[] = [
      { at: new Date().toISOString(), prevContent: existing.content },
      ...priorHistory,
    ].slice(0, MAX_HISTORY_ENTRIES);

    // Synthesize new parts tree from the new content + existing
    // attachments (file parts survive an edit).
    const synthParts: Array<Record<string, unknown>> = [
      { type: "text", text: newContent },
    ];
    const legacyAtts = Array.isArray(existing.attachments)
      ? (existing.attachments as Array<Record<string, unknown>>)
      : [];
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
    const parts = extractParts(synthParts, newContent);
    const searchableContent = buildSearchableContent(parts, newContent);

    // updateMany returns count=0 when the where-clause filters all rows.
    // We use that as the optimistic-concurrency check: scope on
    // editedAt being the value we read so a concurrent edit causes
    // count=0, NOT a P2025 thrown error.
    const updateResult = await prisma.chatMessage.updateMany({
      where: { id: messageId, editedAt: existing.editedAt },
      data: {
        content: newContent,
        parts: parts as unknown as Parameters<typeof prisma.chatMessage.updateMany>[0]["data"]["parts"],
        searchableContent: searchableContent ?? undefined,
        editedAt: new Date(),
        editHistory: nextHistory as unknown as Parameters<typeof prisma.chatMessage.updateMany>[0]["data"]["editHistory"],
      },
    });
    if (updateResult.count === 0) {
      return NextResponse.json(
        { error: "message changed concurrently — please retry" },
        { status: 409 },
      );
    }
    const updated = await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        content: true,
        editedAt: true,
        editHistory: true,
      },
    });
    if (!updated) {
      return NextResponse.json({ error: "message not found" }, { status: 404 });
    }

    // v8.0 — content edit is a high-signal audit event. before/after
    // capture is just the content field — the parts blob is huge and
    // editHistory already preserves prior versions inline.
    void logUpdate(
      "chatMessage",
      updated.id,
      { content: existing.content },
      { content: updated.content },
      { source: "api:ai/chat/edit.PATCH", reason: "user edited message" },
    );

    return NextResponse.json({
      ok: true,
      messageId: updated.id,
      content: updated.content,
      editedAt: updated.editedAt,
      editHistoryCount: Array.isArray(updated.editHistory) ? updated.editHistory.length : 0,
    });
  } catch (err) {
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
