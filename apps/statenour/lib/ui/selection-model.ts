/**
 * Selection model · pure · 2026-09-15 (UI workbench slice 1).
 *
 * The keyboard grammar Linear made standard, expressed as a reducer over an
 * ORDERED LIST OF ENTITY KEYS so it can be tested without a DOM and reused by
 * any list that marks its rows with `data-entity`:
 *
 *   j / Down        move focus         Shift+j / Shift+Down    extend selection
 *   k / Up          move focus         Shift+k / Shift+Up      extend selection
 *   Home / End      first / last row
 *   x               toggle the focused row's selection
 *   Space           PEEK the focused row (transient inspector)
 *   Enter           OPEN the focused row (`?inspect=`)
 *   Esc             unwind one level: peek → selection → inspector
 *
 * Focus never wraps: on a long list a wrap is a surprise, and the end of the
 * list is information. Nothing here reads the DOM; hooks/use-selection-keyboard.ts
 * supplies the order and applies the result as roving focus.
 *
 * The only multi-select this app ever had lived in components/actions/loop-stream.tsx,
 * which is parked with zero importers (tests/repo/ui-mount-graph.test.ts). This
 * is its replacement, as a primitive rather than a page feature.
 */

export interface SelectionState {
  /** Key of the focused row (the wire form of its EntityRef), or null. */
  focus: string | null;
  /** Selected keys in selection order. */
  selected: string[];
  /** Anchor for range selection: the row where the current run started. */
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = Object.freeze({
  focus: null,
  selected: [],
  anchor: null,
}) as SelectionState;

export type SelectionEvent =
  | { type: "focus"; key: string }
  | { type: "move"; delta: 1 | -1 }
  | { type: "extend"; delta: 1 | -1 }
  | { type: "home" }
  | { type: "end" }
  | { type: "toggle"; key?: string }
  | { type: "range"; key: string }
  | { type: "select-only"; key: string }
  | { type: "select-all" }
  | { type: "clear" }
  | { type: "reset" };

function uniq(keys: readonly string[]): string[] {
  return [...new Set(keys)];
}

function clamp(index: number, length: number): number {
  if (length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, index));
}

function rangeBetween(order: readonly string[], a: string, b: string): string[] {
  const ia = order.indexOf(a);
  const ib = order.indexOf(b);
  if (ia < 0 || ib < 0) return [];
  const [lo, hi] = ia <= ib ? [ia, ib] : [ib, ia];
  return order.slice(lo, hi + 1);
}

/**
 * Apply one event. `order` is the list's current row order (entity keys).
 * Events naming a key outside `order` are ignored — a stale reference must
 * never move focus somewhere invisible.
 */
export function reduceSelection(
  state: SelectionState,
  event: SelectionEvent,
  order: readonly string[],
): SelectionState {
  switch (event.type) {
    case "focus": {
      if (!order.includes(event.key)) return state;
      return { ...state, focus: event.key };
    }
    case "move": {
      if (order.length === 0) return state;
      const current = state.focus ? order.indexOf(state.focus) : -1;
      // No focus yet: Down lands on the first row, Up on the last.
      const next =
        current < 0 ? (event.delta > 0 ? 0 : order.length - 1) : clamp(current + event.delta, order.length);
      return { ...state, focus: order[next] ?? null };
    }
    case "extend": {
      if (order.length === 0) return state;
      const moved = reduceSelection(state, { type: "move", delta: event.delta }, order);
      if (!moved.focus) return moved;
      const anchor = state.anchor ?? state.focus ?? moved.focus;
      const run = rangeBetween(order, anchor, moved.focus);
      // A run replaces whatever the previous run selected, but keeps rows
      // selected outside the run (toggled individually).
      const previousRun = state.anchor && state.focus ? rangeBetween(order, state.anchor, state.focus) : [];
      const kept = state.selected.filter((k) => !previousRun.includes(k));
      return { focus: moved.focus, anchor, selected: uniq([...kept, ...run]) };
    }
    case "home": {
      if (order.length === 0) return state;
      return { ...state, focus: order[0] ?? null };
    }
    case "end": {
      if (order.length === 0) return state;
      return { ...state, focus: order[order.length - 1] ?? null };
    }
    case "toggle": {
      const key = event.key ?? state.focus;
      if (!key || !order.includes(key)) return state;
      const isSelected = state.selected.includes(key);
      return {
        focus: key,
        anchor: key,
        selected: isSelected ? state.selected.filter((k) => k !== key) : [...state.selected, key],
      };
    }
    case "range": {
      if (!order.includes(event.key)) return state;
      const anchor = state.anchor ?? state.focus ?? event.key;
      return {
        focus: event.key,
        anchor,
        selected: uniq([...state.selected, ...rangeBetween(order, anchor, event.key)]),
      };
    }
    case "select-only": {
      if (!order.includes(event.key)) return state;
      return { focus: event.key, anchor: event.key, selected: [event.key] };
    }
    case "select-all": {
      return { ...state, anchor: order[0] ?? null, selected: [...order] };
    }
    case "clear": {
      return { ...state, selected: [], anchor: null };
    }
    case "reset": {
      return EMPTY_SELECTION;
    }
    default:
      return state;
  }
}

