/**
 * The tab PageTracker logs for a page opened without ?tab= must be the tab the page really shows, or the
 * page_tab_visit rows name a tab nobody saw. /stats derives it from the same resolver the page uses;
 * /brain's page passes BRAIN_DEFAULT_TAB to PageTabs, which this reads from the page source, and it must
 * be one of the page's own tab keys.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BRAIN_DEFAULT_TAB, defaultTabFor } from "@/lib/brain/default-tabs";
import { STATS_TABS } from "@/lib/stats/resolve-tab";

const ROOT = join(__dirname, "..", "..");
const brainPage = readFileSync(join(ROOT, "app/(mastery)/brain/page.tsx"), "utf8");

describe("defaultTabFor", () => {
  it("/stats is the first stats tab, from the page's own resolver", () => {
    expect(defaultTabFor("/stats")).toBe(STATS_TABS[0].id);
  });

  it("/brain is BRAIN_DEFAULT_TAB", () => {
    expect(defaultTabFor("/brain")).toBe(BRAIN_DEFAULT_TAB);
  });

  it("every other path (and a sub-path of a tabbed page) has no default tab", () => {
    for (const p of ["/", "/chat", "/journal", "/brain/x", "/stats/x", ""]) expect(defaultTabFor(p)).toBeNull();
  });
});

describe("/brain page and its default tab agree", () => {
  it("the page hands BRAIN_DEFAULT_TAB to PageTabs as defaultKey", () => {
    expect(brainPage).toMatch(/defaultKey=\{BRAIN_DEFAULT_TAB\}/);
  });

  it("BRAIN_DEFAULT_TAB is one of the page's tab keys", () => {
    const keys = [...brainPage.slice(brainPage.indexOf("<PageTabs")).matchAll(/\{\s*key:\s*"([a-z_-]+)"/g)].map((m) => m[1]);
    expect(keys.length).toBe(3);
    expect(keys).toContain(BRAIN_DEFAULT_TAB);
  });
});
