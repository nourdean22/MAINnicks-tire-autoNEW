/**
 * UI v3 Wave 4 (Mind), Stats: three tabs and a verdict line, one state block with Retry
 * (PLAN W4 "Stats 3 tabs + verdict line", audit item 5).
 *
 * THE DEFECTS. Five tabs (Mastery, Goals, Body, Learning, Calibration) for one person's numbers;
 * no sentence said where Nour stands; the loading states were grey pulsing blocks that say nothing,
 * and a failed read had no shared honest state.
 *
 * The fix, pinned by what renders: three tabs (Mastery; Goals, which now holds calibration and the
 * forecast duel; Body and learning), every retired key still lands (`?tab=learning` on Body and
 * learning, `?tab=calibration` on Goals) so no deep link breaks; one verdict line above the tabs
 * computed from the character sheet; and one state block that says loading, failed (with a 44 px
 * Retry) or a real zero in words, also used for the lazy sections instead of pulsing blocks.
 */
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Q {
  data: unknown;
  isLoading: boolean;
  error: { message: string } | null;
  refetch: () => void;
}
const h = vi.hoisted(() => ({ search: "", q: null as unknown as Q, refetch: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: h.push, replace: h.push }),
  usePathname: () => "/stats",
  useSearchParams: () => new URLSearchParams(h.search),
}));
vi.mock("next/dynamic", () => ({
  default: (_loader: unknown, opts?: { loading?: () => ReactNode }) => {
    const Lazy = () => <>{opts?.loading ? opts.loading() : null}</>;
    return Lazy;
  },
}));
vi.mock("@/lib/trpc/client", () => ({
  trpc: {
    operator: { characterSheet: { useQuery: () => h.q } },
    // Wave E2: the verdict also reads the Journey lens for its trend line (pinned in tests/components/stats).
    system: { journeyLens: { useQuery: () => ({ data: undefined, isLoading: true, isPending: true, fetchStatus: "fetching", refetch: () => undefined }) } },
  },
}));
vi.mock("@/components/layout/standard-page", () => ({
  StandardPage: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
}));
const { none } = vi.hoisted(() => ({ none: () => null }));
vi.mock("@/components/mastery/character-sheet", () => ({ CharacterSheet: none }));
vi.mock("@/components/mastery/level-up-directive-card", () => ({ LevelUpDirectiveCard: none }));
vi.mock("@/components/goals/goal-board", () => ({ GoalBoard: none }));
vi.mock("@/components/stats/forecast-duel", () => ({ ForecastDuel: none }));
vi.mock("@/components/mastery/coach-event-banner", () => ({ CoachEventBanner: none }));
vi.mock("@/components/mastery/mission-breadcrumb", () => ({ MissionBreadcrumb: none }));
vi.mock("@/components/mastery/nick-side-pane", () => ({ NickSidePane: none }));
vi.mock("@/components/stats/mastery-list", () => ({ MasteryList: none }));
vi.mock("@/components/stats/calibration-tile", () => ({ CalibrationTile: none }));
vi.mock("@/components/brain/prediction-streaks-card", () => ({ PredictionStreaksCard: none }));
vi.mock("@/components/ultron/ghost-nick/ghost-nick-strip", () => ({ GhostNickStrip: none }));

import StatsPage from "@/app/(mastery)/stats/page";
import { STATS_TABS, resolveStatsTab } from "@/lib/stats/resolve-tab";
import { statsVerdict } from "@/components/stats/stats-verdict";

const stat = (label: string, level: number, rising7dXp: number) => ({
  key: label.toLowerCase(),
  label,
  shortLabel: label,
  level,
  rising7dXp,
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function mount(search: string, q: Partial<Q>): Promise<HTMLDivElement> {
  h.search = search;
  h.refetch = vi.fn();
  h.q = { data: undefined, isLoading: false, error: null, refetch: h.refetch, ...q };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<StatsPage />);
  });
  return container;
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("Stats tab contract: three tabs, no deep link lost", () => {
  it("has exactly three tabs", () => {
    expect(STATS_TABS.map((t) => t.id)).toEqual(["mastery", "goals", "body"]);
    expect(STATS_TABS.map((t) => t.label)).toEqual(["Mastery", "Goals", "Body and learning"]);
  });

  it("lands every retired key on the tab that now holds it, and unknown keys on the first tab", () => {
    expect(resolveStatsTab("learning")).toBe("body");
    expect(resolveStatsTab("calibration")).toBe("goals");
    expect(resolveStatsTab("body")).toBe("body");
    expect(resolveStatsTab("money")).toBe("mastery");
    expect(resolveStatsTab(null)).toBe("mastery");
  });
});

