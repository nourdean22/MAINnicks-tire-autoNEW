/**
 * prerender-indexability-consistency — the drift-catcher.
 *
 * WHY THIS EXISTS (the real miss, 2026-09-03): PR #2094 flipped 12 neighborhood
 * pages to `indexed: true` in React (NeighborhoodPage emits
 * robots={indexed ? "index, follow" : "noindex, follow"}), but 10 of them are
 * prerender:true and their committed snapshots still said
 * `<meta name="robots" content="noindex, follow">` with the OLD thin content.
 * prerender-middleware serves those snapshots to crawlers, so googlebot kept
 * getting noindex + stale content — the whole enrich+index feature was silently
 * defeated. `prerender:check` (snapshot exists?) and `prerender:semantic-check`
 * (title/canonical/H1/payload) BOTH passed because neither ever compared the
 * snapshot's robots directive against the source's INTENT.
 *
 * This test closes that gap. For every neighborhood it proves the four
 * indexability facts agree — the source `indexed` flag, the route registration
 * (routes.ts), the sitemap membership, and the prerendered snapshot's robots
 * meta — so a page can never again advertise to bots what crawlers can't see.
 *
 * It is a static test (no live site, no browser): it reads the committed
 * snapshots and the shared route/neighborhood data. That is exactly the surface
 * where the drift lived and where CI can catch it before deploy.
 *
 * The `describe("canary")` block is the positive control (per AGENTS.md "ship
 * the canary, not just the control"): it feeds the checker a KNOWN-bad input and
 * asserts it fails, so a future refactor can't leave this test green-but-blind.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NEIGHBORHOODS, type Neighborhood } from "@shared/neighborhoods";
import { getRouteByPath, SITEMAP_ROUTES } from "@shared/routes";

const ROOT = join(__dirname, "..", "..", ".."); // apps/nickstire
const PRERENDERED = join(ROOT, "prerendered");

/** Mirrors NeighborhoodPage.tsx:245 exactly. */
function intendedRobots(indexed?: boolean): string {
  return indexed ? "index, follow" : "noindex, follow";
}

/**
 * The committed snapshot's robots directive:
 *   null  = no snapshot file (route not prerendered)
 *   ""    = snapshot exists but carries no robots meta
 *   "..." = the content string
 */
