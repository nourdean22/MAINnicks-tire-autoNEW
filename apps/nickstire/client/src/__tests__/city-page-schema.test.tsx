/**
 * City page structured data — what a crawler is allowed to find.
 *
 * WHY (2026-09-07): every one of the 14+ city pages carried (a) a FAQPage
 * block whose questions were never rendered on the page — invisible markup,
 * a manual-action risk; (b) a self-serving aggregateRating on a
 * business-owned AutoRepair node, TWICE (the node and the Service.provider),
 * ineligible for rich results and a spam signal; (c) a full duplicate of the
 * business entity instead of a reference to the home page's canonical
 * `#localbusiness` @id. All three were removed in #2173. The prerendered
 * snapshots are regenerated from this component, so this render IS what
 * Googlebot reads. This test fails if any of the three come back.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { CITIES } from "@shared/cities";

// vi.mock factories are hoisted above imports; a hoisted holder lets the test
// pick a real slug at run time instead of hard-coding one that may be renamed.
const routeState = vi.hoisted(() => ({ slug: "" }));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children),
  Route: ({ children }: any) => React.createElement("div", null, children),
  Switch: ({ children }: any) => React.createElement("div", null, children),
  useLocation: () => [`/${routeState.slug}`, vi.fn()],
  useRoute: () => [true, { slug: routeState.slug }],
  useParams: () => ({ slug: routeState.slug }),
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

/** The rules, as a pure function so the canary below can prove they bite. */
function violations(roots: unknown[]): string[] {
  const nodes = walk(roots);
  const out: string[] = [];
  for (const n of nodes) {
    const types = typeOf(n);
    if (types.includes("FAQPage")) out.push("FAQPage block present (questions not rendered on the page)");
    if ("aggregateRating" in n) out.push(`aggregateRating on ${types.join("/") || "node"} (self-serving, ineligible)`);
    if (types.some((t) => t === "AutoRepair" || t === "LocalBusiness")) {
      const id = String(n["@id"] ?? "");
      if (!id.endsWith("#localbusiness")) out.push(`business node @id is "${id || "(missing)"}", expected …#localbusiness`);
    }
    if (types.includes("Service")) {
      // A reference may carry a type and a display name; it must NOT carry the
      // entity body (address, telephone, rating…) — that is the duplicate the
      // fix removed — and it must point at the canonical @id.
      const provider = n["provider"] as Node | undefined;
      const keys = provider ? Object.keys(provider) : [];
      const allowed = new Set(["@type", "@id", "name"]);
      const extra = keys.filter((k) => !allowed.has(k));
      const id = String(provider?.["@id"] ?? "");
      if (!provider || extra.length > 0 || !id.endsWith("#localbusiness")) {
        out.push(`Service.provider must be an @id reference (type/name allowed), got keys [${keys.join(",")}] id "${id}"`);
      }
    }
  }
  return out;
}

describe("CityPage JSON-LD", () => {
  it("renders a real city with no FAQPage, no aggregateRating, and @id references only", async () => {
    expect(CITIES.length).toBeGreaterThan(0);
    routeState.slug = CITIES[0].slug;
    const { default: CityPage } = await import("../pages/CityPage");
    const { container } = render(React.createElement(CityPage));

    const scripts = Array.from(container.querySelectorAll('script[type="application/ld+json"]'));
    expect(scripts.length, "city page emits JSON-LD").toBeGreaterThanOrEqual(2);
    const roots = scripts.map((s) => JSON.parse(s.textContent || "null"));

    const types = walk(roots).flatMap(typeOf);
    expect(types).toContain("AutoRepair");
    expect(types).toContain("Service");
    expect(violations(roots)).toEqual([]);
  });

  it("canary: the checker flags each of the three removed shapes", () => {
    const bad = [
      { "@type": "FAQPage", mainEntity: [] },
      { "@type": "AutoRepair", "@id": "https://nickstire.org/parma", aggregateRating: { ratingValue: 4.9 } },
      { "@type": "Service", provider: { "@type": "AutoRepair", name: "Nick's", aggregateRating: {} } },
    ];
    const v = violations(bad);
    expect(v.some((m) => m.startsWith("FAQPage"))).toBe(true);
    expect(v.filter((m) => m.startsWith("aggregateRating")).length).toBe(2);
    expect(v.some((m) => m.startsWith("business node @id"))).toBe(true);
    expect(v.some((m) => m.startsWith("Service.provider"))).toBe(true);
  });
});
