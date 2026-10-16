/**
 * UI v3 W1b: the pinned-tab store. Server and first client render hold Journal; hydrate() reads
 * localStorage `nav:pinned-tab` after mount; pin() writes it (and clears it when the pin is the
 * default again). localStorage failures never throw out of the store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usePinnedTabStore, PINNED_TAB_KEY } from "@/lib/state/pinned-tab-store";

const makeStorage = () => {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    map: m,
  };
};

let storage: ReturnType<typeof makeStorage>;

beforeEach(() => {
  storage = makeStorage();
  vi.stubGlobal("window", { localStorage: storage });
  usePinnedTabStore.setState({ href: "/journal" });
});
afterEach(() => vi.unstubAllGlobals());

describe("usePinnedTabStore", () => {
  it("starts on Journal before hydration (the initial state, which the server snapshot serves, not a value a setState planted)", () => {
    expect(PINNED_TAB_KEY).toBe("nav:pinned-tab");
    expect(usePinnedTabStore.getInitialState().href).toBe("/journal");
  });

  it("hydrate reads the stored href", () => {
    storage.map.set(PINNED_TAB_KEY, "/stats");
    usePinnedTabStore.getState().hydrate();
    expect(usePinnedTabStore.getState().href).toBe("/stats");
  });

  it("hydrate with nothing stored keeps Journal", () => {
    usePinnedTabStore.getState().hydrate();
    expect(usePinnedTabStore.getState().href).toBe("/journal");
  });

  it("hydrate keeps a stale href raw; the renderer resolves it to Journal", () => {
    storage.map.set(PINNED_TAB_KEY, "/market");
    usePinnedTabStore.getState().hydrate();
    expect(usePinnedTabStore.getState().href).toBe("/market");
  });

  it("pin writes the href", () => {
    usePinnedTabStore.getState().pin("/people");
    expect(usePinnedTabStore.getState().href).toBe("/people");
    expect(storage.map.get(PINNED_TAB_KEY)).toBe("/people");
  });

  it("pinning Journal restores the default and clears the key", () => {
    usePinnedTabStore.getState().pin("/people");
    usePinnedTabStore.getState().pin("/journal");
    expect(usePinnedTabStore.getState().href).toBe("/journal");
    expect(storage.map.has(PINNED_TAB_KEY)).toBe(false);
  });

  it("a throwing localStorage (private mode) still updates in memory", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(() => usePinnedTabStore.getState().hydrate()).not.toThrow();
    expect(() => usePinnedTabStore.getState().pin("/stats")).not.toThrow();
    expect(usePinnedTabStore.getState().href).toBe("/stats");
  });

  it("hydrate on the server (no window) is a no-op", () => {
    vi.stubGlobal("window", undefined);
    expect(() => usePinnedTabStore.getState().hydrate()).not.toThrow();
    expect(usePinnedTabStore.getState().href).toBe("/journal");
  });
});
