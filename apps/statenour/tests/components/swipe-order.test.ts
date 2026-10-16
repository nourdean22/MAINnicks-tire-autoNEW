/**
 * UI v3 W1b: the swipe loop follows the bar. Three fixed tabs plus the pinned slot, from the same
 * resolver the bar uses, so a pinned Stats is one swipe left of Missions and a swipe on /stats
 * knows it sits at index 3.
 */
import { describe, expect, it } from "vitest";
import { swipeTabs, swipeIndex } from "@/components/layout/swipe-navigation";

const hrefs = (rows: { href: string }[]) => rows.map((r) => r.href);

describe("swipeTabs", () => {
  it("default: Home, Chat, Missions, Journal", () => {
    expect(hrefs(swipeTabs("/journal"))).toEqual(["/", "/chat", "/missions", "/journal"]);
  });

  it("with Stats pinned, a swipe left from Missions lands on Stats", () => {
    const tabs = swipeTabs("/stats");
    expect(hrefs(tabs)).toEqual(["/", "/chat", "/missions", "/stats"]);
    const from = swipeIndex(tabs, "/missions");
    expect(tabs[from + 1]?.href).toBe("/stats");
  });

  it("with Stats pinned, a swipe on /stats (and on /stats/anything) has index 3", () => {
    const tabs = swipeTabs("/stats");
    expect(swipeIndex(tabs, "/stats")).toBe(3);
    expect(swipeIndex(tabs, "/stats/goals")).toBe(3);
    expect(swipeIndex(tabs, "/journal")).toBe(-1);
  });

  it("a stale pin swipes like the default", () => {
    expect(hrefs(swipeTabs("/market"))).toEqual(["/", "/chat", "/missions", "/journal"]);
  });
});
