/**
 * SPA fallback resolution — the one place that decides what an extensionless
 * public path gets when no static file and no prerendered file matched it.
 *
 * Before 2026-09-07 every such path answered 200 with the home shell. Measured
 * live: `/this-page-does-not-exist-xyz` returned the home <title>, the home
 * description and `robots: index, follow`. Google calls that a soft 404 and
 * stops trusting the site's status codes; a typo'd inbound link gets indexed
 * as a duplicate of the home page. NotFound.tsx already renders `noindex`, but
 * only after JavaScript runs — a crawler that does not execute it (and every
 * answer-engine fetcher in prerender-middleware.ts is one) never sees it.
 *
 * "Known" means: in the route registry (shared/routes.ts — the same truth the
 * sitemap, the prerender list and the registry validator read), under one of
 * the wouter `:param` prefixes declared beside it, an /admin path (auth-gated
 * shell, never indexed), or one of the few real pages the registry does not
 * describe. scripts/validate-route-registry.mjs asserts App.tsx and those lists
 * agree in both directions, so a route added to the client without registering
 * it fails CI instead of answering 404 in production.
 *
 * Case: a registry path that differs from the request only by case is a 301,
 * not a 200 twin. wouter matches case-insensitively, so `/Tires` used to render
 * the tires page as a second URL with the same content.
 */
import type { Request, Response } from "express";

import {
  getRouteByPath,
  DYNAMIC_ROUTE_PREFIXES,
  NON_REGISTRY_PUBLIC_PATHS,
} from "../../shared/routes";
import { SITE_URL } from "../../shared/business";
import { jobOpeningBySlug } from "../../shared/jobOpenings";

/**
 * The pathname a catch-all must decide on.
 *
 * Inside `app.use("*", handler)` Express strips the matched mount from
 * `req.url`, so `req.path` is "/" for EVERY request and `req.baseUrl` holds
 * the real path (probed 2026-09-07: GET /this-does-not-exist?x=1 →
 * path "/", baseUrl "/this-does-not-exist"). A resolver fed `req.path` would
 * answer 200 for everything and never fire — the same silent-instrument shape
 * the pure-function tests cannot see, which is why the wiring is tested over
 * real HTTP below in spaFallback.test.ts. `originalUrl` is the only field that
 * survives the mount.
 */
export function pathnameOf(req: Pick<Request, "originalUrl">): string {
  const raw = req.originalUrl || "/";
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q);
}

export function queryStringOf(req: Pick<Request, "originalUrl">): string {
  const raw = req.originalUrl || "";
  const q = raw.indexOf("?");
  return q === -1 ? "" : raw.slice(q);
}

export type SpaResolution =
  | { kind: "page"; status: 200 }
  | { kind: "redirect"; status: 301; location: string }
  | { kind: "not_found"; status: 404 };

const PAGE: SpaResolution = { kind: "page", status: 200 };
const NOT_FOUND: SpaResolution = { kind: "not_found", status: 404 };

const NOT_FOUND_ROUTE = "/404";

function isDynamicRoutePath(pathname: string): boolean {
  return DYNAMIC_ROUTE_PREFIXES.some((prefix) => {
    if (!pathname.startsWith(prefix)) return false;
    // wouter's `:param` matches exactly one segment: /blog/<slug>, not /blog/a/b.
    const rest = pathname.slice(prefix.length);
    return rest.length > 0 && !rest.includes("/");
  });
}

const CAREERS_PREFIX = "/careers/";

/**
 * A job leaf is a real page only while its role is OPEN. Measured live
 * 2026-09-22: `/careers/does-not-exist` answered 200 with the home <title>
 * and a self-canonical — the soft-404 this file exists to prevent, because
 * "/careers/" is a blanket dynamic prefix. Worse for Google Jobs: a filled
 * role's URL kept answering 200, while Google's guidance for removing an
 * expired posting is a 404/410 (or dropping the markup). Checked BEFORE the
 * registry, since a closed role's route entry may still be registered.
 */
