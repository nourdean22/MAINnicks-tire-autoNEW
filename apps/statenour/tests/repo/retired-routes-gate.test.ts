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
export const PRUNED: ReadonlyArray<{ route: string; to?: string; page?: false }> = [
  { route: "/system/chat-states", to: "/system" },
  { route: "/system/schema-history", to: "/system" },
  { route: "/system/tools", to: "/system/actions" },
  { route: "/system/proactive-preview", to: "/system" },
  { route: "/system/camera", to: "https://nickstire.org/admin?tab=lot" },
  { route: "/intelligence/ledger", to: "/" },
  { route: "/intelligence/brief", to: "/" },
  { route: "/content", to: "/" },
  { route: "/learn", to: "/" },
  { route: "/links", to: "/" },
  { route: "/goals", to: "/stats?tab=goals" },
  { route: "/scoreboard", to: "/stats" },
  // 2026-10-19 · wave 2V, cut by Nour: Pinned Memory (the pinned-context panel in Brain Memory does the same job)
  // and Proof (5 visits in 14 days).
  { route: "/pins", to: "/brain?tab=memory" },
  { route: "/proof", to: "/system" },
  { route: "/api/short", to: "/", page: false },
  // Deleted API prefixes with no redirect (no page ever linked here for a person): nothing may request them.
  { route: "/api/content/history", page: false },
  { route: "/api/content/drafts", page: false },
  { route: "/api/social/publish", page: false },
  { route: "/api/social/schedule", page: false },
  { route: "/api/social/recent-images", page: false },
  { route: "/api/outreach", page: false },
  { route: "/api/intelligence/briefs", page: false },
  { route: "/api/intelligence/decisions", page: false },
  { route: "/api/intelligence/opportunities", page: false },
  { route: "/api/system/schema-history", page: false },
  { route: "/api/system/proactive-preview", page: false },
  // 2026-10-18/19 wave 3: crons and surfaces whose output nothing read.
  { route: "/api/cron/change-detection", page: false },
  { route: "/api/cron/experiment-measure", page: false },
  { route: "/api/cron/revenue-decision", page: false },
  { route: "/api/cron/pricing-advisory", page: false },
  { route: "/api/system/revenue-decisions", page: false },
  { route: "/api/system/pricing-advisory", page: false },
  { route: "/api/telegram/revenue-decision-callback", page: false },
  { route: "/api/intel", page: false },
  { route: "/api/customer-360", page: false },
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

// Accepted gap (L1): the regex sees quoted path strings only. It does not catch absolute URLs
// (https://bdnick.info/learn) or strings built from parts (`/${seg}`).
const SCAN_DIRS = ["app", "components", "lib", "hooks", "features", "config"];
/** Tests are scanned for the deleted API prefixes only (page strings appear in nav fixtures on purpose). */
const API_ROWS = PRUNED.filter((p) => p.page === false);
/** Auth-policy probes that feed path STRINGS to the middleware classifier; they never request the route. */
const TEST_SCAN_EXEMPT = [join("tests", "redteam", "route-auth.redteam.test.ts"), join("tests", "repo", "retired-routes-gate.test.ts")];
/** Telegram bot commands (/goals, /content) share spelling with the retired pages; they are chat verbs, not links. */
const SOURCE_SCAN_EXEMPT = [join("app", "api", "telegram", "webhook", "route.ts")];
function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|mts|json)$/.test(name)) yield full;
  }
}

const rel = (file: string) => file.slice(APP_ROOT.length + 1).replace(/\\/g, "/");

function readFiles(dirs: string[], exempt: string[]): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  for (const d of dirs) {
    for (const file of walk(join(APP_ROOT, d))) {
      if (exempt.some((x) => file.endsWith(x))) continue;
      out.push({ path: rel(file), text: readFileSync(file, "utf8") });
    }
  }
  return out;
}

/** The scan itself, pure: every "path → route" where the file's text references the route. */
function scanTexts(files: ReadonlyArray<{ path: string; text: string }>, rows: ReadonlyArray<{ route: string }>): string[] {
  const hits: string[] = [];
  for (const { path, text } of files) {
    for (const { route } of rows) {
      if (referencesRoute(text, route)) hits.push(`${path} → ${route}`);
    }
  }
  return hits;
}

