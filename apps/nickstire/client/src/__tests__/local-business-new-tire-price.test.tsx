/**
 * The shop-wide "New Tire Sales & Installation" Offer carries the canon new-tire floor.
 *
 * WHY (2026-10-21): two customers arrived because AI assistants sent them, one quoting the
 * "$89" new-tire price. The crawler HTML for /tires already said "New tires from $89
 * installed" in text and og tags, but the LocalBusiness JSON-LD Offer for new tires had no
 * minPrice, while Used Tires and Flat Repair did. Structured data is what assistants and
 * rich results read first, so the one price the shop leads with was missing from it.
 *
 * The number comes from BUSINESS.newTires.startingDollars (shared/business.ts), never a
 * literal in the component. One literal "89" control below makes a canon change visible here.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { BUSINESS } from "@shared/business";

vi.mock("@/lib/trpc", () => ({
  trpc: new Proxy({}, {
    get: () => new Proxy({}, {
      get: () => ({ useQuery: () => ({ data: undefined, isLoading: false, error: null }) }),
    }),
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

async function newTireOffer(): Promise<Node> {
  const { default: LocalBusinessSchema } = await import("../components/LocalBusinessSchema");
  const { container } = render(React.createElement(LocalBusinessSchema));
  const roots = Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => JSON.parse(s.textContent || "null"));
  const offers = walk(roots).filter(
    (n) => n["@type"] === "Offer" && (n.itemOffered as Node | undefined)?.name === "New Tire Sales & Installation",
  );
  expect(offers.length, "exactly one New Tire Offer in the JSON-LD").toBe(1);
  return offers[0];
}

describe("LocalBusinessSchema: New Tire Offer price", () => {
  it("carries minPrice from BUSINESS.newTires.startingDollars", async () => {
    const spec = (await newTireOffer()).priceSpecification as Node;
    expect(spec.priceCurrency).toBe("USD");
    expect(spec.minPrice).toBe(String(BUSINESS.newTires.startingDollars));
    // The description states the same floor, so text and number cannot disagree.
    expect(String(spec.description)).toContain(`$${BUSINESS.newTires.startingDollars}`);
  });

  it("control: the canon floor is still $89 (a canon change must be noticed here)", () => {
    expect(BUSINESS.newTires.startingDollars).toBe(89);
  });
});
