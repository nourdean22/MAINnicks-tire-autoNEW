import { describe, expect, it, beforeAll } from "vitest";

/**
 * Sitemap & Robots.txt structural tests.
 * Validates route definitions and SEO data without needing a running server.
 */

let SITEMAP_ROUTES: Array<{ path: string; [key: string]: unknown }> = [];

beforeAll(async () => {
  const mod = await import("../shared/routes");
  SITEMAP_ROUTES = mod.SITEMAP_ROUTES || [];
});

describe("sitemap routes", () => {
  it("has public routes defined", () => {
    expect(SITEMAP_ROUTES.length).toBeGreaterThan(10);
  });

  it("includes homepage", () => {
    const paths = SITEMAP_ROUTES.map(r => r.path);
    expect(paths).toContain("/");
  });

  it("includes core service pages", () => {
    const paths = SITEMAP_ROUTES.map(r => r.path);
    expect(paths).toContain("/tires");
    expect(paths).toContain("/brakes");
    expect(paths).toContain("/contact");
  });

  it("does not include admin pages", () => {
    const paths = SITEMAP_ROUTES.map(r => r.path);
    const adminPaths = paths.filter(p => p.includes("/admin"));
    expect(adminPaths).toHaveLength(0);
  });

  it("all routes have valid path format", () => {
    for (const route of SITEMAP_ROUTES) {
      expect(route.path).toMatch(/^\//);
    }
  });
});

describe("robots.txt structure", () => {
  it("index.ts contains robots.txt handler", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/_core/index.ts", "utf8");
    expect(content).toContain("robots.txt");
  });
});

/**
 * <lastmod> is emitted ONLY where a real date exists.
 *
 * THE RULE THIS SITS INSIDE (server/_core/index.ts, 2026-09-07): every sitemap
 * entry used to carry `new Date()` at request time, so 100+ URLs claimed a
 * change every single day. Google ignores lastmod once it is consistently
 * wrong, so the tag was costing trust and buying nothing, and it was removed
 * from static routes.
 *
 * Job leaf pages are the one exception, because they are the one static route
 * with a date the server actually knows: shared/jobOpenings.ts carries
 * `datePosted`, and its own comment records that Google's job-posting content
 * policy BANS resetting it when nothing about the role changed. That is exactly
 * the "last significant change" semantic lastmod asks for.
 *
 * The second test is the one that matters: an exception that quietly widened
 * back to every route would restore the original defect, and the first test
 * alone would still pass.
 */
describe("sitemap lastmod is real, never a request-time date", () => {
  it("open job pages carry a lastmod taken from datePosted", async () => {
    const { JOB_OPENINGS } = await import("../shared/jobOpenings");
    const open = JOB_OPENINGS.filter((j) => j.status === "open");
    expect(open.length, "no open roles - this assertion would be vacuous").toBeGreaterThan(0);
    for (const j of open) {
      expect(j.datePosted, `${j.slug} has no datePosted to emit`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8"),
    );
    expect(src).toContain("jobLastmod");
    expect(src, "the map must be keyed by the same /careers/<slug> path the loc uses").toContain(
      "jobLastmod.set(`/careers/${j.slug}`",
    );
    expect(src, "closed roles are 404 and must never be advertised").toContain('j.status !== "open"');

    // THE ASSERTION THAT MATTERS, added after the first version of this test
    // passed with the emission DELETED. Building the map and never emitting it
    // is precisely the producer-with-no-consumer shape - the map existed, the
    // dates were right, and the sitemap carried none of them. Assert the value
    // reaches the XML, not merely that it was computed.
    expect(src, "the map must be READ into the <url> entry, not just built").toContain(
      "sitemapLastmod(jobLastmod.get(p.path))",
    );
  });

  it("the static-route branch still emits NO request-time date", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./_core/index.ts", import.meta.url), "utf8"),
    );
    // The defect being guarded: a `new Date()` anywhere in the lastmod path.
    const lastmodHelper = src.slice(src.indexOf("const sitemapLastmod"), src.indexOf("const sitemapLastmod") + 400);
    expect(lastmodHelper, "lastmod must come from a supplied Date, never from now()").not.toContain("new Date()");
  });
});
