"use client";

/**
 * MessageStatusBadge — visual indicator of a chat message's
 * streamingState + an at-a-glance per-message info pulse.
 *
 * v7.6 · C6 · Apr 29 · ChatMessage Batch A — UI surface for the new
 * `streamingState` column ("complete" | "partial" | "errored" |
 * "aborted").
 *
 * Visual language:
 *   · complete  — silent (returns null, no chrome)
 *   · partial   — pulsing amber dot + "stream interrupted · resume?"
 *   · errored   — red triangle + concise error message + "retry" chip
 *   · aborted   — grey ghost dot + "you stopped this" (subtle)
 *
 * Why "alive": the badge isn't static text. partial uses a 1-second
 * pulse animation; errored has a subtle shake-on-mount; the dot
 * colors carry mood without competing with the message body.
 *
 * Power+control: clicking partial → emits `nick-resume-stream` window
 * event with the msg id, parent chat page can hook into it. Clicking
 * errored → fires `nick-retry-message`. Both events bubble through
 * the existing window-event bus the chat page already uses.
 */

import { cn } from "@/lib/utils";
import { AlertTriangle, RefreshCw, Square } from "lucide-react";

// 2026-07-06 · "truncated" added. persist-assistant-turn maps
// finishReason==="length" → streamingState:"truncated", but this union +
// STATE_TONES omitted it, so STATE_TONES["truncated"] was undefined (a latent
// crash if the badge rendered a length-capped turn). The reply is cut off
// mid-sentence but persisted as a normal message; surface it + offer a retry.
export type StreamingState = "complete" | "partial" | "errored" | "aborted" | "truncated";

export interface MessageStatusBadgeProps {
  state: StreamingState | null | undefined;
  messageId: string;
  errorDetails?: { message?: string; provider?: string; retryable?: boolean } | null;
  /** Show extra-detailed text. Default false (icon-only on mobile). */
  verbose?: boolean;
  className?: string;
}

const STATE_TONES: Record<Exclude<StreamingState, "complete">, { dot: string; bg: string; border: string; text: string }> = {
  partial:   { dot: "bg-amber-400",   bg: "bg-amber-500/[0.06]",  border: "border-amber-500/30",   text: "text-amber-300" },
  errored:   { dot: "bg-red-400",     bg: "bg-red-500/[0.07]",    border: "border-red-500/35",     text: "text-red-300"  },
  aborted:   { dot: "bg-zinc-400/60", bg: "bg-zinc-500/[0.04]",   border: "border-zinc-500/25",    text: "text-zinc-400" },
  truncated: { dot: "bg-amber-400",   bg: "bg-amber-500/[0.06]",  border: "border-amber-500/30",   text: "text-amber-300" },
};

export function MessageStatusBadge({ state, messageId, errorDetails, verbose, className }: MessageStatusBadgeProps) {
  if (!state || state === "complete") return null;

  const tone = STATE_TONES[state];

  const handleAction = () => {
    if (typeof window === "undefined") return;
    if (state === "partial") {
      window.dispatchEvent(new CustomEvent("nick-resume-stream", { detail: { messageId } }));
    } else if (state === "errored" || state === "truncated") {
      window.dispatchEvent(new CustomEvent("nick-retry-message", { detail: { messageId } }));
    }
    // aborted = no action; user explicitly stopped, intentional
  };

  const Icon = state === "errored" ? AlertTriangle : state === "aborted" ? Square : RefreshCw;
  const labelMap: Record<Exclude<StreamingState, "complete">, string> = {
    partial: "stream interrupted",
    errored: errorDetails?.message ? `error: ${errorDetails.message.slice(0, 60)}` : "error",
    aborted: "you stopped this",
    truncated: "response cut off",
  };
  const label = labelMap[state];

  const actionMap: Record<Exclude<StreamingState, "complete">, string | null> = {
    partial: "resume",
    errored: errorDetails?.retryable === false ? null : "retry",
    aborted: null,
    truncated: "retry",
  };
  const action = actionMap[state];

  const isClickable = action !== null;

  return (
    <button
      type="button"
      onClick={isClickable ? handleAction : undefined}
      disabled={!isClickable}
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-[10px] mt-1.5 select-none",
        tone.bg,
        tone.border,
        tone.text,
        isClickable && "hover:brightness-125 hover:border-opacity-100 cursor-pointer transition-all",
        !isClickable && "opacity-70",
        state === "partial" && "msg-status-pulse",
        state === "errored" && "msg-status-shake",
        className,
      )}
      aria-label={`Message status: ${label}${action ? ` · click to ${action}` : ""}`}
    >
      <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", tone.dot)} />
      <Icon size={9} className="shrink-0 opacity-80" />
      <span className={cn("font-mono uppercase tracking-[0.18em] text-[8.5px]", verbose ? "" : "hidden sm:inline")}>
        {label}
      </span>
      {action && (
        <span className="font-mono uppercase tracking-[0.18em] text-[8.5px] underline-offset-2 hover:underline">
          · {action}
        </span>
      )}
      <style jsx>{`
        .msg-status-pulse {
          animation: msg-pulse 1.6s ease-in-out infinite;
        }
        @keyframes msg-pulse {
          0%, 100% { opacity: 0.7; transform: scale(1); }
          50%      { opacity: 1;   transform: scale(1.02); }
        }
        .msg-status-shake {
          animation: msg-shake 0.32s ease-out 1;
        }
        @keyframes msg-shake {
          0%   { transform: translateX(0); }
          20%  { transform: translateX(-2px); }
          40%  { transform: translateX(2px); }
          60%  { transform: translateX(-1.5px); }
          80%  { transform: translateX(1.5px); }
          100% { transform: translateX(0); }
        }
      `}</style>
    </button>
  );
}
