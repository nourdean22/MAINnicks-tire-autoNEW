// @vitest-environment jsdom
/**
 * Default-tab views (2026-10-23, usage telemetry). page_tab_visit had 0 rows ever because it fired only
 * when the URL carried ?tab=, and a visit to /brain or /stats with no query shows the default tab
 * without one. PageTracker now logs the tab the page SHOWS: the ?tab= value when there is one, else the
 * page's default, once per page open. Real React in jsdom; assertions read the pageTabVisit calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ path: "/brain", tab: null as string | null, visit: vi.fn(), tabVisit: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => h.path,
  useSearchParams: () => ({ get: (k: string) => (k === "tab" ? h.tab : null) }),
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    brain: {
      pageVisit: { useMutation: () => ({ mutate: h.visit }) },
      pageTabVisit: { useMutation: () => ({ mutate: h.tabVisit }) },
    },
  },
}));

import { PageTracker } from "@/components/brain/page-tracker";

let container: HTMLDivElement;
let root: Root;
const render = () => act(() => root.render(<PageTracker />));
const open = (path: string, tab: string | null = null) => {
  h.path = path;
  h.tab = tab;
  render();
};

beforeEach(() => {
  h.path = "/brain";
  h.tab = null;
  h.visit.mockReset();
  h.tabVisit.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("a page opened without ?tab=", () => {
  it("/brain logs its default tab (memory) once", () => {
    open("/brain");
    expect(h.tabVisit).toHaveBeenCalledTimes(1);
    expect(h.tabVisit).toHaveBeenCalledWith({ page: "/brain", tab: "memory" });
  });

  it("/stats logs its default tab (mastery) once", () => {
    open("/stats");
    expect(h.tabVisit).toHaveBeenCalledTimes(1);
    expect(h.tabVisit).toHaveBeenCalledWith({ page: "/stats", tab: "mastery" });
  });

  it("a re-render of the same open does not log it again", () => {
    open("/brain");
    render();
    render();
    expect(h.tabVisit).toHaveBeenCalledTimes(1);
  });

  it("a page with no tabs logs no tab visit", () => {
    open("/journal");
    open("/chat");
    expect(h.tabVisit).not.toHaveBeenCalled();
  });
});

describe("a page opened with ?tab=", () => {
  it("logs that tab and no duplicate default", () => {
    open("/brain", "review");
    expect(h.tabVisit).toHaveBeenCalledTimes(1);
    expect(h.tabVisit).toHaveBeenCalledWith({ page: "/brain", tab: "review" });
  });

  it("a tab click after the default logs the new tab: memory, then health", () => {
    open("/brain");
    open("/brain", "health");
    expect(h.tabVisit.mock.calls.map((c) => c[0])).toEqual([
      { page: "/brain", tab: "memory" },
      { page: "/brain", tab: "health" },
    ]);
  });

  it("a tab click is still not a page visit", () => {
    open("/brain");
    open("/brain", "health");
    expect(h.visit).toHaveBeenCalledTimes(1);
  });

  it("clicking back to the default tab logs it again (it is a view)", () => {
    open("/stats", "goals");
    open("/stats");
    expect(h.tabVisit.mock.calls.map((c) => c[0].tab)).toEqual(["goals", "mastery"]);
  });
});

describe("moving between pages", () => {
  it("each page open logs its own default", () => {
    open("/brain");
    open("/stats");
    expect(h.tabVisit.mock.calls.map((c) => c[0])).toEqual([
      { page: "/brain", tab: "memory" },
      { page: "/stats", tab: "mastery" },
    ]);
  });
});

describe("opt-out", () => {
  it("nour:no-track = 1 logs no default tab either", () => {
    window.localStorage.setItem("nour:no-track", "1");
    open("/brain");
    expect(h.tabVisit).not.toHaveBeenCalled();
  });
});
