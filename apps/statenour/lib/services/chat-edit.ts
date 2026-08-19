/**
 * Chat message edit · view + edit shared service (Phase JJ · 2026-05-18 PM).
 *
 * Single source of truth for reading the edit history and applying an
 * in-place edit. Called by BOTH the legacy REST handler at
 * `app/api/ai/chat/edit/[messageId]/route.ts` AND the new tRPC
 * `trpc.chat.editHistory` query + `trpc.chat.editMessage` mutation.
 * Drift between the two consumers is structurally impossible.
 *
 * Concurrency · the edit path uses Prisma's `updateMany` scoped on the
 * `editedAt` value we just read · two simultaneous edits surface as
 * count=0 (NOT P2025 · that's an update-only error). Throws
 * ConcurrentEditError so the tRPC layer can translate to CONFLICT and
 * the REST layer to 409.
 *
 * Edge cases · empty content + length cap + unchanged-content no-op all
 * raise typed errors handled by both transports.
 */

import { prisma } from "@/lib/prisma";
import {
  extractParts,
  buildSearchableContent,
} from "@/lib/ai/chat/message-fields";
import { logUpdate } from "@/lib/db/entity-audit";

const MAX_HISTORY_ENTRIES = 10;
export const MAX_CONTENT_CHARS = 10_000;

export class MessageNotFoundError extends Error {
  constructor(public readonly messageId: string) {
    super(`message not found: ${messageId}`);
    this.name = "MessageNotFoundError";
  }
}

export class ConcurrentEditError extends Error {
  constructor(public readonly messageId: string) {
    super("message changed concurrently — please retry");
    this.name = "ConcurrentEditError";
  }
}

export class EmptyContentError extends Error {
  constructor() {
    super("content required");
    this.name = "EmptyContentError";
  }
}

export class ContentTooLongError extends Error {
  constructor() {
    super(`content too long (max ${MAX_CONTENT_CHARS} chars)`);
    this.name = "ContentTooLongError";
  }
}

export interface EditHistoryEntry {
  at: string;
  prevContent: string;
}

export interface MessageEditView {
  messageId: string;
  role: string;
  content: string;
  editedAt: Date | null;
  editHistory: EditHistoryEntry[];
}

export interface EditMessageResult {
  messageId: string;
  /** `true` when the new content matched existing content · no write. */
  unchanged?: boolean;
  content: string;
  editedAt: Date | string;
  editHistoryCount: number;
}

export interface DeleteMessageResult {
  messageId: string;
  /** Count of rows removed — the target + every subsequent message. */
  deletedCount: number;
}

/**
 * Read a single chat message + its edit history view.
 * Throws MessageNotFoundError when missing.
 */
export async function readMessageEditView({
  messageId,
}: {
  messageId: string;
}): Promise<MessageEditView> {
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
    throw new MessageNotFoundError(messageId);
  }
  return {
    messageId: msg.id,
    role: msg.role,
    content: msg.content,
    editedAt: msg.editedAt,
    editHistory: Array.isArray(msg.editHistory)
      ? (msg.editHistory as unknown as EditHistoryEntry[])
      : [],
  };
}

/**
 * Apply an in-place edit to a chat message with optimistic-concurrency
 * protection. Returns `{unchanged: true}` when the new content matches
 * existing (idempotent · doesn't pollute history).
 *
 * Throws:
 *   · EmptyContentError       — content blank after trim
 *   · ContentTooLongError     — content > MAX_CONTENT_CHARS
 *   · MessageNotFoundError    — messageId not in DB
 *   · ConcurrentEditError     — another writer raced us · 409 CONFLICT
 */
