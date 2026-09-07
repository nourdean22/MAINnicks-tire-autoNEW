/**
 * SPA fallback status contract — server/_core/spaFallback.ts.
 *
 * Sits directly under the protected "Prerender generation and bot-serving
 * middleware" surface: a bot whose path has no prerendered file falls through
 * to exactly this decision. Measured live on 2026-09-07 BEFORE the fix:
 * `GET /this-page-does-not-exist-xyz` → HTTP 200, the home <title>, and
 * `robots: index, follow`. NotFound.tsx sets noindex only after hydration,
 * which a non-JavaScript crawler never runs — a textbook soft 404.
 *
 * ROLLBACK: in server/_core/vite.ts, replace the resolvePublicPath /
 * injectNotFoundMeta branch with the old unconditional `.status(200)` +
 * `injectRouteMeta` call and restore `index: true` on express.static. No data,
 * migration or deploy step is involved. The registry validator's Rule 5
 * (dynamic-prefix parity) can stay; it is pure CI.
 *
 * Both directions of the gate are asserted: a real page must stay 200 and an
 * unknown path must become 404. A gate that only ever says one thing is not a
 * gate.
 */
import express from "express";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  HTML_CACHE_CONTROL,
  createSpaFallbackHandler,
  injectNotFoundMeta,
  injectRouteMeta,
  isNoindexPath,
  pathnameOf,
  resolvePublicPath,
} from "./_core/spaFallback";
import { SITE_URL } from "../shared/business";
import { ALL_ROUTES, DYNAMIC_ROUTE_PREFIXES, NON_REGISTRY_PUBLIC_PATHS } from "../shared/routes";

const TEMPLATE = `<!doctype html><html><head>
<title>Home Title</title>
<meta name="description" content="Home description" />
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />
<link rel="canonical" href="${SITE_URL}/" />
<meta property="og:url" content="${SITE_URL}/" />
<meta property="og:title" content="Home OG title" />
<meta property="og:description" content="Home OG description" />
<meta name="twitter:title" content="Home TW title" />
<meta name="twitter:description" content="Home TW description" />
</head><body><div id="root"></div></body></html>`;

describe("resolvePublicPath — every real page stays a 200", () => {
  it("resolves the home page", () => {
    expect(resolvePublicPath("/")).toEqual({ kind: "page", status: 200 });
  });

  it("resolves every registry entry (the sitemap / prerender truth) as a page", () => {
    const misses = ALL_ROUTES.map((r) => r.path).filter((p) => resolvePublicPath(p).kind !== "page");
    expect(misses).toEqual([]);
    expect(ALL_ROUTES.length).toBeGreaterThan(100); // the loop above must have covered something
  });

  it("resolves the admin shell and its sub-paths (auth-gated, never indexed)", () => {
    expect(resolvePublicPath("/admin").status).toBe(200);
    expect(resolvePublicPath("/admin/ig-studio").status).toBe(200);
    expect(resolvePublicPath("/admin/anything?tab=overview").status).toBe(200);
  });

  it("resolves the deliberately unregistered pages", () => {
    for (const p of NON_REGISTRY_PUBLIC_PATHS) {
      if (p === "/404") continue; // asserted separately — its honest status IS 404
      expect(resolvePublicPath(p), p).toEqual({ kind: "page", status: 200 });
    }
  });

  it("resolves one segment under every dynamic prefix, and refuses two", () => {
    for (const prefix of DYNAMIC_ROUTE_PREFIXES) {
      expect(resolvePublicPath(`${prefix}some-slug`).status, prefix).toBe(200);
      expect(resolvePublicPath(`${prefix}some-slug?utm_source=x`).status, prefix).toBe(200);
      expect(resolvePublicPath(`${prefix}a/b`).status, `${prefix}a/b`).toBe(404);
    }
    expect(DYNAMIC_ROUTE_PREFIXES.length).toBeGreaterThan(0);
  });
});

describe("resolvePublicPath — unknown paths are honest 404s", () => {
  it("returns 404 for the path measured live as a soft 404", () => {
    expect(resolvePublicPath("/this-page-does-not-exist-xyz")).toEqual({ kind: "not_found", status: 404 });
  });

  it("returns 404 for near-misses of real pages", () => {
    expect(resolvePublicPath("/brakes-repair").status).toBe(404);
    expect(resolvePublicPath("/services/brakes").status).toBe(404);
    expect(resolvePublicPath("/privacy").status).toBe(404); // the real page is /privacy-policy
  });

  it("returns 404 for the explicit /404 route itself", () => {
    expect(resolvePublicPath("/404").status).toBe(404);
  });

  it("keeps the two directions distinct on the same registry (canary pair)", () => {
    expect(resolvePublicPath("/brakes").status).toBe(200);
    expect(resolvePublicPath("/brakes-does-not-exist").status).toBe(404);
  });
});

