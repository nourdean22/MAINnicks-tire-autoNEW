/**
 * Hub-tab navigation contract · 2026-10-01.
 *
 * A tab can be fully implemented and still be functionally hidden if the
 * shared NAV metadata misses it: More/⌘K derive discoverability from NAV.
 * Content previously had a live AI Assistant tab that NAV did not know about.
 * Stats also had manual Body deep-links that drifted from its query-tab router.
 */
import { describe, expect, it } from "vitest";
import { NAV } from "@/components/layout/nav-items";
import { STATS_TABS } from "@/lib/stats/resolve-tab";

describe("hub tabs stay discoverable from the shared NAV registry", () => {
  it("Stats NAV tabs come from the canonical STATS_TABS contract", () => {
    const stats = NAV.find((entry) => entry.href === "/stats");
    expect(stats?.tabs).toEqual(
      STATS_TABS.map((tab) => ({ key: tab.id, label: tab.label })),
    );
  });

  it("every declared tab key is unique within its hub", () => {
    for (const entry of NAV.filter((item) => item.tabs?.length)) {
      const keys = entry.tabs!.map((tab) => tab.key);
      expect(new Set(keys).size, `duplicate tab key under ${entry.href}`).toBe(keys.length);
    }
  });
});