export async function editChatMessage({
  messageId,
  content,
}: {
  messageId: string;
  content: string;
}): Promise<EditMessageResult> {
  const newContent = (content ?? "").trim();
  if (!newContent) {
    throw new EmptyContentError();
  }
  if (newContent.length > MAX_CONTENT_CHARS) {
    throw new ContentTooLongError();
  }

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
    throw new MessageNotFoundError(messageId);
  }

  // No-op when content didn't actually change. Don't pollute history.
  if (existing.content === newContent) {
    return {
      messageId,
      unchanged: true,
      content: existing.content,
      editedAt: existing.editedAt ?? new Date(0),
      editHistoryCount: Array.isArray(existing.editHistory)
        ? existing.editHistory.length
        : 0,
    };
  }

  // Append the prior content to history (most recent first).
  const priorHistory = Array.isArray(existing.editHistory)
    ? (existing.editHistory as unknown as EditHistoryEntry[])
    : [];
  const nextHistory: EditHistoryEntry[] = [
    { at: new Date().toISOString(), prevContent: existing.content },
    ...priorHistory,
  ].slice(0, MAX_HISTORY_ENTRIES);

  // Synthesize new parts tree from new content + existing attachments.
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

  // Optimistic-concurrency check via updateMany count=0.
  const updateResult = await prisma.chatMessage.updateMany({
    where: { id: messageId, editedAt: existing.editedAt },
    data: {
      content: newContent,
      parts: parts as unknown as Parameters<
        typeof prisma.chatMessage.updateMany
      >[0]["data"]["parts"],
      searchableContent: searchableContent ?? undefined,
      editedAt: new Date(),
      editHistory: nextHistory as unknown as Parameters<
        typeof prisma.chatMessage.updateMany
      >[0]["data"]["editHistory"],
    },
  });
  if (updateResult.count === 0) {
    throw new ConcurrentEditError(messageId);
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
    // Vanishingly rare · the row was deleted between updateMany and
    // findUnique. Surface as not-found so the caller can retry.
    throw new MessageNotFoundError(messageId);
  }

  // High-signal audit event · before/after capture is just the content
  // field. The parts blob is huge and editHistory preserves prior
  // versions inline.
  void logUpdate(
    "chatMessage",
    updated.id,
    { content: existing.content },
    { content: updated.content },
    { source: "service:chat-edit.editChatMessage", reason: "user edited message" },
  );

  return {
    messageId: updated.id,
    content: updated.content,
    editedAt: updated.editedAt ?? new Date(),
    editHistoryCount: Array.isArray(updated.editHistory)
      ? updated.editHistory.length
      : 0,
  };
}

/**
 * Hard-delete a chat message AND every subsequent message in the same
 * conversation. The operator is removing a turn from history; keeping
 * later messages without their context creates an orphan reply chain
 * that doesn't make sense on reload — so the cascade truncates from
 * the target's `createdAt` forward.
 *
 * Extracted from the DELETE handler of
 * `app/api/ai/chat/edit/[messageId]/route.ts` (hooks-lib REST→tRPC
 * slice · 2026-05-22) so the legacy REST endpoint AND the new
 * `chat.deleteMessage` tRPC mutation call the same function · drift
 * impossible. Throws MessageNotFoundError on a missing id.
 */
export async function deleteMessageCascade({
  messageId,
}: {
  messageId: string;
}): Promise<DeleteMessageResult> {
  // 2026-08-18 · resolve by row id OR clientMessageId. A message the
  // operator JUST sent still carries the client-minted UUID in the live
  // useChat state (the DB row id is a cuid; the UUID lands in
  // clientMessageId via the idempotency upsert) — and "fix the message
  // I just sent" is the #1 edit case, which used to NOT_FOUND here.
  // Row id wins when both match something (findFirst tries it first).
  const target =
    (await prisma.chatMessage.findUnique({
      where: { id: messageId },
      select: { id: true, conversationId: true, createdAt: true, content: true },
    })) ??
    (await prisma.chatMessage.findFirst({
      where: { clientMessageId: messageId },
      select: { id: true, conversationId: true, createdAt: true, content: true },
    }));
  if (!target) {
    throw new MessageNotFoundError(messageId);
  }

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
      source: "service:chat-edit.deleteMessageCascade",
      reason: `user deleted message + ${result.count - 1} subsequent`,
    },
  );

  return { messageId, deletedCount: result.count };
}
