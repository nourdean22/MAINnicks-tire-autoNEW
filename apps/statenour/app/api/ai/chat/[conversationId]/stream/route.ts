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
  requestStreamStop,
  buildOpenChunks,
  buildDeltaChunk,
  buildCloseChunks,
  resumeMessageId,
} from "@/lib/services/chat/active-stream";
import { findUserTurnRow } from "@/lib/services/chat/user-turn-identity";
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
    let { conversationId } = await context.params;
    // 2026-10-25 · a FIRST send: the client learns its conversation id only from the POST's
    // headers, and a buffered lane sends none until its reply is whole. The user row is written
    // before generation with the id the client minted, so `?clientMessageId=` finds the
    // conversation (findUserTurnRow's first-send rule). Private turns write no row: 204.
    let firstSend: { conversationId: string; clientMessageId: string } | null = null;
    if (!conversationId || conversationId === "none") {
      const clientMessageId = req.nextUrl?.searchParams?.get("clientMessageId");
      if (!clientMessageId) return new Response(null, { status: 204 });
      const row = await findUserTurnRow({ conversationId: null, messageId: clientMessageId }).catch(() => null);
      if (!row?.clientMessageId) return new Response(null, { status: 204 });
      conversationId = row.conversationId;
      firstSend = { conversationId, clientMessageId: row.clientMessageId };
    }

    const record = await getActiveStream(conversationId);
    if (!record) return new Response(null, { status: 204 });
    // A first send names its turn by its user message: only a row registered FOR that message is
    // its turn. A start time cannot say it (every later turn also started after the first send).
    const namedByMessage = firstSend !== null && record.clientMessageId === firstSend.clientMessageId;
    if (firstSend && !namedByMessage) return new Response(null, { status: 204 });
    /** The turn's identity on every answer: X-Trace-Id lets the next GET name it, and a first send learns its conversation. */
    const identify = (res: Response): Response => {
      if (record.traceId) res.headers.set("X-Trace-Id", record.traceId);
      if (firstSend) res.headers.set("X-Conversation-Id", firstSend.conversationId);
      return res;
    };

    // 2026-10-10 (audit 04-F8) - turn identity. The client may name the
    // turn it is waiting for (`?traceId=`, the X-Trace-Id of its POST). A
    // record for any other turn is not that turn's reply: replaying it
    // re-shows the PREVIOUS answer. Absent param (a mount): an in-flight
    // turn replays, a completed one is a 204 (P2-B6, below).
    const wantedTrace = req.nextUrl?.searchParams?.get("traceId") ?? null;
    if (wantedTrace && record.traceId !== wantedTrace) {
      return new Response(null, { status: 204 });
    }
    // One id per turn, shared by the in-flight tail and the completed
    // replay below, so a re-resume after completion replaces the bubble
    // instead of adding a second one.
    const msgId = resumeMessageId(conversationId, record.traceId ?? record.startedAt);

    // Completed turn: replay the PERSISTED message, which is canonical
    // (it carries any fabrication-rewriter banner the raw stream did not).
    if (record.status === "complete") {
      // P2-B6: a resume that names no turn is a mount (an SPA return inside
      // the linger); the history load already shows this row, so a replay
      // would be a second copy of it. An in-flight turn below still replays.
      if (!wantedTrace && !namedByMessage) return new Response(null, { status: 204 });
      const message = await findAssistantMessage(conversationId, record.startedAt, record.traceId);
      if (!message) return new Response(null, { status: 204 });
      const replay = streamOut(msgId, (write) => {
        write(message.content);
        return { partial: false };
      });
      return identify(withTurnIdentity(replay, record.traceId, () => message));
    }

    // Still generating, nothing to say yet. A buffered chat lane writes no
    // partial bytes (its whole reply lands at once), so a stall reattach read
    // "nothing" for a turn that was still working (2026-10-25). Wait inside
    // this window for bytes or the saved row; no response is built until
    // there is something to put in it, since an empty bubble is worse than no
    // resume. Still nothing: 204 + X-Resume-Pending, so the client asks again.
    const windowEnd = Date.now() + MAX_WAIT_MS;
    let live = record;
    while (live.status === "active" && live.partialText.length === 0) {
      if (Date.now() >= windowEnd) {
        // Named, so the next GET still finds the reply if it saves in between (P2-B6 above).
        return identify(new Response(null, { status: 204, headers: { "X-Resume-Pending": "1" } }));
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
      const next = await getActiveStream(conversationId);
      // Gone, or another turn took the row: nothing of this turn to replay.
      if (!next || next.traceId !== record.traceId) return new Response(null, { status: 204 });
      live = next;
    }
    // Seen in flight by this request, so this is the waited-for turn even
    // unnamed (not the P2-B6 mount copy above).
    if (live.status === "complete") {
      const message = await findAssistantMessage(conversationId, live.startedAt, live.traceId);
      if (!message) return new Response(null, { status: 204 });
      const replay = streamOut(msgId, (write) => {
        write(message.content);
        return { partial: false };
      });
      return identify(withTurnIdentity(replay, live.traceId, () => message));
    }

    // Deterministic id (msgId above): concurrent resumes of the SAME turn
    // collapse to one client-side message instead of N.
    let emitted = live.partialText;
    // Distinguishes the two ways the tail can end without a clean
    // completion: window exhausted (turn still running) vs the persisted
    // row diverging (turn done, splice unsafe). They need different text —
    // telling the operator "still generating" about a finished turn is the
    // same class of lie this whole route is being fixed to stop telling.
    let stillGenerating = true;
    let persisted: { id: string; content: string } | null = null;

    const stream = createUIMessageStream({
      async execute({ writer }) {
        const w = (c: Record<string, unknown>) => writer.write(c as unknown as UIMessageChunk);
        for (const c of buildOpenChunks(msgId)) w(c);
        w(buildDeltaChunk(msgId, emitted));

        const deadline = windowEnd; // one window per request, the wait above included
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, POLL_MS));
          const next = await getActiveStream(conversationId);
          if (!next) break; // row expired mid-tail — stop, don't invent
          if (next.partialText.length > emitted.length) {
            w(buildDeltaChunk(msgId, next.partialText.slice(emitted.length)));
            emitted = next.partialText;
          }
          if (next.status === "complete") {
            const message = await findAssistantMessage(conversationId, next.startedAt, next.traceId);
            persisted = message;
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

    const res = identify(withTurnIdentity(createUIMessageStreamResponse({ stream }), record.traceId, () => persisted));
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

/**
 * DELETE /api/ai/chat/[conversationId]/stream - operator Stop
 * (2026-10-10, audit 04-F6). Records the stop for the in-flight turn so
 * its persisted row says `aborted`, not `complete`. It does not halt the
 * model: consumeStream keeps the turn durable on purpose. 409 when nothing
 * is in flight - never a success for a stop that marked nothing.
 */
export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ conversationId: string }> },
) {
  try {
    await requireSession(req);
    const { conversationId } = await context.params;
    if (!conversationId || conversationId === "none") {
      return Response.json({ stopped: false, reason: "no_active_turn" }, { status: 409 });
    }
    const result = await requestStreamStop(conversationId);
    return Response.json(result, { status: result.stopped ? 200 : 409 });
  } catch (err) {
    return aiRouteError(err, "ai/chat/stream-stop", "Stop failed");
  }
}

