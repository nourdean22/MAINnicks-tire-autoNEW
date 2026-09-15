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

import type { ReactNode } from "react";
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

  const header = (
    <div className="flex items-start justify-between gap-3 border-b border-glass px-4 pb-2 pt-3">
      <div className="min-w-0">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-fg-tertiary">
          {eyebrow}
          {mode === "peek" ? <span className="ml-2 text-gold">peek</span> : null}
        </p>
        {mode === "peek" ? (
          <p className="mt-0.5 text-[11px] text-fg-tertiary">
            <kbd className="font-mono">Enter</kbd> opens · <kbd className="font-mono">Esc</kbd> closes ·{" "}
            <kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> move
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close inspector"
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-lg text-fg-tertiary transition-colors hover:text-fg",
          presentation === "sheet" ? "min-h-[44px] min-w-[44px]" : "h-8 w-8",
        )}
      >
        <X size={16} />
      </button>
    </div>
  );

  const body = <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">{children}</div>;

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
          "fixed top-[env(safe-area-inset-top,0px)] z-[45] flex flex-col border-l border-glass bg-base-layer",
          "bottom-[var(--bottom-chrome-h,6rem)] shadow-[-12px_0_40px_rgba(0,0,0,0.45)]",
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
      <button type="button" aria-label="Close inspector" className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        className={cn(
          "relative z-[61] flex max-h-[85vh] min-h-[40vh] flex-col rounded-t-2xl border-t border-[var(--gold)]/30 bg-void",
          "pb-[env(safe-area-inset-bottom,12px)] shadow-[0_-20px_60px_rgba(0,0,0,0.7),0_-1px_30px_rgba(253,185,19,0.06)] animate-fadeSlideUp",
          className,
        )}
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-[var(--border-default)]" aria-hidden />
        {header}
        {body}
        {footer}
      </div>
    </div>
  );
}
