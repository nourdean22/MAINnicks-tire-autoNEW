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

  // Build the handler — closes over messages + stop + setError.
  // Keeping the identical CHANGED-Apr-15 semantics: stop the hung
  // stream + surface the error, NO silent auto-resend (that caused
  // the duplicate message bug).
  useEffect(() => {
    stallHandlerRef.current = () => {
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      const stallText =
        lastUser?.parts
          ?.filter((p): p is { type: "text"; text: string } => p.type === "text" && !!p.text)
          .map((p) => p.text)
          .join(" ") || "";
      if (!stallText) return;
      stop();
      setError("Nick is stuck. Tap Retry to re-run the last message.");
    };
  }, [messages, stop, setError]);

  return {
    stallStatus,
    triggerStallHandler: () => stallHandlerRef.current?.(),
  };
}
