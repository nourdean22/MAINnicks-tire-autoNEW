/**
 * POST /api/chat/fork
 *
 * Branching conversations (#4). Creates a new chatConversation that
 * inherits all messages from an existing conversation UP TO a given
 * messageId. Lets Nour explore an alternate path from any point in
 * the chat without losing the original thread.
 *
 * Body: { sourceConversationId: string, upToMessageId: string, titleSuffix?: string }
 * Returns: { forkId, title, messageCount }
 */

import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";

import { requireSession } from "@/lib/auth-guard";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  await requireSession(req);
  try {
    const body = (await req.json()) as {
      sourceConversationId: string;
      upToMessageId: string;
      titleSuffix?: string;
    };

    if (!body.sourceConversationId || !body.upToMessageId) {
      return Response.json(
        { error: "sourceConversationId and upToMessageId required" },
        { status: 400 }
      );
    }

    // 1. Load the source conversation + find the pivot message
    const [source, pivot] = await Promise.all([
      prisma.chatConversation.findUnique({
        where: { id: body.sourceConversationId },
        select: { id: true, title: true },
      }),
      prisma.chatMessage.findUnique({
        where: { id: body.upToMessageId },
        select: { id: true, createdAt: true, conversationId: true },
      }),
    ]);

    if (!source) {
      return Response.json({ error: "source conversation not found" }, { status: 404 });
    }
    if (!pivot || pivot.conversationId !== body.sourceConversationId) {
      return Response.json(
        { error: "pivot message not in source conversation" },
        { status: 400 }
      );
    }

    // 2. Pull every message up to and including the pivot
    const messagesToCopy = await prisma.chatMessage.findMany({
      where: {
        conversationId: body.sourceConversationId,
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
      return Response.json({ error: "no messages to fork" }, { status: 400 });
    }

    // 3. Build the new conversation title
    const sourceTitle = source.title || "Conversation";
    const suffix = body.titleSuffix || "fork";
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
            tokenUsage: m.tokenUsage === null ? undefined : (m.tokenUsage as object | undefined),
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
          detail: `${body.sourceConversationId} → ${fork.id}`,
          payload: JSON.parse(
            JSON.stringify({
              sourceId: body.sourceConversationId,
              forkId: fork.id,
              pivotMessageId: body.upToMessageId,
              messageCount: fork._count.messages,
            })
          ),
        },
      })
      .catch(() => {});

    return Response.json({
      forkId: fork.id,
      title: fork.title,
      messageCount: fork._count.messages,
    });
  } catch (err) {
    recordError("api:unknown", err, { route: "chat/fork" });
    return Response.json(
      { error: err instanceof Error ? err.message : "fork failed" },
      { status: 500 }
    );
  }
}
