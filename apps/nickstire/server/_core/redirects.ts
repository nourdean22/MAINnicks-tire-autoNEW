/**
 * URL Canonicalization Middleware
 *
 * Permanent (301) redirects for duplicate URLs that split Google rank juice
 * across multiple paths. Every entry here points a historical/SEO-alias URL
 * to the single canonical URL we want to rank.
 *
 * Why 301 (not 302, not client-side):
 *   - 301 tells Google "consolidate rank into the target forever"
 *   - Runs at the Express level, before any React / prerender logic, so
 *     Googlebot never executes JS to discover the redirect
 *   - Bookmarks and external inbound links keep working permanently
 *
 * Added 2026-04-24 as part of the site cleanup sprint. Each entry has a
 * comment explaining WHY the redirect exists — don't delete without
 * checking the underlying reason (Google may still have the alias
 * cached and need time to consolidate).
 */

import type { Express, Request, Response, NextFunction } from "express";

interface RedirectRule {
  from: string;
  to: string;
  reason: string;
}

// Exact-match redirects. Path is matched literally.
const REDIRECTS: RedirectRule[] = [
  // SEO service-alias pages. Generic service pages at /{slug} rank better
  // once Google consolidates signals from these aliases.
  { from: "/brake-repair-cleveland",          to: "/brakes",       reason: "duplicate of /brakes; was splitting rank" },
  // wave-181.8 · REMOVED /tire-repair-cleveland redirect. We now have a
  // dedicated TireRepairPage at /tire-repair-cleveland (wave-181.7) that
  // targets the "tire repair near me" cluster currently at pos 7.2.
  // Letting the redirect stay would 301 the new page back into /tires.
  // { from: "/tire-repair-cleveland",        to: "/tires",        reason: "duplicate of /tires" },
  { from: "/ac-repair-cleveland",             to: "/ac-repair",    reason: "duplicate of /ac-repair" },
  { from: "/diagnostics-cleveland",           to: "/diagnostics",  reason: "duplicate of /diagnostics" },
  { from: "/check-engine-light-cleveland",    to: "/diagnostics",  reason: "symptom alias → canonical service page" },
  { from: "/suspension-repair-cleveland",     to: "/auto-repair-near-me", reason: "no standalone suspension page; routes to general repair hub" },

  // v1.7 audit · keyword-in-URL captures for direct typers, consolidating
  // link equity into the canonical service pages that already rank for
  // the underlying intent.
  { from: "/check-engine-light",              to: "/diagnostics",        reason: "bare keyword alias → canonical /diagnostics (which already targets check-engine-light intent in title + content)" },
  { from: "/tire-shops-near-me",              to: "/tire-shop-near-me",  reason: "plural variant — canonical is singular per existing rank" },
  { from: "/mechanic-near-me",                to: "/auto-repair-near-me", reason: "AutoRepairNearMePage already targets mechanic-near-me query (per its docstring); consolidate, don't cannibalize" },

  // Tire-shop queries — all flow into the tire-shop landing page
  { from: "/oil-change-cleveland",            to: "/oil-change",   reason: "duplicate of /oil-change" },
  { from: "/oil-change-service-station",      to: "/oil-change",   reason: "intent variant alias — bundle services framing → canonical /oil-change" },
  { from: "/wheel-alignment",                 to: "/alignment",    reason: "keyword alias → /alignment (which already ranks for 'wheel alignment cleveland')" },
  // wave-181.8 · REMOVED /wheel-alignment-cleveland redirect. The
  // 2026-05-02 silo decision routed this geo query into /tires, but
  // the Ahrefs/GSC audit (2026-05-12) showed the city-aware alignment
  // cluster (combined 121 impr/mo at pos 36-40) has demand that doesn't
  // belong on the /tires landing. Built a dedicated
  // WheelAlignmentClevelandPage (wave-181.7) targeting this cluster
  // directly. Letting the redirect stay would 301 the new page back
  // into /tires and lose the strategic SERP slot.
  // { from: "/wheel-alignment-cleveland",    to: "/tires",        reason: "alignment-cleveland geo query routes into /tires per 2026-05-02 silo decision (alignment is bundled with tire install)" },

  // General-repair cluster
  { from: "/general-repair-cleveland",        to: "/auto-repair-near-me", reason: "general-repair got merged into /auto-repair-near-me" },
  { from: "/general-repair",                  to: "/auto-repair-near-me", reason: "consolidate /general-repair (which renders AutoRepairNearMePage anyway) into the canonical URL — kills duplicate-content split" },

  // ─── 2026-05-03 PAGE-PRUNING SPRINT ─────────────────
  // GSC showed 181 pages stuck in 'Discovered - currently not indexed' due
  // to crawl-budget starvation. Below: consolidate alias URLs that split
  // signal across multiple paths into one canonical per intent.

  // Moe's Tire bridge aliases — capture variant queries, consolidate to canonical
  { from: "/moes-tire",                       to: "/moes-tire-euclid", reason: "alias of canonical Moe's bridge page; 2026-05-03 prune sprint" },
  { from: "/moes-tires",                      to: "/moes-tire-euclid", reason: "alias of canonical Moe's bridge page; 2026-05-03 prune sprint" },
  { from: "/moes-auto",                       to: "/moes-tire-euclid", reason: "alias of canonical Moe's bridge page; 2026-05-03 prune sprint" },

  // Sunday-muffler aliases
  { from: "/muffler-shop-sunday",             to: "/muffler-shop-open-sunday-cleveland", reason: "shorter alias → long-tail canonical; 2026-05-03" },
  { from: "/sunday-mechanic-cleveland",       to: "/muffler-shop-open-sunday-cleveland", reason: "broader-intent alias → canonical; 2026-05-03" },

  // Booking / appointment duplicates
  { from: "/appointment",                     to: "/booking", reason: "duplicate booking flow; canonical is /booking" },

  // Pricing-tool duplicates — three pages were doing the same job
  { from: "/estimate",                        to: "/pricing", reason: "third pricing tool consolidated; canonical is /pricing" },
  { from: "/cost-estimator",                  to: "/pricing", reason: "third pricing tool consolidated; canonical is /pricing" },

  // ─── 2026-05-06 wave-14 SLUG RENAMES — preserve link equity ──────
  // The two financing-targeted long-form posts kept their search-query
  // intent but renamed the slugs to use "payment programs" voice. Old
  // URLs may still be in Google's index and on external referrals, so
  // 301 to the new canonicals to consolidate rank + bookmarks.
  {
    from: "/blog/car-repair-financing-bad-credit-cleveland",
    to:   "/blog/auto-repair-payment-programs-bad-credit-cleveland",
    reason: "wave-14 slug rename; same content + intent, FCFS-aligned voice",
  },
  {
    from: "/guides/financing-auto-repair-no-credit-check",
    to:   "/guides/auto-repair-payment-programs-no-credit-check",
    reason: "wave-14 slug rename; same content + intent, FCFS-aligned voice",
  },

  // ─── 2026-05-19 · SOFT-404 CLEANUP ──────────────────────
  // GSC Page-Indexing flagged these as Soft 404 / Crawled-not-indexed.
  // Root cause: routes were removed but Google still crawls the old
  // URLs and the React SPA returns HTTP 200 for everything → Google
  // reads the "not found" render as a soft 404. 301 to a live page
  // tells Google the page moved + consolidates any link equity.

  // The 10 vehicle-make repair pages — routes removed 2026-04-24 per
  // the T5 audit (0 imps / 0 clicks · brand queries == base service
  // intent). seo-pages.ts still has their content as dead data. All
  // 10 redirect to the canonical Cleveland auto-repair page.
  { from: "/toyota-repair-cleveland",    to: "/cleveland-auto-repair", reason: "vehicle-make page route removed 2026-04-24; 301 kills the soft-404" },
  { from: "/honda-repair-cleveland",     to: "/cleveland-auto-repair", reason: "vehicle-make page route removed 2026-04-24; 301 kills the soft-404" },
  { from: "/ford-repair-cleveland",      to: "/cleveland-auto-repair", reason: "vehicle-make page route removed 2026-04-24; 301 kills the soft-404" },
  { from: "/chevy-repair-cleveland",     to: "/cleveland-auto-repair", reason: "vehicle-make page route removed 2026-04-24; 301 kills the soft-404" },
  { from: "/nissan-repair-cleveland",    to: "/cleveland-auto-repair", reason: "vehicle-make page route removed 2026-04-24; 301 kills the soft-404" },
  { from: "/hyundai-repair-cleveland",   to: "/cleveland-auto-repair", reason: "vehicle-make page route removed 2026-04-24; 301 kills the soft-404" },
  { from: "/kia-repair-cleveland",       to: "/cleveland-auto-repair", reason: "vehicle-make page route removed 2026-04-24; 301 kills the soft-404" },
  { from: "/jeep-repair-cleveland",      to: "/cleveland-auto-repair", reason: "vehicle-make page route removed 2026-04-24; 301 kills the soft-404" },
  { from: "/bmw-repair-cleveland",       to: "/cleveland-auto-repair", reason: "vehicle-make page route removed 2026-04-24; 301 kills the soft-404" },
  { from: "/dodge-ram-repair-cleveland", to: "/cleveland-auto-repair", reason: "vehicle-make page route removed 2026-04-24; 301 kills the soft-404" },

  // 3 dead blog posts — slugs no longer in shared/blog.ts. GSC flagged
  // them Soft 404 / Crawled-not-indexed. Stale prerendered HTML for two
  // of them was deleted in the same commit. 301 to the closest live
  // page so any residual link equity + Google's index entry resolves.
  { from: "/blog/winter-tires-vs-all-season-cleveland", to: "/tires",     reason: "deleted blog post; soft-404. /tires is the canonical winter-tire intent page" },
  { from: "/blog/car-ac-not-blowing-cold",              to: "/ac-repair", reason: "deleted blog post; soft-404. /ac-repair is the canonical AC service page" },
  { from: "/blog/tire-maintenance-guide",               to: "/tires",     reason: "deleted blog post; soft-404. /tires covers tire-maintenance intent" },

  // 2026-05-21 · GSC Page-Indexing re-check found one more dead blog
  // slug still serving a 200 SPA shell (soft-404). The other three
  // above already 301 correctly in prod.
  { from: "/blog/pothole-season-suspension-damage", to: "/auto-repair-near-me", reason: "deleted blog post; soft-404. No suspension page — routes to the general-repair hub, matching /suspension-repair-cleveland" },
];

