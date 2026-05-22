"use client";

/**
 * SMART REPLIES — 3 terse follow-up chips that appear under the most
 * recent assistant message so Nour can continue the conversation with
 * a single tap. Fires one POST to /api/ai/chat/suggestions keyed by
 * the user+assistant pair; cached server-side for 60s.
 *
 * Lives inline below the assistant bubble (not fixed). Disappears
 * the moment Nour types, taps one, or the conversation moves past
 * this message.
 *
 * UX rules:
 *   • Don't show for very short replies (< 40 chars) — probably an
 *     ack or a one-word answer where suggestions add noise.
 *   • Never block the UI — show skeletons for max 1.5s, then fail
 *     silent (render nothing) rather than waiting indefinitely.
 *   • Tap a chip → fill the input (caller decides whether to auto-send).
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { ShimmerSkeleton } from "@/components/ui/shimmer-skeleton";
import { Sparkles } from "lucide-react";

import { trpc } from "@/lib/trpc/client";

interface SmartRepliesProps {
  /** Last user message that kicked off this assistant reply */
  userMessage: string;
  /** The assistant message we're suggesting follow-ups for */
  assistantMessage: string;
  /** Stable id — when it changes we refetch (one message = one fetch) */
  messageId: string;
  /** Called when Nour taps a chip. Caller fills input / auto-sends. */
  onPick: (suggestion: string) => void;
  /** Hide the row if the caller wants to hide based on UI state */
  hidden?: boolean;
}

export function SmartReplies({
  userMessage,
  assistantMessage,
  messageId,
  onPick,
  hidden = false,
}: SmartRepliesProps) {
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  // Phase B.5 · the smart-reply fetch migrated off `authedFetch` onto
  // the `trpc.chat.suggestions` query. It's modeled as a lazy
  // imperative fetch (`utils.chat.suggestions.fetch`) — not a
  // useQuery — because the component owns a deliberate 250ms
  // delay-after-stream + a cancelled-guard that React Query's
  // staleTime can't express. `utils` is stable across renders.
  const utils = trpc.useUtils();

  useEffect(() => {
    // Don't bother on short replies (acks, one-word answers).
    if (!assistantMessage || assistantMessage.trim().length < 40) {
      setSuggestions(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setSuggestions(null);

    // Small delay so we don't fire during the final token stream.
    const delay = setTimeout(async () => {
      try {
        const data = await utils.chat.suggestions.fetch({
          userMessage,
          assistantMessage,
        });
        if (cancelled) return;
        const out = Array.isArray(data.suggestions)
          ? data.suggestions.filter((s) => typeof s === "string" && s.trim().length > 0)
          : [];
        setSuggestions(out.slice(0, 3));
      } catch {
        if (!cancelled) setSuggestions(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(delay);
    };
    // messageId is the stable identity — refetch only when message changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId]);

  if (hidden) return null;
  if (!loading && (!suggestions || suggestions.length === 0)) return null;

  return (
    <div className="mt-1.5 mb-1 flex flex-wrap items-center gap-1.5 px-1">
      <Sparkles size={10} className="text-[var(--gold)]/60 shrink-0" />
      {loading && !suggestions && (
        <>
          {[0, 1, 2].map((i) => (
            <ShimmerSkeleton
              key={i}
              className={cn(
                "h-6 rounded-full",
                i === 0 ? "w-20" : i === 1 ? "w-28" : "w-24"
              )}
            />
          ))}
        </>
      )}
      {suggestions?.map((s, i) => (
        <button
          key={`${i}-${s}`}
          onClick={() => onPick(s)}
          className={cn(
            "smart-reply-chip",
            "text-[10.5px] px-2.5 py-0.5 rounded-full border transition-all",
            "border-[var(--gold)]/25 bg-[var(--gold)]/5 text-[var(--gold)]/90",
            "hover:border-[var(--gold)]/50 hover:bg-[var(--gold)]/15 hover:scale-[1.02] active:scale-95"
          )}
          title="Tap to send"
        >
          {s}
        </button>
      ))}
    </div>
  );
}