describe("resolvePublicPath — case variants redirect instead of duplicating", () => {
  it("301s a mis-cased registry path to its lowercase form", () => {
    expect(resolvePublicPath("/Tires")).toEqual({ kind: "redirect", status: 301, location: "/tires" });
    expect(resolvePublicPath("/BRAKES")).toEqual({ kind: "redirect", status: 301, location: "/brakes" });
  });

  it("does not redirect a slug under a dynamic prefix (slugs may carry case)", () => {
    expect(resolvePublicPath("/blog/Some-Slug").status).toBe(200);
  });

  it("still 404s a mis-cased path whose lowercase is also unknown", () => {
    expect(resolvePublicPath("/Nope-Not-Real").status).toBe(404);
  });
});

describe("injectNotFoundMeta — what a non-JS crawler reads on a 404", () => {
  const html = injectNotFoundMeta(TEMPLATE);

  it("replaces the home title and description", () => {
    expect(html).toContain("<title>Page Not Found | Nick's Tire &amp; Auto Cleveland</title>");
    expect(html).not.toContain("<title>Home Title</title>");
    expect(html).toContain('<meta name="description" content="Page not found.');
  });

  it("sets noindex, nofollow and points canonical + og:url at the home page", () => {
    expect(html).toContain('<meta name="robots" content="noindex, nofollow" />');
    expect(html).not.toContain("index, follow, max-image-preview");
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/" />`);
    expect(html).toContain(`<meta property="og:url" content="${SITE_URL}/" />`);
  });
});

describe("injectRouteMeta — registry pages keep their own meta", () => {
  it("injects the registry title, description and canonical for a known route", () => {
    const brakes = ALL_ROUTES.find((r) => r.path === "/brakes");
    expect(brakes).toBeDefined();
    const html = injectRouteMeta(TEMPLATE, "/brakes?utm_source=test");
    const escapedTitle = brakes!.title.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    expect(html).toContain(`<title>${escapedTitle}</title>`);
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/brakes" />`);
    expect(html).toContain('<meta name="robots" content="index, follow');
  });

  it("rewrites only canonical + og:url for a dynamic (unregistered) page", () => {
    const html = injectRouteMeta(TEMPLATE, "/blog/some-slug");
    expect(html).toContain(`<link rel="canonical" href="${SITE_URL}/blog/some-slug" />`);
    expect(html).toContain("<title>Home Title</title>");
  });
});

describe("isNoindexPath", () => {
  it("covers the admin shell only", () => {
    expect(isNoindexPath("/admin")).toBe(true);
    expect(isNoindexPath("/admin/reel-studio")).toBe(true);
    expect(isNoindexPath("/brakes")).toBe(false);
    expect(isNoindexPath("/administration-guide")).toBe(false);
  });
});

/**
 * THE WIRING TEST. Everything above exercises pure functions; this mounts the
 * real handler the way production does — `app.use("*", …)` — and speaks HTTP
 * to it. Found on 2026-09-07 during self-audit, before merge: inside a
 * wildcard mount Express rewrites `req.path` to "/" for every request, so a
 * handler keyed on `req.path` answers 200 for everything and the 404 never
 * fires. The pure tests were green the whole time.
 */
describe("createSpaFallbackHandler mounted on app.use('*') — real HTTP", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.use("*", createSpaFallbackHandler({ readIndexHtml: () => TEMPLATE }));
    await new Promise<void>((resolve) => {
      server = app.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    if (!addr || typeof addr === "string") throw new Error("no ephemeral port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("pathnameOf reads originalUrl, never the mount-stripped req.path", () => {
    expect(pathnameOf({ originalUrl: "/this-does-not-exist?x=1" })).toBe("/this-does-not-exist");
    expect(pathnameOf({ originalUrl: "/" })).toBe("/");
  });

  it("answers 404 + noindex for an unknown URL through the wildcard mount", async () => {
    const res = await fetch(`${base}/this-page-does-not-exist-xyz?utm_source=x`, { redirect: "manual" });
    expect(res.status).toBe(404);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    const body = await res.text();
    expect(body).toContain("<title>Page Not Found | Nick's Tire &amp; Auto Cleveland</title>");
    expect(body).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it("answers 200 with the registry title and the 5-minute cache header for a real page", async () => {
    const res = await fetch(`${base}/brakes`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(HTML_CACHE_CONTROL);
    expect(res.headers.get("x-robots-tag")).toBeNull();
    const body = await res.text();
    const brakes = ALL_ROUTES.find((r) => r.path === "/brakes")!;
    expect(body).toContain(`<title>${brakes.title.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}</title>`);
    expect(body).toContain(`<link rel="canonical" href="${SITE_URL}/brakes" />`);
  });

  it("answers 200 for the home page and a dynamic page", async () => {
    expect((await fetch(`${base}/`, { redirect: "manual" })).status).toBe(200);
    expect((await fetch(`${base}/blog/some-slug`, { redirect: "manual" })).status).toBe(200);
  });

  it("301s a mis-cased twin and keeps the query string", async () => {
    const res = await fetch(`${base}/Tires?size=205-55r16`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/tires?size=205-55r16");
  });

  it("marks the admin shell noindex while still serving it", async () => {
    const res = await fetch(`${base}/admin/reel-studio`, { redirect: "manual" });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });
});
