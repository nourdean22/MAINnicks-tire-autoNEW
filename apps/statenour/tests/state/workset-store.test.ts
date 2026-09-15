/**
 * Workset store · 2026-09-15.
 *
 * Persistence + hydration over the pure rules in lib/ui/workset.ts. Node
 * environment, so `window.localStorage` is stubbed with a Map.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorksetStore } from "@/lib/state/workset-store";
import { WORKSET_STORAGE_KEY, serializeWorkset } from "@/lib/ui/workset";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  };
}

let storage: ReturnType<typeof memoryStorage>;
const NOW = new Date("2026-09-16T15:30:00");

beforeEach(() => {
  storage = memoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
  useWorksetStore.setState({ entries: [], hydrated: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useWorksetStore", () => {
  it("add persists, has() sees it, remove persists the removal", () => {
    const s = useWorksetStore.getState();
    s.add({ kind: "task", id: "t1" }, "  Renew insurance  ", "today", NOW);
    expect(useWorksetStore.getState().entries[0]).toMatchObject({
      ref: { kind: "task", id: "t1" },
      label: "Renew insurance",
      horizon: "today",
      pinnedAt: NOW.getTime(),
    });
    expect(useWorksetStore.getState().entries[0]!.expiresAt).toBeGreaterThan(NOW.getTime());
    expect(useWorksetStore.getState().has({ kind: "task", id: "t1" })).toBe(true);
    expect(storage.getItem(WORKSET_STORAGE_KEY)).toContain("task:t1");
    s.remove({ kind: "task", id: "t1" });
    expect(useWorksetStore.getState().entries).toEqual([]);
    expect(storage.getItem(WORKSET_STORAGE_KEY)).toBe("[]");
  });

  it("a blank label falls back to '<kind> <id>' rather than an empty chip", () => {
    useWorksetStore.getState().add({ kind: "memory", id: "m1" }, "   ", "session", NOW);
    expect(useWorksetStore.getState().entries[0]!.label).toBe("memory m1");
  });

  it("hydrate loads stored entries once and prunes the expired ones", () => {
    storage.setItem(
      WORKSET_STORAGE_KEY,
      serializeWorkset([
        { ref: { kind: "task", id: "live" }, label: "live", horizon: "until-resolved", pinnedAt: 1, expiresAt: null },
        { ref: { kind: "task", id: "dead" }, label: "dead", horizon: "today", pinnedAt: 1, expiresAt: NOW.getTime() - 1 },
      ]),
    );
    useWorksetStore.getState().hydrate(NOW);
    expect(useWorksetStore.getState().entries.map((e) => e.ref.id)).toEqual(["live"]);
    // Second hydrate is a no-op even if storage changed underneath.
    storage.setItem(WORKSET_STORAGE_KEY, "[]");
    useWorksetStore.getState().hydrate(NOW);
    expect(useWorksetStore.getState().entries).toHaveLength(1);
  });

  it("survives a storage that throws (private mode) — the in-memory shelf still works", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("SecurityError");
        },
        setItem: () => {
          throw new Error("QuotaExceeded");
        },
        removeItem: () => {},
      },
    });
    useWorksetStore.getState().hydrate(NOW);
    useWorksetStore.getState().add({ kind: "task", id: "t1" }, "x", "today", NOW);
    expect(useWorksetStore.getState().entries).toHaveLength(1);
  });
});
