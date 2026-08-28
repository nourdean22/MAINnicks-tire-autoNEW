/**
 * GET /api/ai/chat/[conversationId]/stream — reconnect-to-stream
 * (2026-07-29 · dossier WP-A V1 · 2026-08-28 · WP2 V2 partial tail).
 *
 * The DefaultChatTransport's resume protocol GETs this URL on mount
 * when `useChat({ resume: true })` and a turn was in flight. Contract:
 *
 *   · 204 → nothing to resume (no active record, sentinel id, private
 *     mode, or no bytes exist yet for this turn).
 *   · SSE UIMessage stream → the turn's bytes. The model is NEVER
 *     re-run from here; a resume transports existing bytes only
 *     (WP-A invariant 3, unchanged in V2).
 *
 * WHAT V2 CHANGED, and why it is the actual "doesn't respond" fix:
 * V1 waited up to 20s for `status === "complete"` and returned 204 for
 * anything else. Measured deep turns run 132s mean / 161s worst, so the
 * exact turns the operator calls "complex tasks" ALWAYS lost their work
 * on reconnect — the route was structurally incapable of helping the
 * case it was built for. V2 replays the bytes accumulated so far and
 * then live-tails the row for more, instead of discarding them.
 *
 * Honest termination (no silent degradation): if the window closes with
 * the turn still generating, the stream ends carrying
 * `X-Resume-Partial: 1` — the client learns it holds an incomplete
 * reply and can resume again, rather than being handed a partial reply
 * dressed as a finished one.
 */
import type { NextRequest } from "next/server";
import { createUIMessageStream, createUIMessageStreamResponse, type UIMessageChunk } from "ai";
import { requireSession } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  getActiveStream,
  buildOpenChunks,
  buildDeltaChunk,
  buildCloseChunks,
  resumeMessageId,
} from "@/lib/services/chat/active-stream";
import { aiRouteError } from "@/lib/utils/http";
import { logError } from "@/lib/utils/error-log";

export const maxDuration = 30;