/** Drop focus / selection entries whose rows left the list (re-sort, filter, delete). */
export function reconcileSelection(state: SelectionState, order: readonly string[]): SelectionState {
  const present = new Set(order);
  const selected = state.selected.filter((k) => present.has(k));
  const focus = state.focus && present.has(state.focus) ? state.focus : null;
  const anchor = state.anchor && present.has(state.anchor) ? state.anchor : null;
  if (selected.length === state.selected.length && focus === state.focus && anchor === state.anchor) {
    return state;
  }
  return { focus, selected, anchor };
}

export type KeyIntent =
  | { intent: "move"; delta: 1 | -1 }
  | { intent: "extend"; delta: 1 | -1 }
  | { intent: "home" }
  | { intent: "end" }
  | { intent: "toggle" }
  | { intent: "peek" }
  | { intent: "open" }
  | { intent: "escape" };

export interface KeyLike {
  key: string;
  shiftKey?: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
}

/**
 * Map a keydown to an intent, or null when the key is not ours. Modifier
 * chords (Cmd/Ctrl/Alt) are never claimed — Cmd+K, Cmd+Shift+K and the chat
 * matrix own those. Shift is the only modifier this grammar uses.
 */
export function keyToIntent(e: KeyLike): KeyIntent | null {
  if (e.metaKey || e.ctrlKey || e.altKey) return null;
  switch (e.key) {
    case "ArrowDown":
    case "j":
    case "J":
      return e.shiftKey ? { intent: "extend", delta: 1 } : { intent: "move", delta: 1 };
    case "ArrowUp":
    case "k":
    case "K":
      return e.shiftKey ? { intent: "extend", delta: -1 } : { intent: "move", delta: -1 };
    case "Home":
      return { intent: "home" };
    case "End":
      return { intent: "end" };
    case "x":
    case "X":
      return { intent: "toggle" };
    case " ":
    case "Spacebar":
      return { intent: "peek" };
    case "Enter":
      return { intent: "open" };
    case "Escape":
      return { intent: "escape" };
    default:
      return null;
  }
}

export interface TypingTargetLike {
  tagName?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
}

/**
 * True when a keydown originates from something the operator is typing into.
 * The global shortcut handler (components/hud/keyboard-shortcuts.tsx) only
 * checks INPUT / TEXTAREA / SELECT; contenteditable editors and ARIA text
 * boxes (the chat composer, the journal) would otherwise lose `j`, `k`, `x`
 * and Space to list navigation.
 */
export function isTypingTarget(target: TypingTargetLike | null | undefined): boolean {
  if (!target) return false;
  const tag = (target.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  const role = target.getAttribute?.("role");
  if (role === "textbox" || role === "combobox" || role === "searchbox") return true;
  if (target.getAttribute?.("contenteditable") === "true") return true;
  return false;
}

export type EscapeStep = "close-peek" | "clear-selection" | "close-inspector" | "none";

/** Esc unwinds ONE level per press, innermost first. */
export function escapeStep(ctx: { peek: boolean; hasSelection: boolean; inspecting: boolean }): EscapeStep {
  if (ctx.peek) return "close-peek";
  if (ctx.hasSelection) return "clear-selection";
  if (ctx.inspecting) return "close-inspector";
  return "none";
}
