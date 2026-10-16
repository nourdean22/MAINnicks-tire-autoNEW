/**
 * lib/services/chat/user-turn-identity.ts - find a turn's user row from the id the client holds.
 *
 * A live thread names its user message by the client-minted id (stored in
 * chat_messages.client_message_id). A hydrated thread names it by the DATABASE id:
 * use-conversations.ts maps id = chat_messages.id and carries the minted id as a separate top-level
 * clientMessageId field on the message, which the chat route does not read.
 * So the first Regenerate of a loaded conversation arrives as "cuid..." while the row's
 * client_message_id is still the original UUID, and a lookup by clientMessageId alone
 * misses it (persistUserTurn then wrote a second copy of the user message).
 *
 * The same either-id rule as chat-edit.deleteMessageCascade, in one query.
 */
import { prisma } from "@/lib/prisma";

export interface UserTurnRow {
  id: string;
  conversationId: string;
  clientMessageId: string | null;
  createdAt: Date;
}

const select = { id: true, conversationId: true, clientMessageId: true, createdAt: true } as const;

/**
 * `conversationId: null` is a first-send replay: the client never learned the thread id, so the
 * message can only be named by the id it minted, and that is the only column matched (a database id
 * from some other thread must not attach a request to it). Scoped to a thread it is one query, either
 * id. Oldest first, so two rows that share an id (the lease-lapse and fail-open cases allow it) still
 * resolve the same way every time. Throws on a store failure; callers decide whether an unreadable row
 * is "absent" (a first send) or "unknown" (turn-guard.ts).
 */
export async function findUserTurnRow(input: {
  conversationId: string | null | undefined;
  messageId: string;
}): Promise<UserTurnRow | null> {
  const where = input.conversationId
    ? { role: "user", conversationId: input.conversationId, OR: [{ clientMessageId: input.messageId }, { id: input.messageId }] }
    : { role: "user", clientMessageId: input.messageId };
  return prisma.chatMessage.findFirst({ where, orderBy: { createdAt: "asc" }, select });
}
