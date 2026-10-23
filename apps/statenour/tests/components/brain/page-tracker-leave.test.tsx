// @vitest-environment jsdom
/**
 * PageTracker leave / dwell (2026-10-23, usage telemetry). A page_visit opens a visit; the visit ends on
 * a route change (or unmount), when the tab is hidden, or on pagehide, and each end sends ONE leave to
 * POST /api/brain/page-leave with keepalive (a tRPC mutation cannot run while the page is going away).
 * Real React in jsdom: the effects, their cleanups and the DOM listeners all run for real, and the
 * assertions read the fetch the tracker actually made.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ path: "/chat", tab: null as string | null, visit: vi.fn(), tabVisit: vi.fn() }));
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

const fetchMock = vi.fn();
let container: HTMLDivElement;
let root: Root;
let visibility: "visible" | "hidden" = "visible";

const render = () => act(() => root.render(<PageTracker />));
const goTo = (path: string) => {
  h.path = path;
  render();
};
const setVisibility = (v: "visible" | "hidden") => {
  visibility = v;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};
const leaves = () =>
  fetchMock.mock.calls.map(([url, init]) => ({
    url: url as string,
    init: init as RequestInit,
    body: JSON.parse((init as RequestInit).body as string) as Record<string, unknown>,
  }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-23T12:00:00Z"));
  h.path = "/chat";
  h.tab = null;
  h.visit.mockReset();
  h.tabVisit.mockReset();
  fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetchMock);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  window.localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("leave on a route change", () => {
  it("writes one leave with the PREVIOUS path and a positive dwell", () => {
    render();
    vi.setSystemTime(Date.now() + 5_000);
    goTo("/missions");
    expect(leaves()).toHaveLength(1);
    expect(leaves()[0].url).toBe("/api/brain/page-leave");
    expect(leaves()[0].init.method).toBe("POST");
    expect(leaves()[0].body).toEqual({ page: "/chat", dwellMs: 5_000, reason: "route" });
  });

  it("the new page opens a new visit: its own leave carries its own path and dwell", () => {
    render();
    vi.setSystemTime(Date.now() + 5_000);
    goTo("/missions");
    vi.setSystemTime(Date.now() + 90_000);
    goTo("/journal");
    expect(leaves().map((l) => l.body)).toEqual([
      { page: "/chat", dwellMs: 5_000, reason: "route" },
      { page: "/missions", dwellMs: 90_000, reason: "route" },
    ]);
  });

  it("unmounting the tracker (leaving the layout) ends the visit too", () => {
    render();
    vi.setSystemTime(Date.now() + 2_000);
    act(() => root.unmount());
    expect(leaves()).toHaveLength(1);
    expect(leaves()[0].body).toMatchObject({ page: "/chat", dwellMs: 2_000, reason: "route" });
    root = createRoot(container); // afterEach unmounts it
  });
});

describe("leave when the page is going away", () => {
  it("pagehide writes one leave, sent with keepalive so it outlives the page", () => {
    render();
    vi.setSystemTime(Date.now() + 7_000);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(leaves()).toHaveLength(1);
    expect(leaves()[0].init.keepalive).toBe(true);
    expect(leaves()[0].body).toEqual({ page: "/chat", dwellMs: 7_000, reason: "pagehide" });
  });

  it("hiding the tab writes one leave (keepalive) with reason hidden", () => {
    render();
    vi.setSystemTime(Date.now() + 3_000);
    setVisibility("hidden");
    expect(leaves()).toHaveLength(1);
    expect(leaves()[0].init.keepalive).toBe(true);
    expect(leaves()[0].body).toEqual({ page: "/chat", dwellMs: 3_000, reason: "hidden" });
  });

  it("a route change leave is also keepalive (one transport for every end)", () => {
    render();
    vi.setSystemTime(Date.now() + 1_000);
    goTo("/missions");
    expect(leaves()[0].init.keepalive).toBe(true);
  });
});

describe("one visit never writes two leaves", () => {
  it("hidden then pagehide (what closing a tab does) is one leave", () => {
    render();
    vi.setSystemTime(Date.now() + 4_000);
    setVisibility("hidden");
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(leaves()).toHaveLength(1);
  });

  it("pagehide then the unmount cleanup is one leave", () => {
    render();
    vi.setSystemTime(Date.now() + 4_000);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    act(() => root.unmount());
    expect(leaves()).toHaveLength(1);
    root = createRoot(container);
  });

  it("hidden, then a route change while still hidden, is one leave", () => {
    render();
    vi.setSystemTime(Date.now() + 4_000);
    setVisibility("hidden");
    goTo("/missions");
    expect(leaves()).toHaveLength(1);
    expect(leaves()[0].body.page).toBe("/chat");
  });

  it("listeners of an ended visit are gone: a later pagehide on the new page reports the NEW path once", () => {
    render();
    vi.setSystemTime(Date.now() + 1_000);
    goTo("/missions");
    vi.setSystemTime(Date.now() + 2_000);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(leaves().map((l) => l.body.page)).toEqual(["/chat", "/missions"]);
  });
});

describe("coming back from a hidden tab", () => {
  it("starts a new foreground stretch: its leave counts from the return, not from the original open", () => {
    render();
    vi.setSystemTime(Date.now() + 10_000);
    setVisibility("hidden");
    vi.setSystemTime(Date.now() + 600_000); // phone locked for ten minutes
    setVisibility("visible");
    vi.setSystemTime(Date.now() + 20_000);
    goTo("/missions");
    expect(leaves().map((l) => l.body)).toEqual([
      { page: "/chat", dwellMs: 10_000, reason: "hidden" },
      { page: "/chat", dwellMs: 20_000, reason: "route" },
    ]);
  });
});

describe("a page that mounts while the tab is already hidden", () => {
  it("counts only the time it is shown: hidden at mount, shown ten minutes later, hidden again 5 s on is 5 s, not 605", () => {
    setVisibility("hidden");
    render(); // opened in the background
    vi.setSystemTime(Date.now() + 600_000);
    setVisibility("visible");
    vi.setSystemTime(Date.now() + 5_000);
    setVisibility("hidden");
    expect(leaves().map((l) => l.body)).toEqual([{ page: "/chat", dwellMs: 5_000, reason: "hidden" }]);
  });

  it("a background-opened page that is left again before it was ever shown writes no leave", () => {
    setVisibility("hidden");
    render();
    vi.setSystemTime(Date.now() + 30_000);
    goTo("/missions");
    expect(leaves()).toHaveLength(0);
  });
});

describe("tracking opt-out and failure", () => {
  it("nour:no-track = 1 sends no leave at all", () => {
    window.localStorage.setItem("nour:no-track", "1");
    render();
    vi.setSystemTime(Date.now() + 5_000);
    act(() => {
      window.dispatchEvent(new Event("pagehide"));
    });
    goTo("/missions");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.visit).not.toHaveBeenCalled();
  });

  it("a rejected or throwing fetch never throws into the app", () => {
    render();
    vi.setSystemTime(Date.now() + 1_000);
    fetchMock.mockRejectedValueOnce(new Error("offline"));
    expect(() => goTo("/missions")).not.toThrow();
    vi.setSystemTime(Date.now() + 1_000);
    fetchMock.mockImplementationOnce(() => {
      throw new Error("sync boom");
    });
    expect(() => goTo("/journal")).not.toThrow();
  });

  it("the body carries the path, the dwell and the reason, nothing else (no query, no tab, no referrer)", () => {
    h.tab = "wisdom";
    render();
    vi.setSystemTime(Date.now() + 1_000);
    goTo("/missions");
    expect(Object.keys(leaves()[0].body).sort()).toEqual(["dwellMs", "page", "reason"]);
  });
});