describe("statsVerdict: one sentence from the character sheet", () => {
  it("names the total level and this week's top riser", () => {
    expect(statsVerdict([stat("Focus", 7, 40), stat("Strength", 5, 120), stat("Writing", 3, 0)])).toBe(
      "Total level 15 across 3 stats. Strength gained the most this week, +120 XP.",
    );
  });

  it("says so when nothing moved this week, instead of naming a riser", () => {
    expect(statsVerdict([stat("Focus", 7, 0), stat("Strength", 5, 0)])).toBe("Total level 12 across 2 stats. Nothing gained XP this week.");
  });
});

describe("/stats page", () => {
  it("renders three tabs with the verdict line above them", async () => {
    const el = await mount("", { data: [stat("Focus", 7, 40), stat("Strength", 5, 120)] });
    const tabs = [...el.querySelectorAll('[role="tablist"][aria-label="Stats sections"] [role="tab"]')];
    expect(tabs.map((t) => t.textContent)).toEqual(["Mastery", "Goals", "Body and learning"]);
    const verdict = el.querySelector("[data-stats-verdict]");
    expect(verdict?.textContent).toBe("Total level 12 across 2 stats. Strength gained the most this week, +120 XP.");
    expect(Boolean(verdict!.compareDocumentPosition(tabs[0]) & Node.DOCUMENT_POSITION_FOLLOWING), "the verdict is not above the tabs").toBe(true);
  });

  it("?tab=learning opens Body and learning with the learning section; ?tab=calibration opens Goals with calibration", async () => {
    let el = await mount("tab=learning", { data: [stat("Focus", 7, 0)] });
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Body and learning");
    expect(el.querySelector("section#learning")).toBeTruthy();
    expect(el.querySelector("section#body")).toBeTruthy();
    await act(async () => root!.unmount());
    container?.remove();
    root = null;
    el = await mount("tab=calibration", { data: [stat("Focus", 7, 0)] });
    expect(el.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Goals");
    expect(el.querySelector("section#calibration")).toBeTruthy();
    expect(el.querySelector("section#forecast-duel")).toBeTruthy();
  });

  it("a failed read says so in the state block, not as zero, and Retry reads again", async () => {
    const el = await mount("", { error: { message: "500" } });
    const block = el.querySelector('[data-state-block="error"]') as HTMLElement;
    expect(block, "no honest error state").toBeTruthy();
    expect(block.textContent).toMatch(/couldn.t read your stats/i);
    expect(block.textContent).toMatch(/not zero/i);
    const retry = [...block.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Retry") as HTMLButtonElement;
    expect(retry.className).toContain("min-h-[44px]");
    await act(async () => retry.click());
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it("loading and a real zero each say which one they are", async () => {
    let el = await mount("", { isLoading: true });
    expect(el.querySelector('[data-state-block="loading"]')?.textContent).toMatch(/reading your stats/i);
    await act(async () => root!.unmount());
    container?.remove();
    root = null;
    el = await mount("", { data: [] });
    expect(el.querySelector('[data-state-block="empty"]')?.textContent).toMatch(/no stats recorded yet/i);
  });

  it("fix round 1: an alias deep link clears the sticky tab bar and re-scrolls once after the tab's content loads", async () => {
    const scrolled: string[] = [];
    const proto = Element.prototype as unknown as { scrollIntoView?: () => void };
    const original = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element) {
      scrolled.push(this.id);
    };
    let resize: (() => void) | null = null;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(private cb: () => void) {}
        observe() {
          resize = this.cb;
          this.cb(); // browsers fire once when observation starts
        }
        disconnect() {
          resize = null;
        }
      },
    );
    try {
      const el = await mount("tab=calibration", { data: [stat("Focus", 7, 0)] });
      const target = el.querySelector("section#calibration") as HTMLElement;
      expect(target.className, "the section lands under the sticky tab bar").toMatch(/scroll-mt-\S+/);
      expect(scrolled).toEqual(["calibration"]);
      await act(async () => resize?.()); // the lazy content arrived and pushed the section down
      expect(scrolled).toEqual(["calibration", "calibration"]);
      await act(async () => resize?.()); // once only: a later resize is the operator's own scroll
      expect(scrolled).toEqual(["calibration", "calibration"]);
      expect((el.querySelector("section#learning") ?? null) === null).toBe(true);
    } finally {
      proto.scrollIntoView = original;
      vi.unstubAllGlobals();
    }
  });

  it("the lazy sections load behind words, not pulsing blocks", async () => {
    const el = await mount("tab=body", { data: [stat("Focus", 7, 0)] });
    expect(el.querySelectorAll(".animate-pulse").length, "a pulsing placeholder is still on the page").toBe(0);
    expect(el.querySelectorAll('[data-state-block="loading"]').length).toBeGreaterThan(0);
  });
});
