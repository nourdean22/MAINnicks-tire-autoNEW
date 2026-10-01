/**
 * Hub-tab navigation contract · 2026-10-01.
 *
 * A tab can be fully implemented and still be functionally hidden if the
 * shared NAV metadata misses it: More/⌘K derive discoverability from NAV.
 * Content previously had a live AI Assistant tab that NAV did not know about.
 * Stats also had manual Body deep-links that drifted from its query-tab router.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "@/components/layout/nav-items";
import { STATS_TABS } from "@/lib/stats/resolve-tab";

const ROOT = join(__dirname, "..", "..");
const PAIR = /\{\s*key:\s*"([a-z_-]+)",\s*label:\s*"([^"]+)"/g;

function pageTabPairs(path: string): Array<[string, string]> {
  const source = readFileSync(join(ROOT, path), "utf8");
  const anchor = source.indexOf("<PageTabs");
  expect(anchor, `${path} has no <PageTabs>`).toBeGreaterThanOrEqual(0);
  const slice = source.slice(anchor);
  return [...slice.matchAll(PAIR)].map((match) => [match[1], match[2]]);
}

describe("hub tabs stay discoverable from the shared NAV registry", () => {
  it("Content NAV tabs match the live Content page tabs", () => {
    const content = NAV.find((entry) => entry.href === "/content");
    expect(content?.tabs).toBeTruthy();
    expect(content!.tabs!.map((tab) => [tab.key, tab.label])).toEqual(
      pageTabPairs("app/(mastery)/content/page.tsx"),
    );
  });

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
