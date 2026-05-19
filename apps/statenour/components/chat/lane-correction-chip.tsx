"use client";

/**
 * LANE CORRECTION CHIP — inline proactive blind-spot alert in chat.
 *
 * After each assistant reply, the chat page pings /api/ai/chat/lane-check
 * with the user+assistant pair. The route reads blind-spots + Dania
 * silence detector + domain inference and returns an optional chip.
 *
 * When chip is non-null, this component renders a subtle one-liner
 * below the assistant bubble: "Also watching: 3 leads going cold
 * in pipeline · [pull list ↗]". Nour can tap the action to deep-
 * link or dismiss the chip for the session.
 *
 * Critical: this never blocks the reply render. Fires async, caches
 * server-side 2min, session-dedupes to 30min per domain so Nour
 * doesn't see the same chip twice in one hour.
 */

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Eye, AlertTriangle, ArrowUpRight, X } from "lucide-react";

import { authedFetch } from "@/hooks/use-authed-fetch";
import { trpc } from "@/lib/trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc/root";

// Phase GG (2026-05-18 PM) · LaneChip type now flows from the
// chat.laneCheck procedure's return shape via inferRouterOutputs ·
// pre-GG the manual mirror could drift from the service. Same
// typed-output inference pattern Y.2 established.
type LaneChip = NonNullable<
  inferRouterOutputs<AppRouter>["chat"]["laneCheck"]["chip"]
>;

const SEV_RING: Record<LaneChip["severity"], string> = {
  critical: "border-red-500/40 bg-red-500/[0.05] text-red-300",
  high: "border-amber-500/40 bg-amber-500/[0.05] text-amber-300",
  medium: "border-[var(--gold)]/30 bg-[var(--gold)]/[0.04] text-[var(--gold)]/90",
  low: "border-zinc-700/40 bg-zinc-900/30 text-[var(--text-tertiary)]",
};

interface Props {
  userMessage: string;
  assistantMessage: string;
  /** Stable id so we only fire once per message */
  messageId: string;
  /** Hide if the caller wants to suppress (e.g. Nour typing) */
  hidden?: boolean;
}

export function LaneCorrectionChip({ userMessage, assistantMessage, messageId, hidden }: Props) {
  const [dismissed, setDismissed] = useState(false);
  // Reset dismissed state when message changes · matches pre-GG
  // useEffect's `setDismissed(false)` on messageId change.
  const [lastSeenMessageId, setLastSeenMessageId] = useState(messageId);
  if (messageId !== lastSeenMessageId) {
    setDismissed(false);
    setLastSeenMessageId(messageId);
  }

  // Phase GG · React Query handles fetch + cleanup · enabled gates the
  // call until the assistant message crosses the 40-char threshold.
  // staleTime 30 min matches the legacy in-memory session-dedupe
  // window so the operator doesn't re-fire identical checks while
  // scrolling back through the conversation.
  const enoughTokens = !!assistantMessage && assistantMessage.length >= 40;
  const { data } = trpc.chat.laneCheck.useQuery(
    { userMessage, assistantMessage },
    {
      enabled: enoughTokens && !hidden,
      staleTime: 30 * 60_000,
      retry: false, // chip is decoration · no retry storm if it fails
    },
  );
  const chip = data?.chip ?? null;

  if (hidden || dismissed || !chip) return null;

  const Icon = chip.severity === "critical" || chip.severity === "high" ? AlertTriangle : Eye;

  const sendFeedback = (action: "tapped" | "dismissed") => {
    authedFetch("/api/ai/chat/lane-check/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        action,
        domain: chip.domain,
        severity: chip.severity,
        userMessage,
        assistantMessage,
      }),
    }).catch(() => {});
  };

  return (
    <div
      className={cn(
        "mt-1.5 mb-1 mx-1 flex items-center gap-2 px-2.5 py-1 rounded-md border text-[10.5px] leading-snug animate-fade-in",
        SEV_RING[chip.severity]
      )}
    >
      <Icon size={10} className="shrink-0" />
      <span className="flex-1 min-w-0 truncate">{chip.text}</span>
      <Link
        href={chip.href}
        onClick={() => sendFeedback("tapped")}
        className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider hover:brightness-125 transition-all shrink-0"
        title={chip.action}
      >
        {chip.action}
        <ArrowUpRight size={9} />
      </Link>
      <button
        onClick={() => {
          sendFeedback("dismissed");
          setDismissed(true);
        }}
        className="p-0.5 rounded hover:bg-white/10 opacity-60 hover:opacity-100 transition-all shrink-0"
        aria-label="dismiss"
      >
        <X size={9} />
      </button>
    </div>
  );
}
