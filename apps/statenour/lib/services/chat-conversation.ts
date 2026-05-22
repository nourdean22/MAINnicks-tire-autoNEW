/**
 * lib/services/chat-conversation.ts · Phase B.5 (2026-05-22 ·
 * legacy-modernizer REST→tRPC chat slice)
 *
 * Conversation-level mutation services · extracted from two route
 * handlers so the legacy REST endpoints AND the new
 * `trpc.chat.updateConversation` / `trpc.chat.deleteConversation`
 * procedures both call these single functions · drift between the
 * two consumers is structurally impossible. Same shared-service
 * pattern as Z / DD / EE / GG.
 *
 * Extracted from:
 *   · PATCH /api/ai/chat/conversation/[id] → updateConversation
 *   · DELETE /api/ai/chat/[id]             → deleteConversation
 *
 * Both routes keep their HTTP handlers · they only lose the inline
 * Prisma logic to these functions.
 */

import { prisma } from "@/lib/prisma";

/** Thrown when the conversation id doesn't resolve (Prisma P2025). */
export class ConversationNotFoundError extends Error {
  constructor(message = "conversation not found") {
    super(message);
    this.name = "ConversationNotFoundError";
  }
}

export interface UpdateConversationArgs {
  id: string;
  archived?: boolean;
  starred?: boolean;
  muted?: boolean;
  title?: string;
}

export interface UpdateConversationResult {
  ok: true;
  conversation: {
    id: string;
    /** Nullable · ChatConversation.title is optional in the schema. */
    title: string | null;
    archivedAt: Date | null;
    starredAt: Date | null;
    mutedAt: Date | null;
    lastActiveAt: Date | null;
    messageCount: number;
  };
}

/**
 * Toggle conversation flags (archive / star / mute) + update title.
 * Booleans map to archivedAt / starredAt / mutedAt as Date|null ·
 * title is trimmed + sliced to 200 chars. An empty title (after
 * trim) is dropped — matches the legacy route's `if (t) data.title`.
 *
 * Throws ConversationNotFoundError on a missing id (P2025) so the
 * REST handler can 404 + the tRPC procedure can NOT_FOUND. Returns
 * `{ error }` semantics — i.e. an empty patch — surface as a thrown
 * Error so callers reject identically.
 */
export async function updateConversation(
  args: UpdateConversationArgs,
): Promise<UpdateConversationResult> {
  const data: Record<string, unknown> = {};
  if (typeof args.archived === "boolean")
    data.archivedAt = args.archived ? new Date() : null;
  if (typeof args.starred === "boolean")
    data.starredAt = args.starred ? new Date() : null;
  if (typeof args.muted === "boolean")
    data.mutedAt = args.muted ? new Date() : null;
  if (typeof args.title === "string") {
    const t = args.title.trim().slice(0, 200);
    if (t) data.title = t;
  }

  if (Object.keys(data).length === 0) {
    throw new Error("no fields to update");
  }

  try {
    const updated = await prisma.chatConversation.update({
      where: { id: args.id },
      data: data as Parameters<typeof prisma.chatConversation.update>[0]["data"],
      select: {
        id: true,
        title: true,
        archivedAt: true,
        starredAt: true,
        mutedAt: true,
        lastActiveAt: true,
        messageCount: true,
      },
    });
    return { ok: true, conversation: updated };
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") {
      throw new ConversationNotFoundError();
    }
    throw err;
  }
}

/**
 * Hard-delete a conversation. Idempotent · a missing row is swallowed
 * (matches the legacy route's `.delete().catch(() => null)`), so the
 * result is always `{ ok: true }`.
 */
export async function deleteConversation(args: {
  id: string;
}): Promise<{ ok: true }> {
  await prisma.chatConversation
    .delete({ where: { id: args.id } })
    .catch((): null => null);
  return { ok: true };
}
