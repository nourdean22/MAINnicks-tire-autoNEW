/**
 * Simulate streamText output from a pre-computed string · v10.0.507
 *
 * ADR-0011 Tier 2b prerequisite · the auto-regen winner-selection
 * path in `maybePreStreamRegen` returns a winning text. The chat
 * route streams responses via `streamText().toUIMessageStreamResponse()`.
 * To ship a winner-selected text AS a stream, we need to convert a
 * plain string into a stream that the chat UI accepts.
 *
 * This module exposes one function: `simulateStreamFromText(text)`
 * that produces a `Response` matching the wire format of the streaming
 * chat path. The UI parses it identically to a real LLM stream.
 *
 * Why this matters: ADR-0011 Tier 2b (pre-stream auto-regen with
 * winner-selection · helper at lib/ai/chat/pre-stream-regen.ts)
 * was blocked on this. Now unblocked.
 *
 * Pattern: AI SDK v6 `createUIMessageStream` exposes a writer that
 * can emit chunks. We write `text-start` → `text-delta` (the full
 * text in one chunk OR optionally chunked for typewriter effect) →
 * `text-end` → `finish`. Then wrap the stream with
 * `createUIMessageStreamResponse`.
 */

import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import type { ReasoningRequest } from "@/lib/ai/reasoning/types";

interface SimulateStreamArgs {
  /** The pre-computed reply text to ship as a stream. */
  text: string;
  /**
   * Optional · split the text into chunks of approximately this many
   * characters to simulate a typewriter effect. Default 0 (no
   * chunking · single chunk).
   */
  chunkSize?: number;
  /**
   * Optional · delay between chunks in milliseconds. Only relevant
   * when chunkSize > 0. Default 0 (no delay).
   */
  chunkDelayMs?: number;
  /**
   * Optional · per-message ID generator. Falls through to AI SDK
   * default if omitted.
   */
  messageId?: string;
  /**
   * Optional · fired AFTER the full text is written (post text-end),
   * before the stream closes. Mirrors streamText's `onFinish` so a
   * caller shipping a pre-computed reply can still run the SAME
   * persistence pipeline (buildOnFinish). Errors are swallowed — a
   * persistence failure must NEVER break the already-delivered stream.
   */
  onComplete?: () => void | Promise<void>;
}

interface SimulateReasoningStreamArgs {
  /** The full request to run through the reasoning engine. */
  request: ReasoningRequest;
  /** Optional chunking size for final answer. */
  chunkSize?: number;
  /** Optional chunking delay for final answer. */
  chunkDelayMs?: number;
  /** Optional message ID generator. */
  messageId?: string;
  /** Called after reasoning + streaming completes. Gives the caller the final winner text. */
  onComplete?: (winner: string) => void | Promise<void>;
}

/**
 * Build a Response that streams the provided text in UIMessageStream
 * format. Drop-in alternative to `streamText().toUIMessageStreamResponse()`
 * when the text is already computed (e.g. winner-selected from
 * maybePreStreamRegen).
 */
export function simulateStreamFromText({
  text,
  chunkSize = 0,
  chunkDelayMs = 0,
  messageId,
  onComplete,
}: SimulateStreamArgs): Response {
  const stream = createUIMessageStream({
    generateId: messageId ? () => messageId : undefined,
    execute: async ({ writer }) => {
      // Generate a stable text-part id so the start / delta / end
      // chunks all reference the same UIMessage text part.
      const textPartId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      writer.write({ type: "text-start", id: textPartId });

      if (chunkSize > 0 && text.length > chunkSize) {
        // Chunked emission · typewriter feel
        let offset = 0;
        while (offset < text.length) {
          const slice = text.slice(offset, offset + chunkSize);
          writer.write({ type: "text-delta", id: textPartId, delta: slice });
          offset += chunkSize;
          if (chunkDelayMs > 0 && offset < text.length) {
            await new Promise((r) => setTimeout(r, chunkDelayMs));
          }
        }
      } else {
        // Single-chunk emission · instant
        writer.write({ type: "text-delta", id: textPartId, delta: text });
      }

      writer.write({ type: "text-end", id: textPartId });

      // Persist on completion — mirrors streamText's onFinish so the
      // assistant turn lands in history even though no streamText ran.
      // Swallow errors: the reply is already delivered; a persist failure
      // must not surface to the client as a broken stream.
      if (onComplete) {
        try {
          await onComplete();
        } catch (err) {
          /* intentionally ignored — delivered stream must not break */
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.simulate-stream-from-text", err, { fn: "simulateStreamFromText.onComplete" })).catch((e) => console.error("simulateStreamFromText.onComplete import error:", e));
        }
      }
    },
  }) as ReadableStream<Parameters<UIMessageStreamWriter<UIMessage>["write"]>[0]>;

  return createUIMessageStreamResponse({
    stream: stream as Parameters<typeof createUIMessageStreamResponse>[0]["stream"],
  });
}

/**
 * Build a Response that actually RUNS the reasoning engine inside the Vercel AI
 * execute stream block. This allows us to push live ReasoningStep annotations
 * to the client BEFORE the final answer is ready.
 */
export function simulateReasoningStream({
  request,
  chunkSize = 0,
  chunkDelayMs = 0,
  messageId,
  onComplete,
}: SimulateReasoningStreamArgs): Response {
  const stream = createUIMessageStream({
    generateId: messageId ? () => messageId : undefined,
    execute: async ({ writer }) => {
      const { reasonStreaming } = await import("@/lib/ai/reasoning/engine");

      const reasoning = await reasonStreaming(request, (step) => {
        (writer as any).write({ type: "data", data: [{ type: "reasoning-step", step }] });
      });

      const winner = reasoning.trace.answer ?? "";
      const textPartId = `text-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

      writer.write({ type: "text-start", id: textPartId });

      if (chunkSize > 0 && winner.length > chunkSize) {
        let offset = 0;
        while (offset < winner.length) {
          const slice = winner.slice(offset, offset + chunkSize);
          writer.write({ type: "text-delta", id: textPartId, delta: slice });
          offset += chunkSize;
          if (chunkDelayMs > 0 && offset < winner.length) {
            await new Promise((r) => setTimeout(r, chunkDelayMs));
          }
        }
      } else {
        writer.write({ type: "text-delta", id: textPartId, delta: winner });
      }

      writer.write({ type: "text-end", id: textPartId });

      if (onComplete) {
        try {
          await onComplete(winner);
        } catch (err) {
          /* intentionally ignored */
          void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.simulate-stream-from-text", err, { fn: "simulateReasoningStream.onComplete" })).catch((e) => console.error("simulateReasoningStream.onComplete import error:", e));
        }
      }
    },
  }) as ReadableStream<Parameters<UIMessageStreamWriter<UIMessage>["write"]>[0]>;

  return createUIMessageStreamResponse({
    stream: stream as Parameters<typeof createUIMessageStreamResponse>[0]["stream"],
  });
}
