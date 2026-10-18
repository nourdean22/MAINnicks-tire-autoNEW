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
import { describe, expect, it, vi } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// 2026-09-07 · next.config wraps itself in withSentryConfig. This gate is
// about redirects, not Sentry, and on a checkout whose node_modules predate
// @sentry/nextjs the real import cannot resolve — the wrapper is identity here.
vi.mock("@sentry/nextjs/config", () => ({ withSentryConfig: (config: unknown) => config }));
vi.mock("@next/bundle-analyzer", () => ({ default: () => (config: unknown) => config }));
import nextConfig from "../../next.config";
import { IMPORTANT_PAGES } from "@/lib/brain/page-intelligence";
import { HREF_BY_DOMAIN } from "@/lib/services/chat-lane-check";
import { STATS_TABS, resolveStatsTab } from "@/lib/stats/resolve-tab";

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

  it("redirects into /stats may name only a current canonical tab", async () => {
    // Next appends the incoming query to a redirect destination no matter what
    // (a `has` capture does NOT strip it — live-probed 2026-09-02:
    // /business?tab=money → /stats?tab=money). So Stats still has to tolerate
    // unknown incoming tabs via resolveStatsTab(). But a redirect may now
    // deliberately target a CURRENT tab (e.g. /body → ?tab=body); only retired
    // or invented tab keys are forbidden here.
    const validTabs = new Set(STATS_TABS.map((tab) => tab.id));
    const redirects = await nextConfig.redirects!();
    for (const r of redirects.filter((row) => row.destination.startsWith("/stats"))) {
      const tab = new URL(r.destination, "https://bdnick.info").searchParams.get("tab");
      if (!tab) continue;
      expect(validTabs.has(tab), `${r.source} carries unknown /stats tab "${tab}"`).toBe(true);
    }
  });

  it("an unknown or retired ?tab on /stats resolves to the first tab, never to a blank page", () => {
    const tabs = [{ id: "mastery" }, { id: "goals" }, { id: "body" }];
    expect(resolveStatsTab("money", tabs)).toBe("mastery");
    expect(resolveStatsTab("clients", tabs)).toBe("mastery");
    expect(resolveStatsTab(null, tabs)).toBe("mastery");
    expect(resolveStatsTab("", tabs)).toBe("mastery");
    expect(resolveStatsTab("goals", tabs)).toBe("goals");
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

/**
 * 2026-10-18 · bdnick prune (job 2026-10-18-bdnick-prune). Pages cut because prod
 * page_visit audit events (90 days) and a code-level reference check showed no
 * live use. Each keeps a redirect so old Telegram, push, email and bookmark links
 * never 404. `route` is a page path (or an API prefix); `to` is the exact redirect
 * destination, query string included.
 */
export const PRUNED: ReadonlyArray<{ route: string; to: string; page?: false }> = [
  { route: "/system/chat-states", to: "/system" },
  { route: "/system/schema-history", to: "/system" },
  { route: "/system/tools", to: "/system/actions" },
  { route: "/system/proactive-preview", to: "/system" },
  { route: "/system/alerts", to: "/brain?tab=memory" },
  { route: "/system/camera", to: "https://nickstire.org/admin?tab=lot" },
  { route: "/intelligence/ledger", to: "/" },
  { route: "/intelligence/brief", to: "/" },
  { route: "/content", to: "/" },
  { route: "/learn", to: "/" },
  { route: "/links", to: "/" },
  { route: "/photo-improver", to: "/" },
  { route: "/goals", to: "/stats?tab=goals" },
  { route: "/scoreboard", to: "/stats" },
  { route: "/api/short", to: "/", page: false },
];

/**
 * True when `text` carries `route` as a whole path (not `/api/goals`, not
 * `/learning`, not `https://x/learn`), outside comments. Exported shape is
 * private to this file; the positive control below pins it.
 */
function referencesRoute(text: string, route: string): boolean {
  const esc = route.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  const re = new RegExp(`(?<![\\w/.:-])${esc}(?![\\w-])`);
  return text.split(/\r?\n/).some((line) => {
    const t = line.trim();
    if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*") || t.startsWith("{/*")) return false;
    return re.test(line.replace(/\s\/\/.*$/, ""));
  });
}

const SCAN_DIRS = ["app", "components", "lib", "hooks", "features", "config"];
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts|json)$/.test(name)) yield full;
  }
}

describe("pruned routes (2026-10-18) · gone, redirected, and linked from nowhere", () => {
  it("each pruned route has no page file and exactly one redirect to its stated destination", async () => {
    const redirects = await nextConfig.redirects!();
    const problems: string[] = [];
    for (const { route, to, page } of PRUNED) {
      if (page !== false && pageExists(route)) problems.push(`${route}: page.tsx still exists`);
      const source = page === false ? `${route}/:path*` : route;
      const hits = redirects.filter((r) => r.source === source);
      if (hits.length !== 1) problems.push(`${route}: expected 1 redirect from ${source}, found ${hits.length}`);
      else if (hits[0].destination !== to) problems.push(`${route}: redirects to ${hits[0].destination}, expected ${to}`);
      else if (hits[0].permanent !== false) problems.push(`${route}: redirect must be non-permanent`);
    }
    expect(problems).toEqual([]);
  });

  it("no redirect lands on a pruned page (a hop through a dead route would 404 or loop)", async () => {
    const redirects = await nextConfig.redirects!();
    const dead = new Set(PRUNED.filter((p) => p.page !== false).map((p) => p.route));
    const stale = redirects
      .filter((r) => dead.has(r.destination.replace(/[?#].*$/, "")))
      .map((r) => `${r.source} → ${r.destination}`);
    expect(stale).toEqual([]);
  });

  it("referencesRoute matches a real link and ignores look-alikes (positive control)", () => {
    expect(referencesRoute(`<Link href="/learn">`, "/learn")).toBe(true);
    expect(referencesRoute(`href: "/goals?x=1"`, "/goals")).toBe(true);
    expect(referencesRoute(`fetch("/api/short")`, "/api/short")).toBe(true);
    expect(referencesRoute(`fetch("/api/short/abc")`, "/api/short")).toBe(true);
    expect(referencesRoute(`fetch("/api/goals")`, "/goals")).toBe(false);
    expect(referencesRoute(`href="/learning"`, "/learn")).toBe(false);
    expect(referencesRoute(`href="https://example.com/learn"`, "/learn")).toBe(false);
    expect(referencesRoute(`// see /learn for history`, "/learn")).toBe(false);
    expect(referencesRoute(`const x = 1; // was /learn`, "/learn")).toBe(false);
  });

  it("no source file links to a pruned route (control: the scan sees real files and a planted hit)", () => {
    const hits: string[] = [];
    let scanned = 0;
    for (const d of SCAN_DIRS) {
      for (const file of walk(join(APP_ROOT, d))) {
        scanned++;
        const text = readFileSync(file, "utf8");
        for (const { route } of PRUNED) {
          if (referencesRoute(text, route)) hits.push(`${file.slice(APP_ROOT.length + 1).replace(/\\/g, "/")} → ${route}`);
        }
      }
    }
    expect(scanned, "the scan walked real source").toBeGreaterThan(500);
    expect(hits).toEqual([]);
  });
});
