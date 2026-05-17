"use client";

/**
 * PromptSuggestionsBar — collapsible row of completions above the chat
 * input. v7.4 · Apr 29 first cut.
 *
 * Replaces the retired empty-state opener cards with a more useful
 * surface: completions for whatever Nour is actively typing. Silent
 * when the autocomplete endpoint returns nothing.
 *
 * Interactions:
 *   · Tap a chip → fills the textarea with the suggestion (and we
 *     optionally append a trailing space if the suggestion ended on
 *     an open phrase like "for the spring sale").
 *   · X button → collapses the bar for this draft session. Reopens
 *     when the textarea is cleared.
 *   · Hidden entirely on multi-line drafts and on send (parent passes
 *     suggestions=[] in those states).
 *
 * Future ideas (not built yet): inline ghost-text in the textarea,
 * Tab-cycle between alternates, score the suggestions against Nour's
 * accept history.
 */

import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface PromptSuggestionsBarProps {
  suggestions: string[];
  loading?: boolean;
  onPick: (suggestion: string) => void;
  onCollapse: () => void;
  className?: string;
}

export function PromptSuggestionsBar({
  suggestions,
  loading,
  onPick,
  onCollapse,
  className,
}: PromptSuggestionsBarProps) {
  if (!loading && suggestions.length === 0) return null;

  return (
    <div
      className={cn(
        "w-full mb-1.5 px-2 sm:px-0",
        "animate-fadeSlideUp",
        className,
      )}
    >
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-xl border border-[var(--gold)]/15 bg-[var(--gold)]/[0.04]",
          "px-2 py-1.5 overflow-hidden",
        )}
      >
        <Sparkles size={11} className="text-[var(--gold)]/70 shrink-0" />
        <div className="flex-1 flex items-center gap-1.5 overflow-x-auto scrollbar-thin">
          {loading && suggestions.length === 0 && (
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)] opacity-70">
              thinking…
            </span>
          )}
          {suggestions.map((s, i) => (
            <button
              key={`${i}:${s}`}
              type="button"
              onClick={() => onPick(s)}
              className={cn(
                "shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md",
                "text-[11px] sm:text-[11.5px] text-[var(--text-primary)]",
                "border border-[var(--gold)]/20 bg-[var(--bg-raised)]/40",
                "hover:bg-[var(--gold)]/10 hover:border-[var(--gold)]/40 transition-colors",
                "active:scale-[0.97]",
              )}
              title="Tap to fill"
            >
              <span className="truncate max-w-[260px] sm:max-w-[360px]">{s}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="shrink-0 p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          title="Hide suggestions"
          aria-label="Hide suggestions"
        >
          <X size={11} />
        </button>
      </div>
    </div>
  );
}
