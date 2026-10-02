"use client";

/**
 * InspectorFrame · the ONE chrome for inspecting any object · 2026-09-15.
 *
 * Twenty bespoke overlays each re-implemented backdrop, z-index, Escape and
 * safe-area (docs/design/ui-workbench-2026-09-15.md §1.1 S7). This is the
 * primitive they were missing. Presentational: it knows nothing about data,
 * routes or stores, so tests render it with `renderToStaticMarkup` and the
 * chat-states gallery shows its states against fixtures.
 *
 *   panel  (>= xl)  non-modal right dock, 380px, `role="complementary"`.
 *                   Sits left of the Nick pane when that is open
 *                   (`--nick-pane-open-w`, published by nick-side-pane.tsx)
 *                   and leaves the fixed bottom chrome untouched.
 *   sheet  (< xl)   bottom sheet with scrim — the more-sheet.tsx /
 *                   nick-side-pane.tsx house chrome. z-index slot 60/61:
 *                   above the Nick sheet (58/59), below MORE (70).
 *
 * `mode="peek"` is the Space preview: same chrome, an eyebrow that says how
 * to commit or leave, no URL entry.
 */

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ENTITY_KIND_LABEL, type EntityKind } from "@/lib/ui/entity-ref";

export type InspectorMode = "peek" | "inspect";
export type InspectorPresentation = "panel" | "sheet";

export interface InspectorFrameProps {
  kind: EntityKind | null;
  mode: InspectorMode;
  presentation: InspectorPresentation;
  onClose: () => void;
  /** Footer slot — the entity action row, page-provided actions. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export const INSPECTOR_PANEL_WIDTH = "380px";

export function InspectorFrame({ kind, mode, presentation, onClose, actions, children, className }: InspectorFrameProps) {
  const eyebrow = kind ? ENTITY_KIND_LABEL[kind] : "object";
  const closeRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  // The sheet is intentionally specialized rather than portaled through
  // Dialog because this same frame also renders the non-modal desktop panel
  // and participates in Inspector ViewTransitions. Enforce the same modal
  // contract in place: trap focus, restore the opener, and lock page scroll.
  // Object swaps do NOT re-focus Close; the effect runs only when the
  // presentation itself becomes a sheet.
  useEffect(() => {
    if (presentation !== "sheet") return;

    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusFrame = requestAnimationFrame(() => {
      closeRef.current?.focus({ preventScroll: true });
    });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const root = sheetRef.current;
      if (!root) return;

      const focusables = Array.from(
        root.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((node) => !node.hasAttribute("aria-hidden"));

      if (focusables.length === 0) {
        event.preventDefault();
        closeRef.current?.focus({ preventScroll: true });
        return;
      }

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;

      if (!active || !root.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus && document.contains(previousFocus)) {
        requestAnimationFrame(() => {
          if (document.contains(previousFocus)) {
            previousFocus.focus({ preventScroll: true });
          }
        });
      }
    };
  }, [presentation]);

  const header = (
    <div className="flex items-start justify-between gap-3 border-b border-edge-subtle px-4 pb-2 pt-3">
      <div className="min-w-0">
        <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-fg-tertiary">
          <span className="notch mr-2 align-middle" aria-hidden />
          {eyebrow}
          {mode === "peek" ? <span className="ml-2 text-fg-secondary">peek</span> : null}
        </p>
        {mode === "peek" ? (
          <p className="mt-0.5 text-[11px] text-fg-tertiary">
            <kbd className="font-mono">Enter</kbd> opens · <kbd className="font-mono">Esc</kbd> closes ·{" "}
            <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> move
          </p>
        ) : null}
      </div>
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close inspector"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-control text-fg-tertiary transition-colors duration-[var(--motion-state)] hover:text-fg",
          presentation === "sheet" ? "min-h-[44px] min-w-[44px]" : "h-8 w-8",
        )}
      >
        <X size={16} />
      </button>
    </div>
  );

  const body = <div className="flex-1 overflow-y-auto overscroll-contain bg-content px-4 py-3">{children}</div>;

  const footer = actions ? <div className="border-t border-glass px-4 py-3">{actions}</div> : null;

  if (presentation === "panel") {
    return (
      <aside
        role="complementary"
        aria-label="Inspector"
        data-inspector="panel"
        data-inspector-mode={mode}
        data-inspector-kind={kind ?? "unknown"}
        className={cn(
          "ui-material fixed top-[env(safe-area-inset-top,0px)] z-[45] flex flex-col border-l border-edge-default",
          "bottom-[var(--bottom-chrome-h,6rem)] shadow-l1",
          className,
        )}
        style={{ width: INSPECTOR_PANEL_WIDTH, right: "var(--nick-pane-open-w, 0px)" }}
      >
        {header}
        {body}
        {footer}
      </aside>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Inspector"
      data-inspector="sheet"
      data-inspector-mode={mode}
      data-inspector-kind={kind ?? "unknown"}
    >
      {/* Scrim: tap-to-close, but not a second "Close inspector" in the tab order. */}
      <button type="button" aria-hidden tabIndex={-1} className="absolute inset-0 bg-overlay/70" onClick={onClose} />
      <div
        ref={sheetRef}
        className={cn(
          "ui-material relative z-[61] flex max-h-[85vh] min-h-[40vh] flex-col rounded-t-float border-t border-edge-default",
          "pb-[env(safe-area-inset-bottom,12px)] shadow-l2 animate-fadeSlideUp",
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-edge-strong" aria-hidden />
        {header}
        {body}
        {footer}
      </div>
    </div>
  );
}
