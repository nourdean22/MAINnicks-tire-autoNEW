/**
 * lib/services/chat/user-turn-identity.ts - find a turn's user row from the id the client holds.
 *
 * A live thread names its user message by the client-minted id (stored in
 * chat_messages.client_message_id). A hydrated thread names it by the DATABASE id:
 * use-conversations.ts maps id = chat_messages.id and keeps the minted id in metadata.
 * So the first Regenerate of a loaded conversation arrives as "cuid..." while the row's
 * client_message_id is still the original UUID, and a lookup by clientMessageId alone
 * misses it (persistUserTurn then wrote a second copy of the user message).
 *
 * The same either-id rule as chat-edit.deleteMessageCascade. Two sequential indexed reads,
 * not an OR: the minted id is the common case and the second read only runs on a miss.
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
 * row can only be found by the id it minted. Throws on a store failure; callers decide whether
 * an unreadable row is "absent" (a first send) or "unknown" (turn-guard.ts).
 */
export async function findUserTurnRow(input: {
  conversationId: string | null | undefined;
  messageId: string;
}): Promise<UserTurnRow | null> {
  const scope = { role: "user", ...(input.conversationId ? { conversationId: input.conversationId } : {}) };
  const byMintedId = await prisma.chatMessage.findFirst({ where: { ...scope, clientMessageId: input.messageId }, select });
  if (byMintedId) return byMintedId;
  return prisma.chatMessage.findFirst({ where: { ...scope, id: input.messageId }, select });
}