// The turn's own reply carries its traceId in tokenUsage; deferred work adds a newer
// "Action receipts" row (no tokenUsage) and a later turn adds its own reply, so match the trace.
function findAssistantMessage(conversationId: string, startedAt: string, traceId?: string | null) {
  return prisma.chatMessage.findFirst({
    where: {
      conversationId,
      role: "assistant",
      createdAt: { gte: new Date(startedAt) },
      ...(traceId ? { tokenUsage: { path: ["traceId"], equals: traceId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, content: true },
  });
}

/**
 * P2-B6 · a resumed turn identifies itself like a live one: `X-Trace-Id`
 * (so a mount-time resume learns its turn and its re-resume can name it),
 * and, once its row exists, `event: message.persisted { id, content }`
 * after the replay. The client transport consumes that frame and binds the
 * bubble to the DB id; the AI SDK parser never sees it.
 */
function withTurnIdentity(
  res: Response,
  traceId: string | null,
  persisted: () => { id: string; content: string } | null,
): Response {
  const encoder = new TextEncoder();
  const body = res.body?.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      flush(controller) {
        const p = persisted();
        if (p) {
          const data = JSON.stringify({ id: p.id, content: p.content });
          controller.enqueue(encoder.encode(`event: message.persisted\ndata: ${data}\n\n`));
        }
      },
    }),
  );
  const headers = new Headers(res.headers);
  if (traceId) headers.set("X-Trace-Id", traceId);
  return new Response(body, { status: res.status, statusText: res.statusText, headers });
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
