"use client";

import type { Mention } from "@/hooks/use-mention-suggestions";

/**
 * MentionDropdown — the @mention picker that surfaces above the
 * composer when the operator types `@` and a match list is available.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~45 LOC of
 * presentation JSX. The picker only knows the matched mentions and
 * what to do when one is picked · the parent owns the textarea state
 * + caret position and computes the rewrite via `onPick`.
 */
export function MentionDropdown({
  filtered,
  onPick,
}: {
  filtered: Mention[];
  onPick: (mention: Mention) => void;
}) {
  return (
    <div className="border-b border-[var(--gold)]/25 bg-[var(--bg-raised)] max-h-[240px] overflow-y-auto">
      <div className="px-4 py-1.5 text-[9px] text-[var(--gold)]/70 font-[var(--font-display)] font-bold uppercase tracking-[0.22em]">
        insert context
      </div>
      {filtered.length === 0 ? (
        <div className="px-4 py-3 text-[11px] text-[var(--text-tertiary)]">
          No matching tokens. Try @mit · @revenue · @critical · @commits · @drift · @score
        </div>
      ) : (
        filtered.map((m) => (
          <button
            key={m.key}
            onClick={() => onPick(m)}
            className="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[var(--gold-ghost)]"
          >
            <span className="text-base">{m.icon}</span>
            <div className="flex-1 min-w-0">
              <span className="text-xs font-medium text-[var(--gold)] font-mono">{m.label}</span>
              <span className="text-[10px] text-[var(--text-tertiary)] ml-2">{m.description}</span>
            </div>
          </button>
        ))
      )}
    </div>
  );
}
