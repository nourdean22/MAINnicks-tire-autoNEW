import { describe, expect, it } from "vitest";

/**
 * Tests for the sitemap.xml and robots.txt server endpoints.
 * These validate the endpoint responses via HTTP since they are Express routes
 * (not tRPC procedures).
 */

const BASE = `http://localhost:${process.env.PORT || 3000}`;

describe("sitemap.xml endpoint", () => {
  it("returns valid XML with correct content type", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("application/xml");
    const body = await res.text();
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain("<urlset");
    expect(body).toContain("</urlset>");
  });

  it("includes the homepage with highest priority", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const body = await res.text();
    expect(body).toContain("<loc>https://nickstire.org/</loc>");
    expect(body).toContain("<priority>1.0</priority>");
  });

  it("includes all six service pages", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const body = await res.text();
    expect(body).toContain("<loc>https://nickstire.org/tires</loc>");
    expect(body).toContain("<loc>https://nickstire.org/brakes</loc>");
    expect(body).toContain("<loc>https://nickstire.org/diagnostics</loc>");
    expect(body).toContain("<loc>https://nickstire.org/emissions</loc>");
    expect(body).toContain("<loc>https://nickstire.org/oil-change</loc>");
    expect(body).toContain("<loc>https://nickstire.org/general-repair</loc>");
  });

  it("includes the /about and /contact pages", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const body = await res.text();
    expect(body).toContain("<loc>https://nickstire.org/about</loc>");
    expect(body).toContain("<loc>https://nickstire.org/contact</loc>");
  });

  it("includes the /blog index page", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const body = await res.text();
    expect(body).toContain("<loc>https://nickstire.org/blog</loc>");
  });

  it("includes hardcoded blog article URLs", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const body = await res.text();
    expect(body).toContain("<loc>https://nickstire.org/blog/5-signs-brakes-need-replacing</loc>");
    expect(body).toContain("<loc>https://nickstire.org/blog/check-engine-light-common-causes</loc>");
    expect(body).toContain("<loc>https://nickstire.org/blog/ohio-echeck-what-to-know</loc>");
  });

  it("includes changefreq and priority for all URLs", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const body = await res.text();
    // Every <url> block should have changefreq and priority
    const urlBlocks = body.match(/<url>[\s\S]*?<\/url>/g) || [];
    expect(urlBlocks.length).toBeGreaterThan(0);
    for (const block of urlBlocks) {
      expect(block).toContain("<changefreq>");
      expect(block).toContain("<priority>");
    }
  });

  it("does not include admin pages", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const body = await res.text();
    expect(body).not.toContain("/admin");
  });

  it("uses YYYY-MM-DD date format for lastmod", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const body = await res.text();
    const dateMatch = body.match(/<lastmod>(\d{4}-\d{2}-\d{2})<\/lastmod>/);
    expect(dateMatch).not.toBeNull();
  });
});

describe("robots.txt endpoint", () => {
  it("returns valid robots.txt with correct content type", async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("User-agent: *");
  });

  it("allows all public pages", async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    const body = await res.text();
    expect(body).toContain("Allow: /");
  });

  it("disallows admin and API routes", async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    const body = await res.text();
    expect(body).toContain("Disallow: /admin");
    expect(body).toContain("Disallow: /api/");
  });

  it("references the sitemap URL", async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    const body = await res.text();
    expect(body).toContain("Sitemap: https://nickstire.org/sitemap.xml");
  });
});
