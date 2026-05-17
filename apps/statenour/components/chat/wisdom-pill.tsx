"use client";

/**
 * components/chat/wisdom-pill.tsx · v10.0.526 · Arc B Feature 2
 *
 * At-write-time wisdom suggestion surface. Sits ABOVE the composer,
 * faded · gold-on-dark · editorial-minimalist. Killable on click ·
 * inserts the wisdom into the draft via the caller's `onUseThis`
 * (prefixed `// considering: ` so the wisdom rides as a margin note
 * the operator can keep, edit, or strip before sending).
 *
 * Why ABOVE not BELOW · per operator (v484): the killed
 * ProactiveInsightCard was an after-response card that grabbed
 * attention AFTER Nick had already replied. That surface is dead.
 * This surface is at the OPPOSITE end of the loop · BEFORE the
 * operator hits send · faded baseline so it never interrupts ·
 * dismissable on first click so it can't camp.
 *
 * Visual contract:
 *   · ONE dominant aesthetic direction · operator's gold-on-dark
 *   · NO purple gradient · NO Inter · NO symmetric stack
 *   · Faded opacity 0.55 baseline · 1.0 on hover/focus-within
 *   · Compact · 1 line if possible · 2 lines hard ceiling
 *   · Sits inside a hairline gold-border container so it reads as a
 *     "margin note" against the elevated composer chrome
 *
 * Accessibility:
 *   · aria-live="polite" · screen readers get the suggestion AFTER
 *     the current utterance · NOT assertive (would interrupt)
 *   · role="status" so AT scrubbing announces it as supplementary
 *   · Tab-reachable chip · Enter triggers `useThis`
 *   · Backspace/Delete on the chip triggers `dismiss` (kbd parity
 *     with the visible "×" button)
 */

