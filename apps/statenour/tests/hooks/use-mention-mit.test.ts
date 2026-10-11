/**
 * @mit reads the server MIT (audit 03-F1, 2026-10-10).
 *
 * It read localStorage, which only the chat /mit command ever wrote, so a MIT
 * set anywhere else (MITSlot, Telegram) expanded as "not set yet today". It now
 * reads operator.mit, and a failed read says unknown instead of "not set".
 *
 * No DOM in this vitest env: React's hooks are stubbed with a tiny slot store
 * so the hook's real mount effect runs and a second pass sees its state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  slots: [] as unknown[],
  i: 0,
  effects: [] as Array<() => unknown>,
  fetchMit: vi.fn(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => {
      const k = h.i++;
      if (!(k in h.slots)) h.slots[k] = typeof init === "function" ? (init as () => unknown)() : init;
      return [h.slots[k], (v: unknown) => { h.slots[k] = typeof v === "function" ? (v as (p: unknown) => unknown)(h.slots[k]) : v; }];
    },
    useEffect: (fn: () => unknown) => { h.effects.push(fn); },
    useMemo: (fn: () => unknown) => fn(),
    useCallback: (fn: unknown) => fn,
  };
});
vi.mock("@/lib/state/nour-state", () => ({
  useNourState: () => ({ urgentItems: [], activeCommitments: 0, habitsTotal: 0, currentState: "normal" }),
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: { useUtils: () => ({ operator: { mit: { fetch: h.fetchMit } } }) },
}));

import { useMentionSuggestions } from "@/hooks/use-mention-suggestions";

const getItem = vi.fn();
// React is mocked above, so the hook runs as a plain function; the alias keeps rules-of-hooks off it.
const runMentionHook = useMentionSuggestions;

/** Mount (run the effects, let the read settle), then render again and expand @mit. */
async function expandMit(): Promise<string> {
  h.i = 0;
  runMentionHook();
  for (const fn of h.effects.splice(0)) fn();
  await new Promise((r) => setTimeout(r, 0));
  h.i = 0;
  return runMentionHook().expandMentions("@mit");
}

beforeEach(() => {
  h.slots = [];
  h.effects = [];
  h.fetchMit.mockReset();
  getItem.mockReset();
  vi.stubGlobal("window", { localStorage: { getItem }, addEventListener: vi.fn(), removeEventListener: vi.fn() });
});
afterEach(() => vi.unstubAllGlobals());

describe("@mit", () => {
  it("expands the server MIT (operator.mit), not localStorage", async () => {
    h.fetchMit.mockResolvedValue({ key: "2026-10-10", text: "Call Mike", updatedAt: null });
    expect(await expandMit()).toBe("[MIT: Call Mike]");
    expect(h.fetchMit).toHaveBeenCalled();
    expect(getItem).not.toHaveBeenCalled();
  });

  it("a failed read is unknown, never 'not set yet today'", async () => {
    h.fetchMit.mockRejectedValue(new Error("UNAUTHORIZED"));
    const out = await expandMit();
    expect(out).toContain("unknown");
    expect(out).not.toContain("not set");
  });

  it("CONTROL: a read that finds no MIT says not set", async () => {
    h.fetchMit.mockResolvedValue({ key: "2026-10-10", text: null, updatedAt: null });
    expect(await expandMit()).toBe("[MIT: not set yet today]");
  });
});
