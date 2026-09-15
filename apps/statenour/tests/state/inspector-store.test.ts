/**
 * Inspector store · 2026-09-15.
 *
 * The transient layer around the URL-backed inspector: peek toggles, a
 * selection lives in one scope, a page can own kinds, and Reality Mode
 * persists across reloads through localStorage (stubbed here — the vitest
 * environment is Node, so `window` is provided by the test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { REALITY_MODE_STORAGE_KEY, isSelectedKey, selectedRefs, useInspectorStore } from "@/lib/state/inspector-store";
import { parseEntityRef } from "@/lib/ui/entity-ref";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    map,
  };
}

let storage: ReturnType<typeof memoryStorage>;

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
  useInspectorStore.setState({
    peek: null,
    focused: null,
    selected: [],
    selectionScope: null,
    ownedKinds: [],
    realityMode: false,
    hydrated: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("peek", () => {
  it("togglePeek opens, re-toggling the same ref closes, a different ref swaps", () => {
    const s = useInspectorStore.getState();
    s.togglePeek({ kind: "task", id: "a" });
    expect(useInspectorStore.getState().peek).toEqual({ kind: "task", id: "a" });
    s.togglePeek({ kind: "task", id: "a" });
    expect(useInspectorStore.getState().peek).toBeNull();
    s.togglePeek({ kind: "task", id: "a" });
    s.togglePeek({ kind: "task", id: "b" });
    expect(useInspectorStore.getState().peek).toEqual({ kind: "task", id: "b" });
  });
});

describe("selection", () => {
  it("dedupes keys and clears the scope when the selection empties", () => {
    const s = useInspectorStore.getState();
    s.setSelection(["task:a", "task:a", "task:b"], "missions");
    expect(useInspectorStore.getState().selected).toEqual(["task:a", "task:b"]);
    expect(useInspectorStore.getState().selectionScope).toBe("missions");
    expect(isSelectedKey(useInspectorStore.getState(), { kind: "task", id: "a" })).toBe(true);
    expect(selectedRefs(useInspectorStore.getState(), parseEntityRef)).toEqual([
      { kind: "task", id: "a" },
      { kind: "task", id: "b" },
    ]);
    s.setSelection([], "missions");
    expect(useInspectorStore.getState().selectionScope).toBeNull();
  });
});

describe("ownership", () => {
  it("ownKinds / releaseKinds are set-like", () => {
    const s = useInspectorStore.getState();
    s.ownKinds(["person"]);
    s.ownKinds(["person", "task"]);
    expect(useInspectorStore.getState().ownedKinds).toEqual(["person", "task"]);
    s.releaseKinds(["person"]);
    expect(useInspectorStore.getState().ownedKinds).toEqual(["task"]);
  });
});

describe("reality mode", () => {
  it("persists to localStorage and hydrates back (once)", () => {
    useInspectorStore.getState().setRealityMode(true);
    expect(storage.getItem(REALITY_MODE_STORAGE_KEY)).toBe("1");
    useInspectorStore.setState({ realityMode: false, hydrated: false });
    useInspectorStore.getState().hydrate();
    expect(useInspectorStore.getState().realityMode).toBe(true);
    // A second hydrate does not re-read (the flag is authoritative once set in-session).
    storage.setItem(REALITY_MODE_STORAGE_KEY, "0");
    useInspectorStore.getState().hydrate();
    expect(useInspectorStore.getState().realityMode).toBe(true);
  });

  it("defaults to off when storage is empty (the control)", () => {
    useInspectorStore.getState().hydrate();
    expect(useInspectorStore.getState().realityMode).toBe(false);
  });
});

describe("identity · a set that changes nothing does not notify (review 2026-09-15)", () => {
  it("setFocused / setSelection / clearSelection are no-ops for equal input", () => {
    const seen: number[] = [];
    const unsub = useInspectorStore.subscribe(() => seen.push(1));
    const s = useInspectorStore.getState();
    s.setFocused({ kind: "task", id: "t1" });
    s.setSelection(["task:t1", "task:t2"], "missions");
    const after = seen.length;
    // Fresh identities, same values — every pointerdown in a scope does this.
    s.setFocused({ kind: "task", id: "t1" });
    s.setSelection(["task:t1", "task:t2"], "missions");
    s.setFocused(null);
    s.setFocused(null);
    expect(seen.length).toBe(after + 1); // only the first setFocused(null) changed anything
    s.clearSelection();
    s.clearSelection();
    expect(seen.length).toBe(after + 2);
    unsub();
  });

  it("resetTransient drops peek, focus and selection together, keeps ownership and reality mode", () => {
    const s = useInspectorStore.getState();
    s.setPeek({ kind: "memory", id: "m1" });
    s.setFocused({ kind: "memory", id: "m1" });
    s.setSelection(["memory:m1"], "brain");
    s.ownKinds(["person"]);
    s.setRealityMode(true);
    s.resetTransient();
    const st = useInspectorStore.getState();
    expect(st.peek).toBeNull();
    expect(st.focused).toBeNull();
    expect(st.selected).toEqual([]);
    expect(st.selectionScope).toBeNull();
    expect(st.ownedKinds).toEqual(["person"]);
    expect(st.realityMode).toBe(true);
  });
});

describe("page actions (2026-09-15)", () => {
  it("register → visible per kind; release removes only its own registration", () => {
    const s = useInspectorStore.getState();
    const first = [{ id: "complete", label: "complete", run: () => {} }];
    const release1 = s.registerPageActions("task", first);
    expect(useInspectorStore.getState().pageActions.task).toBe(first);
    const second = [{ id: "snooze", label: "snooze", run: () => {} }];
    const release2 = s.registerPageActions("task", second);
    expect(useInspectorStore.getState().pageActions.task).toBe(second);
    // A stale release (the first page unmounting late) must not drop the live one.
    release1();
    expect(useInspectorStore.getState().pageActions.task).toBe(second);
    release2();
    expect(useInspectorStore.getState().pageActions.task).toBeUndefined();
  });
});
