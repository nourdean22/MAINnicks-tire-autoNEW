/**
 * /tires/205-60r16 (2026-10-21).
 *
 * ChatGPT sent a customer in for 205/60R16 tires on 2026-10-21, and Bing had no
 * Nick's result for "cheap 205/60R16 tires installed Cleveland". The size had
 * no page. Pins: it is in TIRE_SIZE_PAGES, the generated route is in the
 * sitemap and prerender lists, and the committed prerendered HTML (what
 * crawlers and answer engines fetch) carries the page, not a shell or the
 * not-found branch. No per-size price: $89 is the site-wide floor.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { TIRE_SIZE_PAGES } from "../../shared/tireSizes";
import { PRERENDER_ROUTES, SITEMAP_ROUTES } from "../../shared/routes";

const entry = TIRE_SIZE_PAGES.find((p) => p.slug === "205-60r16");
const HTML_PATH = join(__dirname, "..", "..", "prerendered", "tires", "205-60r16", "index.html");

describe("205/60R16 size page", () => {
  it("is a TIRE_SIZE_PAGES entry in the house pattern", () => {
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      size: "205/60R16",
      category: "Sedan",
      metaTitle: "205/60R16 Tires Cleveland | New & Used | Nick's Tire & Auto",
    });
    expect(entry!.commonVehicles).toContain("Nissan Sentra");
    expect(entry!.commonVehicles.length).toBeLessThanOrEqual(4);
    expect(entry!.metaDescription).toBe(
      `Buy 205/60R16 tires in Cleveland. Fits ${entry!.commonVehicles.join(", ")}. New & used options. Free installation. Walk-ins welcome. (216) 862-0005`,
    );
    expect(`${entry!.metaTitle} ${entry!.metaDescription}`).not.toMatch(/\$/);
  });

  it("the generated route is in the sitemap and the prerender list", () => {
    expect(SITEMAP_ROUTES.map((r) => r.path)).toContain("/tires/205-60r16");
    expect(PRERENDER_ROUTES.map((r) => r.path)).toContain("/tires/205-60r16");
  });

  it("the committed prerendered HTML carries the page", () => {
    expect(existsSync(HTML_PATH)).toBe(true);
    const html = readFileSync(HTML_PATH, "utf8");
    const kb = statSync(HTML_PATH).size / 1024;
    expect(kb).toBeGreaterThan(80);
    expect(kb).toBeLessThan(130);
    expect(html).toContain("<title>205/60R16 Tires Cleveland | New &amp; Used | Nick's Tire &amp; Auto</title>");
    expect(html).toContain('<link rel="canonical" href="https://nickstire.org/tires/205-60r16"');
    expect(html).toMatch(/<h1[^>]*>[^<]*(?:<[^>]+>[^<]*)*205\/60R16/);
    expect(html).toMatch(/"@type":\s*"FAQPage"/);
    expect(html).toMatch(/"@type":\s*"Service"/);
    expect(html).not.toMatch(/isn.t on the wall/i);
    // No render-host or env leak. (The Meta pixel config URL carries domain=localhost in every
    // committed artifact, CI-rendered ones included, so a bare /localhost/ is not the signal.)
    expect(html).not.toMatch(/localhost:\d|127\.0\.0\.1|:4173|prerender-dummy|DATABASE_URL|mysql:\/\//);
    // The new-tire floor is a site-wide offer, never a price on this size.
    expect(html).not.toMatch(/205\/60R16[^.<]*\$89|\$89[^.<]*205\/60R16/);
  });
});
