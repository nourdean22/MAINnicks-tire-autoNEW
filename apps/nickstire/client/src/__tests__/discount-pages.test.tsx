/**
 * /discounts and /discounts/:slug: search pages for groups that look for a
 * discount (military, first responders, students, seniors, gig drivers and
 * more), added 2026-10-29 on Nour's ask.
 *
 * What this pins:
 *   1. Every page is wired: registry, sitemap, prerender, dynamic prefix.
 *   2. Every page is its own page. Google's spam policy names "substantially
 *      similar pages" as doorway abuse, so no two audience pages may share
 *      more than a small slice of their body text.
 *   3. What the page says is what the counter honors: the offer, the proof
 *      and the fine print render from DISCOUNT_PROGRAMS, and the JSON-LD says
 *      the same thing the visible page says.
 *   4. The LGBTQ+ page carries no price (no orientation-based price).
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { BUSINESS, DISCOUNT_PROGRAMS } from "@shared/business";
import { DISCOUNT_PAGES, buildDiscountFaqs, getDiscountGroup, type DiscountPageContent } from "@shared/discountPages";

/** A page's own words: everything except the shared shell and the terms. */
function discountPageText(page: DiscountPageContent): string {
  return [
    page.intro,
    ...page.sections.flatMap((s) => [s.heading, s.body]),
    ...page.faqs.flatMap((f) => [f.q, f.a]),
  ].join(" ");
}
import { SITEMAP_ROUTES, PRERENDER_ROUTES, DYNAMIC_ROUTE_PREFIXES, getRouteByPath } from "@shared/routes";

const routeState = vi.hoisted(() => ({ slug: "" }));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children),
  Route: ({ children }: any) => React.createElement("div", null, children),
  Switch: ({ children }: any) => React.createElement("div", null, children),
  useLocation: () => [`/discounts/${routeState.slug}`, vi.fn()],
  useRoute: () => [true, { slug: routeState.slug }],
  useParams: () => ({ slug: routeState.slug }),
  useSearch: () => "",
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
function walk(value: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(value)) value.forEach((v) => walk(v, out));
  else if (value && typeof value === "object") {
    out.push(value as Node);
    Object.values(value as Node).forEach((v) => walk(v, out));
  }
  return out;
}
const typesOf = (n: Node): string[] => ([] as unknown[]).concat(n["@type"] ?? []).map(String);
const jsonLd = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('script[type="application/ld+json"]')).map((s) => JSON.parse(s.textContent || "null"));

/** Share of word 3-grams two texts have in common (Jaccard). 1 = identical. */
function overlap(a: string, b: string): number {
  const grams = (t: string) => {
    const w = t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
    const s = new Set<string>();
    for (let i = 0; i + 2 < w.length; i++) s.add(`${w[i]} ${w[i + 1]} ${w[i + 2]}`);
    return s;
  };
  const A = grams(a), B = grams(b);
  let both = 0;
  for (const g of A) if (B.has(g)) both++;
  return both / (A.size + B.size - both || 1);
}
const MAX_OVERLAP = 0.15;

describe("discount pages are wired into the site", () => {
  it("every program has exactly one page and every page has a program", () => {
    expect(DISCOUNT_PROGRAMS.groups.length).toBeGreaterThanOrEqual(8);
    expect(DISCOUNT_PAGES.map((p) => p.groupId).sort()).toEqual(DISCOUNT_PROGRAMS.groups.map((g) => g.id).sort());
  });

  it("the hub and every page are in the sitemap and the prerender list", () => {
    const sitemap = new Set(SITEMAP_ROUTES.map((r) => r.path));
    const prerender = new Set(PRERENDER_ROUTES.map((r) => r.path));
    for (const path of ["/discounts", ...DISCOUNT_PAGES.map((p) => `/discounts/${p.slug}`)]) {
      expect(sitemap.has(path), `${path} in sitemap`).toBe(true);
      expect(prerender.has(path), `${path} prerendered`).toBe(true);
    }
    expect(DYNAMIC_ROUTE_PREFIXES).toContain("/discounts/");
  });

  it("the committed prerendered pages (what Googlebot reads) carry the current terms", () => {
    const dir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../prerendered/discounts");
    for (const p of [{ slug: "", offer: true }, ...DISCOUNT_PAGES.map((d) => ({ slug: d.slug, offer: getDiscountGroup(d.groupId)!.offer }))]) {
      const file = resolve(dir, p.slug, "index.html");
      expect(existsSync(file), `${file} exists`).toBe(true);
      const html = readFileSync(file, "utf8");
      if (p.offer) expect(html.includes(DISCOUNT_PROGRAMS.offer.display), `/discounts/${p.slug} shows "${DISCOUNT_PROGRAMS.offer.display}"`).toBe(true);
      else expect(/\d+\s?% off/i.test(html), `/discounts/${p.slug} states no percent off`).toBe(false);
    }
  });

  it("every related link on a page points at a real registered page", () => {
    for (const p of DISCOUNT_PAGES) {
      for (const r of p.related) expect(getRouteByPath(r.href.split("#")[0]), `${p.slug} -> ${r.href}`).toBeTruthy();
    }
  });

  it("titles and descriptions fit the SERP and carry no em dash", () => {
    for (const p of DISCOUNT_PAGES) {
      const r = getRouteByPath(`/discounts/${p.slug}`)!;
      expect(r.title, p.slug).toBe(p.metaTitle);
      expect(p.metaTitle.length, `${p.slug} title`).toBeLessThanOrEqual(60);
      expect(p.metaDescription.length, `${p.slug} description`).toBeLessThanOrEqual(160);
      expect(`${p.metaTitle} ${p.metaDescription} ${discountPageText(p)}`, p.slug).not.toMatch(/—/);
    }
  });
});

