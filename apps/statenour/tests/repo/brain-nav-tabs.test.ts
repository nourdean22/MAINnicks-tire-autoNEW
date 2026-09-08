/**
 * tests/repo/brain-nav-tabs.test.ts · 2026-09-07 (program §5.11)
 *
 * Brain's More-sheet sub-links come from nav-items.ts; the page's tabs come
 * from app/(mastery)/brain/page.tsx. They listed 4 and 9 respectively for
 * months. This pins them to the SAME ordered list of key/label pairs by
 * reading both files — a new tab on the page without its nav row (or vice
 * versa) fails here.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV } from "@/components/layout/nav-items";

const ROOT = join(__dirname, "..", "..");
const PAIR = /\{\s*key:\s*"([a-z_-]+)",\s*label:\s*"([^"]+)"/g;

function pairsIn(source: string, from: string, to: string): Array<[string, string]> {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  expect(start, `anchor "${from}" not found`).toBeGreaterThanOrEqual(0);
  expect(end, `anchor "${to}" not found`).toBeGreaterThan(start);
  return [...source.slice(start, end).matchAll(PAIR)].map((m) => [m[1], m[2]]);
}

describe("Brain nav tabs mirror the Brain page tabs", () => {
  const page = readFileSync(join(ROOT, "app/(mastery)/brain/page.tsx"), "utf8");
  const pageTabs = pairsIn(page, "<PageTabs", "]}");

  it("the page declares every tab with a key and a label (parser sanity)", () => {
    expect(pageTabs.length).toBeGreaterThanOrEqual(9);
  });

  it("nav-items lists the same tabs, same order, same labels", () => {
    const brain = NAV.find((n) => n.href === "/brain");
    expect(brain?.tabs, "nav-items has no /brain tabs").toBeTruthy();
    expect(brain!.tabs!.map((t) => [t.key, t.label])).toEqual(pageTabs);
  });
});