// Returns a 301 redirect if the path matches, otherwise falls through.
export function installRedirects(app: Express): void {
  for (const rule of REDIRECTS) {
    app.get(rule.from, (_req: Request, res: Response) => {
      res.redirect(301, rule.to);
    });
  }

  // 2026-05-19 · wildcard 301 for the 154 killed /near/[slug] intersection
  // pages (deleted wave-181.98). Google still has all 154 URLs indexed and
  // will re-crawl them — without this they each return a SPA soft-404.
  // One wildcard rule catches the whole orphan silo → /areas-served (the
  // location hub that survived). Kept out of the REDIRECTS array because
  // the array is also consumed by the sitemap/audit as literal paths.
  app.get("/near/*", (_req: Request, res: Response) => {
    res.redirect(301, "/areas-served");
  });
}

// Export the list so other code (sitemap, audit) can see what's redirected.
export const REDIRECTED_PATHS = REDIRECTS.map(r => r.from);
export { REDIRECTS };

// Membership check for sitemap emission. The 2026-07-04 GSC audit found 12
// sitemap URLs answering 301 (9 registry aliases + 3 DB-published blog slugs
// that were later redirected). A sitemap must list only final 200 URLs — a
// redirecting <loc> is a contradictory crawl signal. Every sitemap handler
// filters through this so a future alias added to REDIRECTS drops out of the
// sitemap automatically, whatever source it comes from (registry, BLOG_SLUGS,
// or the articles DB).
const REDIRECTED_SET = new Set(REDIRECTED_PATHS);
export function isRedirectedPath(pathname: string): boolean {
  return REDIRECTED_SET.has(pathname);
}

