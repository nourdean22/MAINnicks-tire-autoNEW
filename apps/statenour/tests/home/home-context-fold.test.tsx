/**
 * tests/home/home-context-fold.test.tsx - bdnick appearance wave B (2026-10-23).
 *
 * On a phone Home's right-hand rail (Horizon, Waiting on others, Since last visit) used to stack under
 * the brief as three more blocks. It is now ONE native disclosure, "Context (N)", closed on a phone and
 * held open from xl, so the verdict, Nick and the brief own the first screens. The pattern is the
 * Journal's (09-F25, tests/components/journal-insights-disclosure.test.tsx).
 *
 * N is read from the rendered lines, never typed: each line renders null while loading or empty, so a
 * fixed "3" would be an invented number (assert-the-consumer: the count and the fold read the same
 * nodes). The three lines are stubbed here; HomeConsole is real, so a Home that stops mounting the fold
 * fails this file.
 *
 * Also pinned: the "Refresh failed" sentence is body type, not the metadata typeface (R-06).
 */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({
  wide: false,
  horizon: true,
  waiting: true,
  change: true,
  late: false,
  maxim: null as { context: string | null; ready: boolean } | null,
  query: { data: {} as unknown, isLoading: false, isError: false, refetch: () => Promise.resolve() },
}));

vi.mock("@/hooks/use-min-width", () => ({ useMinWidth: () => h.wide }));
vi.mock("@/hooks/use-polling-fetch", () => ({ usePollingFetch: () => ({ data: null, loading: true, error: null }) }));
// shopToday: the Home shop card (home-pulse W2, 2026-10-30); a pending read renders its skeleton.
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    operator: {
      brief: { useQuery: () => h.query },
      shopToday: { useQuery: () => ({ data: undefined, isError: false }) },
      goalsSnapshot: { useQuery: () => ({ data: undefined, isError: false }) },
    },
  },
}));
vi.mock("@/components/home/brief-state-line", () => ({ BriefStateLine: () => null }));
vi.mock("@/components/home/brief-rows", () => ({ BriefRows: () => null }));
vi.mock("@/components/wisdom/maxim-line", () => ({
  MaximLine: (props: { context: string | null; ready: boolean }) => {
    h.maxim = props;
    return null;
  },
}));
vi.mock("@/components/home/nick-command-line", () => ({ NickCommandLine: () => null }));
vi.mock("@/components/relationships/love-map-line", () => ({ LoveMapLine: () => null }));
vi.mock("@/components/home/horizon-line", () => ({
  HorizonLine: () => (h.horizon ? <section aria-label="horizon">Horizon</section> : null),
}));
vi.mock("@/components/home/waiting-line", () => ({
  WaitingLine: () => (h.waiting ? <section aria-label="waiting on others">Waiting</section> : null),
}));
vi.mock("@/components/home/change-line", () => ({
  // A line that answers AFTER mount, like a tRPC read: the count has to follow it.
  ChangeLine: function ChangeLine() {
    const [ready, setReady] = useState(!h.late);
    useEffect(() => {
      if (h.late) Promise.resolve().then(() => setReady(true));
    }, []);
    return h.change && ready ? <section aria-label="since last visit">Change</section> : null;
  },
}));

import { HomeConsole } from "@/components/home/home-console";

let host: HTMLDivElement;
let root: Root;

async function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(<HomeConsole />);
    await Promise.resolve();
  });
}

const fold = () => host.querySelector("aside[data-home-column='context'] details") as HTMLDetailsElement | null;
const summary = () => fold()?.querySelector("summary") ?? null;

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  Object.assign(h, { wide: false, horizon: true, waiting: true, change: true, late: false });
  h.query = { data: {}, isLoading: false, isError: false, refetch: () => Promise.resolve() };
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("Home context rail on a phone", () => {
  it("folds Horizon, Waiting and Change into ONE closed disclosure named Context (3)", async () => {
    await mount();
    const details = fold();
    expect(details, "the rail holds a disclosure").not.toBeNull();
    expect(host.querySelectorAll("aside[data-home-column='context'] details")).toHaveLength(1);
    expect(details!.open).toBe(false);
    expect(summary()?.textContent?.replace(/\s+/g, " ").trim()).toBe("Context (3)");
    for (const name of ["horizon", "waiting on others", "since last visit"]) {
      const line = host.querySelector(`section[aria-label="${name}"]`);
      expect(line, `${name} still renders`).not.toBeNull();
      expect(details!.contains(line), `${name} sits inside the fold`).toBe(true);
    }
  });

  it("the aside keeps its landmark and its grid cell", async () => {
    await mount();
    const aside = host.querySelector("aside[data-home-column='context']") as HTMLElement;
    expect(aside.getAttribute("aria-label")).toBe("context");
  });

  it("N is the number of lines that rendered, and nothing else", async () => {
    h.change = false;
    await mount();
    expect(summary()?.textContent).toContain("Context (2)");
    const body = fold()!.querySelector("[data-context-body]") as HTMLElement;
    expect(body.children.length, "the summary counts the very nodes it hides").toBe(2);
  });

  it("N follows a line that answers after mount", async () => {
    h.late = true;
    await mount();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(summary()?.textContent).toContain("Context (3)");
  });

  it("with nothing to say the rail renders no chrome: no summary, no rule", async () => {
    h.horizon = false;
    h.waiting = false;
    h.change = false;
    await mount();
    const aside = host.querySelector("aside[data-home-column='context']") as HTMLElement;
    expect(aside, "the grid cell stays").not.toBeNull();
    expect(summary()).toBeNull();
    expect(host.textContent).not.toContain("Context");
    expect(aside.className).not.toMatch(/\bborder-t\b|xl:border-l\b/);
  });

  it("CONTROL: with lines, the rail draws its rule", async () => {
    await mount();
    const aside = host.querySelector("aside[data-home-column='context']") as HTMLElement;
    expect(aside.className).toMatch(/\bborder-t\b/);
  });
});

describe("Home context rail from xl", () => {
  it("is held open with its summary hidden, so the wide rail reads as before", async () => {
    h.wide = true;
    await mount();
    expect(fold()!.open).toBe(true);
    expect(summary()?.className).toMatch(/\bxl:hidden\b/);
  });
});

describe("Home sentences are body type", () => {
  it("the Refresh failed line is not set in the metadata typeface", async () => {
    h.query = { data: { state: null, horizon: null }, isLoading: false, isError: true, refetch: () => Promise.resolve() };
    await mount();
    const line = Array.from(host.querySelectorAll("p")).find((p) => p.textContent?.includes("Refresh failed"));
    expect(line, "the line renders when a background refetch fails").toBeDefined();
    expect(line!.className).not.toMatch(/\bfont-mono\b/);
  });
});

describe("the Home maxim gets today's top line", () => {
  it("passes the brief's lead headline as context once the brief is in, and null when there is no lead", async () => {
    h.query = { ...h.query, data: { lead: { headline: "Decisions are blocking the system" } } };
    await mount();
    expect(h.maxim).toEqual({ context: "Decisions are blocking the system", ready: true });
    act(() => root.unmount());
    host.remove();
    h.query = { ...h.query, data: {} };
    await mount();
    expect(h.maxim).toEqual({ context: null, ready: true });
  });
});
