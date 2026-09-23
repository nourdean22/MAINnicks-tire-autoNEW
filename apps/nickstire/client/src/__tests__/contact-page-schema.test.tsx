/**
 * /contact structured data — one business entity, and no rating it can't show.
 *
 * WHY (2026-09-17): Contact.tsx hand-rolled its own `ContactSchema`, emitting
 * a SECOND AutoRepair node with no `@id` and `url: .../contact` — so /contact
 * described a different entity than every other page's canonical
 * `…/#localbusiness` instead of referencing it. The same duplicate-entity
 * defect #2173 removed from the city pages.
 *
 * It also carried its own aggregateRating built from the LIVE review query and
 * stringified (ratingValue "4.9", reviewCount "1711", no worstRating), which
 * produced three problems at once: it disagreed with the homepage's node for
 * the same business (1700 vs 1711 vs the 1,712+ in visible copy, all confirmed
 * live); schema.org expects Number there; and /contact renders NO reviews, so
 * emitting a rating there is the self-serving-review manual-action risk that
 * LocalBusinessSchema's own comment already warns about.
 *
 * Replaced by the shared <LocalBusinessSchema />, which defaults
 * includeReviews=false. This test fails if either shape returns.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: any) => React.createElement("a", { href, ...props }, children),
  Route: ({ children }: any) => React.createElement("div", null, children),
  Switch: ({ children }: any) => React.createElement("div", null, children),
  useLocation: () => ["/contact", vi.fn()],
  useRoute: () => [true, {}],
  useParams: () => ({}),
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
          // A LIVE-looking payload on purpose: if anything on this page starts
          // feeding these numbers into JSON-LD again, the rules below catch it.
          useQuery: () => ({ data: { rating: 4.9, totalReviews: 1711 }, isLoading: false, error: null, refetch: vi.fn() }),
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

const typeOf = (n: Node): string[] => ([] as unknown[]).concat(n["@type"] ?? []).map(String);

const isBusiness = (n: Node) =>
  typeOf(n).some((t) => t === "AutoRepair" || t === "TireShop" || t === "LocalBusiness");

/** The rules, pure so the canaries can prove they bite. */
function violations(roots: unknown[]): string[] {
  const out: string[] = [];
  const businesses = walk(roots).filter(isBusiness);

  if (businesses.length !== 1) {
    out.push(`expected exactly 1 business node, found ${businesses.length}`);
  }
  for (const b of businesses) {
    const id = String(b["@id"] ?? "");
    if (!id.endsWith("#localbusiness")) {
      out.push(`business node @id is "${id || "(missing)"}", expected …#localbusiness`);
    }
    if ("aggregateRating" in b) {
      out.push("aggregateRating on /contact — no reviews are rendered on this page");
    }
  }
  return out;
}

describe("Contact page JSON-LD", () => {
  it("emits one canonical business entity and no rating", async () => {
    const { default: Contact } = await import("../pages/Contact");
    const { container } = render(React.createElement(Contact));
    const roots = Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
      .map((s) => JSON.parse(s.textContent || "null"));

    expect(roots.length, "contact page emits JSON-LD").toBeGreaterThanOrEqual(1);
    expect(walk(roots).filter(isBusiness).length, "exactly one business node").toBe(1);
    expect(violations(roots)).toEqual([]);
  });

  it("canary: the checker flags the exact shape that shipped", () => {
    const shipped = [
      {
        "@type": "AutoRepair",
        name: "Nick's Tire & Auto",
        url: "https://nickstire.org/contact",
        aggregateRating: {
          "@type": "AggregateRating",
          ratingValue: "4.9",
          reviewCount: "1711",
          bestRating: "5",
        },
      },
    ];
    const v = violations(shipped);
    expect(v.some((m) => m.startsWith("business node @id")), "missing @id caught").toBe(true);
    expect(v.some((m) => m.startsWith("aggregateRating on /contact")), "rating caught").toBe(true);
  });

  it("canary: two business nodes are caught even if both are well-formed", () => {
    const twice = [
      { "@type": "AutoRepair", "@id": "https://nickstire.org/#localbusiness" },
      { "@type": "AutoRepair", "@id": "https://nickstire.org/#localbusiness" },
    ];
    expect(violations(twice).some((m) => m.startsWith("expected exactly 1 business node"))).toBe(true);
  });

  it("canary: a single canonical node with no rating passes", () => {
    const good = [{ "@type": ["AutoRepair", "TireShop"], "@id": "https://nickstire.org/#localbusiness" }];
    expect(violations(good)).toEqual([]);
  });
});