function snapshotRobots(slug: string): string | null {
  const file = join(PRERENDERED, slug, "index.html");
  if (!existsSync(file)) return null;
  const html = readFileSync(file, "utf8");
  const m = html.match(/<meta\s+name=["']robots["']\s+content=["']([^"']*)["']/i);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

const sitemapPaths = new Set(SITEMAP_ROUTES.map((r) => r.path));

/**
 * The invariant, as a pure function so the canary can exercise it with a
 * synthetic input. Returns the list of consistency violations for one
 * neighborhood (empty = consistent).
 */
export function neighborhoodIndexIssues(n: Neighborhood): string[] {
  const errors: string[] = [];
  const path = `/${n.slug}`;
  const route = getRouteByPath(path);

  // Scope: NEIGHBORHOODS is also a data source for city slugs that have their
  // OWN dedicated page (e.g. /lakewood-auto-repair -> CityPage, group "city").
  // App.tsx registers those explicit routes BEFORE the NEIGHBORHOODS.map()
  // catch, so the NeighborhoodPage route for such a slug is shadowed and its
  // `indexed` flag is dead — CityPage owns the URL and its own robots. Only a
  // route classified group:"neighborhood" (or an unregistered slug served solely
  // by the NEIGHBORHOODS.map) is actually driven by NeighborhoodPage's
  // indexed?-ternary, which is the only thing this invariant governs.
  if (route && route.group !== "neighborhood") return [];

  const want = intendedRobots(n.indexed);
  const snap = snapshotRobots(n.slug);

  if (n.indexed) {
    // An indexed page must be registered, prerendered, in the sitemap, and its
    // served snapshot must actually say index — or bots never see the intent.
    if (!route) {
      errors.push(`${n.slug}: indexed:true but not registered in routes.ts (no route entry).`);
    } else {
      if (!route.prerender) {
        errors.push(`${n.slug}: indexed:true but routes.ts prerender:false — crawlers get the SPA shell, not the content.`);
      }
      if (!sitemapPaths.has(path)) {
        errors.push(`${n.slug}: indexed:true but excluded from SITEMAP_ROUTES (neighborhood group is filtered out) — indexable pages must be in the sitemap.`);
      }
    }
    if (snap === null) {
      errors.push(`${n.slug}: indexed:true but no prerender snapshot exists — crawlers get nothing.`);
    } else if (snap !== want) {
      errors.push(`${n.slug}: indexed:true but snapshot robots="${snap}" (want "${want}") — STALE snapshot silently defeats indexing.`);
    }
  } else {
    // A noindex page is fine, but a lingering snapshot must not advertise index.
    if (snap && /(^|[^n])index/i.test(snap) && !/noindex/i.test(snap)) {
      errors.push(`${n.slug}: indexed:false but snapshot robots="${snap}" advertises indexing.`);
    }
  }
  return errors;
}

describe("prerender indexability consistency", () => {
  it("every neighborhood agrees across source, routes, sitemap, and snapshot robots", () => {
    const issues = NEIGHBORHOODS.flatMap(neighborhoodIndexIssues);
    expect(issues, `\n${issues.join("\n")}\n`).toEqual([]);
  });

  it("the instrument actually fired: at least one real neighborhood snapshot was read", () => {
    // Guards against a vacuous green — if the prerendered/ path resolved wrong
    // or the files vanished, snapshotRobots would return null everywhere and the
    // check above would pass while inspecting nothing.
    const withSnapshots = NEIGHBORHOODS.filter((n) => snapshotRobots(n.slug) !== null);
    expect(withSnapshots.length).toBeGreaterThan(0);
  });
});

/**
 * THE CHECK ABOVE COVERS NEIGHBOURHOODS. THE SITEMAP IS WIDER THAN THAT.
 *
 * Everything above iterates NEIGHBORHOODS, and on 2026-09-10 that is 100% of
 * its subject list against 146 sitemap routes. Two routes outside that list
 * were in exactly the state this file exists to prevent — advertised in the
 * sitemap while their committed snapshot said `noindex`, which is GSC's
 * "Excluded by 'noindex'" bucket and a direct contradiction: the sitemap asks
 * Google to index a page that tells Google not to.
 *
 *   · /refer   — ReferralPage.tsx:62 sets robots="noindex, follow" on purpose,
 *                and routes.ts said sitemap: true. Now sitemap: false.
 *   · /tires/info — registered against GenericServicePage, whose matcher is
 *                useRoute("/:slug"), ONE segment. Two-segment path, never
 *                matched, so it rendered the not-found branch: HTTP 200, title
 *                "Service Not Found", copy "SERVICE NOT FOUND", noindex — at
 *                priority 0.8 in group "service". Now 301s to /tires.
 *
 * A gate is only as wide as its subject list. This block takes the subject list
 * from SITEMAP_ROUTES itself, so it cannot fall behind the thing it guards.
 */
describe("no sitemap route advertises a page that refuses to be indexed", () => {
  const withSnapshot = SITEMAP_ROUTES.map((route) => {
    const file =
      route.path === "/"
        ? join(PRERENDERED, "index.html")
        : join(PRERENDERED, route.path.slice(1), "index.html");
    if (!existsSync(file)) return null;
    const robots = /<meta\b[^>]*\bname=["']robots["'][^>]*>/i.exec(readFileSync(file, "utf8"))?.[0] ?? "";
    return { path: route.path, robots };
  }).filter((r): r is { path: string; robots: string } => r !== null);

  it("read real snapshots for the whole sitemap — the positive control", () => {
    // Without this, a wrong PRERENDERED path makes every route resolve to "no
    // snapshot", the assertion below inspects an empty list, and the green
    // means nothing.
    expect(withSnapshot.length).toBeGreaterThan(100);
    expect(withSnapshot.some((r) => r.robots !== "")).toBe(true);
  });

  it("every sitemap route's snapshot is indexable", () => {
    const contradictions = withSnapshot
      .filter((r) => /noindex/i.test(r.robots))
      .map((r) => `${r.path}: in the sitemap but its snapshot says ${r.robots}`);
    expect(
      contradictions,
      `\n${contradictions.join("\n")}\n\n` +
        `Either drop the route from the sitemap (sitemap: false in shared/routes.ts)\n` +
        `or stop emitting noindex on the page. Shipping both puts the URL in GSC's\n` +
        `"Excluded by 'noindex'" bucket, where it counts against the site and\n` +
        `converts nothing.\n`,
    ).toEqual([]);
  });
});

describe("canary — the checker actually catches the drift it exists for", () => {
  // A real, IN-SCOPE (group:"neighborhood") neighborhood that HAS a committed
  // noindex snapshot. Pretending it is indexed:true is exactly the PR #2094
  // defect; the checker must flag it. Scoping to group:"neighborhood" ensures
  // the mutant isn't skipped by the shadowed-route guard.
  const withNoindexSnapshot = NEIGHBORHOODS.find(
    (n) =>
      getRouteByPath(`/${n.slug}`)?.group === "neighborhood" &&
      snapshotRobots(n.slug) === "noindex, follow",
  );

  it("a neighborhood with a noindex snapshot exists to mutate (baseline)", () => {
    expect(withNoindexSnapshot, "expected at least one prerendered noindex neighborhood").toBeDefined();
  });

  it("flags a stale snapshot when indexed:true meets a noindex snapshot", () => {
    const mutant: Neighborhood = { ...(withNoindexSnapshot as Neighborhood), indexed: true };
    const issues = neighborhoodIndexIssues(mutant);
    expect(issues.some((e) => /STALE snapshot silently defeats indexing/.test(e))).toBe(true);
    // and it must also catch the sitemap-exclusion conflict for the same mutant
    expect(issues.some((e) => /excluded from SITEMAP_ROUTES/.test(e))).toBe(true);
  });

  it("passes the same neighborhood when it is honestly noindex (no false positive)", () => {
    const honest: Neighborhood = { ...(withNoindexSnapshot as Neighborhood), indexed: false };
    expect(neighborhoodIndexIssues(honest)).toEqual([]);
  });
});