import { useCallback, useState, type KeyboardEvent } from "react";
import { X, Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { useWisdomSuggest, type WisdomSuggestion } from "@/hooks/use-wisdom-suggest";

/**
 * Pure helper · builds the "margin-note inserted draft" given the
 * wisdom text + current draft. Exported so the unit test can lock
 * down the prefix shape without mounting the component.
 *
 *   buildInsertedDraft("..principle..", "")  → "// considering: ..principle..\n"
 *   buildInsertedDraft("..principle..", "x") → "// considering: ..principle..\n\nx"
 */
export function buildInsertedDraft(wisdomText: string, currentDraft: string): string {
  const prefix = `// considering: ${wisdomText.trim()}`;
  if (currentDraft.trim().length === 0) {
    return `${prefix}\n`;
  }
  return `${prefix}\n\n${currentDraft}`;
}

interface WisdomPillProps {
  /** Current draft text in the composer textarea. */
  draft: string;
  /**
   * Set true while Nick is streaming · pill hides during reply so it
   * never competes for attention.
   */
  isStreaming?: boolean;
  /**
   * Called when the operator presses Enter or clicks the chip to
   * accept a suggestion. Receives the FULL new draft string · parent
   * is responsible for writing it back to the textarea state. Prefix
   * is `// considering: <wisdom>` followed by a newline and the
   * existing draft so the wisdom sits at the top as a margin note.
   */
  onUseThis: (newDraft: string) => void;
  className?: string;
}

export function WisdomPill({
  draft,
  isStreaming = false,
  onUseThis,
  className,
}: WisdomPillProps) {
  const { suggestions, loading, killed, dismiss, killForever } = useWisdomSuggest({
    draft,
    disabled: isStreaming,
  });
  const [showKillMenu, setShowKillMenu] = useState(false);

  const handleUse = useCallback(
    (s: WisdomSuggestion) => {
      // Margin-note format · operator can keep / edit / strip before
      // sending. Two-line shape · the marker line is grep-able so it
      // surfaces in transcripts as a deliberate inclusion.
      onUseThis(buildInsertedDraft(s.text, draft));
    },
    [draft, onUseThis],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, s: WisdomSuggestion) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleUse(s);
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        dismiss(s.id);
      }
    },
    [handleUse, dismiss],
  );

  // Render gates · in priority order. Each is a fast-fail.
  if (killed) return null;
  if (isStreaming) return null;
  if (!loading && suggestions.length === 0) return null;

  return (
    <div
      className={cn("w-full mb-1.5 px-2 sm:px-0", className)}
      // aria-live=polite so screen readers get the suggestion as a
      // supplementary announce · NOT interrupting whatever they're
      // already reading. role=status matches WCAG SC 4.1.3 status
      // message guidance.
      aria-live="polite"
      role="status"
    >
      <div
        className={cn(
          // Container · faded baseline · 1.0 on hover for that
          // "lean in and engage" feel without it ever screaming for
          // attention. Border is a hairline gold-tinted line · the
          // editorial-minimalist signature.
          "group/wisdom flex items-start gap-2 rounded-lg",
          "border border-[var(--gold)]/12 bg-[var(--gold)]/[0.025]",
          "px-2.5 py-1.5",
          "opacity-[0.55] focus-within:opacity-100 hover:opacity-100",
          "transition-opacity duration-200 ease-out",
        )}
      >
        <Sparkles
          size={11}
          className="mt-[3px] shrink-0 text-[var(--gold)]/80"
          aria-hidden="true"
        />
        <div className="flex-1 min-w-0 flex flex-col gap-1">
          {loading && suggestions.length === 0 && (
            <span className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--text-tertiary)]">
              listening…
            </span>
          )}
          {suggestions.map((s) => (
            <div
              key={s.id}
              className="flex items-start gap-1.5 min-w-0"
            >
              <button
                type="button"
                onClick={() => handleUse(s)}
                onKeyDown={(e) => handleKeyDown(e, s)}
                className={cn(
                  "flex-1 min-w-0 text-left px-1.5 py-1 rounded",
                  "text-[11.5px] sm:text-[12px] leading-[1.45]",
                  "text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
                  "hover:bg-[var(--gold)]/[0.05]",
                  "transition-colors duration-150 ease-out",
                )}
                title="Press Enter to insert as a margin note"
                aria-label={`Use wisdom from ${s.source}: ${s.text.slice(0, 80)}`}
              >
                <span className="line-clamp-2 break-words">
                  <span
                    className="text-[10px] font-mono uppercase tracking-[0.12em] text-[var(--gold)]/65 mr-1.5"
                    aria-hidden="true"
                  >
                    {s.source}
                  </span>
                  {s.text}
                </span>
              </button>
              <button
                type="button"
                onClick={() => dismiss(s.id)}
                className={cn(
                  "shrink-0 mt-[2px] p-1 rounded",
                  "text-[var(--text-tertiary)] hover:text-[var(--text-primary)]",
                  "hover:bg-[var(--bg-elevated)]",
                  "transition-colors duration-150",
                )}
                title="Dismiss"
                aria-label="Dismiss this suggestion"
              >
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
        {/* Kill-forever menu · invisible until hovered · only the
            operator should ever see this on intentional inspection.
            Permanently disables the pill via localStorage. */}
        <div className="shrink-0 self-start flex flex-col items-end gap-0.5">
          {showKillMenu ? (
            <button
              type="button"
              onClick={() => {
                killForever();
                setShowKillMenu(false);
              }}
              className={cn(
                "px-1.5 py-0.5 rounded",
                "text-[9px] font-mono uppercase tracking-[0.14em]",
                "text-red-400 hover:text-red-300",
                "border border-red-400/30 hover:border-red-400/50",
                "transition-colors",
              )}
              title="Stop showing wisdom suggestions permanently"
            >
              kill
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowKillMenu(true)}
              className={cn(
                "text-[9px] font-mono uppercase tracking-[0.14em]",
                "text-[var(--text-tertiary)]/60 hover:text-[var(--text-tertiary)]",
                "opacity-0 group-hover/wisdom:opacity-100 focus:opacity-100",
                "transition-opacity",
              )}
              title="Disable wisdom suggestions"
              aria-label="More options for the wisdom suggestion pill"
            >
              ⋯
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Export the underlying types so callers can import alongside the
// component without reaching into the hook directly.
export type { WisdomSuggestion };
