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
  { from: "/tire-repair-cleveland",           to: "/tires",        reason: "duplicate of /tires" },
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
  { from: "/wheel-alignment-cleveland",       to: "/alignment",    reason: "geo-suffixed variant → /alignment" },

  // General-repair cluster
  { from: "/general-repair-cleveland",        to: "/auto-repair-near-me", reason: "general-repair got merged into /auto-repair-near-me" },
];

// Returns a 301 redirect if the path matches, otherwise falls through.
export function installRedirects(app: Express): void {
  for (const rule of REDIRECTS) {
    app.get(rule.from, (_req: Request, res: Response) => {
      res.redirect(301, rule.to);
    });
  }
}

// Export the list so other code (sitemap, audit) can see what's redirected.
export const REDIRECTED_PATHS = REDIRECTS.map(r => r.from);
export { REDIRECTS };

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
