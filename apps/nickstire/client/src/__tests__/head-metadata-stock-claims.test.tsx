/**
 * Head metadata must not claim stock this app cannot back.
 *
 * WHY (2026-09-17): #2404 removed a fabricated `AggregateOffer`
 * (availability:InStock) from the 30 /tires/:size components and shipped.
 * It missed the surface Google actually PRINTS: the <title> tag. All 30
 * routes kept serving
 *
 *     <title>225/55R18 Tires Cleveland | In Stock | Nick's Tire & Auto</title>
 *
 * plus "New & used in stock." in <meta name="description">. Those strings
 * never pass through the React component — `scripts/prerender.mjs:61` reads
 * `PRERENDER_ROUTES` from `shared/routes.ts`, which maps them straight off
 * the static `TIRE_SIZE_PAGES` table in `shared/tireSizes.ts` (untouched
 * since 2026-07-12). So a component-level fix could never reach them.
 *
 * The standard was already written down and being violated:
 * `server/routers/gatewayTire.ts` sets `const inStock = false` under the
 * comment "Do not fabricate in-stock status" — there is no Nick's-shop
 * inventory anywhere in this codebase; the /tires finder only ever sees the
 * SUPPLIER's warehouse count.
 *
 * `pnpm run verify` was green through all of it: `lint:brand-voice` scans
 * copy, not <title>, and nothing at all reads the tireSizes metadata table.
 * This test is that missing gate.
 *
 * It forbids UNBACKED stock claims, not the concept. When real per-size
 * availability is wired to a source with a freshness guarantee, update this
 * test deliberately, alongside it.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join, sep } from "node:path";
import { TIRE_SIZE_PAGES, buildTireSizeMetaDescription } from "@shared/tireSizes";
import { PRERENDER_ROUTES } from "@shared/routes";

const APP_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const PRERENDERED = join(APP_ROOT, "prerendered");

/**
 * Matches an assertion that a thing is ON HAND. Deliberately narrow:
 * "available", "we carry", "special order" and "distributor feed" all stay
 * legal — they describe sourcing, which this app CAN back. Only possession
 * is banned.
 */
const STOCK_CLAIM = /\b(in[-\s]stock|stocked|on the shelf|in our warehouse)\b/i;

const decode = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();

/** Every committed prerender snapshot, as { route, title, description }. */
function readPrerenderedHeads(): { route: string; title: string; description: string }[] {
  const out: { route: string; title: string; description: string }[] = [];
  if (!existsSync(PRERENDERED)) return out;

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(p);
        continue;
      }
      if (entry.name !== "index.html") continue;
      const html = readFileSync(p, "utf8");
      const headEnd = html.indexOf("</head>");
      if (headEnd === -1) continue;
      const head = html.slice(0, headEnd);
      out.push({
        route: "/" + p.slice(PRERENDERED.length + 1).split(sep).slice(0, -1).join("/"),
        title: decode((head.match(/<title>([\s\S]*?)<\/title>/) || [])[1] ?? ""),
        description: decode(
          (head.match(/<meta\s+name="description"\s+content="([^"]*)"/) || [])[1] ?? "",
        ),
      });
    }
  };
  walk(PRERENDERED);
  return out;
}

describe("head metadata — no unbacked stock claims", () => {
  it("canary: the matcher catches the exact strings that shipped, and clears the fixes", () => {
    // Positive controls — every one of these was live on 2026-09-17.
    expect(STOCK_CLAIM.test("225/55R18 Tires Cleveland | In Stock | Nick's Tire & Auto")).toBe(true);
    expect(STOCK_CLAIM.test("New & used in stock. Free installation.")).toBe(true);
    expect(STOCK_CLAIM.test("Akron-based brand, full lineup stocked.")).toBe(true);
    expect(STOCK_CLAIM.test("Tire Prices Cleveland — Live In-Stock Pricing | Nick's")).toBe(true);
    expect(STOCK_CLAIM.test("Premium brands stocked, same-day fitment.")).toBe(true);

    // Negative controls — sourcing language must stay legal, or the rule is
    // useless: it would force vaguer copy rather than truer copy.
    expect(STOCK_CLAIM.test("225/55R18 Tires Cleveland | New & Used | Nick's Tire & Auto")).toBe(false);
    expect(STOCK_CLAIM.test("New & used options. Free installation.")).toBe(false);
    expect(STOCK_CLAIM.test("Akron-based brand, full lineup available.")).toBe(false);
    expect(STOCK_CLAIM.test("Full lineup available to order.")).toBe(false);
    expect(STOCK_CLAIM.test("Real tire prices from our live distributor feed.")).toBe(false);
  });

  it("no TIRE_SIZE_PAGES entry claims stock in its title or description", () => {
    expect(TIRE_SIZE_PAGES.length).toBeGreaterThan(0);
    const offenders = TIRE_SIZE_PAGES.flatMap((p) => [
      STOCK_CLAIM.test(p.metaTitle) ? `${p.slug} metaTitle: ${p.metaTitle}` : null,
      STOCK_CLAIM.test(p.metaDescription) ? `${p.slug} metaDescription: ${p.metaDescription}` : null,
    ]).filter(Boolean);
    expect(offenders).toEqual([]);
  });

  it("buildTireSizeMetaDescription never emits a stock claim, for any category", () => {
    const offenders = TIRE_SIZE_PAGES.map((p) => {
      const d = buildTireSizeMetaDescription(p);
      return STOCK_CLAIM.test(d) ? `${p.slug} (${p.category}): ${d}` : null;
    }).filter(Boolean);
    // Every category branch must be exercised, or a clean run proves nothing.
    expect(new Set(TIRE_SIZE_PAGES.map((p) => p.category)).size).toBeGreaterThan(1);
    expect(offenders).toEqual([]);
  });

  it("no route in PRERENDER_ROUTES carries a stock claim in its SEO title or description", () => {
    expect(PRERENDER_ROUTES.length).toBeGreaterThan(0);
    const offenders = PRERENDER_ROUTES.flatMap((r: { path: string; title?: string; description?: string }) => [
      r.title && STOCK_CLAIM.test(r.title) ? `${r.path} title: ${r.title}` : null,
      r.description && STOCK_CLAIM.test(r.description) ? `${r.path} description: ${r.description}` : null,
    ]).filter(Boolean);
    expect(offenders).toEqual([]);
  });

  /**
   * The drift-catcher. Source and served HTML can disagree — that is defect
   * class #2094/#2098, and it is exactly how this one hid: the component was
   * clean while 30 committed snapshots carried the claim. A source-only gate
   * would have stayed green through the whole incident.
   *
   * If this is the only red one, the source is fixed and the committed
   * snapshots are stale: refresh them via the `prerender-refresh.yml`
   * workflow_dispatch (NOT a local `pnpm run regen` — that runs without
   * GOOGLE_MAPS_API_KEY and strips the live review cards off /reviews).
   */
  it("no committed prerender snapshot serves a stock claim in <title> or <meta description>", () => {
    const heads = readPrerenderedHeads();
    expect(heads.length, "prerender tree is present and readable").toBeGreaterThan(100);

    const offenders = heads.flatMap((h) => [
      STOCK_CLAIM.test(h.title) ? `${h.route} <title>: ${h.title}` : null,
      STOCK_CLAIM.test(h.description) ? `${h.route} <meta description>: ${h.description}` : null,
    ]).filter(Boolean);

    expect(offenders).toEqual([]);
  });
});
