"use client";

/**
 * useChatStall — thin wrapper around useStallDetection that also
 * owns the stop-and-surface stall handler. Extracted from
 * `app/(mastery)/chat/page.tsx` as part of v11.1 B2.
 *
 * Why wrap: the page previously declared a stallHandlerRef, wired
 * onStall to it, AND re-computed the handler body inside a useEffect
 * (because the handler needs access to messages + stop + setError).
 * Those three things moved together now — one hook, one spot,
 * one set of deps.
 *
 * Returns the current stall status ("idle" | "healthy" | "warn" |
 * "stalled") so the page can render the warning banner.
 */
import { useEffect, useRef } from "react";
import { useStallDetection, type StallStatus } from "@/hooks/use-stall-detection";

interface MessagePart {
  type: string;
  text?: string;
}
interface Message {
  role: "user" | "assistant" | "system";
  parts?: MessagePart[];
}

interface UseChatStallOptions {
  messages: Message[];
  isStreaming: boolean;
  stop: () => void;
  setError: (s: string | null) => void;
  /** Default: 30s. v11.1 had this at 6s which was way too eager —
   *  every image gen (5-25s) tripped the warn banner mid-flight, and
   *  the auto-retry that followed at 22s spawned duplicate Venice
   *  calls that rate-limited the whole pipeline. 30s gives normal
   *  slow operations breathing room without missing real stalls. */
  warningMs?: number;
  /** Default: 90s. v11.1 had this at 22s which auto-killed image
   *  gens that took >22s and immediately retried, spawning the
   *  duplicate-image storm. 90s only fires on truly dead streams. */
  abortMs?: number;
}

export interface UseChatStallResult {
  stallStatus: StallStatus;
  /** Call this when the user taps "Retry now" in the stall banner. */
  triggerStallHandler: () => void;
}

export function useChatStall(opts: UseChatStallOptions): UseChatStallResult {
  const { messages, isStreaming, stop, setError, warningMs = 30_000, abortMs = 90_000 } = opts;

  const stallHandlerRef = useRef<() => void>(() => {});

  const stallStatus = useStallDetection({
    messages,
    isStreaming,
    warningMs,
    abortMs,
    onStall: () => stallHandlerRef.current?.(),
  });

  // Build the handler — closes over stop + setError. Semantics unchanged
  // since Apr 15: stop the hung stream + surface the error, NO silent
  // auto-resend (that caused the duplicate message bug).
  //
  // 2026-08-09 · REMOVED a dead guard that could only ever suppress
  // recovery. The handler used to reconstruct the last user message's text
  // and `return` early when it came back empty:
  //
  //     const stallText = lastUser?.parts?.filter(p => p.type === "text")…
  //     if (!stallText) return;      // <- before stop() and setError()
  //
  // `stallText` was never USED for anything else — it is a leftover from
  // the auto-resend that was deliberately removed. So its only remaining
  // effect was: whenever the last user turn had no extractable text part
  // (attachment-only turn, a parts shape this local interface does not
  // model, or messages not yet reconciled), the 90s stall fired and then
  // did NOTHING — no stop(), no error, no toast. The stream stayed "live"
  // and the UI span forever. Operator-reported symptom, 2026-08-09:
  // long messages "won't respond or get stuck".
  //
  // A stall is a stall regardless of what the user typed. Always stop and
  // always say so.
  useEffect(() => {
    stallHandlerRef.current = () => {
      stop();
      setError("Nick is stuck. Tap Retry to re-run the last message.");
    };
  }, [stop, setError]);

  return {
    stallStatus,
    triggerStallHandler: () => stallHandlerRef.current?.(),
  };
}
