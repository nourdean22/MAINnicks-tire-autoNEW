"use client";

/**
 * useStallDetection — client-side streaming heartbeat.
 *
 * Problem: when Venice (or any provider) stalls mid-stream, useChat's
 * `status === "streaming"` stays true but no tokens arrive. The UI
 * shows a happy spinner while nothing is actually happening. Nour's
 * "spotty chat" complaint is partly this: responses that look alive
 * but are dead.
 *
 * This hook watches the last assistant message and tracks when it
 * last grew. After `warningMs` of stagnation it flips into "warn"
 * state so the UI can show a "Nick is slow" banner. After `abortMs`
 * it calls `onStall` — the chat page uses that callback to stop the
 * current request and auto-retry with a different provider.
 *
 * Tool-call awareness (Apr 15 fix): while a tool is PENDING (state !=
 * output-available/output-error) stall detection is paused. Image
 * generation takes 15-45s and was tripping the 30s abort threshold,
 * cancelling the stream right before the image arrived and creating
 * a retry loop.
 *
 * Returns a status string:
 *   - "idle"    — not streaming, nothing to watch
 *   - "healthy" — streaming and tokens are flowing
 *   - "warn"    — streaming but stalled for warningMs
 *   - "stalled" — streaming but stalled for abortMs (onStall has fired)
 */

import { useEffect, useRef, useState } from "react";

export type StallStatus = "idle" | "healthy" | "warn" | "stalled";

interface MessagePart {
  type: string;
  text?: string;
  state?: string;
}

interface Message {
  role: "user" | "assistant" | "system";
  parts?: MessagePart[];
}

interface UseStallDetectionOptions {
  messages: Message[];
  isStreaming: boolean;
  warningMs?: number;
  abortMs?: number;
  onStall?: () => void;
}

function messageLength(msg: Message | undefined): number {
  if (!msg) return 0;
  if (!msg.parts) return 0;
  let len = 0;
  for (const p of msg.parts) {
    if (p.type === "text" && typeof p.text === "string") {
      len += p.text.length;
    } else if (p.type.startsWith("tool-")) {
      // Tool calls count as "progress" too — we don't want to nag
      // when Nick is waiting on a slow tool call
      len += 100;
    }
  }
  return len;
}

/**
 * True when the assistant message has a tool call that's still pending
 * (input being streamed, or awaiting output). When a tool is active we
 * pause stall detection entirely — tool execution can legitimately
 * take 30-60s (image generation, deep DB queries) and that's NOT a
 * stall.
 */
function hasPendingToolCall(msg: Message | undefined): boolean {
  if (!msg?.parts) return false;
  for (const p of msg.parts) {
    if (!p.type.startsWith("tool-")) continue;
    // Terminal states — tool is done (successfully or not)
    if (p.state === "output-available") continue;
    if (p.state === "output-error") continue;
    // Any other state means the tool is in-flight
    return true;
  }
  return false;
}