describe("pruned routes (2026-10-18) · gone, redirected, and linked from nowhere", () => {
  it("each pruned route has no page file and exactly one redirect to its stated destination", async () => {
    const redirects = await nextConfig.redirects!();
    const problems: string[] = [];
    for (const { route, to, page } of PRUNED) {
      if (page !== false && pageExists(route)) problems.push(`${route}: page.tsx still exists`);
      if (to === undefined) continue; // API prefix with no redirect: only the reference scan applies
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

  it("scanTexts reports ONE planted string per row type, and nothing for clean text (control)", () => {
    expect(API_ROWS.length, "API_ROWS is empty: the test scan would pass vacuously").toBeGreaterThan(0);
    expect(PRUNED.some((p) => p.page !== false), "no page rows").toBe(true);
    const apiRow = API_ROWS[0];
    const pageRow = PRUNED.find((p) => p.page !== false)!;
    expect(scanTexts([{ path: "tests/x.spec.ts", text: `await request.get("${apiRow.route}?x=1");` }], API_ROWS)).toEqual([
      `tests/x.spec.ts → ${apiRow.route}`,
    ]);
    expect(scanTexts([{ path: "components/y.tsx", text: `<Link href="${pageRow.route}">go</Link>` }], PRUNED)).toEqual([
      `components/y.tsx → ${pageRow.route}`,
    ]);
    expect(scanTexts([{ path: "lib/z.ts", text: `// ${pageRow.route} is gone\nconst a = 1;` }], PRUNED)).toEqual([]);
    // every row type is individually detectable, not just the first
    for (const { route } of PRUNED) {
      expect(scanTexts([{ path: "p.ts", text: `go("${route}")` }], PRUNED), route).toContain(`p.ts → ${route}`);
    }
  });

  it("no source file links to a pruned route", () => {
    const files = readFiles(SCAN_DIRS, SOURCE_SCAN_EXEMPT);
    expect(files.length, "the scan walked real source").toBeGreaterThan(500);
    expect(scanTexts(files, PRUNED)).toEqual([]);
  });

  it("no test requests a deleted API route (the e2e smoke list kept two for a week)", () => {
    const files = readFiles(["tests"], TEST_SCAN_EXEMPT);
    expect(files.length, "the scan walked real tests").toBeGreaterThan(300);
    expect(API_ROWS.length).toBeGreaterThan(0);
    expect(scanTexts(files, API_ROWS)).toEqual([]);
  });
});

/**
 * 2026-10-19 · wave 2V: Brain went from nine tabs to three (Memory, Review, Health), Nour's cut. Each retired
 * `?tab=` key redirects to the tab that received its content (Wisdom -> Memory, Discover -> Review, Changed ->
 * Health) or, for the three dropped surfaces (Map, Board, Reason), to Memory.
 */
export const BRAIN_TAB_REDIRECTS: ReadonlyArray<{ key: string; to: string }> = [
  { key: "graph", to: "/brain?tab=memory" },
  { key: "discover", to: "/brain?tab=review" },
  { key: "wisdom", to: "/brain?tab=memory" },
  { key: "board", to: "/brain?tab=memory" },
  { key: "reason", to: "/brain?tab=memory" },
  { key: "continuity", to: "/brain?tab=health" },
];
const LIVE_BRAIN_TABS = ["memory", "review", "health"];

describe("Brain retired tabs (2026-10-19) · every old ?tab= key redirects, nothing links to one", () => {
  it("each retired key has exactly one non-permanent has-query redirect from /brain to its new tab", async () => {
    const redirects = await nextConfig.redirects!();
    const problems: string[] = [];
    for (const { key, to } of BRAIN_TAB_REDIRECTS) {
      const hits = redirects.filter(
        (r) => r.source === "/brain" && (r.has ?? []).some((h) => h.type === "query" && h.key === "tab" && h.value === key),
      );
      if (hits.length !== 1) problems.push(`tab=${key}: expected 1 redirect, found ${hits.length}`);
      else if (hits[0].destination !== to) problems.push(`tab=${key}: goes to ${hits[0].destination}, expected ${to}`);
      else if (hits[0].permanent !== false) problems.push(`tab=${key}: redirect must be non-permanent`);
    }
    expect(problems).toEqual([]);
  });

  it("no redirect rule lands on a retired Brain tab (the old /reason and /brain/board hops)", async () => {
    const redirects = await nextConfig.redirects!();
    const retired = new Set(BRAIN_TAB_REDIRECTS.map((b) => b.key));
    const stale = redirects
      .filter((r) => r.destination.startsWith("/brain"))
      .filter((r) => retired.has(new URL(r.destination, "https://bdnick.info").searchParams.get("tab") ?? ""))
      .map((r) => `${r.source} → ${r.destination}`);
    expect(stale).toEqual([]);
  });

  it("the destination's own tab beats the incoming one (Next's own query merge, so a redirect cannot loop on the old key)", async () => {
    const { prepareDestination } = await import("next/dist/shared/lib/router/utils/prepare-destination");
    const out = prepareDestination({
      appendParamsToQuery: true,
      destination: "/brain?tab=memory",
      params: {},
      query: { tab: "wisdom", focus: "w1" },
    });
    expect(out.parsedDestination.query).toEqual({ tab: "memory", focus: "w1" });
  });

  it("Brain declares exactly the live tabs", () => {
    const page = readFileSync(join(APP_ROOT, "app", "(mastery)", "brain", "page.tsx"), "utf8");
    const start = page.indexOf("<PageTabs");
    const keys = [...page.slice(start, page.indexOf("]}", start)).matchAll(/key:\s*"([a-z_-]+)"/g)].map((m) => m[1]);
    expect(keys).toEqual(LIVE_BRAIN_TABS);
  });

  it("no source file links to a retired Brain tab (positive control: a planted link is flagged)", () => {
    const re = new RegExp(`/brain\\?tab=(?:${BRAIN_TAB_REDIRECTS.map((b) => b.key).join("|")})\\b`);
    const scan = (files: ReadonlyArray<{ path: string; text: string }>) =>
      files
        .filter((f) => f.text.split(/\r?\n/).some((l) => !/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(l) && re.test(l)))
        .map((f) => f.path);
    expect(scan([{ path: "p.ts", text: 'router.push("/brain?tab=wisdom&focus=1");' }])).toEqual(["p.ts"]);
    expect(scan([{ path: "q.ts", text: '// was /brain?tab=wisdom\nrouter.push("/brain?tab=memory&focus=1");' }])).toEqual([]);
    const files = readFiles(SCAN_DIRS, SOURCE_SCAN_EXEMPT);
    expect(files.length).toBeGreaterThan(500);
    expect(scan(files)).toEqual([]);
  });
});