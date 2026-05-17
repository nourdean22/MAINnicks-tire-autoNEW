"use client";

/**
 * StallBanner — the amber "reconnecting…" warning row that appears
 * above the composer when useChatStall reports a stalled stream
 * (no tokens in ~6s). One tap on Retry now fires the stall handler.
 *
 * Extracted from app/(mastery)/chat/page.tsx (Wave 83) · ~14 LOC of
 * inline JSX. Stall state + handler stay on the parent (useChatStall);
 * this component is pure presentation gated on the warn/streaming
 * combo from the parent.
 */
export function StallBanner({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-500/10 border-t border-amber-500/30 text-[10px] text-amber-300 animate-fade-in-scale">
      <div className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
      <span className="flex-1">
        reconnecting… no tokens in 6s. Auto-retry with fallback provider soon.
      </span>
      <button
        onClick={onRetry}
        className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 font-bold text-[9px] uppercase tracking-wider"
      >
        Retry now
      </button>
    </div>
  );
}
