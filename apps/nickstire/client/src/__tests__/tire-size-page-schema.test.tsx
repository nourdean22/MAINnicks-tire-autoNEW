/**
 * Tire-size page structured data — no price or stock claim this app cannot back.
 *
 * WHY (2026-09-17): all 30 /tires/:size routes emitted a byte-identical
 * `offers: AggregateOffer` — lowPrice "40", highPrice "200", offerCount "2",
 * availability InStock — derived from no feed, no per-size inventory and no
 * price lookup. Two defects, both on indexable URLs:
 *
 *   1. availability:InStock asserted stock that does not exist anywhere in
 *      this path. There is no Nick's-shop inventory in the codebase; even the
 *      /tires finder only ever sees the SUPPLIER's warehouse count, and its
 *      own catalog fallback already refuses to invent one
 *      (server/routers/gatewayTire.ts: `const inStock = false`, under the
 *      comment "Do not fabricate in-stock status"). The size pages
 *      contradicted that standard 30 times over.
 *   2. lowPrice "40" contradicted the visible FAQ on the very same page,
 *      which says used tires "start around $25-60 each". Google's
 *      structured-data policy requires markup to match what the user is
 *      shown; a price floor 60% above the visible one is the mismatch that
 *      draws a manual action.
 *
 * The prerendered snapshots are regenerated from this component, so this
 * render IS what Googlebot reads. This test fails if either claim returns.
 *
 * It does NOT forbid offers forever — it forbids UNBACKED ones. When real
 * per-size price/availability is wired to a source with a freshness
 * guarantee, this test is the thing to update, deliberately, alongside it.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { TIRE_SIZE_PAGES } from "@shared/tireSizes";

const PRERENDERED_TIRES = resolve(dirname(fileURLToPath(import.meta.url)), "../../../prerendered/tires");

const routeState = vi.hoisted(() => ({ slug: "" }));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children),
  Route: ({ children }: any) => React.createElement("div", null, children),
  Switch: ({ children }: any) => React.createElement("div", null, children),
  useLocation: () => [`/tires/${routeState.slug}`, vi.fn()],
  useRoute: () => [true, { size: routeState.slug }],
  useParams: () => ({ size: routeState.slug }),
  useSearch: () => "",
}));

vi.mock("framer-motion", () => ({
  motion: new Proxy({}, {
    get: (_t, prop) =>
      React.forwardRef((props: any, ref: any) => {
        const { initial, animate, exit, transition, whileInView, whileHover, whileTap, variants, viewport, layout, layoutId, ...rest } = props;
        return React.createElement(prop as string, { ...rest, ref });
      }),
  }),
  AnimatePresence: ({ children }: any) => React.createElement(React.Fragment, null, children),
  useInView: () => true,
  useAnimation: () => ({ start: vi.fn(), set: vi.fn() }),
  useScroll: () => ({ scrollYProgress: { get: () => 0 } }),
  useTransform: () => 0,
  useMotionValue: () => ({ get: () => 0, set: vi.fn() }),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: (_t, prop) => {
      if (prop === "useUtils" || prop === "useContext") {
        return () => new Proxy({}, { get: () => new Proxy({}, { get: () => ({ invalidate: vi.fn(), refetch: vi.fn() }) }) });
      }
      return new Proxy({}, {
        get: () => ({
          useQuery: () => ({ data: undefined, isLoading: false, error: null, refetch: vi.fn() }),
          useMutation: () => ({ mutate: vi.fn(), mutateAsync: vi.fn(), isPending: false }),
        }),
      });
    },
  }),
}));

type Node = Record<string, unknown>;

/** Every object reachable from the JSON-LD roots, depth-first. */
function walk(value: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(value)) value.forEach((v) => walk(v, out));
  else if (value && typeof value === "object") {
    out.push(value as Node);
    Object.values(value as Node).forEach((v) => walk(v, out));
  }
  return out;
}

const typeOf = (n: Node): string[] => ([] as unknown[]).concat(n["@type"] ?? []).map(String);

/** Keys that assert a price this template has no source for. */
const PRICE_KEYS = ["lowPrice", "highPrice", "price", "offerCount"] as const;

/**
 * The rules, as a pure function so the canary below can prove they bite.
 *
 * Deliberately scoped to the CLAIM, not the node type. `LocalBusinessSchema`
 * legitimately emits ~16 `hasOfferCatalog` → `Offer` nodes whose `itemOffered`
 * is a Service and which carry no price and no availability — naming a service
 * you perform is not a stock or price assertion, and banning the node type
 * outright fails every page for the wrong reason (first run of this test did
 * exactly that). What must never come back is an offer that asserts a NUMBER
 * or a STOCK STATE nothing in this codebase can source.
 */
function violations(roots: unknown[]): string[] {
  const out: string[] = [];
  for (const n of walk(roots)) {
    const types = typeOf(n);
    const label = types.join("/") || "node";
    if ("availability" in n) {
      out.push(`availability asserted on ${label} — no inventory source backs this`);
    }
    for (const k of PRICE_KEYS) {
      if (k in n) out.push(`${k} asserted on ${label} — no price source backs this`);
    }
  }
  return out;
}

