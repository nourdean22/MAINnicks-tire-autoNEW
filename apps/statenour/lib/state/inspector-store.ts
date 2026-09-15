import { create } from "zustand";
import { formatEntityRef, sameEntity, type EntityKind, type EntityRef } from "@/lib/ui/entity-ref";

/**
 * An action the CURRENT PAGE lends to the inspector for one kind — the
 * Missions board registers complete / snooze for `task` through its own
 * dispatch, so the inspector runs the page's mutation path (optimistic
 * board update, completion prompt, telemetry) instead of a second one.
 * `run` receives the entity id; the inspector invalidates its own read after.
 */
export interface InspectorPageAction {
  id: string;
  label: string;
  run: (id: string) => void | Promise<void>;
  tone?: "primary" | "default";
}

/**
 * Inspector store · 2026-09-15 (UI workbench slice 1).
 *
 * Cross-component UI state for the universal inspector, in the Zustand
 * pattern `more-sheet-store.ts` and `chat-ui-store.ts` established. What is
 * NOT here: the OPEN inspector. That lives in the URL (`?inspect=`, see
 * lib/ui/inspect-url.ts) so it survives reload and Back/Forward; the store
 * only holds the transient layer around it:
 *
 *   peek        the row Space previewed — follows focus, never in the URL
 *   focused     the last entity a list gave keyboard focus (palette reads it)
 *   selected    entity keys chosen with x / Shift+arrows, in one scope
 *   ownedKinds  kinds the CURRENT PAGE renders itself (e.g. /people's dossier
 *               panel) so the host stays silent for them
 *   realityMode the persisted "show provenance inline everywhere" toggle
 */
export interface InspectorState {
  peek: EntityRef | null;
  focused: EntityRef | null;
  selected: string[];
  selectionScope: string | null;
  ownedKinds: EntityKind[];
  realityMode: boolean;
  hydrated: boolean;
  /** Per kind, the actions the current page registered (see InspectorPageAction). */
  pageActions: Partial<Record<EntityKind, InspectorPageAction[]>>;

  setPeek: (ref: EntityRef | null) => void;
  togglePeek: (ref: EntityRef) => void;
  setFocused: (ref: EntityRef | null) => void;
  setSelection: (keys: string[], scope: string | null) => void;
  clearSelection: () => void;
  ownKinds: (kinds: EntityKind[]) => void;
  releaseKinds: (kinds: EntityKind[]) => void;
  setRealityMode: (on: boolean) => void;
  hydrate: () => void;
  /** Route change: peek, focus and selection belong to the page that made them. */
  resetTransient: () => void;
  /** Register a page's actions for a kind; returns the release. A second registration replaces the first. */
  registerPageActions: (kind: EntityKind, actions: InspectorPageAction[]) => () => void;
}

function sameKeys(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

export const REALITY_MODE_STORAGE_KEY = "nour:reality-mode:v1";

function readRealityMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(REALITY_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeRealityMode(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REALITY_MODE_STORAGE_KEY, on ? "1" : "0");
  } catch {
    /* storage full or disabled — the in-memory value still applies */
  }
}

export const useInspectorStore = create<InspectorState>((set, get) => ({
  peek: null,
  focused: null,
  selected: [],
  selectionScope: null,
  ownedKinds: [],
  realityMode: false,
  hydrated: false,
  pageActions: {},

  setPeek: (ref) => set({ peek: ref }),
  togglePeek: (ref) => set((s) => ({ peek: sameEntity(s.peek, ref) ? null : ref })),
  // Every pointerdown in a scope calls these with fresh identities; a no-op
  // when nothing changed keeps the action bar and the palette from
  // re-rendering per click (review 2026-09-15).
  setFocused: (ref) => {
    const cur = get().focused;
    if (ref === null ? cur === null : sameEntity(cur, ref)) return;
    set({ focused: ref });
  },
  setSelection: (keys, scope) => {
    const next = [...new Set(keys)];
    const nextScope = next.length ? scope : null;
    const cur = get();
    if (sameKeys(cur.selected, next) && cur.selectionScope === nextScope) return;
    set({ selected: next, selectionScope: nextScope });
  },
  clearSelection: () => {
    if (get().selected.length === 0 && get().selectionScope === null) return;
    set({ selected: [], selectionScope: null });
  },
  resetTransient: () => set({ peek: null, focused: null, selected: [], selectionScope: null }),
  registerPageActions: (kind, actions) => {
    set((s) => ({ pageActions: { ...s.pageActions, [kind]: actions } }));
    return () => {
      // Release only what THIS registration put there — a later registration
      // for the same kind must survive an earlier one's unmount.
      if (get().pageActions[kind] !== actions) return;
      set((s) => {
        const next = { ...s.pageActions };
        delete next[kind];
        return { pageActions: next };
      });
    };
  },
  ownKinds: (kinds) => set((s) => ({ ownedKinds: [...new Set([...s.ownedKinds, ...kinds])] })),
  releaseKinds: (kinds) => set((s) => ({ ownedKinds: s.ownedKinds.filter((k) => !kinds.includes(k)) })),
  setRealityMode: (on) => {
    writeRealityMode(on);
    set({ realityMode: on });
  },
  hydrate: () => {
    if (get().hydrated) return;
    set({ realityMode: readRealityMode(), hydrated: true });
  },
}));

/** Selected keys as refs — a helper for the consumers that act on selections. */
export function selectedRefs(state: Pick<InspectorState, "selected">, parse: (key: string) => EntityRef | null): EntityRef[] {
  return state.selected.map(parse).filter((r): r is EntityRef => r !== null);
}

export function isSelectedKey(state: Pick<InspectorState, "selected">, ref: EntityRef): boolean {
  return state.selected.includes(formatEntityRef(ref));
}
