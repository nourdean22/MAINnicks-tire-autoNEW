/**
 * Page views had no opt-out (audit 02-F1). PageTracker now skips the visit write when localStorage
 * 'nour:no-track' is '1'. useEffect does not run under node SSR, so it runs inline here and the component is
 * called as a plain function with its hooks mocked; each effect's dependency list is recorded so the test can
 * say WHICH effect a tab change re-runs.
 *
 * Tab clicks (2026-10-19 review round): the page_visit effect depends on the pathname only; the tab goes
 * through its own mutation and effect, so a tab click can never write another page_visit row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutate = vi.hoisted(() => vi.fn());
const tabMutate = vi.hoisted(() => vi.fn());
const effects = vi.hoisted(() => ({ deps: [] as unknown[][] }));
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: (fn: () => void, deps: unknown[]) => {
      effects.deps.push(deps);
      void fn();
    },
  };
});
const tabParam = vi.hoisted(() => ({ value: null as string | null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/journal",
  useSearchParams: () => ({ get: (k: string) => (k === "tab" ? tabParam.value : null) }),
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: { brain: { pageVisit: { useMutation: () => ({ mutate }) }, pageTabVisit: { useMutation: () => ({ mutate: tabMutate }) } } },
}));

import { PageTracker } from "@/components/brain/page-tracker";

function stubStorage(value: string | null, throws = false) {
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => {
        if (throws) throw new Error("SecurityError");
        return k === "nour:no-track" ? value : null;
      },
    },
    // 2026-10-23: the visit effect also registers the pagehide / visibilitychange leave listeners.
    // Leave behaviour itself is pinned in page-tracker-leave.test.tsx (real React, jsdom).
    addEventListener: () => {},
    removeEventListener: () => {},
  });
  vi.stubGlobal("document", { referrer: "", visibilityState: "visible", addEventListener: () => {}, removeEventListener: () => {} });
}

beforeEach(() => {
  mutate.mockClear();
  tabMutate.mockClear();
  effects.deps.length = 0;
  tabParam.value = null;
});
afterEach(() => vi.unstubAllGlobals());

describe("PageTracker opt-out", () => {
  it("does not record the visit when nour:no-track is '1'", () => {
    stubStorage("1");
    tabParam.value = "wisdom";
    PageTracker();
    expect(mutate).not.toHaveBeenCalled();
    expect(tabMutate).not.toHaveBeenCalled();
  });

  it("control: records the visit once when the key is unset", () => {
    stubStorage(null);
    PageTracker();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ page: "/journal" }));
  });

  it("still records when storage throws (private mode), since no opt-out could be read", () => {
    stubStorage(null, true);
    PageTracker();
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});

describe("tab clicks are not page visits", () => {
  it("the page_visit effect depends on the pathname only; the tab effect depends on both", () => {
    stubStorage(null);
    tabParam.value = "wisdom";
    PageTracker();
    expect(effects.deps).toEqual([["/journal"], ["/journal", "wisdom"]]);
  });

  it("a visit with a tab writes one page_visit (no tab key) and one tab visit", () => {
    stubStorage(null);
    tabParam.value = "wisdom";
    PageTracker();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect("tab" in (mutate.mock.calls[0][0] as object)).toBe(false);
    expect(tabMutate).toHaveBeenCalledTimes(1);
    expect(tabMutate).toHaveBeenCalledWith({ page: "/journal", tab: "wisdom" });
  });

  it("a visit without a tab writes no tab visit", () => {
    stubStorage(null);
    PageTracker();
    expect(tabMutate).not.toHaveBeenCalled();
  });
});