describe("no two discount pages are near-duplicates (doorway rule)", () => {
  it("canary: the overlap measure scores a copy as 1 and unrelated text near 0", () => {
    const t = discountPageText(DISCOUNT_PAGES[0]);
    expect(overlap(t, t)).toBe(1);
    expect(overlap(t, "completely different words about something else entirely here")).toBeLessThan(0.05);
  });

  it(`every pair shares under ${MAX_OVERLAP * 100}% of its word 3-grams`, () => {
    const offenders: string[] = [];
    for (let i = 0; i < DISCOUNT_PAGES.length; i++) {
      for (let j = i + 1; j < DISCOUNT_PAGES.length; j++) {
        const o = overlap(discountPageText(DISCOUNT_PAGES[i]), discountPageText(DISCOUNT_PAGES[j]));
        if (o >= MAX_OVERLAP) offenders.push(`${DISCOUNT_PAGES[i].slug} ~ ${DISCOUNT_PAGES[j].slug}: ${o.toFixed(2)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("every page has its own words: at least 250 of them, and its own FAQ", () => {
    for (const p of DISCOUNT_PAGES) {
      expect(discountPageText(p).split(/\s+/).length, p.slug).toBeGreaterThanOrEqual(250);
      expect(p.faqs.length, p.slug).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("copy rules a counter or a lawyer would care about", () => {
  const all = DISCOUNT_PAGES.map((p) => `${p.metaTitle} ${p.metaDescription} ${discountPageText(p)}`).join("\n");

  it('never "old people"', () => {
    expect(all).not.toMatch(/\bold (?:people|folks|timers?)\b/i);
  });

  it("gig-app brands only describe the drivers: no partner, official or sponsored wording", () => {
    const BRAND = /\b(?:doordash|uber|lyft|grubhub|instacart|amazon flex)\b[^.\n]{0,40}\b(?:partner|official|sponsored|approved|endorsed|affiliate)/i;
    expect("Uber official partner shop").toMatch(BRAND);
    expect(all).not.toMatch(BRAND);
  });
});

describe("each page renders the shop's real facts and the configured offer", () => {
  it("renders every page with its h1, address, hours, phone, offer, proof and matching JSON-LD", async () => {
    const { default: DiscountPage } = await import("../pages/DiscountPage");
    for (const page of DISCOUNT_PAGES) {
      routeState.slug = page.slug;
      const group = getDiscountGroup(page.groupId)!;
      const { container, unmount } = render(React.createElement(DiscountPage));
      const text = container.textContent ?? "";

      expect(container.querySelector("h1")?.textContent, page.slug).toBe(page.h1);
      expect(text, page.slug).toContain(BUSINESS.address.full);
      expect(text, page.slug).toContain(BUSINESS.hours.display);
      expect(text, page.slug).toContain(BUSINESS.phone.display);
      const hrefs = Array.from(container.querySelectorAll("a")).map((a) => a.getAttribute("href"));
      expect(hrefs, `${page.slug} directions`).toContain(BUSINESS.urls.googleMapsDirections);

      const roots = jsonLd(container);
      const nodes = walk(roots);
      const faq = nodes.find((n) => typesOf(n).includes("FAQPage"))!;
      expect(faq, `${page.slug} FAQPage`).toBeTruthy();
      const faqs = buildDiscountFaqs(page);
      expect((faq.mainEntity as Node[]).map((q) => q.name), page.slug).toEqual(faqs.map((f) => f.q));
      for (const f of faqs) expect(text, `${page.slug} visible FAQ`).toContain(f.a);

      // The shop-wide LocalBusiness schema also emits Offer nodes (its service
      // catalog); the discount Offer is the one aimed at an Audience.
      const audienceOf = (n: Node) => ((n.itemOffered as Node | undefined)?.audience as Node | undefined);
      const offers = nodes.filter((n) => typesOf(n).includes("Offer") && audienceOf(n) !== undefined);
      if (group.offer) {
        expect(text, page.slug).toContain(DISCOUNT_PROGRAMS.offer.display);
        expect(text, page.slug).toContain(group.qualifies);
        for (const proof of group.proof) expect(text, `${page.slug} proof`).toContain(proof);
        for (const line of DISCOUNT_PROGRAMS.offer.finePrint) expect(text, `${page.slug} fine print`).toContain(line);
        expect(offers.length, `${page.slug} Offer node`).toBe(1);
        expect(offers[0].description).toBe(DISCOUNT_PROGRAMS.offer.display);
        expect(audienceOf(offers[0])!.audienceType).toBe(group.qualifies);
      } else {
        expect(text, page.slug).not.toContain(DISCOUNT_PROGRAMS.offer.display);
        expect(text, page.slug).not.toMatch(/\d+\s?% off/i);
        expect(offers, `${page.slug} has no Offer`).toEqual([]);
      }
      unmount();
    }
  });

  it("the hub links every audience page and states the offer once from config", async () => {
    const { default: DiscountsHub } = await import("../pages/DiscountsHub");
    const { container } = render(React.createElement(DiscountsHub));
    for (const p of DISCOUNT_PAGES) {
      expect(container.querySelector(`a[href="/discounts/${p.slug}"]`), p.slug).not.toBeNull();
    }
    expect(container.textContent).toContain(DISCOUNT_PROGRAMS.offer.display);
    expect(container.querySelector("h1")).not.toBeNull();
  });

  it("an unknown slug renders a not-found with a way back to the hub", async () => {
    const { default: DiscountPage } = await import("../pages/DiscountPage");
    routeState.slug = "no-such-group";
    const { container } = render(React.createElement(DiscountPage));
    expect(container.textContent).toMatch(/not a page we have/i);
    expect(container.querySelector('a[href="/discounts"]')).not.toBeNull();
  });
});
