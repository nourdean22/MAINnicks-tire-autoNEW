"use client";

import { Pin, X } from "lucide-react";

/**
 * PinnedMessagesBar — the gold-tinted strip at the top of the chat
 * surface that lists session-pinned messages. Each pin shows a
 * single-line preview + an unpin button.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83). Visual
 * contract identical · the parent owns the pin store via
 * usePinnedMessages and passes the list + unpin handler down.
 */
export function PinnedMessagesBar({
  pinned,
  onUnpin,
}: {
  pinned: Array<{ id: string; text: string }>;
  onUnpin: (id: string) => void;
}) {
  if (pinned.length === 0) return null;
  return (
    <div className="shrink-0 border-b border-[var(--gold)]/10 bg-[var(--gold-ghost)] px-3 py-1.5 space-y-1 max-h-24 overflow-y-auto">
      {pinned.map((p) => (
        <div key={p.id} className="flex items-start gap-2 text-[11px]">
          <Pin size={10} className="text-[var(--gold)] mt-0.5 shrink-0" />
          <p className="flex-1 text-[var(--text-secondary)] line-clamp-1">{p.text}</p>
          <button
            onClick={() => onUnpin(p.id)}
            className="shrink-0 text-[var(--text-tertiary)] hover:text-red-400"
            aria-label="Unpin this context"
            title="Unpin"
          >
            <X size={10} />
          </button>
        </div>
      ))}
    </div>
  );
}
