"use client";

/**
 * UndoSendToast — Apr 19. Small toast in the bottom-right that shows
 * after a message is queued. Has a 2s countdown + Undo button. If the
 * user taps Undo, the timer is cleared and the message never sends.
 *
 * The 2s undo window is the "oh wait no" grace period that phone
 * typing demands.
 */

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";

interface Props {
  visible: boolean;
  onUndo: () => void;
  totalMs?: number;
}

export function UndoSendToast({ visible, onUndo, totalMs = 2000 }: Props) {
  const [remainingMs, setRemainingMs] = useState(totalMs);

  useEffect(() => {
    if (!visible) {
      setRemainingMs(totalMs);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => {
      const elapsed = Date.now() - start;
      setRemainingMs(Math.max(0, totalMs - elapsed));
    }, 80);
    return () => clearInterval(id);
  }, [visible, totalMs]);

  if (!visible) return null;

  const secs = Math.ceil(remainingMs / 1000);
  const pct = (remainingMs / totalMs) * 100;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        "fixed bottom-4 right-4 z-[100] min-w-[200px]",
        "rounded-lg border border-[var(--border-default)] bg-[var(--bg-void)] backdrop-blur-xl",
        "shadow-[0_20px_60px_rgba(0,0,0,0.4)]",
        "animate-fade-in overflow-hidden",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="w-1.5 h-1.5 rounded-full bg-[var(--gold)] animate-pulse shrink-0" aria-hidden />
        <span className="text-[11px] text-[var(--text-primary)] flex-1">
          sent · undo in {secs}s
        </span>
        {/* 2026-05-24 · Wave X · pre-fix this button was text-[9px]
            px-2 py-0.5 ≈ 14px tall × 50px wide · operator on iPhone
            missed it constantly and the 2s window expired. Apple HIG
            min: 44pt. Now: min-h-[40px] min-w-[60px] with bigger
            font. role="status" + aria-live="polite" on the parent
            announces "sent · undo in 2s" to VoiceOver instead of the
            chip going un-noticed. */}
        <button
          onClick={onUndo}
          className="text-[10px] font-bold uppercase tracking-wider px-3 min-h-[40px] min-w-[60px] rounded border border-[var(--gold)]/40 text-[var(--gold)] hover:bg-[var(--gold)]/10 active:bg-[var(--gold)]/20 inline-flex items-center justify-center gap-1.5"
          aria-label={`Undo · ${secs} seconds left`}
        >
          <RotateCcw size={11} />
          undo
        </button>
      </div>
      {/* Shrinking progress bar */}
      <div
        className="h-0.5 bg-[var(--gold)] transition-all"
        style={{ width: `${pct}%`, transitionDuration: "80ms" }}
        aria-hidden
      />
    </div>
  );
}
