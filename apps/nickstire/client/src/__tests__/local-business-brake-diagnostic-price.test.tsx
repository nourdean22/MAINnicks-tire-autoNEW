/**
 * The shop-wide Brake Repair and Engine Diagnostics Offers state the prices the site already shows.
 *
 * WHY (2026-10-21): assistants such as ChatGPT, Gemini and Perplexity read structured data. The
 * crawler HTML for /brakes says "$149" and /diagnostics says "$49", but the LocalBusiness JSON-LD
 * Brake Repair Offer had no minPrice and the Engine Diagnostics Offer hid the fee. Both numbers
 * come from shared/pricing.ts, never a literal in the component. The literal controls below make
 * a canon change visible here.
 *
 * Diagnostics deliberately has NO minPrice: the code scan is free, so a "$49 minimum" would mislead.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { BRAKE_PRICE, DIAGNOSTIC_PRICE } from "@shared/pricing";

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

async function offerSpec(serviceName: string): Promise<Node> {
  const { default: LocalBusinessSchema } = await import("../components/LocalBusinessSchema");
  const { container } = render(React.createElement(LocalBusinessSchema));
  const roots = Array.from(container.querySelectorAll('script[type="application/ld+json"]'))
    .map((s) => JSON.parse(s.textContent || "null"));
  const offers = walk(roots).filter(
    (n) => n["@type"] === "Offer" && (n.itemOffered as Node | undefined)?.name === serviceName,
  );
  expect(offers.length, `exactly one ${serviceName} Offer in the JSON-LD`).toBe(1);
  return offers[0].priceSpecification as Node;
}

describe("LocalBusinessSchema: Brake Repair Offer price", () => {
  it("carries minPrice from BRAKE_PRICE.padsStarting and states it in the description", async () => {
    const spec = await offerSpec("Brake Repair");
    expect(spec.priceCurrency).toBe("USD");
    expect(spec.minPrice).toBe(String(BRAKE_PRICE.padsStarting));
    expect(String(spec.description)).toContain(`$${BRAKE_PRICE.padsStarting}`);
    expect(String(spec.description)).toContain("per axle");
  });

  it("control: the canon brake floor is still 149 (a canon change must be noticed here)", async () => {
    expect(BRAKE_PRICE.padsStarting).toBe(149);
    expect((await offerSpec("Brake Repair")).minPrice).toBe("149");
  });
});

describe("LocalBusinessSchema: Engine Diagnostics Offer fee", () => {
  it("names the DIAGNOSTIC_PRICE fee and waiver, with no minPrice", async () => {
    const spec = await offerSpec("Engine Diagnostics");
    const description = String(spec.description);
    expect(description).toContain(`$${DIAGNOSTIC_PRICE.fee}`);
    expect(description).toContain(DIAGNOSTIC_PRICE.waiver);
    expect(spec).not.toHaveProperty("minPrice");
  });

  it("control: the canon diagnostic fee is still $49 (a canon change must be noticed here)", async () => {
    expect(DIAGNOSTIC_PRICE.fee).toBe(49);
    expect(String((await offerSpec("Engine Diagnostics")).description)).toContain("$49");
  });
});
