/**
 * /brain?tab=reason must not start a paid run from a URL (audit 02-F6, 2026-10-10).
 *
 * `?q=<text>` auto-ran the reasoning engine on mount: any link, bookmark or
 * history entry fired a paid run with no tap, and the deep-mode chip put the
 * operator's typed text into that URL. Now `?q=` only prefills; only the
 * sessionStorage handoff (`?h=1`, written by the chip on a tap) auto-runs.
 *
 * No DOM in this vitest env: React's hooks are stubbed with a slot store so
 * ReasonTab and the real NickReasoner run their mount effects across passes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";

const h = vi.hoisted(() => ({
  slots: [] as unknown[],
  i: 0,
  effects: [] as Array<() => unknown>,
  search: "",
  push: vi.fn(),
  fetch: vi.fn(),
  store: new Map<string, string>(),
}));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const slot = (init: () => unknown) => {
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = init();
    return k;
  };
  return {
    ...actual,
    useState: (init: unknown) => {
      const k = slot(() => (typeof init === "function" ? (init as () => unknown)() : init));
      return [h.slots[k], (v: unknown) => { h.slots[k] = typeof v === "function" ? (v as (p: unknown) => unknown)(h.slots[k]) : v; }];
    },
    useRef: (init: unknown) => h.slots[slot(() => ({ current: init }))],
    useEffect: (fn: () => unknown) => { h.effects.push(fn); },
    useCallback: (fn: unknown) => fn,
    useMemo: (fn: () => unknown) => fn(),
  };
});
vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(h.search),
  useRouter: () => ({ push: h.push }),
}));

import { ReasonTab } from "@/components/brain/reason-tab";
import { DeepModeNudge } from "@/components/operator/deep-mode-nudge";

type El = ReactElement<{ children?: ReactNode; value?: string; onClick?: () => void }>;

/** One render pass: ReasonTab, plus the function component it returns (NickReasoner). */
function render(): El | null {
  h.i = 0;
  let el = ReasonTab() as El | null;
  if (el && typeof el.type === "function") el = (el.type as (p: unknown) => El)(el.props);
  return el;
}

/** Mount: render, run effects, let async work settle, re-render (a few passes). */
async function mount(): Promise<El | null> {
  let el = render();
  for (let pass = 0; pass < 3; pass++) {
    for (const fn of h.effects.splice(0)) fn();
    await new Promise((r) => setTimeout(r, 0));
    el = render();
  }
  h.effects.length = 0;
  return el;
}

function find(node: unknown, type: string): El | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const hit = find(n, type);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as El;
  if (el.type === type) return el;
  return find(el.props?.children, type);
}

const reasonCalls = () => h.fetch.mock.calls.filter((c) => c[0] === "/api/nick/reason/stream");

beforeEach(() => {
  h.slots = [];
  h.effects = [];
  h.push.mockReset();
  h.fetch.mockReset().mockResolvedValue({ ok: false, status: 500, body: null, json: async () => ({ error: "x" }) });
  h.store.clear();
  vi.stubGlobal("fetch", h.fetch);
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => h.store.get(k) ?? null,
    setItem: (k: string, v: string) => void h.store.set(k, v),
    removeItem: (k: string) => void h.store.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("ReasonTab entry paths", () => {
  it("?q=hello only prefills: no reasoning run without a tap", async () => {
    h.search = "tab=reason&q=hello";
    const el = await mount();
    expect(reasonCalls()).toHaveLength(0);
    expect(find(el, "textarea")?.props.value).toBe("hello");
  });

  it("?h=1&q= with sessionStorage blocked prefills from the URL and still does not run", async () => {
    h.search = "tab=reason&h=1&q=hello";
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); } });
    const el = await mount();
    expect(reasonCalls()).toHaveLength(0);
    expect(find(el, "textarea")?.props.value).toBe("hello");
  });

  it("CONTROL: the ?h=1 sessionStorage handoff (a tap on the chip) runs exactly once", async () => {
    h.search = "tab=reason&h=1";
    h.store.set("reason:pending-q", "should I hire a second tech this quarter?");
    const el = await mount();
    expect(reasonCalls()).toHaveLength(1);
    expect(find(el, "textarea")?.props.value).toBe("should I hire a second tech this quarter?");
    expect(h.store.has("reason:pending-q")).toBe(false);
  });
});

describe("DeepModeNudge hands the question over out of the URL", () => {
  it("a tap stores the text in sessionStorage and opens ?h=1, never ?q=<text>", () => {
    h.i = 0;
    h.slots[0] = { tier: "deep", text: "should I hire a second tech this quarter?" };
    const chip = DeepModeNudge() as El;
    chip.props.onClick!();
    expect(h.store.get("reason:pending-q")).toBe("should I hire a second tech this quarter?");
    expect(h.push).toHaveBeenCalledWith("/brain?tab=reason&h=1");
    expect(String(h.push.mock.calls[0][0])).not.toContain("hire");
  });

  it("blocked sessionStorage falls back to ?q= (which now only prefills)", () => {
    vi.stubGlobal("sessionStorage", { setItem: () => { throw new Error("blocked"); } });
    h.i = 0;
    h.slots[0] = { tier: "deep", text: "hire?" };
    (DeepModeNudge() as El).props.onClick!();
    expect(h.push).toHaveBeenCalledWith(`/brain?tab=reason&q=${encodeURIComponent("hire?")}`);
  });
});
