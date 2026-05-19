"use client";

/**
 * MessageBranchSwitcher — sibling-cycle indicator + arrow controls.
 *
 * v7.6 · C8 · Apr 29 · ChatMessage Batch A — branching UI.
 *
 * Shows when an assistant message has siblings (regenerations).
 * Renders inline:
 *   ‹ alt 2 of 3 ›
 *
 * Behavior:
 *   · Polls /api/ai/chat/branches/{parentMessageId} on mount.
 *   · Silent when count ≤ 1 (no chrome on solo messages).
 *   · ‹ / › buttons replace the visible message in-place.
 *   · Keyboard: pressing left/right arrow with this message focused
 *     also cycles (added in chat page, not here — keeps this dumb).
 *   · Click count badge → fires `nick-branch-overview` event so the
 *     chat page can show a side-by-side compare drawer (future).
 *
 * Props are minimal — the parent owns the index state + swap logic.
 *
 * Why this is "alive":
 *   · Tiny LED-style dots represent each sibling, with the active
 *     one filled. At-a-glance density (3 dots = 3 versions).
 *   · Each dot's color matches its feedbackScore (none/+/-) so Nour
 *     can SEE which alternate was rated highest before clicking.
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { trpc } from "@/lib/trpc/client";

// Phase DD (2026-05-18 PM) · types now flow from the chat.branches
// procedure · the manual SiblingPreview mirror is gone. The full
// sibling shape comes back · the rendering below cherry-picks
// {id, feedbackScore, latencyMs} only.

export interface MessageBranchSwitcherProps {
  parentMessageId: string;
  /** Current visible sibling id (typically msg.id). */
  activeId: string;
  /** Notify parent to swap to a different sibling id. */
  onSelect: (siblingId: string) => void;
  className?: string;
}

export function MessageBranchSwitcher({
  parentMessageId,
  activeId,
  onSelect,
  className,
}: MessageBranchSwitcherProps) {
  // Phase DD · React Query handles fetch + cache + cleanup. The pre-DD
  // useEffect + cancelled flag dance is gone · React Query's per-input
  // dedupe + auto-cleanup-on-unmount covers the same concerns with
  // less ceremony. 30s staleTime keeps repeat parent re-mounts from
  // re-fetching unnecessarily as the operator cycles between branches.
  const { data } = trpc.chat.branches.useQuery(
    { parentMessageId },
    { staleTime: 30_000 },
  );
  const siblings = data?.siblings ?? null;

  if (!siblings || siblings.length <= 1) return null;

  const idx = siblings.findIndex((s) => s.id === activeId);
  const safeIdx = idx >= 0 ? idx : 0;
  const total = siblings.length;
  const prev = safeIdx > 0 ? siblings[safeIdx - 1] : null;
  const next = safeIdx < total - 1 ? siblings[safeIdx + 1] : null;

  return (
    <div className={cn("inline-flex items-center gap-1.5 text-[10px]", className)}>
      <button
        type="button"
        onClick={() => prev && onSelect(prev.id)}
        disabled={!prev}
        className={cn(
          "inline-flex items-center justify-center w-5 h-5 rounded-md border",
          "border-[var(--border-default)] text-[var(--text-tertiary)]",
          "hover:text-[var(--gold)] hover:border-[var(--gold)]/40 transition-colors",
          "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-[var(--text-tertiary)] disabled:hover:border-[var(--border-default)]",
        )}
        title="Previous version"
        aria-label="Previous sibling"
      >
        <ChevronLeft size={11} />
      </button>

      {/* LED dots — at-a-glance density + color tinted by feedback */}
      <div className="flex items-center gap-0.5">
        {siblings.map((s, i) => {
          const tone =
            s.feedbackScore === 1
              ? "bg-emerald-400"
              : s.feedbackScore === -1
                ? "bg-red-400"
                : "bg-[var(--text-tertiary)]/60";
          const active = i === safeIdx;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              className={cn(
                "rounded-full transition-all",
                active ? "w-2 h-2" : "w-1.5 h-1.5 hover:w-2 hover:h-2",
                tone,
                !active && "opacity-50 hover:opacity-100",
              )}
              title={`Alt ${i + 1}${s.feedbackScore === 1 ? " · 👍" : s.feedbackScore === -1 ? " · 👎" : ""}${s.latencyMs ? ` · ${s.latencyMs}ms` : ""}`}
              aria-label={`Sibling ${i + 1} of ${total}`}
            />
          );
        })}
      </div>

      <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-[var(--text-tertiary)] tabular-nums">
        {safeIdx + 1}/{total}
      </span>

      <button
        type="button"
        onClick={() => next && onSelect(next.id)}
        disabled={!next}
        className={cn(
          "inline-flex items-center justify-center w-5 h-5 rounded-md border",
          "border-[var(--border-default)] text-[var(--text-tertiary)]",
          "hover:text-[var(--gold)] hover:border-[var(--gold)]/40 transition-colors",
          "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:text-[var(--text-tertiary)] disabled:hover:border-[var(--border-default)]",
        )}
        title="Next version"
        aria-label="Next sibling"
      >
        <ChevronRight size={11} />
      </button>
    </div>
  );
}
