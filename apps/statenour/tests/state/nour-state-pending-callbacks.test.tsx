/**
 * NourState.pendingCallbacks (audit B7, 2026-10-10).
 *
 * Before: loadAll read `cmd.brief.pendingCallbacks`, a key /api/command/data
 * never emits (it lives at `shop.pendingCallbacks`, null when unknown), so
 * the field was a fabricated 0 on every load, and the pre-load default was 0
 * too. Now: the real path, and unknown stays null.
 *
 * No DOM in this vitest env (node), so the provider is driven directly:
 * React's hooks are stubbed so the "Initial load" effect can be awaited and
 * the state it commits captured. This exercises the real loadAll, not a copy.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  initial: undefined as unknown,
  committed: [] as unknown[],
  responses: {} as Record<string, () => Promise<unknown>>,
  apiFetch: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      h.initial = init;
      return [init, (next: unknown) => h.committed.push(next)];
    },
    useEffect: (fn: () => unknown) => {
      h.effects.push(fn);
    },
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
  };
});
vi.mock("@/lib/events/data-change", () => ({
  notifyDataChanged: vi.fn(),
  onDataChanged: vi.fn(() => () => {}),
}));
vi.mock("@/lib/utils/api-fetch", () => ({
  apiFetch: (url: string) => h.apiFetch(url),
}));

import { NourStateProvider } from "@/lib/state/nour-state";

type Loaded = { pendingCallbacks: number | null; isLoading: boolean };

async function load(cmd: () => Promise<unknown>): Promise<Loaded> {
  h.apiFetch.mockImplementation((url: string) =>
    url === "/api/command/data" ? cmd() : Promise.resolve(null),
  );
  NourStateProvider({ children: null });
  // effects[0] is the "Initial load" effect: it calls loadAll().
  await h.effects[0]!();
  await vi.waitFor(() => expect(h.committed.length).toBeGreaterThan(0));
  return h.committed.at(-1) as Loaded;
}

beforeEach(() => {
  h.effects = [];
  h.committed = [];
  h.initial = undefined;
  h.apiFetch.mockReset();
});

describe("NourState.pendingCallbacks", () => {
  it("reads shop.pendingCallbacks from /api/command/data", async () => {
    const s = await load(() => Promise.resolve({ shop: { pendingCallbacks: 7 }, brief: {} }));
    expect(h.apiFetch).toHaveBeenCalledWith("/api/command/data");
    expect(s.isLoading).toBe(false);
    expect(s.pendingCallbacks).toBe(7);
  });

  it("a measured zero stays 0", async () => {
    const s = await load(() => Promise.resolve({ shop: { pendingCallbacks: 0 }, brief: {} }));
    expect(s.pendingCallbacks).toBe(0);
  });

  it("unknown (null from the route) stays null, never 0", async () => {
    const s = await load(() => Promise.resolve({ shop: { pendingCallbacks: null }, brief: {} }));
    expect(s.pendingCallbacks).toBeNull();
  });

  it("a failed command-data read is null, never 0", async () => {
    const s = await load(() => Promise.reject(new Error("503")));
    expect(s.pendingCallbacks).toBeNull();
  });

  it("before the first load it is null (not loaded), never 0", () => {
    NourStateProvider({ children: null });
    expect((h.initial as Loaded).pendingCallbacks).toBeNull();
  });
});
