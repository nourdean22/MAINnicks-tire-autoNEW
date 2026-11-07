import { afterEach, describe, it, expect, vi } from "vitest";
import { pickWholesaleCost } from "./gatewayClient";

/**
 * Regression guard for the 2026-06-05 customer overcharge bug.
 *
 * D&K's /quicksearch/cache INVERTS its field names: `selling_price` is the
 * dealer's wholesale COST, `cost_price` is the suggested RETAIL (= 2x cost).
 * pickWholesaleCost used to read `cost_price`, so every customer tire was
 * priced at cost x 4 (100% markup applied to 2x cost) — e.g. the NITTO
 * LT295/55R22 showed $1883 instead of $941.50. It must return the TRUE cost
 * (the lower of the two prices).
 */
const item = (pricing: Record<string, unknown>[]) => ({ pricing_data: pricing });

describe("pickWholesaleCost — D&K inverted pricing fields", () => {
  it("returns the dealer cost (selling_price), not the retail (cost_price)", () => {
    // Exact shapes from the live D&K response for size 295/55R22.
    expect(pickWholesaleCost(item([{ cost_price: 941.5, selling_price: 470.75 }]))).toBe(470.75);
    expect(pickWholesaleCost(item([{ cost_price: 1000, selling_price: 500 }]))).toBe(500);
    expect(pickWholesaleCost(item([{ cost_price: 746.7264, selling_price: 373.3632 }]))).toBe(373.3632);
  });

  it("stays correct even if D&K ever un-inverts the names (always the lower price = cost)", () => {
    expect(pickWholesaleCost(item([{ cost_price: 470.75, selling_price: 941.5 }]))).toBe(470.75);
  });

  it("falls back to the only positive price when one field is missing or zero", () => {
    expect(pickWholesaleCost(item([{ selling_price: 470.75 }]))).toBe(470.75);
    expect(pickWholesaleCost(item([{ cost_price: 941.5 }]))).toBe(941.5);
    expect(pickWholesaleCost(item([{ cost_price: 0, selling_price: 470.75 }]))).toBe(470.75);
  });

  it("returns 0 (caller filters $0 tires) when pricing is missing, empty, or non-numeric", () => {
    expect(pickWholesaleCost({})).toBe(0);
    expect(pickWholesaleCost({ pricing_data: [] })).toBe(0);
    expect(pickWholesaleCost(item([{ cost_price: "n/a", selling_price: "call" }]))).toBe(0);
  });
});

/**
 * searchTiresWithReason gives back THIS call's failure reason (a short code, never account text), so a caller
 * does not read the shared last-failure slot that another Gateway call may have written meanwhile.
 */
describe("searchTiresWithReason — the reason belongs to this call", () => {
  const KEYS = ["GATEWAY_TIRE_USERNAME", "GATEWAY_TIRE_PASSWORD", "GATEWAY_TIRE_SHIP_TO"] as const;
  const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  async function search(route: (path: string) => Response, shipTo: string | null = "SHIP-TO") {
    process.env.GATEWAY_TIRE_USERNAME = "u";
    process.env.GATEWAY_TIRE_PASSWORD = "p";
    if (shipTo) process.env.GATEWAY_TIRE_SHIP_TO = shipTo;
    else delete process.env.GATEWAY_TIRE_SHIP_TO;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL) => route(new URL(String(input)).pathname)));
    vi.resetModules();
    const { searchTiresWithReason } = await import("./gatewayClient");
    return searchTiresWithReason("225/65R17");
  }
  const tokenThen = (search: () => Response) => (path: string) => (path === "/token" ? reply({ access_token: "t" }) : search());

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("rows and no reason when the search answers with a list", async () => {
    expect(await search(tokenThen(() => reply([{ dk_part_number: "A" }])))).toEqual({ rows: [{ dk_part_number: "A" }], reason: null });
  });

  it("no ship-to set", async () => {
    expect(await search(() => reply({}), null)).toEqual({ rows: null, reason: "ship_to_not_set" });
  });

  it("login refused", async () => {
    expect(await search(() => reply({ detail: "account 12345 rejected" }, 500))).toEqual({ rows: null, reason: "login_failed" });
  });

  it("search refused, with its status", async () => {
    expect(await search(tokenThen(() => reply({}, 503)))).toEqual({ rows: null, reason: "search_http_503" });
  });

  it("an answer that is not a list", async () => {
    expect(await search(tokenThen(() => reply({ items: [] })))).toEqual({ rows: null, reason: "bad_shape" });
  });
});
