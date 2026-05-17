"use client";

/**
 * BreakPromiseModal · v10.0.529.13
 *
 * Extracted from `components/actions/loop-stream.tsx` lines 587-644.
 * Reason capture for "I committed to this and I'm breaking it" flow.
 * Saves a `BrokenPromiseLog` row via the parent's `onBreakPromise`
 * handler so Nick can pattern-tag the failure for next time.
 *
 * What this extraction gives us (audit · v529.12 mobile/a11y pass):
 *   · `role="dialog"` + `aria-modal="true"` · WCAG 2.1 SC 4.1.2
 *   · `aria-labelledby` + `aria-describedby` · screen reader anchors
 *   · Focus trap · Tab/Shift+Tab cycle restricted to the modal
 *   · Escape closes · the canonical dismiss affordance
 *   · Focus restoration · returns to the originating element on close
 *   · Backdrop click closes · standard modal expectation
 *
 * Without these, iOS VoiceOver users could read content behind the
 * modal · keyboard users could tab into the underlying page · and
 * Escape did nothing. The visual treatment is unchanged.
 */

import { useEffect, useId, useRef } from "react";
import { X } from "lucide-react";

interface BreakPromiseModalProps {
  task: { id: string; title: string };
  reason: string;
  onReasonChange: (next: string) => void;
  onCancel: () => void;
  onConfirm: () => Promise<void> | void;
}

export function BreakPromiseModal({
  task,
  reason,
  onReasonChange,
  onCancel,
  onConfirm,
}: BreakPromiseModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descId = useId();

  // Capture the previously-focused element so we can restore it when
  // the modal closes · and move focus into the textarea on mount.
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    textareaRef.current?.focus();
    return () => {
      // Restore focus to wherever it came from. If that element is
      // gone (e.g. the row was deleted), this is a no-op.
      previouslyFocused.current?.focus?.();
    };
  }, []);

  // Escape to close · Tab/Shift+Tab cycle restricted to the dialog.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = root.querySelectorAll<HTMLElement>(
        'a, button, textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      // Backdrop click closes · click on the dialog body itself should
      // NOT close, so the inner div uses stopPropagation.
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className="w-full max-w-md rounded-xl border border-red-500/30 bg-zinc-950 p-4 space-y-3 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <X size={14} className="text-red-400 mt-0.5 shrink-0" aria-hidden />
          <div className="flex-1">
            <p
              id={titleId}
              className="text-[10px] font-bold uppercase tracking-wider text-red-400"
            >
              Break promise
            </p>
            <p className="text-[12px] text-zinc-200 mt-0.5 leading-snug">
              {task.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel and close dialog"
            className="text-zinc-600 hover:text-zinc-300 -mr-1 -mt-0.5 p-1"
          >
            <X size={11} aria-hidden />
          </button>
        </div>
        <div>
          <label
            id={descId}
            htmlFor={`break-reason-${task.id}`}
            className="text-[9px] font-bold uppercase tracking-wider text-zinc-500 mb-1 block"
          >
            What got in the way?
          </label>
          <textarea
            ref={textareaRef}
            id={`break-reason-${task.id}`}
            value={reason}
            onChange={(e) => onReasonChange(e.target.value)}
            placeholder="One sentence is enough. Nick will learn from this."
            rows={3}
            className="w-full px-2 py-1.5 rounded bg-zinc-900 border border-zinc-800 text-[11px] text-zinc-200 placeholder:text-zinc-700 resize-none focus:border-red-500/30 outline-none"
          />
          <p className="text-[8px] text-zinc-700 mt-1 italic">
            Saved to the broken-promise log. Pattern-tagged so Nick can flag similar commitments later.
          </p>
        </div>
        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onCancel}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 px-3 py-1.5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            className="text-[10px] font-bold uppercase tracking-wider text-red-300 hover:text-red-200 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 rounded px-3 py-1.5"
          >
            Mark broken
          </button>
        </div>
      </div>
    </div>
  );
}
