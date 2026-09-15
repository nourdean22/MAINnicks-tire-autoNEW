"use client";

import { useEffect } from "react";
import { useInspectorStore } from "@/lib/state/inspector-store";
import { parseEntityRef } from "@/lib/ui/entity-ref";
import { routeOwnsKind } from "@/lib/ui/entity-actions";
import { readInspect } from "@/lib/ui/inspect-url";
import {
  EMPTY_SELECTION,
  escapeStep,
  isTypingTarget,
  keyToIntent,
  reconcileSelection,
  reduceSelection,
  type SelectionState,
} from "@/lib/ui/selection-model";
import { useInspector } from "@/hooks/use-inspector";

/**
 * Roving focus + selection over `[data-entity]` rows · 2026-09-15.
 *
 * A list opts in by marking its container `data-selection-scope="<id>"` and
 * each row `data-entity="<kind>:<id>"` (optionally `data-entity-label`). No
 * data plumbing: the hook reads row ORDER from the DOM each keystroke, runs
 * the pure reducer (lib/ui/selection-model.ts) and applies the result as
 * attributes + `element.focus()`, so screen readers follow and the row's own
 * `:focus-visible` ring shows. One document listener for the whole app,
 * mounted by the inspector host.
 *
 * Active scope = the scope containing the focused element, else the scope
 * last clicked, else the first scope on the page. Keys typed into inputs,
 * textareas, contenteditable and ARIA textboxes are never claimed.
 */

export const SELECTION_SCOPE_ATTR = "data-selection-scope";
export const ENTITY_ATTR = "data-entity";
export const ENTITY_LABEL_ATTR = "data-entity-label";
export const FOCUSED_ATTR = "data-entity-focused";
export const SELECTED_ATTR = "data-entity-selected";
/** Dispatch on `window` to clear the current selection from anywhere (the action bar's Clear). */
export const SELECTION_CLEAR_EVENT = "nour:selection-clear";
/**
 * Set on <html> while the document listener is attached — the host is
 * Suspense-wrapped, so it can arm a commit AFTER the rest of the layout
 * hydrated; a key pressed before that is lost. Tests wait on this instead
 * of guessing (tests/e2e/selection-grammar.spec.ts).
 */
export const SELECTION_ARMED_ATTR = "data-selection-grammar";

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

export function entityElement(scope: ParentNode, key: string): HTMLElement | null {
  return scope.querySelector<HTMLElement>(`[${ENTITY_ATTR}="${cssEscape(key)}"]`);
}

export function orderIn(scope: ParentNode): string[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(`[${ENTITY_ATTR}]`))
    .map((el) => el.getAttribute(ENTITY_ATTR) ?? "")
    .filter((k) => k.length > 0);
}

/** Label for a selected row, read from the DOM so no page has to plumb it. */
export function entityLabelFromDom(key: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.querySelector<HTMLElement>(`[${ENTITY_ATTR}="${cssEscape(key)}"]`);
  if (!el) return undefined;
  const explicit = el.getAttribute(ENTITY_LABEL_ATTR);
  if (explicit && explicit.trim()) return explicit.trim();
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 80) : undefined;
}

const INTERACTIVE = new Set(["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT", "SUMMARY"]);

/** A modal that is not ours (⌘K, the MORE sheet, a confirm) is up anywhere on the page. */
function foreignModalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]:not([data-inspector])') !== null;
}

/**
 * The Nick side pane publishes its open width on <html> (nick-side-pane.tsx,
 * `--nick-pane-open-w`) and closes itself on Esc. While it is open, Esc is
 * its key — the inspector underneath must not close in the same stroke.
 */
function nickPaneOpen(): boolean {
  return document.documentElement.style.getPropertyValue("--nick-pane-open-w").trim().length > 0;
}

