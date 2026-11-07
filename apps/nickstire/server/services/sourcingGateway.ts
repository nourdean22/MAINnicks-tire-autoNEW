/**
 * Gateway Tire / D&K search rows -> SupplierOffer (shared/sourcing.ts). Rows come from gatewayClient.searchTiresBySize.
 *
 * What D&K's search states, and what it does not (docs/plans/shop-os/26-VENDOR-SCHEMATICS.md section 5):
 * - on_hand + pricing_data[0].site_name: stock at the branch that serves this account. Orderable, on the route.
 * - trade_region[] {site_id, site_name, on_hand}, or only trade_region_quantity: regional warehouses
 *   (docs/plans/shop-os/30-PORTAL-NETWORK-SCHEMATICS.md section 3). Whether this account may order them online is
 *   UNKNOWN and est_delivery_days is a day count, not a time, so each is a "transfer" with at UNKNOWN: price only.
 * - other_warehouse_quantity: national stock, a "ship" with at UNKNOWN, price only.
 * - total_qty is the grand total of the three (doc 30 s.3), so it is never a location of its own.
 * - No delivery or cutoff time anywhere, so every arrival.at / orderBy is UNKNOWN; SUPPLIER_SCHEDULES supplies the run.
 * - A zero away from the local branch is not an option, so it is left out.
 */
import { normalizeTireSize, UNKNOWN, type Maybe, type OfferLocation, type SupplierOffer } from "@shared/sourcing";
import { pickWholesaleCost } from "./gatewayClient";

type Row = Record<string, unknown>;

const num = (v: unknown): Maybe<number> => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : UNKNOWN);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function toOffer(item: Row, ctx: { size: string; verifiedAt: string }): SupplierOffer {
  const pricing = (Array.isArray(item.pricing_data) ? item.pricing_data[0] : undefined) as Row | undefined;
  // selling_price is the dealer cost. Without it pickWholesaleCost falls back to cost_price, which is retail (2x).
  const cost = typeof pricing?.selling_price === "number" && pricing.selling_price > 0 ? pickWholesaleCost(item) : 0;
  const wanted = normalizeTireSize(ctx.size);
  const size = normalizeTireSize(text(item.invent_size));
  const model = text(item.minor_name).replace(/^[A-Z]+\s*-\s*/, "");

  const away = (branchCode: string, branchName: string, qty: unknown, tier: "transfer" | "ship"): OfferLocation[] => {
    const n = num(qty);
    if (n === UNKNOWN || n === 0) return [];
    return [
      {
        branchCode,
        branchName,
        kind: "network",
        qty: n,
        qtySource: "supplier_live",
        orderable: UNKNOWN,
        arrival: { tier, at: UNKNOWN, orderBy: UNKNOWN },
        fulfillmentMode: tier,
      },
    ];
  };
  const sites = (Array.isArray(item.trade_region) ? item.trade_region : []).filter((s): s is Row => typeof s === "object" && s !== null);
  const regional = sites.length
    ? sites.flatMap((s, i) => away(`regional-${String(s.site_id ?? i)}`, text(s.site_name) || "D&K regional", s.on_hand, "transfer"))
    : away("regional", "D&K regional", item.trade_region_quantity, "transfer");

  const locations: OfferLocation[] = [
    {
      branchCode: "local",
      branchName: text(pricing?.site_name) || "D&K branch",
      kind: "warehouse",
      qty: num(item.on_hand),
      qtySource: "supplier_live",
      orderable: "yes",
      arrival: { tier: "shelf", at: UNKNOWN, orderBy: UNKNOWN },
      fulfillmentMode: "route",
    },
    ...regional,
    ...away("national", "D&K national", item.other_warehouse_quantity, "ship"),
  ];

  return {
    supplierId: "gateway_dk",
    supplierName: "Gateway Tire (D&K)",
    sku: text(item.dk_part_number) || String(item.dk_part_number ?? ""),
    description: text(item.display_name) || [text(item.make), model, text(item.invent_size)].filter(Boolean).join(" "),
    priceStatus: cost > 0 ? "priced" : "not_priced",
    unitPrice: cost > 0 ? cost : UNKNOWN,
    fet: num(pricing?.fet),
    core: "not_applicable",
    priceSource: "supplier_live",
    fitConfidence: wanted !== null && size === wanted ? "confirmed" : "not_confirmed",
    fitConditions: [],
    lastVerifiedAt: ctx.verifiedAt,
    locations,
  };
}

export function gatewayItemsToOffers(items: readonly Row[], ctx: { size: string; verifiedAt: string }): SupplierOffer[] {
  return items.filter((item) => typeof item === "object" && item !== null).map((item) => toOffer(item, ctx));
}