const POLL_MS = 500;
/** Tail window. Deliberately UNDER `maxDuration` so the route returns
 *  its own honest terminator instead of being cut off mid-stream by the
 *  platform. Not a turn deadline: a turn outliving this window keeps
 *  generating server-side (consumeStream) and the next resume picks up
 *  from the bytes this one already durably persisted. */
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

    const record = await getActiveStream(conversationId);
    if (!record) return new Response(null, { status: 204 });

    // Completed turn → V1 path unchanged: replay the PERSISTED message,
    // which is canonical (it carries any fabrication-rewriter banner the
    // raw stream did not).
    if (record.status === "complete") {
      const message = await findAssistantMessage(conversationId, record.startedAt);
      if (!message) return new Response(null, { status: 204 });
      return streamOut(message.id, (write) => {
        write(message.content);
        return { partial: false };
      });
    }

    // Still generating. Nothing to say yet → 204, exactly as before; a
    // resume that emits an empty bubble is worse than no resume.
    if (record.partialText.length === 0) {
      return new Response(null, { status: 204 });
    }

    // Deterministic id: concurrent resumes of the SAME turn collapse to
    // one client-side message instead of N (duplicate-message scar).
    const msgId = resumeMessageId(conversationId, record.startedAt);
    let emitted = record.partialText;
    // Distinguishes the two ways the tail can end without a clean
    // completion: window exhausted (turn still running) vs the persisted
    // row diverging (turn done, splice unsafe). They need different text —
    // telling the operator "still generating" about a finished turn is the
    // same class of lie this whole route is being fixed to stop telling.
    let stillGenerating = true;

    const stream = createUIMessageStream({
      async execute({ writer }) {
        const w = (c: Record<string, unknown>) => writer.write(c as unknown as UIMessageChunk);
        for (const c of buildOpenChunks(msgId)) w(c);
        w(buildDeltaChunk(msgId, emitted));

        const deadline = Date.now() + MAX_WAIT_MS;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          const next = await getActiveStream(conversationId);
          if (!next) break; // row expired mid-tail — stop, don't invent
          if (next.partialText.length > emitted.length) {
            w(buildDeltaChunk(msgId, next.partialText.slice(emitted.length)));
            emitted = next.partialText;
          }
          if (next.status === "complete") {
            const message = await findAssistantMessage(conversationId, next.startedAt);
            // The persisted row is canonical and MAY diverge from the
            // raw deltas (L2 fabrication-rewriter prepends a banner
            // pre-persist). Append the remainder only when it is a true
            // continuation of what the client already holds; on
            // divergence emit nothing further and finish partial, so the
            // next history load shows the canonical text rather than a
            // spliced hybrid of two different strings.
            if (message && message.content.startsWith(emitted)) {
              const tail = message.content.slice(emitted.length);
              if (tail) w(buildDeltaChunk(msgId, tail));
              for (const c of buildCloseChunks(msgId)) w(c);
              return;
            }
            if (message) {
              logError(
                "chat.stream-resume",
                new Error("persisted content diverged from streamed partial"),
                { conversationId, emittedChars: emitted.length, persistedChars: message.content.length },
                "warn",
              );
            }
            // The turn FINISHED; we simply cannot safely splice. A
            // different exit from "ran out of window", and it must not
            // claim the turn is still running.
            stillGenerating = false;
            break;
          }
        }
        // Window closed (or the row vanished) with the turn UNFINISHED.
        //
        // 2026-08-28 · review fix, and the most important lines in this
        // file. Closing here emits a real `finish` chunk, and the AI SDK
        // has no "partial" status — it sets `ready`, `isStreaming` flips
        // false, and use-stall-detection (which gates its whole polling
        // effect on isStreaming) tears down. Without a visible signal the
        // operator is left holding a TRUNCATED reply that renders exactly
        // like a completed one: no spinner, no banner, no way back. That
        // is strictly worse than the 204 this route used to return, which
        // at least looked broken.
        //
        // Two independent signals, deliberately belt-and-braces:
        //   1. `X-Resume-Partial` (set below) drives an automatic
        //      re-resume in use-chat-transport → use-chat-stream.
        //   2. THIS marker, in the text itself. A header can be dropped
        //      by a proxy or ignored by a future client; bytes in the
        //      bubble cannot. It is not persisted — the canonical row in
        //      chat_messages is untouched, so a reload shows clean text.
        w(
          buildDeltaChunk(
            msgId,
            stillGenerating
              ? "\n\n_(still generating — reconnecting for the rest…)_"
              : "\n\n_(reply was revised after this point — reload to see the final version)_",
          ),
        );
        for (const c of buildCloseChunks(msgId)) w(c);
      },
    });

    const res = createUIMessageStreamResponse({ stream });
    // Set on the in-flight lane: the body may still resolve to a
    // complete turn inside the tail, but headers flush first, so this
    // header means "this response STARTED partial" — the client should
    // re-resume unless it saw a completion. Erring toward re-resume is
    // safe (idempotent, deterministic id); erring toward silence is the
    // data loss this WP exists to end.
    res.headers.set("X-Resume-Partial", "1");
    return res;
  } catch (err) {
    return aiRouteError(err, "ai/chat/stream-resume", "Stream resume failed");
  }
}

function findAssistantMessage(conversationId: string, startedAt: string) {
  return prisma.chatMessage.findFirst({
    where: {
      conversationId,
      role: "assistant",
      createdAt: { gte: new Date(startedAt) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true },
  });
}

/** One-shot emit of a whole message (the completed-turn path). */
function streamOut(
  messageId: string,
  fill: (write: (text: string) => void) => { partial: boolean },
) {
  const stream = createUIMessageStream({
    execute({ writer }) {
      const w = (c: Record<string, unknown>) => writer.write(c as unknown as UIMessageChunk);
      for (const c of buildOpenChunks(messageId)) w(c);
      // Chunked so a very long reply doesn't land as one megabyte delta.
      fill((text) => {
        const STEP = 2000;
        if (text.length === 0) w(buildDeltaChunk(messageId, ""));
        for (let i = 0; i < text.length; i += STEP) {
          w(buildDeltaChunk(messageId, text.slice(i, i + STEP)));
        }
      });
      for (const c of buildCloseChunks(messageId)) w(c);
    },
  });
  return createUIMessageStreamResponse({ stream });
}
