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
import http, { type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Plain node:http, NOT the global `fetch`. The suite runs serially in one
 * process (see AGENTS.md §3) and an earlier file's `global.fetch = vi.fn()`
 * leaks into this one: in CI on 2026-09-07 these tests read a canned 200
 * from that stub for every URL (4 failed, 1 passed by accident) while the same
 * tests were green in isolation. A request that cannot be mocked away is the
 * only honest probe of the wiring.
 */
function httpGet(url: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

import {
  createSpaFallbackHandler,
  injectNotFoundMeta,
  injectRouteMeta,
  pathnameOf,
  resolvePublicPath,
} from "./_core/spaFallback";

/** The 2026-05-06 cache contract for every HTML route, pinned as a literal. */
const HTML_CACHE_CONTROL = "public, max-age=300, s-maxage=300, must-revalidate";
import { SITE_URL } from "../shared/business";
import { ALL_ROUTES, DYNAMIC_ROUTE_PREFIXES, NON_REGISTRY_PUBLIC_PATHS } from "../shared/routes";
import { JOB_OPENINGS, openJobOpenings } from "../shared/jobOpenings";

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
      // /careers/ is the one prefix whose slug set is KNOWN (shared/jobOpenings);
      // an arbitrary slug under it is a 404 by design — see the careers block below.
      if (prefix === "/careers/") continue;
      expect(resolvePublicPath(`${prefix}some-slug`).status, prefix).toBe(200);
      expect(resolvePublicPath(`${prefix}some-slug?utm_source=x`).status, prefix).toBe(200);
      expect(resolvePublicPath(`${prefix}a/b`).status, `${prefix}a/b`).toBe(404);
    }
    expect(DYNAMIC_ROUTE_PREFIXES.length).toBeGreaterThan(0);
  });
});

describe("resolvePublicPath — job leaves exist only while the role is open", () => {
  // Measured live 2026-09-22: /careers/does-not-exist answered 200 with the
  // home <title> — a soft 404 under a URL Google Jobs crawls.
  it("an open role's leaf is a page", () => {
    for (const job of openJobOpenings()) {
      expect(resolvePublicPath(`/careers/${job.slug}`).status, job.slug).toBe(200);
    }
    expect(openJobOpenings().length).toBeGreaterThan(0);
  });

  it("an unknown slug is a 404, not the home shell", () => {
    expect(resolvePublicPath("/careers/does-not-exist")).toEqual({ kind: "not_found", status: 404 });
  });

  it("a FILLED role is a 404 even though its route may still be registered", () => {
    const job = JOB_OPENINGS[0];
    const original = job.status;
    try {
      job.status = "filled";
      expect(resolvePublicPath(`/careers/${job.slug}`).status).toBe(404);
    } finally {
      job.status = original;
    }
  });

  it("a trailing slash never turns a leaf into a second 200 URL, and never rescues a closed one", () => {
    // Open role: the slash variant keeps its pre-existing answer (not a new
    // duplicate page with its own canonical).
    expect(resolvePublicPath("/careers/automotive-technician/").status).toBe(404);
    // Unknown/closed role: 404 either way.
    expect(resolvePublicPath("/careers/does-not-exist/").status).toBe(404);
  });

  it("the /careers list page itself stays a page", () => {
    expect(resolvePublicPath("/careers").status).toBe(200);
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
    const res = await httpGet(`${base}/this-page-does-not-exist-xyz?utm_source=x`);
    expect(res.status).toBe(404);
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(res.headers["cache-control"]).toBe("no-cache");
    expect(res.body).toContain("<title>Page Not Found | Nick's Tire &amp; Auto Cleveland</title>");
    expect(res.body).toContain('<meta name="robots" content="noindex, nofollow" />');
  });

  it("answers 200 with the registry title and the 5-minute cache header for a real page", async () => {
    const res = await httpGet(`${base}/brakes`);
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe(HTML_CACHE_CONTROL);
    expect(res.headers["x-robots-tag"]).toBeUndefined();
    const brakes = ALL_ROUTES.find((r) => r.path === "/brakes")!;
    expect(res.body).toContain(`<title>${brakes.title.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}</title>`);
    expect(res.body).toContain(`<link rel="canonical" href="${SITE_URL}/brakes" />`);
  });

  it("answers 200 for the home page and a dynamic page", async () => {
    expect((await httpGet(`${base}/`)).status).toBe(200);
    expect((await httpGet(`${base}/blog/some-slug`)).status).toBe(200);
  });

  it("301s a mis-cased twin and keeps the query string", async () => {
    const res = await httpGet(`${base}/Tires?size=205-55r16`);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe("/tires?size=205-55r16");
  });

  it("marks the admin shell noindex while still serving it", async () => {
    const res = await httpGet(`${base}/admin/reel-studio`);
    expect(res.status).toBe(200);
    expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow");
  });

  it("keys the noindex rule on the /admin segment, not on a prefix", async () => {
    const admin = await httpGet(`${base}/admin`);
    expect(admin.status).toBe(200);
    expect(admin.headers["x-robots-tag"]).toBe("noindex, nofollow");
    const brakes = await httpGet(`${base}/brakes`);
    expect(brakes.headers["x-robots-tag"]).toBeUndefined();
  });
});
