/**
 * Gateway/D&K search rows -> SupplierOffer. Rows use the recorded /quicksearch/cache key set
 * (server/__tests__/fixtures/gatewayOrder/dk.json, values invented): on_hand, pricing_data[0].{site_name,
 * selling_price, cost_price, quantity, fet}; total_qty is the regional figure gatewayTire.adminSearch reads.
 */
import { describe, expect, it } from "vitest";
import dk from "../__tests__/fixtures/gatewayOrder/dk.json";
import { gatewayItemsToOffers } from "./sourcingGateway";
import { compareOffers, UNKNOWN } from "@shared/sourcing";

const AT = "2026-11-06T15:00:00.000Z";
const NOW = new Date(AT);
const CTX = { size: "225/65R17", verifiedAt: AT };

const row = (p: Record<string, unknown> = {}, pricing: Record<string, unknown> = {}) => ({
  dk_part_number: "NX-2256517",
  make: "NEXEN",
  minor_name: "NEX - N PRIZ S",
  display_name: "NEXEN N PRIZ S 225/65R17 102H",
  invent_size: "225/65R17",
  on_hand: 6,
  pricing_data: [{ site_id: 7001, site_name: "Seville, OH", selling_price: 88.5, cost_price: 177, quantity: 6, fet: 0, ...pricing }],
  ...p,
});

describe("gatewayItemsToOffers", () => {
  it("local stock is on the shelf at the named branch, orderable, by route, with no invented time", () => {
    const [o] = gatewayItemsToOffers([row()], CTX);
    expect(o.locations).toHaveLength(1);
    expect(o.locations[0]).toMatchObject({
      branchName: "Seville, OH",
      qty: 6,
      qtySource: "supplier_live",
      orderable: "yes",
      fulfillmentMode: "route",
      arrival: { tier: "shelf", at: UNKNOWN, orderBy: UNKNOWN },
    });
    expect(o.lastVerifiedAt).toBe(AT);
  });

  it("prices off selling_price (D&K's dealer cost), carries FET, and tires have no core", () => {
    const [o] = gatewayItemsToOffers([row({}, { fet: 1.25 })], CTX);
    expect([o.priceStatus, o.unitPrice, o.fet, o.core]).toEqual(["priced", 88.5, 1.25, "not_applicable"]);
  });

  it("a regional figure becomes a second location: a transfer, orderable not confirmed", () => {
    const [o] = gatewayItemsToOffers([row({ on_hand: 1, total_qty: 12 })], CTX);
    expect(o.locations[1]).toMatchObject({
      branchCode: "regional",
      qty: 12,
      orderable: UNKNOWN,
      kind: "network",
      arrival: { tier: "transfer", at: UNKNOWN, orderBy: UNKNOWN },
    });
  });

  it("missing stock, price and FET are UNKNOWN, a stated 0 is 0", () => {
    const [blank] = gatewayItemsToOffers([{ dk_part_number: "X", invent_size: "225/65R17" }], CTX);
    expect([blank.locations[0].qty, blank.unitPrice, blank.fet, blank.priceStatus]).toEqual([UNKNOWN, UNKNOWN, UNKNOWN, "not_priced"]);
    const [zero] = gatewayItemsToOffers([row({ on_hand: 0 })], CTX);
    expect(zero.locations[0].qty).toBe(0);
  });

  it("a row whose size does not match the search is not a confirmed fit", () => {
    const [o] = gatewayItemsToOffers([row({ invent_size: "225/60R17" })], CTX);
    expect(o.fitConfidence).toBe("not_confirmed");
    const [none] = gatewayItemsToOffers([row({ invent_size: undefined })], CTX);
    expect(none.fitConfidence).toBe("not_confirmed");
  });

  it("reads the recorded fixture row as-is", () => {
    const [o] = gatewayItemsToOffers([dk.searchHit], { size: "215/55R16", verifiedAt: AT });
    expect([o.sku, o.unitPrice, o.locations[0].qty, o.locations[0].branchName, o.fitConfidence]).toEqual([
      "LS388-2155516",
      61.25,
      12,
      "Seville, OH",
      "confirmed",
    ]);
  });
});

describe("Gateway offers through compareOffers", () => {
  // Built per test, so a broken adapter fails each test instead of the whole file at collection.
  const offers = () =>
    gatewayItemsToOffers(
      [
        row({ dk_part_number: "CHEAP", on_hand: 2, total_qty: 14 }, { selling_price: 70 }),
        row({ dk_part_number: "MID", on_hand: 6 }, { selling_price: 88.5 }),
        row({ dk_part_number: "PRICEY", on_hand: 9 }, { selling_price: 120 }),
      ],
      CTX,
    );

  it.each([
    [1, "CHEAP", "CHEAP"],
    [4, "MID", "CHEAP"],
    [6, "MID", "CHEAP"],
  ])("qty %i: quickest %s, best price %s", (qty, quickest, best) => {
    const r = compareOffers(offers(), qty, NOW);
    expect(r.quickest?.offer.sku).toBe(quickest);
    expect(r.bestPrice?.offer.sku).toBe(best);
  });

  it("qty 6: two shelf offers in one run window are reported as a tie", () => {
    const r = compareOffers(offers(), 6, NOW);
    expect(r.sameWindow.map((c) => c.offer.sku)).toEqual(["PRICEY"]);
  });

  it("qty 4: CHEAP is short here and its regional stock competes on price only", () => {
    const r = compareOffers(offers(), 4, NOW);
    const local = r.candidates.find((c) => c.key === "gateway_dk:CHEAP:local");
    const regional = r.candidates.find((c) => c.key === "gateway_dk:CHEAP:regional");
    expect(local?.reasons).toContain("Only 2 here, need 4");
    expect(regional?.canWinQuickest).toBe(false);
    expect(regional?.canWinPrice).toBe(true);
  });

  it("regional-only stock: no quickest pick (ETA unknown - call), but it can be the best price", () => {
    const only = gatewayItemsToOffers([row({ on_hand: 1, total_qty: 12 })], CTX);
    const r = compareOffers(only, 4, NOW);
    expect(r.quickest).toBeNull();
    expect(r.bestPrice?.location.branchCode).toBe("regional");
  });

  it("a lookup 16 minutes old no longer ranks as on the shelf", () => {
    const r = compareOffers(offers(), 4, new Date(NOW.getTime() + 16 * 60_000));
    expect(r.quickest).toBeNull();
  });

  it("an unpriced row never wins Best price", () => {
    const r = compareOffers(gatewayItemsToOffers([row({}, { selling_price: 0, cost_price: 0 })], CTX), 4, NOW);
    expect(r.bestPrice).toBeNull();
    expect(r.quickest).not.toBeNull();
  });
});