describe("TireSizePage JSON-LD", () => {
  it("renders a real size with no unbacked price or availability claim", async () => {
    expect(TIRE_SIZE_PAGES.length).toBeGreaterThan(0);
    routeState.slug = TIRE_SIZE_PAGES[0].slug;
    const { default: TireSizePage } = await import("../pages/TireSizePage");
    const { container } = render(React.createElement(TireSizePage));

    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    expect(scripts.length, "size page emits JSON-LD").toBeGreaterThanOrEqual(1);
    const roots = scripts.map((s) => JSON.parse(s.textContent || "null"));

    // The legitimate wave-178 Service entity must survive the offers removal.
    const types = walk(roots).flatMap(typeOf);
    expect(types, "per-size Service entity still emitted").toContain("Service");

    expect(violations(roots)).toEqual([]);
  });

  it("every size page stays clean, not just the first", async () => {
    const { default: TireSizePage } = await import("../pages/TireSizePage");
    const offenders: string[] = [];
    for (const page of TIRE_SIZE_PAGES) {
      routeState.slug = page.slug;
      const { container, unmount } = render(React.createElement(TireSizePage));
      const roots = Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
        .map((s) => JSON.parse(s.textContent || "null"));
      const v = violations(roots);
      if (v.length) offenders.push(`${page.slug}: ${v.join("; ")}`);
      unmount();
    }
    expect(offenders).toEqual([]);
  });

  it("canary: the checker flags each removed shape", () => {
    const bad = [
      {
        "@type": "Service",
        offers: {
          "@type": "AggregateOffer",
          priceCurrency: "USD",
          lowPrice: "40",
          highPrice: "200",
          offerCount: "2",
          availability: "https://schema.org/InStock",
        },
      },
    ];
    const v = violations(bad);
    expect(v.some((m) => m.startsWith("availability asserted")), "availability rule bites").toBe(true);
    expect(v.some((m) => m.startsWith("lowPrice asserted")), "lowPrice rule bites").toBe(true);
    expect(v.some((m) => m.startsWith("highPrice asserted")), "highPrice rule bites").toBe(true);
    expect(v.some((m) => m.startsWith("offerCount asserted")), "offerCount rule bites").toBe(true);
  });

  /**
   * THE COMPONENT IS NOT WHAT GOOGLEBOT READS.
   *
   * Railway deploys do not regenerate prerendered/ (PRERENDER_ON_BUILD is off),
   * and the prerender middleware serves the COMMITTED
   * prerendered/tires/<size>/index.html to crawlers. So a render-only test can
   * be green while the unsupported claim is still crawler-visible — which is
   * exactly the state this PR opened in (30/30 snapshots still carried it).
   * Raised by review on #2404; this is the assertion that closes it.
   *
   * The committed artifact is refreshed by prerender-refresh.yml
   * (Mondays 08:00 UTC, or workflow_dispatch). Never by a local
   * `pnpm run regen` without GOOGLE_MAPS_API_KEY — that strips the live review
   * cards off /reviews.
   */
  it("the committed crawler snapshots carry no unbacked price or availability claim", () => {
    const missing: string[] = [];
    const offenders: string[] = [];

    for (const page of TIRE_SIZE_PAGES) {
      const file = resolve(PRERENDERED_TIRES, page.slug, "index.html");
      if (!existsSync(file)) {
        missing.push(page.slug);
        continue;
      }
      const html = readFileSync(file, "utf8");
      const hits: string[] = [];
      // Scoped to the JSON-LD claim shape, not to prose. "InStock" as a
      // schema.org URL, and price keys as JSON-LD properties.
      if (/schema\.org\/InStock/.test(html)) hits.push("availability InStock");
      if (/"lowPrice"\s*:/.test(html)) hits.push("lowPrice");
      if (/"highPrice"\s*:/.test(html)) hits.push("highPrice");
      if (/"offerCount"\s*:/.test(html)) hits.push("offerCount");
      if (hits.length) offenders.push(`${page.slug}: ${hits.join(", ")}`);
    }

    expect(missing, "every size page has a committed snapshot").toEqual([]);
    expect(offenders).toEqual([]);
  });

  it("canary: the snapshot scanner detects the exact block that shipped", () => {
    // The literal JSON-LD fragment found in all 30 snapshots before the regen.
    const shipped =
      '{"@type":"AggregateOffer","priceCurrency":"USD","lowPrice":"40","highPrice":"200",' +
      '"offerCount":"2","availability":"https://schema.org/InStock"}';
    expect(/schema\.org\/InStock/.test(shipped)).toBe(true);
    expect(/"lowPrice"\s*:/.test(shipped)).toBe(true);
    expect(/"highPrice"\s*:/.test(shipped)).toBe(true);
    expect(/"offerCount"\s*:/.test(shipped)).toBe(true);
    // And a clean snapshot must not trip it.
    const clean = '{"@type":"Service","name":"205/55R16 Tire Sales & Installation"}';
    expect(/schema\.org\/InStock|"lowPrice"\s*:|"highPrice"\s*:|"offerCount"\s*:/.test(clean)).toBe(false);
  });

  it("canary: a clean Service node, and a priceless service-catalog Offer, produce no violations", () => {
    const good = [
      {
        "@type": "Service",
        name: "205/55R16 Tire Sales & Installation",
        provider: { "@type": "AutoRepair", "@id": "https://nickstire.org/#localbusiness" },
      },
      // The shape LocalBusinessSchema really emits — naming a service you
      // perform, with no price and no stock state. Must stay legal.
      {
        "@type": "Offer",
        itemOffered: { "@type": "Service", name: "Tire Installation" },
      },
    ];
    expect(violations(good)).toEqual([]);
  });
});
