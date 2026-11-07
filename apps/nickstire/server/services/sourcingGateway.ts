/**
 * Gateway Tire / D&K search rows -> SupplierOffer (shared/sourcing.ts). Rows come from gatewayClient.searchTiresBySize.
 *
 * What D&K's search states, and what it does not (docs/plans/shop-os/26-VENDOR-SCHEMATICS.md section 5):
 * - on_hand + pricing_data[0].site_name: stock at the branch that serves this account. Orderable, on the route.
 * - total_qty (when present): a regional figure. Orderable online is not confirmed and no transfer time is stated,
 *   so it is a "transfer" with at UNKNOWN: it competes on price only and never ranks for speed.
 * - No delivery or cutoff time anywhere, so every arrival.at / orderBy is UNKNOWN; SUPPLIER_SCHEDULES supplies the run.
 */
import { normalizeTireSize, UNKNOWN, type Maybe, type OfferLocation, type SupplierOffer } from "@shared/sourcing";
import { pickWholesaleCost } from "./gatewayClient";

type Row = Record<string, unknown>;

const num = (v: unknown): Maybe<number> => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : UNKNOWN);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

function toOffer(item: Row, ctx: { size: string; verifiedAt: string }): SupplierOffer {
  const pricing = (Array.isArray(item.pricing_data) ? item.pricing_data[0] : undefined) as Row | undefined;
  const cost = pickWholesaleCost(item);
  const wanted = normalizeTireSize(ctx.size);
  const size = normalizeTireSize(text(item.invent_size));
  const model = text(item.minor_name).replace(/^[A-Z]+\s*-\s*/, "");

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
  ];
  if (typeof item.total_qty === "number") {
    locations.push({
      branchCode: "regional",
      branchName: "D&K regional",
      kind: "network",
      qty: num(item.total_qty),
      qtySource: "supplier_live",
      orderable: UNKNOWN,
      arrival: { tier: "transfer", at: UNKNOWN, orderBy: UNKNOWN },
      fulfillmentMode: "transfer",
    });
  }

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
  return items.map((item) => toOffer(item, ctx));
}
