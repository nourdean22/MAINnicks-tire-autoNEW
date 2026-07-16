"use client";

/**
 * OmniCaptureModal · /tasks v2.2 Phase 4 lite · 2026-05-26
 *
 * ⌘K-triggered omni-capture modal · Linear-style centered. Accepts
 * text input · on Enter calls the operator-provided `onCapture`
 * handler · on Esc closes. Self-mounts a global keyboard listener
 * that responds to Cmd+K (or Ctrl+K on non-mac).
 *
 * Phase 4 lite scope (this commit):
 *   - Text capture only · matches the /tasks quick-add behavior
 *   - Reuses parseQuickAdd via the consumer's onCapture handler
 *   - Voice continuous mode DEFERRED · the heavier @transformers.js
 *     integration lands in Phase 4 full
 *   - AI categorization DEFERRED · operator captures raw, list does
 *     the rest via existing parsers
 *
 * The trigger fires GLOBALLY on the page when this component is
 * mounted · operator doesn't need to focus anything first. Standard
 * "focus is an input" detection skips the listener so Cmd+K inside
 * a TextArea still pages-down (rare but possible).
 *
 * Mobile fallback · the modal also exposes a [+] FAB-like button that
 * iOS PWA can tap. ⌘K is keyboard-only by definition.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Sparkles, X, Plus } from "lucide-react";

interface OmniCaptureModalProps {
  /** Handler called with the operator-typed string when they press Enter.
   *  Consumer is responsible for parsing + persisting (e.g. via the
   *  existing parseQuickAdd + addTask handlers on /tasks). */
  onCapture: (text: string) => Promise<void> | void;
  /** Optional placeholder · defaults to the operator-grade prompt. */
  placeholder?: string;
  /** When false · the global Cmd+K listener is not attached. Useful
   *  for pages that want to mount the modal but trigger via their
   *  own UI button. Default true. */
  enableHotkey?: boolean;
}

export function OmniCaptureModal({
  onCapture,
  placeholder = "Capture · brake quote for Will · order tires B250 · cold plunge",
  enableHotkey = true,
}: OmniCaptureModalProps) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global ⌘K (or Ctrl+K on non-mac) opens the modal. Skip when an
  // input element already has focus (so a quick-add input on /tasks
  // takes precedence and doesn't shadow itself).
  useEffect(() => {
    if (!enableHotkey) return;
    function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== "k") return;
      const active = document.activeElement;
      const tag = (active?.tagName || "").toUpperCase();
      const inEditable =
        tag === "INPUT" || tag === "TEXTAREA" || (active as HTMLElement | null)?.isContentEditable;
      // If operator's typing in any input that's NOT this modal's
      // own field · let the browser/native ⌘K handle it (typically
      // does nothing in chrome). Don't fight focus contention.
      if (inEditable && active !== inputRef.current) return;
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enableHotkey]);

  // Esc closes when modal is open · also focus the input on open.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        setText("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const submit = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    try {
      await onCapture(trimmed);
      setText("");
      setOpen(false);
    } catch {
      // The consumer toasts the failure (handleQuickAdd rethrows after
      // toast.error). Keep the modal open with the text intact so the
      // operator can retry — clearing/closing only happens on success.
    } finally {
      setSubmitting(false);
    }
  }, [text, submitting, onCapture]);

  // Mobile sweep #3 (2026-05-27) · render a mobile-only "+" FAB when
  // closed so iOS PWA operators have a tap path to omni-capture (⌘K
  // is keyboard-only). Positioned bottom-LEFT to stay clear of the
  // brain FAB (bottom-right). Hidden on desktop where ⌘K dominates.
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="omni capture"
        className="lg:hidden fixed bottom-4 left-4 z-40 inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--gold)]/40 bg-[var(--bg-base)]/95 backdrop-blur-sm text-[var(--gold)] shadow-lg shadow-[var(--gold)]/10 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40 pb-[env(safe-area-inset-bottom,0px)]"
      >
        <Plus size={18} strokeWidth={2} />
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="omni capture"
      // Backdrop · click-outside closes · prevents body scroll behind
      // by not adding overflow-hidden to body (keeps simple · iOS PWA
      // already has its own scroll lock pattern via the page state).
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm px-4 pt-[20vh] sm:pt-[18vh]"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          setOpen(false);
          setText("");
        }
      }}
    >
      <div
        className="w-full max-w-xl rounded-2xl border border-[var(--gold)]/40 bg-[var(--bg-base)] shadow-2xl shadow-[var(--gold)]/10 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-4 py-2.5">
          <Sparkles size={13} className="text-[var(--gold)]" strokeWidth={1.75} />
          <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]/80">
            omni capture
          </span>
          <span className="ml-auto hidden lg:inline text-[10px] font-mono tabular-nums text-[var(--text-tertiary)]">
            ⌘K · esc to close
          </span>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setText("");
            }}
            aria-label="close"
            className="ml-2 inline-flex h-9 w-9 lg:h-6 lg:w-6 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-raised)]/[0.15] active:scale-90 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40"
          >
            <X size={14} strokeWidth={2} />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="p-4"
        >
          <input
            ref={inputRef}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={placeholder}
            disabled={submitting}
            // 44pt min for iOS PWA · 16px font for no iOS zoom
            className="w-full min-h-[44px] rounded-lg border border-[var(--border-default)] bg-[var(--bg-raised)]/[0.1] px-3.5 py-2 text-[16px] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)]/70 focus:border-[var(--gold)]/40 focus:bg-[var(--bg-raised)]/[0.2] focus:outline-none transition-colors disabled:opacity-50"
            autoComplete="off"
            spellCheck
            aria-label="task or note"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--text-tertiary)]/70">
              {text ? `${text.trim().length} chars · enter to capture` : "type · enter · done"}
            </span>
            <button
              type="submit"
              disabled={!text.trim() || submitting}
              className="inline-flex min-h-[36px] items-center gap-1.5 rounded-md border border-[var(--gold)]/50 bg-[var(--gold)]/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.05em] text-[var(--gold)] hover:bg-[var(--gold)]/15 disabled:opacity-40 disabled:hover:bg-[var(--gold)]/10 transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--gold)]/40"
            >
              {submitting ? "capturing…" : "capture"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
