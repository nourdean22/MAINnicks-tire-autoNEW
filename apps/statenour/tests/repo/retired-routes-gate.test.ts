/**
 * tests/repo/retired-routes-gate.test.ts · 2026-09-02 · /business deletion (plan R7)
 *
 * The #2069 review found that deleting a page is not one edit: a duplicate
 * "important pages" list in lib/brain/page-intelligence.ts would have made
 * "Business" a PERMANENT false blind spot in the daily brief and Nick's
 * prompt, the chat lane-check map still pointed at /business, and the
 * redirects carried a retired `?tab=` into /stats. While fixing those, two
 * more dead targets turned up in the same lists (`/strategy`, `/inventory`)
 * that no one had noticed since those pages were deleted.
 *
 * So: ENUMERATE the route-carrying registries, ASSERT each target is a real
 * page (or an external URL), and keep the deletion itself pinned. A page
 * deleted without updating one of these lists fails here, not in a brief
 * three days later.
 */
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextConfig from "../../next.config";
import { IMPORTANT_PAGES } from "@/lib/brain/page-intelligence";
import { HREF_BY_DOMAIN } from "@/lib/services/chat-lane-check";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Does an app-router page exist for this path? Route groups `(x)` are transparent. */
function pageExists(path: string): boolean {
  const clean = path.replace(/[?#].*$/, "").replace(/\/$/, "") || "/";
  const segs = clean === "/" ? [] : clean.slice(1).split("/");
  const groups = ["", "(mastery)"];
  return groups.some((g) => existsSync(join(APP_ROOT, "app", g, ...segs, "page.tsx")));
}
const isExternal = (href: string) => /^https?:\/\//.test(href);

describe("retired routes gate · every route-carrying registry points at a page that exists", () => {
  it("/business is gone: no page file, and a redirect takes its place", async () => {
    expect(pageExists("/business")).toBe(false);
    const redirects = await nextConfig.redirects!();
    const business = redirects.filter((r) => r.source === "/business");
    expect(business.length, "a /business redirect exists").toBeGreaterThanOrEqual(1);
    expect(business.every((r) => r.destination === "/stats")).toBe(true);
  });

  it("no redirect points at /business any more (the old /financial /funnel /crm hops)", async () => {
    const redirects = await nextConfig.redirects!();
    const stale = redirects.filter((r) => r.destination.startsWith("/business")).map((r) => `${r.source} → ${r.destination}`);
    expect(stale, "redirects still targeting the deleted page").toEqual([]);
  });

  it("a retired ?tab= is dropped on the way into /stats (a blank page is not a redirect)", async () => {
    const redirects = await nextConfig.redirects!();
    // The has-capture form consumes `tab`, so Next does not append it to the
    // destination; without it, /business?tab=money became /stats?tab=money and
    // StatsContent rendered nothing for an unknown tab.
    const captures = redirects.find((r) => r.source === "/business" && Array.isArray(r.has) && r.has.some((h) => h.type === "query" && h.key === "tab"));
    expect(captures, "a /business redirect that captures ?tab").toBeTruthy();
    for (const r of redirects.filter((r) => r.destination.startsWith("/stats"))) {
      expect(r.destination, `${r.source} must not carry a tab into /stats`).not.toMatch(/tab=/);
    }
  });

  it("every page-intelligence IMPORTANT_PAGES path has a page (a missing one is a permanent false blind spot)", () => {
    const missing = IMPORTANT_PAGES.filter((p) => !pageExists(p.path)).map((p) => `${p.label} ${p.path}`);
    expect(missing, "important pages with no page.tsx — they would be reported as never visited forever").toEqual([]);
  });

  it("every chat lane-check href is an existing page or an external URL", () => {
    const dead = Object.entries(HREF_BY_DOMAIN)
      .filter(([, href]) => !isExternal(href) && !pageExists(href))
      .map(([domain, href]) => `${domain} → ${href}`);
    expect(dead, "lane-check targets that 404").toEqual([]);
  });
});
