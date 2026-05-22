/**
 * lib/services/chat-fork.ts · misc-pages slice (2026-05-22 ·
 * legacy-modernizer REST→tRPC).
 *
 * Conversation branching · lifted verbatim from
 * app/api/chat/fork/route.ts. Creates a new ChatConversation that
 * inherits every message from a source conversation UP TO a given
 * pivot message — letting the operator explore an alternate path from
 * any point without losing the original thread.
 *
 * The legacy POST /api/chat/fork AND the new `chat.fork` tRPC mutation
 * call the SAME `forkConversation` function · drift between consumers
 * structurally impossible.
 *
 * `forkConversation` returns an EXPLICIT, shallow shape
 * (`ForkResult`) · the page reads `{ forkId, title }`. No Json column
 * reaches the return type. Bad-input cases throw typed errors the
 * route + tRPC layer translate identically.
 */

import { prisma } from "@/lib/prisma";

/** Shallow result · mirrors the legacy route's JSON envelope + the
 *  page's `{ forkId, title }` read. */
export interface ForkResult {
  forkId: string;
  title: string;
  messageCount: number;
}

/** Source conversation not found. → 404 / NOT_FOUND. */
export class ForkSourceNotFoundError extends Error {
  constructor() {
    super("source conversation not found");
    this.name = "ForkSourceNotFoundError";
  }
}

/** Pivot message missing, or not part of the source conversation, or
 *  no messages up to the pivot. → 400 / BAD_REQUEST. */
export class ForkInvalidPivotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForkInvalidPivotError";
  }
}

export interface ForkConversationInput {
  sourceConversationId: string;
  upToMessageId: string;
  titleSuffix?: string;
}

/**
 * Fork a conversation up to (and including) a pivot message. Writes a
 * new ChatConversation with copied messages + an AuditEvent. Throws
 * `ForkSourceNotFoundError` / `ForkInvalidPivotError` for the legacy
 * route's 404 / 400 branches.
 */
export async function forkConversation(
  input: ForkConversationInput,
): Promise<ForkResult> {
  // 1. Load the source conversation + find the pivot message
  const [source, pivot] = await Promise.all([
    prisma.chatConversation.findUnique({
      where: { id: input.sourceConversationId },
      select: { id: true, title: true },
    }),
    prisma.chatMessage.findUnique({
      where: { id: input.upToMessageId },
      select: { id: true, createdAt: true, conversationId: true },
    }),
  ]);

  if (!source) {
    throw new ForkSourceNotFoundError();
  }
  if (!pivot || pivot.conversationId !== input.sourceConversationId) {
    throw new ForkInvalidPivotError("pivot message not in source conversation");
  }

  // 2. Pull every message up to and including the pivot
  const messagesToCopy = await prisma.chatMessage.findMany({
    where: {
      conversationId: input.sourceConversationId,
      createdAt: { lte: pivot.createdAt },
    },
    orderBy: { createdAt: "asc" },
    select: {
      role: true,
      content: true,
      model: true,
      tokenUsage: true,
      createdAt: true,
    },
  });

  if (messagesToCopy.length === 0) {
    throw new ForkInvalidPivotError("no messages to fork");
  }

  // 3. Build the new conversation title
  const sourceTitle = source.title || "Conversation";
  const suffix = input.titleSuffix || "fork";
  const newTitle = `${sourceTitle.slice(0, 60)} · ${suffix}`;

  // 4. Create the fork + copy messages in a transaction
  const fork = await prisma.chatConversation.create({
    data: {
      title: newTitle,
      messages: {
        create: messagesToCopy.map((m) => ({
          role: m.role,
          content: m.content,
          model: m.model,
          tokenUsage:
            m.tokenUsage === null
              ? undefined
              : (m.tokenUsage as object | undefined),
        })),
      },
    },
    select: {
      id: true,
      title: true,
      _count: { select: { messages: true } },
    },
  });

  // 5. Audit log so the deploys/memory-decay/audit pages can see it
  await prisma.auditEvent
    .create({
      data: {
        actor: "chat_fork",
        eventType: "conversation_forked",
        detail: `${input.sourceConversationId} → ${fork.id}`,
        payload: JSON.parse(
          JSON.stringify({
            sourceId: input.sourceConversationId,
            forkId: fork.id,
            pivotMessageId: input.upToMessageId,
            messageCount: fork._count.messages,
          }),
        ),
      },
    })
    .catch(() => {});

  return {
    forkId: fork.id,
    title: fork.title ?? newTitle,
    messageCount: fork._count.messages,
  };
}