/** True when Space/Enter would already mean something to the focused element (a button inside the row). */
function targetIsInteractive(target: EventTarget | null, row: HTMLElement | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || el === row) return false;
  if (INTERACTIVE.has(el.tagName)) return true;
  const role = el.getAttribute?.("role");
  return role === "button" || role === "link" || role === "menuitem" || role === "checkbox";
}

export function useSelectionKeyboard(): void {
  const { openInspector, closeInspector } = useInspector();

  useEffect(() => {
    if (typeof document === "undefined") return;

    let state: SelectionState = EMPTY_SELECTION;
    let activeScope: HTMLElement | null = null;
    let lastClickedScope: HTMLElement | null = null;

    const scopeId = (scope: HTMLElement | null) => scope?.getAttribute(SELECTION_SCOPE_ATTR) ?? null;

    const resolveScope = (): HTMLElement | null => {
      const active = document.activeElement as HTMLElement | null;
      const fromFocus = active?.closest?.<HTMLElement>(`[${SELECTION_SCOPE_ATTR}]`) ?? null;
      if (fromFocus) return fromFocus;
      if (lastClickedScope && document.contains(lastClickedScope)) return lastClickedScope;
      return document.querySelector<HTMLElement>(`[${SELECTION_SCOPE_ATTR}]`);
    };

    const clearAttrs = (scope: HTMLElement | null) => {
      const root: ParentNode = scope ?? document;
      root.querySelectorAll<HTMLElement>(`[${FOCUSED_ATTR}]`).forEach((el) => el.removeAttribute(FOCUSED_ATTR));
      root.querySelectorAll<HTMLElement>(`[${SELECTED_ATTR}]`).forEach((el) => el.removeAttribute(SELECTED_ATTR));
    };

    const apply = (scope: HTMLElement, next: SelectionState, moveFocus: boolean) => {
      if (scope !== activeScope) {
        clearAttrs(activeScope);
        activeScope = scope;
      }
      state = next;
      clearAttrs(scope);
      for (const key of next.selected) entityElement(scope, key)?.setAttribute(SELECTED_ATTR, "true");
      if (next.focus) {
        const el = entityElement(scope, next.focus);
        if (el) {
          el.setAttribute(FOCUSED_ATTR, "true");
          if (moveFocus) {
            if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
            el.focus({ preventScroll: true });
            el.scrollIntoView({ block: "nearest" });
          }
        }
      }
      const store = useInspectorStore.getState();
      store.setFocused(next.focus ? parseEntityRef(next.focus) : null);
      store.setSelection(next.selected, scopeId(scope));
    };

    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      const scope = target?.closest?.<HTMLElement>(`[${SELECTION_SCOPE_ATTR}]`) ?? null;
      if (!scope) return;
      lastClickedScope = scope;
      const row = target?.closest?.<HTMLElement>(`[${ENTITY_ATTR}]`);
      const key = row?.getAttribute(ENTITY_ATTR);
      if (!key) return;
      const order = orderIn(scope);
      // Click = focus. Shift-click = range. Cmd/Ctrl-click = toggle.
      const base = reconcileSelection(scope === activeScope ? state : EMPTY_SELECTION, order);
      const event = e.shiftKey
        ? ({ type: "range", key } as const)
        : e.metaKey || e.ctrlKey
          ? ({ type: "toggle", key } as const)
          : ({ type: "focus", key } as const);
      apply(scope, reduceSelection(base, event, order), false);
    };

    const onClear = () => {
      const scope = activeScope ?? resolveScope();
      if (!scope) {
        // No scope on this page (the selection was made elsewhere): the bar
        // still shows the store's count, so clear the store directly.
        state = EMPTY_SELECTION;
        useInspectorStore.getState().clearSelection();
        return;
      }
      apply(scope, reduceSelection(state, { type: "clear" }, orderIn(scope)), false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (isTypingTarget(e.target as HTMLElement | null)) return;
      // A modal that is not ours (⌘K, MORE sheet, a confirm dialog) owns the
      // keyboard while it is up — Esc must close IT, and j/k must not move
      // focus in the list underneath it. Checked on the DOCUMENT, not the
      // event target: the MORE sheet never moves focus into itself, so a
      // target-based check saw the page and one Esc closed two layers.
      if (foreignModalOpen()) return;
      const intent = keyToIntent(e);
      if (!intent) return;

      const store = useInspectorStore.getState();

      if (intent.intent === "escape") {
        if (nickPaneOpen()) return;
        const step = escapeStep({
          peek: store.peek !== null,
          hasSelection: state.selected.length > 0 || store.selected.length > 0,
          inspecting: readInspect(window.location.search) !== null,
        });
        if (step === "none") return;
        e.preventDefault();
        if (step === "close-peek") store.setPeek(null);
        else if (step === "clear-selection") onClear();
        else closeInspector();
        return;
      }

      const scope = resolveScope();
      if (!scope) return;
      const order = orderIn(scope);
      if (order.length === 0) return;
      const reconciled = reconcileSelection(scope === activeScope ? state : EMPTY_SELECTION, order);
      // A row reached by Tab (role="button" rows are tabbable) has DOM focus
      // but no grammar focus yet — adopt it, so Enter/Space/x act on the row
      // the operator is actually on.
      const domRow = (document.activeElement as HTMLElement | null)?.closest?.<HTMLElement>(`[${ENTITY_ATTR}]`) ?? null;
      const domKey = domRow && scope.contains(domRow) ? domRow.getAttribute(ENTITY_ATTR) : null;
      const base =
        domKey && domKey !== reconciled.focus && order.includes(domKey)
          ? reduceSelection(reconciled, { type: "focus", key: domKey }, order)
          : reconciled;
      const focusedRow = base.focus ? entityElement(scope, base.focus) : null;

      switch (intent.intent) {
        case "move":
        case "extend": {
          e.preventDefault();
          const next = reduceSelection(base, { type: intent.intent, delta: intent.delta }, order);
          apply(scope, next, true);
          // Peek follows focus.
          if (store.peek && next.focus) store.setPeek(parseEntityRef(next.focus));
          return;
        }
        case "home":
        case "end": {
          e.preventDefault();
          const next = reduceSelection(base, { type: intent.intent }, order);
          apply(scope, next, true);
          if (store.peek && next.focus) store.setPeek(parseEntityRef(next.focus));
          return;
        }
        case "toggle": {
          if (!base.focus) return;
          e.preventDefault();
          apply(scope, reduceSelection(base, { type: "toggle" }, order), false);
          return;
        }
        case "peek": {
          if (!base.focus || targetIsInteractive(e.target, focusedRow)) return;
          const ref = parseEntityRef(base.focus);
          if (!ref) return;
          // A kind this page renders itself has no global peek to show —
          // setting one would only cost the next Esc.
          if (store.ownedKinds.includes(ref.kind) || routeOwnsKind(window.location.pathname, ref.kind)) return;
          e.preventDefault();
          store.togglePeek(ref);
          return;
        }
        case "open": {
          if (!base.focus || targetIsInteractive(e.target, focusedRow)) return;
          const ref = parseEntityRef(base.focus);
          if (!ref) return;
          e.preventDefault();
          openInspector(ref);
          return;
        }
        default:
          return;
      }
    };

    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener(SELECTION_CLEAR_EVENT, onClear);
    document.documentElement.setAttribute(SELECTION_ARMED_ATTR, "1");
    return () => {
      document.documentElement.removeAttribute(SELECTION_ARMED_ATTR);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener(SELECTION_CLEAR_EVENT, onClear);
      clearAttrs(activeScope);
      // The deps change with the pathname (openInspector closes over it), so
      // this runs on every route change: focus, selection and peek belong
      // to the page that made them. Without it "2 selected" followed the
      // operator to a page with no rows and no way to clear it.
      useInspectorStore.getState().resetTransient();
    };
  }, [openInspector, closeInspector]);
}
