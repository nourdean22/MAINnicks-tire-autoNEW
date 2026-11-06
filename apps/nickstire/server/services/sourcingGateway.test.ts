import { describe, expect, it } from "vitest";
import { gatewayItemToOffer } from "./sourcingGateway";
import { normalizeTireSize } from "@shared/sourcing";

const AT = "2026-11-06T15:00:00Z";
// D&K inverts its names: selling_price is the dealer cost (see pickWholesaleCost).
const item = (onHand: number | undefined, total: number | undefined) => ({
  dk_part_number: "DK123",
  make: "NEXEN",
  minor_name: "NEX - N Priz S",
  display_name: "Nexen N Priz S",
  invent_size: "225/65R17",
  on_hand: onHand,
  total_qty: total,
  pricing_data: [{ selling_price: 88.5, cost_price: 140 }],
});

describe("gatewayItemToOffer", () => {
  it("local stock that covers the job is on the shelf with the usual 30-60 min run", () => {
    const o = gatewayItemToOffer(item(6, 20), 4, AT);
    expect(o.tier).toBe("shelf");
    expect(o.location).toBe("Local");
    expect(o.qtyAvailable).toBe(6);
    expect(o.runMinutes).toEqual({ min: 30, max: 60 });
    expect(o.unitCost).toBe(88.5);
    expect(o.description).toContain("225/65R17");
  });

  it("regional-only coverage is a transfer with no invented arrival time", () => {
    const o = gatewayItemToOffer(item(1, 12), 4, AT);
    expect(o.tier).toBe("transfer");
    expect(o.location).toBe("Regional");
    expect(o.statedArrival).toBeNull();
    expect(o.runMinutes).toBeNull();
    expect(o.notes?.[0]).toMatch(/does not show how long/);
  });

  it("reports the shortfall when no bucket covers the quantity", () => {
    const o = gatewayItemToOffer(item(2, 3), 4, AT);
    expect(o.qtyAvailable).toBe(3);
    expect(o.tier).toBe("transfer");
  });

  it("missing stock fields are unknown, not zero", () => {
    const o = gatewayItemToOffer(item(undefined, undefined), 4, AT);
    expect(o.tier).toBe("unknown");
    expect(o.qtyAvailable).toBeNull();
  });
});

describe("normalizeTireSize", () => {
  it.each([
    ["2256517", "225/65R17"],
    ["225/65R17", "225/65R17"],
    ["225/65-17", "225/65R17"],
    ["225 65 17", "225/65R17"],
    ["P225/65R17", "225/65R17"],
  ])("%s -> %s", (raw, want) => expect(normalizeTireSize(raw)).toBe(want));
  it("rejects non-sizes", () => {
    expect(normalizeTireSize("abc")).toBeNull();
    expect(normalizeTireSize("22565")).toBeNull();
  });
});
