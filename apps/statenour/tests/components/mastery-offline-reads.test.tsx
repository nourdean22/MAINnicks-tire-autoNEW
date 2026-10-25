/**
 * tests/components/mastery-offline-reads.test.tsx - honest-reads leftovers 2026-10-25.
 *
 * The /stats Mastery tab still had two blocks that read a PAUSED or failed query as "nothing here"
 * (empty-vs-error; lib/query-state.ts; react-query v5 leaves an offline query with no data, no error
 * and isLoading false):
 *   - CharacterSheet turned missing data into [] and drew "No stats recorded yet" (provenance ZERO).
 *   - LevelUpDirectiveCard read only isLoading and error, so a paused stat read said "Missing data:
 *     no stat history to rank yet", a failed stat read hid the card, and a failed goals or body read
 *     ranked on less data without saying so.
 * Each failure case pairs with a CONTROL: a measured empty answer keeps its ZERO / Missing-data
 * branch, and a clean read shows the card with no read-state marker.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => ({ q: {} as Record<string, unknown> }));
vi.mock("@/lib/trpc/client", () => {
  const idle = { data: undefined, isError: false, error: null, isPending: false, isLoading: false, fetchStatus: "idle", refetch: () => Promise.resolve() };
  const make = (path: string[]): unknown =>
    new Proxy(() => undefined, {
      get: (_t, k: string) => {
        if (k === "useQuery") return () => h.q[path.join(".")] ?? idle;
        return make([...path, k]);
      },
    });
  return { trpc: make([]) };
});
vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

import { CharacterSheet } from "@/components/mastery/character-sheet";
import { LevelUpDirectiveCard } from "@/components/mastery/level-up-directive-card";

const refetch = vi.fn(() => Promise.resolve());
const base = { error: null, isError: false, isPending: false, isLoading: false, fetchStatus: "idle", refetch };
const ready = (data: unknown) => ({ ...base, data });
const failed = { ...base, data: undefined, isError: true, error: { message: "boom" } };
/** Nothing cached and the connection is down: react-query pauses the fetch. */
const paused = { ...base, data: undefined, isPending: true, fetchStatus: "paused" };
const loading = { ...base, data: undefined, isPending: true, isLoading: true, fetchStatus: "fetching" };

const stat = (key: string, branch: string, level: number) => ({
  key,
  label: key,
  shortLabel: key,
  description: "",
  color: "#888888",
  branch,
  xp: level * 100,
  level,
  tier: "Adept",
  tierEmoji: "",
  xpIntoLevel: 10,
  xpForNext: 100,
  progressPct: 10,
  rising7dXp: 3,
  goals: [],
});
const stats = [stat("focus", "mind", 9), stat("strength", "body", 7)];

const SHEET = "operator.characterSheet";
const GOALS = "task.goals";
const BODY = "operator.bodyTracking";

let host: HTMLDivElement;
let root: Root;
async function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root.render(node);
  });
}
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  h.q = {};
  refetch.mockClear();
  localStorage.clear();
});
const marker = (state: string) => host.querySelector(`[data-read-state="${state}"]`);