export function useStallDetection({
  messages,
  isStreaming,
  warningMs = 15_000,
  abortMs = 30_000,
  onStall,
}: UseStallDetectionOptions): StallStatus {
  const [status, setStatus] = useState<StallStatus>(isStreaming ? "healthy" : "idle");
  const lastGrowthRef = useRef<number>(0);
  const lastLengthRef = useRef<number>(0);
  const stalledRef = useRef<boolean>(false);
  const onStallRef = useRef(onStall);

  // Keep callback fresh without retriggering effects
  useEffect(() => {
    onStallRef.current = onStall;
  }, [onStall]);

  // Track growth of the last assistant message. Reset timer every
  // time it grows; stream is considered stalled when it hasn't grown
  // for warningMs (soft) or abortMs (hard).
  //
  // ALSO resets the timer whenever a tool call transitions state —
  // tool execution doesn't increase messageLength beyond the initial
  // 100-char credit, but tools CAN legitimately run for 30-60 seconds
  // (image gen, deep DB queries). The timer reset prevents the stall
  // detector from killing the stream mid-tool-execution.
  const lastToolStateRef = useRef<string>("");
  const wasStreamingRef = useRef<boolean>(false);
  // Audit #349 fix · keep latest `messages` in a ref so the tick
  // effect below does NOT tear down + recreate setInterval on every
  // token chunk. Previously, `messages` in the deps array thrashed
  // the interval 200+ times per long reply, leaking timers between
  // renders. Mutate ref inside useEffect to comply with React purity guidelines.
  const messagesRef = useRef(messages);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Derive status synchronously for idle states to avoid effect triggers
  const resolvedStatus = isStreaming ? status : "idle";

  useEffect(() => {
    if (!isStreaming) {
      stalledRef.current = false;
      lastLengthRef.current = 0;
      lastToolStateRef.current = "";
      wasStreamingRef.current = false;
      return;
    }

    // FIX (Apr 15): when streaming transitions false → true, reset the
    // growth timer to NOW. Previously lastGrowthRef would hold the
    // timestamp from the last chunk of a PREVIOUS session, so the
    // tick effect computed a huge elapsed value on the next
    // isStreaming flip and fired the stall handler instantly — long
    // before the new stream had any chance to produce tokens. The
    // NL interceptor path (brain dump, decision) was hit hardest
    // because it waits for ingestJournal to complete (5-15s of
    // server-side AI extraction) BEFORE opening the stream.
    if (!wasStreamingRef.current) {
      wasStreamingRef.current = true;
      lastGrowthRef.current = Date.now();
      lastLengthRef.current = 0;
      lastToolStateRef.current = "";
      stalledRef.current = false;
      setStatus("healthy");
    }

    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant") return;

    // Build a signature of the current tool states so any transition
    // (call → input-streaming → output-available) counts as progress.
    const toolStateSignature = (last.parts || [])
      .filter((p) => p.type.startsWith("tool-"))
      .map((p) => `${p.type}:${p.state || "pending"}`)
      .join("|");

    const len = messageLength(last);
    const toolStateChanged =
      toolStateSignature !== lastToolStateRef.current;

    if (len > lastLengthRef.current || toolStateChanged) {
      // Growth detected — reset the stall timer
      lastLengthRef.current = len;
      lastToolStateRef.current = toolStateSignature;
      lastGrowthRef.current = Date.now();
      stalledRef.current = false;
      setStatus((prev) => (prev === "healthy" ? prev : "healthy"));
    }
  }, [messages, isStreaming]);

  // Separate effect to TICK the status forward based on elapsed time.
  // Runs every 2s while streaming so we don't burn cycles when idle.
  useEffect(() => {
    if (!isStreaming) return;

    const interval = setInterval(() => {
      const m = messagesRef.current;
      const last = m[m.length - 1];

      // SKIP stall check entirely if a tool is actively executing.
      // Tools can legitimately take 30-60s — image generation is the
      // canonical example. While a tool is pending we treat the stream
      // as "healthy" and reset the growth timer so the abort threshold
      // doesn't fire the instant the tool finishes.
      if (hasPendingToolCall(last)) {
        lastGrowthRef.current = Date.now();
        if (!stalledRef.current) {
          setStatus((prev) => (prev === "healthy" ? prev : "healthy"));
        }
        return;
      }

      const elapsed = Date.now() - lastGrowthRef.current;

      if (elapsed >= abortMs && !stalledRef.current) {
        stalledRef.current = true;
        setStatus("stalled");
        // Fire once — onStallRef is read at call time so edits between
        // renders are picked up cleanly.
        onStallRef.current?.();
      } else if (elapsed >= warningMs) {
        setStatus((prev) => (prev === "warn" || prev === "stalled" ? prev : "warn"));
      }
    }, 2_000);

    return () => clearInterval(interval);
    // Audit #349 fix · `messages` deliberately omitted · read via
    // messagesRef.current so interval doesn't tear down per token.
  }, [isStreaming, warningMs, abortMs]);

  return resolvedStatus;
}
