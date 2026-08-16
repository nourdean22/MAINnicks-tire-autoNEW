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
  /** Default: 180s. v11.1 had this at 22s which auto-killed image
   *  gens that took >22s and immediately retried, spawning the
   *  duplicate-image storm.
   *
   *  2026-08-15 · raised 90s -> 180s alongside the output-budget fix
   *  (prepare-tools maxOutputTokens 2000 -> 6000 standard / 4500 -> 10000
   *  deep). Those two numbers are coupled and were not coupled before:
   *  this client abort is the ONLY deadline in the system — `maxDuration`
   *  is inert on Railway and the server has no bound — and its clock
   *  starts at SUBMIT, so all server pre-stream time is charged to it.
   *
   *  Measured on the live pin (scripts/probe-empty-responses.ts, 12 calls):
   *  13.2 ms/token mean, 16.1 worst. Projected wall time at the new caps:
   *
   *      2000 tok (old)   26s mean /  32s worst   safe under 90s
   *      3300 tok (typical complete answer)
   *                       44s mean /  53s worst   safe under 90s
   *      6000 tok (new standard)
   *                       79s mean /  97s worst   EXCEEDS 90s
   *     10000 tok (new deep)
   *                      132s mean / 161s worst   FAR EXCEEDS 90s
   *
   *  ...and those are bare-prompt numbers: no ~40k-char system prompt, no
   *  tool round-trips. Left at 90s, raising the token ceiling would have
   *  traded truncated answers for aborted ones — the same complaint with a
   *  different cause.
   *
   *  180s covers standard comfortably and deep in the mean; the extreme
   *  deep tail (a turn that actually consumes all 10000 tokens) can still
   *  reach it. The 30s warning is unchanged, so a slow turn is visible long
   *  before it is killed, and the stall banner carries a Retry action. */
  abortMs?: number;
}

export interface UseChatStallResult {
  stallStatus: StallStatus;
  /** Call this when the user taps "Retry now" in the stall banner. */
  triggerStallHandler: () => void;
}

export function useChatStall(opts: UseChatStallOptions): UseChatStallResult {
  const { messages, isStreaming, stop, setError, warningMs = 30_000, abortMs = 180_000 } = opts;

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