// Host canonicalization — 301 any www.nickstire.org request to the apex.
// As of the 2026-07-04 GSC audit, www has NO DNS record (NXDOMAIN): inbound
// www links die before reaching us. Once the operator adds the www CNAME in
// the registrar panel, Railway will serve the app on that host too — this
// middleware makes it a proper 301 instead of duplicate-host content.
// req.hostname is proxy-safe: app.set("trust proxy", ...) runs at startup.
export function hostCanonicalRedirect(req: Request, res: Response, next: NextFunction): void {
  if (req.hostname === "www.nickstire.org") {
    return void res.redirect(301, `https://nickstire.org${req.originalUrl}`);
  }
  next();
}

// Trailing-slash 301 normalization — the safe subset of canonicalPathMiddleware
// below. That helper also LOWERCASES the whole path, which would 301 any
// uppercase asset filename into a path that doesn't exist on a case-sensitive
// filesystem; it was never installed for that reason. This one only strips a
// trailing slash on extensionless GET paths (/services/ → /services), where
// both variants currently serve 200 and split crawl signals.
export function trailingSlashRedirect(req: Request, res: Response, next: NextFunction): void {
  const p = req.path;
  if (
    req.method !== "GET" ||
    p.length <= 1 ||
    !p.endsWith("/") ||
    p.includes(".") ||
    p.startsWith("/api/")
  ) {
    return next();
  }
  const stripped = p.slice(0, -1);
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  res.redirect(301, stripped + qs);
}

// Helper: middleware that also lowercases + strips trailing slashes.
// Helps consolidate /Brakes, /brakes/, /brakes → all end up at /brakes.
export function canonicalPathMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalPath = req.path;

  // Only normalize GET requests (POST/tRPC have meaningful paths)
  if (req.method !== "GET") return next();

  // Skip API + asset routes
  if (originalPath.startsWith("/api/") || originalPath.startsWith("/assets/")) return next();

  const lowered = originalPath.toLowerCase();
  const stripped = lowered.length > 1 && lowered.endsWith("/") ? lowered.slice(0, -1) : lowered;

  if (stripped !== originalPath) {
    const target = stripped + (req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "");
    return res.redirect(301, target) as unknown as void;
  }

  next();
}