export function careersLeafVerdict(pathname: string): boolean | null {
  if (!pathname.startsWith(CAREERS_PREFIX)) return null;
  const raw = pathname.slice(CAREERS_PREFIX.length);
  // One trailing slash names the same leaf FILE: the prerender middleware's
  // path.join("/careers/<slug>/", "index.html") resolves to the same artifact,
  // so a closed role must be refused with or without it, or its stale
  // JobPosting slips through (post-merge audit, 2026-09-23).
  const slug = raw.replace(/\/$/, "");
  if (slug.length === 0 || slug.includes("/")) return null;
  if (jobOpeningBySlug(slug)?.status !== "open") return false;
  // An OPEN role is only "the leaf" at its canonical, slash-less path. The
  // slash variant defers to the pre-existing handling (null) rather than
  // becoming a second 200 URL with its own canonical.
  return raw.endsWith("/") ? null : true;
}

function isKnownPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  const careers = careersLeafVerdict(pathname);
  if (careers !== null) return careers;
  if (getRouteByPath(pathname)) return true;
  if (pathname === "/admin" || pathname.startsWith("/admin/")) return true;
  if ((NON_REGISTRY_PUBLIC_PATHS as readonly string[]).includes(pathname)) return true;
  return isDynamicRoutePath(pathname);
}

/** Decide the HTTP status for a fallen-through GET. Query strings are ignored. */
export function resolvePublicPath(pathname: string): SpaResolution {
  const p = pathname.split("?")[0] || "/";
  // The explicit NotFound route is a real page, but its honest status is 404.
  if (p === NOT_FOUND_ROUTE) return NOT_FOUND;
  if (isKnownPublicPath(p)) return PAGE;
  const lower = p.toLowerCase();
  if (lower !== p && lower !== NOT_FOUND_ROUTE && isKnownPublicPath(lower)) {
    return { kind: "redirect", status: 301, location: lower };
  }
  return NOT_FOUND;
}

/** Paths whose HTML must never be indexed even if a crawler reaches it. */
function isNoindexPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Inject route-specific meta tags (title, description, canonical, OG) into the HTML template.
 * This is critical for SEO — without it, Google sees the same homepage meta tags on every page,
 * causing soft 404s and duplicate content issues across the entire site.
 */
export function injectRouteMeta(html: string, url: string): string {
  const path = url.split("?")[0];
  const route = getRouteByPath(path);

  // Critical SEO fix: if the path isn't in the route registry (e.g. dynamic
  // /blog/:slug, /:city neighborhood pages), DON'T return early — at minimum
  // we MUST overwrite the canonical to point to the requested URL. Otherwise
  // every dynamic page inherits index.html's canonical (`https://nickstire.org/`),
  // which Google interprets as "this is a duplicate of the homepage" and drops
  // the URL from the index. That bug killed indexing for 21 of 24 blog posts.
  if (!route) {
    const baseUrl = SITE_URL;
    const fullUrl = `${baseUrl}${path === "/" ? "/" : path}`;
    html = html.replace(
      /<link rel="canonical" href="[^"]*" \/>/,
      `<link rel="canonical" href="${fullUrl}" />`
    );
    html = html.replace(
      /<meta property="og:url" content="[^"]*" \/>/,
      `<meta property="og:url" content="${fullUrl}" />`
    );
    return html;
  }

  const baseUrl = SITE_URL;
  const fullUrl = `${baseUrl}${route.path}`;
  const escapedTitle = escapeAttr(route.title);
  const escapedDesc = escapeAttr(route.description);

  // Replace title tag
  html = html.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapedTitle}</title>`
  );

  // Replace meta description
  html = html.replace(
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${escapedDesc}" />`
  );

  // Replace canonical URL
  html = html.replace(
    /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${fullUrl}" />`
  );

  // Replace OG tags
  html = html.replace(
    /<meta property="og:url" content="[^"]*" \/>/,
    `<meta property="og:url" content="${fullUrl}" />`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${escapedTitle}" />`
  );
  html = html.replace(
    /<meta property="og:description" content="[^"]*" \/>/,
    `<meta property="og:description" content="${escapedDesc}" />`
  );

  // Replace Twitter tags
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*" \/>/,
    `<meta name="twitter:title" content="${escapedTitle}" />`
  );
  html = html.replace(
    /<meta name="twitter:description" content="[^"]*" \/>/,
    `<meta name="twitter:description" content="${escapedDesc}" />`
  );

  return html;
}