describe("CharacterSheet: a paused or unanswered read is not a measured zero", () => {
  it("offline with nothing cached says offline, not 'No stats recorded yet'", async () => {
    h.q = { [SHEET]: paused };
    await mount(<CharacterSheet />);
    expect(host.textContent).not.toContain("No stats recorded yet");
    expect(marker("offline"), host.innerHTML.slice(0, 300)).not.toBeNull();
    expect(host.textContent).toContain("Offline.");
  });

  it("a read that finished with no data and no error says state unknown, and Retry reruns it", async () => {
    h.q = { [SHEET]: { ...base, data: undefined } };
    await mount(<CharacterSheet />);
    expect(host.textContent).not.toContain("No stats recorded yet");
    expect(marker("error"), host.innerHTML.slice(0, 300)).not.toBeNull();
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Retry");
    expect(retry).toBeTruthy();
    await act(async () => {
      retry!.click();
    });
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("CONTROL: a measured empty answer keeps the ZERO state", async () => {
    h.q = { [SHEET]: ready([]) };
    await mount(<CharacterSheet />);
    expect(host.textContent).toContain("No stats recorded yet");
    expect(host.querySelector("[data-read-state]")).toBeNull();
  });

  it("CONTROL: a failed read still shows the error card, never the ZERO state", async () => {
    h.q = { [SHEET]: failed };
    await mount(<CharacterSheet />);
    expect(host.textContent).toContain("Failed to load character sheet");
    expect(host.textContent).not.toContain("No stats recorded yet");
  });

  it("CONTROL: loading stays silent", async () => {
    h.q = { [SHEET]: loading };
    await mount(<CharacterSheet />);
    expect(host.innerHTML).toBe("");
  });

  it("CONTROL: a clean read draws the sheet and no read-state marker", async () => {
    h.q = { [SHEET]: ready(stats) };
    await mount(<CharacterSheet />);
    expect(host.textContent).toContain("Total level");
    expect(host.querySelector("[data-read-state]")).toBeNull();
  });
});

describe("LevelUpDirectiveCard: every failed read is named, and no failure reads as 'no history'", () => {
  it("a paused stat read says offline, not 'Missing data: no stat history'", async () => {
    h.q = { [SHEET]: paused, [GOALS]: ready({ goals: [] }), [BODY]: ready({ entries: [] }) };
    await mount(<LevelUpDirectiveCard />);
    expect(host.textContent).not.toContain("Missing data");
    expect(marker("offline"), host.innerHTML.slice(0, 300)).not.toBeNull();
    expect(host.textContent).toContain("Stat list");
  });

  it("a failed stat read names the stat list instead of hiding the card", async () => {
    h.q = { [SHEET]: failed, [GOALS]: ready({ goals: [] }), [BODY]: ready({ entries: [] }) };
    await mount(<LevelUpDirectiveCard />);
    expect(host.innerHTML).not.toBe("");
    expect(host.textContent).not.toContain("Missing data");
    expect(host.textContent).toContain("Stat list could not load");
  });

  it("a failed goals read still ranks the stats and names the goal list", async () => {
    h.q = { [SHEET]: ready(stats), [GOALS]: failed, [BODY]: ready({ entries: [] }) };
    await mount(<LevelUpDirectiveCard />);
    expect(host.textContent).toContain("Goal list could not load");
    expect(host.textContent).not.toContain("Body log");
    expect(host.querySelector('a[href^="/"]'), "the directive itself still renders").not.toBeNull();
  });

  it("a failed body read still ranks the stats and names the body log", async () => {
    h.q = { [SHEET]: ready(stats), [GOALS]: ready({ goals: [] }), [BODY]: failed };
    await mount(<LevelUpDirectiveCard />);
    expect(host.textContent).toContain("Body log could not load");
    expect(host.textContent).not.toContain("Goal list");
  });

  it("both goals and body failed: each is named", async () => {
    h.q = { [SHEET]: ready(stats), [GOALS]: failed, [BODY]: paused };
    await mount(<LevelUpDirectiveCard />);
    expect(host.textContent).toContain("Goal list could not load");
    expect(host.textContent).toContain("Offline. Body log");
  });

  it("CONTROL: a measured empty stat list keeps the Missing-data line, with no read-state marker", async () => {
    h.q = { [SHEET]: ready([]), [GOALS]: ready({ goals: [] }), [BODY]: ready({ entries: [] }) };
    await mount(<LevelUpDirectiveCard />);
    expect(host.textContent).toContain("Missing data: no stat history to rank yet");
    expect(host.querySelector("[data-read-state]")).toBeNull();
  });

  it("CONTROL: a clean read shows the directive and no read-state marker", async () => {
    h.q = { [SHEET]: ready(stats), [GOALS]: ready({ goals: [] }), [BODY]: ready({ entries: [] }) };
    await mount(<LevelUpDirectiveCard />);
    expect(host.textContent).toContain("Level-up directive");
    expect(host.textContent).not.toContain("Missing data");
    expect(host.querySelector("[data-read-state]")).toBeNull();
  });

  it("CONTROL: loading stays silent", async () => {
    h.q = { [SHEET]: loading, [GOALS]: ready({ goals: [] }), [BODY]: ready({ entries: [] }) };
    await mount(<LevelUpDirectiveCard />);
    expect(host.innerHTML).toBe("");
  });
});
