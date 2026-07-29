/**
 * GET /api/ai/chat/[conversationId]/stream — reconnect-to-stream
 * (2026-07-29 · dossier WP-A, scoped V1).
 *
 * The DefaultChatTransport's resume protocol GETs this URL on mount
 * when `useChat({ resume: true })` and a turn was in flight. Contract:
 *
 *   · 204 → nothing to resume (no active record, sentinel id, private
 *     mode, or the turn's message predates this reconnect window).
 *   · SSE UIMessage stream → the PERSISTED assistant reply, replayed
 *     verbatim. The model is NEVER re-run from here; a resume
 *     transports existing bytes only (WP-A invariant 3).
 *
 * While the turn is still active we wait briefly for the durable
 * completion (the chat route's consumeStream guarantees it arrives
 * even if the original client died), then replay. Timeout → 204 —
 * the client keeps its old behavior, never a fake completion.
 */
import type { NextRequest } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  getActiveStream,
  buildReplayChunks,
} from "@/lib/services/chat/active-stream";
import { aiRouteError } from "@/lib/utils/http";

export const maxDuration = 30;

const POLL_MS = 500;
const MAX_WAIT_MS = 20_000;

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    await requireSession(req);
    const { conversationId } = await context.params;
    if (!conversationId || conversationId === "none") {
      return new Response(null, { status: 204 });
    }

    let record = await getActiveStream(conversationId);
    if (!record) return new Response(null, { status: 204 });

    // Wait for durable completion when the turn is still in flight.
    const deadline = Date.now() + MAX_WAIT_MS;
    while (record && record.status === "active" && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, POLL_MS));
      record = await getActiveStream(conversationId);
    }
    if (!record || record.status !== "complete") {
      return new Response(null, { status: 204 });
    }

    const message = await prisma.chatMessage.findFirst({
      where: {
        conversationId,
        role: "assistant",
        createdAt: { gte: new Date(record.startedAt) },
      },
      orderBy: { createdAt: "desc" },
      select: { id: true, content: true },
    });
    if (!message) return new Response(null, { status: 204 });

    const chunks = buildReplayChunks(message.id, message.content);
    const stream = createUIMessageStream({
      execute({ writer }) {
        for (const chunk of chunks) {
          writer.write(chunk as unknown as UIMessageChunk);
        }
      },
    });
    return createUIMessageStreamResponse({ stream });
  } catch (err) {
    return aiRouteError(err, "ai/chat/stream-resume", "Stream resume failed");
  }
}
