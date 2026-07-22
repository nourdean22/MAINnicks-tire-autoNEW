/**
 * Chat fast-path handlers · shared utilities
 *
 * Two pieces are reused by every handler in this directory:
 *
 *   · buildFastStream            — wraps confirmation text in the
 *                                  Vercel AI v6 UI Message protocol so
 *                                  the client renderer treats it
 *                                  identically to a streamed model
 *                                  response.
 *   · ensureConvAndPersistUser   — creates the conversation if missing,
 *                                  persists the user message, dedups
 *                                  silent-retry POSTs within a 30s
 *                                  window so the user's row doesn't
 *                                  double-persist.
 *
 * Lives next to the handlers (lib/ai/chat/handlers/*) instead of the
 * top-level interceptors.ts so each handler file can stay small AND
 * the regex constants exported from interceptors.ts can be imported
 * here without creating a cycle (handlers depend on shared · shared
 * depends on prisma + recordError only · interceptors.ts depends on
 * both shared and handlers).
 */

import { prisma } from "@/lib/prisma";
import { recordError } from "@/lib/errors/record-error";

/**
 * Wrap confirmation text in the Vercel AI v6 UI Message protocol so
 * the client renderer treats it identically to a streamed model
 * response. messageIdPrefix is a short label used in logs + as the
 * stream id.
 */
export async function buildFastStream(
  convId: string,
  confirmationText: string,
  messageIdPrefix: string,
  modelTag: string,
): Promise<Response> {
  if (convId && convId !== "temp") {
    // v7.6 · ChatMessage Batch A · Apr 29 — fast-path writes now
    // populate the rich-content + observability columns so reload
    // hydrates properly + FTS indexes these confirmations.
    await prisma.chatMessage
      .create({
        data: {
          conversationId: convId,
          role: "assistant",
          content: confirmationText,
          model: modelTag,
          parts: [{ type: "text", text: confirmationText }] as unknown as Parameters<typeof prisma.chatMessage.create>[0]["data"]["parts"],
          searchableContent: confirmationText,
          streamingState: "complete",
          provider: "fast-path",
          routerReason: messageIdPrefix,
          // fast-path is synchronous so latency is the build cost only
          latencyMs: 0,
        },
      })
      .catch((dbErr) =>
        recordError("chat:db-write", dbErr, { path: messageIdPrefix }),
      );
    // v7.6 · Bump conversation activity for sidebar sort + count.
    // 2026-05-27 · the bare swallow hid a data mystery (sidebar sort
    // stuck, message count stale) when the conversation row vanished
    // mid-write — log so the next operator who hits "why is this
    // convo at the bottom forever" can grep prod logs.
    prisma.chatConversation
      .update({
        where: { id: convId },
        data: { messageCount: { increment: 1 }, lastActiveAt: new Date() },
      })
      .catch((err) => {
        console.warn(
          "[chat/handlers/shared] chatConversation.update failed for",
          convId,
          ":",
          err instanceof Error ? err.message : err,
        );
        return null;
      });
  }
  const messageId = `${messageIdPrefix}_${Date.now()}`;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const lines = [
        `data: ${JSON.stringify({ type: "start", messageId })}\n\n`,
        `data: ${JSON.stringify({ type: "start-step" })}\n\n`,
        `data: ${JSON.stringify({ type: "text-start", id: "t1" })}\n\n`,
        `data: ${JSON.stringify({ type: "text-delta", id: "t1", delta: confirmationText })}\n\n`,
        `data: ${JSON.stringify({ type: "text-end", id: "t1" })}\n\n`,
        `data: ${JSON.stringify({ type: "finish-step" })}\n\n`,
        `data: ${JSON.stringify({ type: "finish" })}\n\n`,
        `data: [DONE]\n\n`,
      ];
      for (const line of lines) controller.enqueue(encoder.encode(line));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Conversation-Id": convId && convId !== "private" && convId !== "temp" ? convId : "",
      "X-Vercel-AI-UI-Message-Stream": "v1",
    },
  });
}

/**
 * All three handlers share this front-matter: ensure convId exists,
 * persist the user message so /chat history is consistent. Returns
 * the resolved convId (or "temp" sentinel if DB writes failed —
 * downstream still streams successfully without persistence).
 */
export async function ensureConvAndPersistUser(
  convId: string | undefined,
  userContent: string,
  lastUserMsg: { role?: string },
): Promise<string> {
  let id = convId;
  if (!id) {
    try {
      const firstText = userContent || "New chat";
      const conv = await prisma.chatConversation.create({
        data: { title: firstText.slice(0, 80) },
      });
      id = conv.id;
    } catch (dbErr) {
      recordError("chat:db-write", dbErr, { path: "fast-path-conv-create" });
      id = "temp";
    }
  }
  if (lastUserMsg?.role === "user" && id && id !== "temp") {
    // v7 · Apr 28 · Dedup guard. Silent-retry can re-fire the same POST
    // and double-persist user messages. Skip if identical content
    // already persisted in the last 30s.
    const dupSince = new Date(Date.now() - 30_000);
    const existingDupe = await prisma.chatMessage
      .findFirst({
        where: {
          conversationId: id,
          role: "user",
          content: userContent,
          createdAt: { gte: dupSince },
        },
        select: { id: true },
      })
      .catch(() => null);
    if (existingDupe) {
      console.warn(
        `[fast-path] duplicate user message in ${id.slice(0, 8)} suppressed`,
      );
      return id;
    }
    await prisma.chatMessage
      .create({
        data: { conversationId: id, role: "user", content: userContent },
      })
      .catch((dbErr) =>
        recordError("chat:db-write", dbErr, { path: "fast-path-user-msg" }),
      );
  }
  return id;
}
