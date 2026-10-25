/**
 * tests/components/stale-reads-leftovers.test.tsx - bdnick leftovers 2026-10-25.
 *
 * Wave D's sweep named two query-reading blocks outside its lane that still treated a failed read as
 * "nothing here" (empty-vs-error): the Nick suggestion chips, which hid on every non-ready state and
 * also hid CACHED chips after a failed refresh, and the learning-velocity scoreboard, where the failed
 * line won over cached data. Driven here the way tests/components/brain/stale-reads.test.tsx drives the
 * rest of the Brain tab: cached data plus a failed refetch (stale), a failed read with nothing cached
 * (error), and a paused read (offline). Loading and a clean empty answer stay silent: the CONTROLS.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ q: {} as Record<string, unknown> }));
vi.mock("@/lib/trpc/client", () => {
  const idle = { data: undefined, isError: false, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() };
  const make = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, k: string) => {
        if (k === "useQuery") return () => h.q[path.join(".")] ?? idle;
        if (k === "useMutation") return () => ({ mutate: () => undefined, mutateAsync: async () => undefined, isPending: false });
        if (k === "useUtils") return () => make(["utils"]);
        if (k === "invalidate" || k === "fetch" || k === "refetch" || k === "setData") return () => Promise.resolve();
        return make([...path, k]);
      },
    });
  return { trpc: make([]) };
});
vi.mock("@/lib/events/data-change", () => ({ onDataChanged: () => () => undefined }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }));

import { NickSuggestions } from "@/components/chat/nick-suggestions";
import { LearningVelocityScoreboard } from "@/components/brain/learning-velocity-scoreboard";

const refetch = vi.fn(() => Promise.resolve());
const base = { isPending: false, isLoading: false, fetchStatus: "idle", refetch };
/** Data in hand and the last read fine. */
const ready = (data: unknown) => ({ ...base, data, isError: false });
/** Cached data, then a refetch that failed. */
const stale = (data: unknown) => ({ ...base, data, isError: true, error: { message: "refetch failed" } });
/** Nothing cached and the read failed. */
const failed = { ...base, data: undefined, isError: true, error: { message: "boom" } };
/** Nothing cached and the connection is down: react-query pauses the fetch. */
const paused = { ...base, data: undefined, isError: false, isPending: true, fetchStatus: "paused" };
/** Nothing cached and the first fetch is on its way. */
const loading = { ...base, data: undefined, isError: false, isPending: true, isLoading: true, fetchStatus: "fetching" };

const chip = { id: "c1", kind: "overdue", severity: "high", label: "3 tasks overdue", seedPrompt: "What is overdue?" };
const chips = { suggestions: [chip] };
const noChips = { suggestions: [] };

const digest = {
  memoryPctChange30d: 12,
  memoriesLast30d: 40,
  healthScore: 61,
  healthScoreMax: 90,
  memoriesThisWeek: 9,
  memoriesDelta: 2,
  wisdomCreated30d: 3,
  newConnections30d: 7,
  contradictionsResolved30d: 1,
};

let host: HTMLDivElement;
let root: Root;
async function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  h.q = {};
  refetch.mockClear();
});

const marker = (state: string) => host.querySelector(`[data-read-state="${state}"]`);

describe("NickSuggestions: a failed read never looks like 'no suggestions'", () => {
  it("stale: a failed refresh keeps the cached chips AND says so", async () => {
    h.q = { "nick.suggestions": stale(chips) };
    await mount(<NickSuggestions />);
    expect(host.textContent).toContain("3 tasks overdue");
    expect(marker("stale"), host.innerHTML.slice(0, 300)).not.toBeNull();
    expect(host.textContent).toContain("below may be out of date");
  });

  it("stale with an empty cache: the note stands alone, so an empty answer is not trusted", async () => {
    h.q = { "nick.suggestions": stale(noChips) };
    await mount(<NickSuggestions />);
    expect(marker("stale"), host.innerHTML.slice(0, 300)).not.toBeNull();
    // Nothing is below it, so the sentence must not point at chips that are not there.
    expect(host.textContent).not.toContain("below");
  });

  it("error: a failed read with nothing cached says state unknown, not empty, and Retry reruns it", async () => {
    h.q = { "nick.suggestions": failed };
    await mount(<NickSuggestions />);
    expect(marker("error"), host.innerHTML.slice(0, 300)).not.toBeNull();
    expect(host.textContent).toContain("could not load");
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry");
    expect(retry).toBeTruthy();
    await act(async () => {
      retry!.click();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("offline: a paused read with nothing cached says so", async () => {
    h.q = { "nick.suggestions": paused };
    await mount(<NickSuggestions />);
    expect(marker("offline"), host.innerHTML.slice(0, 300)).not.toBeNull();
  });

  it("CONTROL: loading stays silent (the strip does not announce its own loading)", async () => {
    h.q = { "nick.suggestions": loading };
    await mount(<NickSuggestions />);
    expect(host.innerHTML).toBe("");
  });

  it("CONTROL: a clean empty answer stays silent (a quiet morning)", async () => {
    h.q = { "nick.suggestions": ready(noChips) };
    await mount(<NickSuggestions />);
    expect(host.innerHTML).toBe("");
  });

  it("CONTROL: a clean read shows the chip and no read-state marker", async () => {
    h.q = { "nick.suggestions": ready(chips) };
    await mount(<NickSuggestions />);
    expect(host.textContent).toContain("3 tasks overdue");
    expect(host.querySelector("[data-read-state]")).toBeNull();
  });
});

describe("LearningVelocityScoreboard: cached data beats the failed line", () => {
  it("stale: a failed refresh keeps the cached numbers AND says so", async () => {
    h.q = { "journal.learningVelocity": stale(digest) };
    await mount(<LearningVelocityScoreboard />);
    expect(host.textContent).toContain("health 61/90");
    expect(marker("stale"), host.innerHTML.slice(0, 300)).not.toBeNull();
    expect(host.querySelector("[data-read-failed]")).toBeNull();
  });

  it("error: a failed read with nothing cached shows the unavailable line", async () => {
    h.q = { "journal.learningVelocity": failed };
    await mount(<LearningVelocityScoreboard />);
    expect(host.querySelector("[data-read-failed]"), host.innerHTML.slice(0, 300)).not.toBeNull();
    expect(host.textContent).not.toContain("health");
  });

  it("CONTROL: offline with nothing cached still says offline", async () => {
    h.q = { "journal.learningVelocity": paused };
    await mount(<LearningVelocityScoreboard />);
    expect(marker("offline")).not.toBeNull();
  });

  it("CONTROL: a clean read shows the numbers and no marker", async () => {
    h.q = { "journal.learningVelocity": ready(digest) };
    await mount(<LearningVelocityScoreboard />);
    expect(host.textContent).toContain("health 61/90");
    expect(host.querySelector("[data-read-state], [data-read-failed]")).toBeNull();
  });

  it("CONTROL: loading stays silent", async () => {
    h.q = { "journal.learningVelocity": loading };
    await mount(<LearningVelocityScoreboard />);
    expect(host.innerHTML).toBe("");
  });
});