const NOT_FOUND_TITLE = "Page Not Found | Nick's Tire & Auto Cleveland";
const NOT_FOUND_DESCRIPTION =
  "Page not found. Pull up to the homepage. Nick's Tire & Auto — Cleveland auto repair on Euclid Ave.";

/**
 * The 404 shell: same strings NotFound.tsx sets after hydration, applied in the
 * HTML so a non-JavaScript crawler reads noindex and a canonical of "/" rather
 * than the home page's title under an unknown URL.
 */
export function injectNotFoundMeta(html: string): string {
  const home = `${SITE_URL}/`;
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeAttr(NOT_FOUND_TITLE)}</title>`);
  html = html.replace(
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${escapeAttr(NOT_FOUND_DESCRIPTION)}" />`
  );
  html = html.replace(
    /<meta name="robots" content="[^"]*" \/>/,
    `<meta name="robots" content="noindex, nofollow" />`
  );
  html = html.replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${home}" />`);
  html = html.replace(
    /<meta property="og:url" content="[^"]*" \/>/,
    `<meta property="og:url" content="${home}" />`
  );
  html = html.replace(
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${escapeAttr(NOT_FOUND_TITLE)}" />`
  );
  html = html.replace(
    /<meta name="twitter:title" content="[^"]*" \/>/,
    `<meta name="twitter:title" content="${escapeAttr(NOT_FOUND_TITLE)}" />`
  );
  return html;
}

const HTML_CACHE_CONTROL = "public, max-age=300, s-maxage=300, must-revalidate";

/**
 * The production SPA fallback, as one handler so the wildcard wiring can be
 * exercised over real HTTP in a test. `readIndexHtml` is injected because the
 * built index.html lives in dist/public, which a unit test does not have.
 *
 * Caller contract: asset-looking paths are answered BEFORE this runs (vite.ts
 * keeps that guard); everything else — registry pages, dynamic pages, the
 * admin shell, unknown URLs — comes here.
 */
export function createSpaFallbackHandler(opts: { readIndexHtml: () => string }) {
  return function spaFallback(req: Request, res: Response): void {
    const pathname = pathnameOf(req);
    const resolution = resolvePublicPath(pathname);
    if (resolution.kind === "redirect") {
      res.redirect(resolution.status, `${resolution.location}${queryStringOf(req)}`);
      return;
    }

    let html = opts.readIndexHtml();
    html =
      resolution.kind === "not_found"
        ? injectNotFoundMeta(html)
        : injectRouteMeta(html, req.originalUrl);

    // 2026-05-06 cache fix · HTML is short-lived (it points at hashed asset
    // filenames that ARE long-cached): 5-min browser + 5-min CDN with
    // must-revalidate = a deploy lands for everyone within 5 minutes.
    const headers: Record<string, string> = {
      "Content-Type": "text/html",
      "Cache-Control": resolution.kind === "not_found" ? "no-cache" : HTML_CACHE_CONTROL,
    };
    // The admin shell is auth-gated and robots.txt-disallowed; the header is
    // the belt to that brace for any crawler that reaches it via a link.
    if (resolution.kind === "not_found" || isNoindexPath(pathname)) {
      headers["X-Robots-Tag"] = "noindex, nofollow";
    }
    res.status(resolution.status).set(headers).end(html);
  };
}
