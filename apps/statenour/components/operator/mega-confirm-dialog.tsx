"use client";

/**
 * MegaConfirmDialog · Phase N.4 (2026-05-18 PM)
 *
 * Replaces window.confirm for the mega-tier cost gate. Pre-N.4 the
 * native confirm() blocked the UI thread + didn't trap focus + didn't
 * follow ARIA conventions · keyboard users could skip the confirm
 * entirely on some browsers.
 *
 * Now: proper modal dialog · focus trap via aria-modal + focus
 * management on open/close · Esc closes (cancel) · Enter confirms ·
 * backdrop click cancels · matches the editorial-minimalist aesthetic
 * of the rest of /reason.
 *
 * Promise-based API · so the existing `await confirm("...")` call
 * pattern works unchanged.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface MegaConfirmDialogProps {
  open: boolean;
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function MegaConfirmDialog({
  open,
  title = "Confirm expensive run",
  message,
  confirmLabel = "Run mega",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: MegaConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // N.4 · focus management · save current focus on open · restore on close.
  // Manual modal exception: lock background scroll for parity with the
  // Base UI Dialog runtime used by the rest of StateNour.
  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Focus the confirm button on mount
    confirmRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [open]);

  // Keyboard handling · Esc cancels · Enter confirms · Tab trapped to dialog
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        // Focus trap · cycle within dialog's focusable elements
        const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  if (!open || typeof window === "undefined") return null;

  return createPortal(
    <div
      // Backdrop · click cancels · presents the modal
      className="fixed inset-0 z-[100] flex items-center justify-center bg-overlay/70"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mega-confirm-title"
        aria-describedby="mega-confirm-message"
        className="max-w-md w-full mx-4 max-h-[85vh] overflow-y-auto rounded-overlay border border-edge-default bg-overlay shadow-l2 p-6 space-y-4"
      >
        <h2
          id="mega-confirm-title"
          className="text-[11px] font-mono uppercase tracking-[0.12em] text-fg-tertiary"
        >
          {title}
        </h2>
        <p
          id="mega-confirm-message"
          className="text-sm text-[var(--text-primary)] whitespace-pre-wrap leading-relaxed"
        >
          {message}
        </p>
        <div className="flex items-center justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex min-h-[44px] items-center rounded-control border border-edge-default bg-content px-4 text-[13px] font-medium text-fg-secondary transition-colors duration-[var(--motion-state)] hover:border-edge-strong hover:text-fg"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            onClick={onConfirm}
            className="inline-flex min-h-[44px] items-center rounded-control bg-accent px-4 text-[14px] font-semibold text-[var(--text-inverse)] transition-colors duration-[var(--motion-state)] hover:bg-accent-hover"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// Promise-based API · drop-in replacement for window.confirm(message).
// Mounts a transient dialog · resolves with true/false on user action.
let confirmCounter = 0;
const pendingConfirms = new Map<number, (v: boolean) => void>();
let renderUpdate: (() => void) | null = null;

interface PendingConfirm {
  id: number;
  message: string;
  resolve: (v: boolean) => void;
}

let pendingState: PendingConfirm | null = null;

export function megaConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const id = ++confirmCounter;
    pendingConfirms.set(id, resolve);
    pendingState = { id, message, resolve };
    renderUpdate?.();
  });
}

/** Mount once at the layout root · listens for megaConfirm() calls
 *  and renders the dialog. Decoupled from the page that triggers
 *  it so the dialog isn't tied to React state in NickReasoner. */
export function MegaConfirmHost() {
  const [, setTick] = useState(0);
  useEffect(() => {
    renderUpdate = () => setTick((t) => t + 1);
    return () => {
      renderUpdate = null;
    };
  }, []);
  const current = pendingState;
  if (!current) return null;
  return (
    <MegaConfirmDialog
      open={true}
      title="Mega tier · confirm spend"
      message={current.message}
      onConfirm={() => {
        current.resolve(true);
        pendingConfirms.delete(current.id);
        pendingState = null;
        renderUpdate?.();
      }}
      onCancel={() => {
        current.resolve(false);
        pendingConfirms.delete(current.id);
        pendingState = null;
        renderUpdate?.();
      }}
    />
  );
}
