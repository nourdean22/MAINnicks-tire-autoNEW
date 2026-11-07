/**
 * Gateway Tire / D&K -> SupplierOffer adapter for the supplier comparison (shared/sourcing.ts).
 *
 * D&K returns two stock buckets per tire (22-GATEWAY-DK-UX-AUDIT section 4a): `on_hand` at the
 * local branch and `total_qty` across the region. Local stock is "on the shelf" (one 30-60 min
 * run, Nour 2026-11-06). Regional stock is a transfer whose timing D&K does not state - kept as
 * an open question in 26-VENDOR-SCHEMATICS section 5, so the offer says so instead of guessing.
 */
import { DEFAULT_RUN_MINUTES, type SupplierOffer } from "@shared/sourcing";
import { pickWholesaleCost } from "./gatewayClient";

export const GATEWAY_SUPPLIER = { id: "gateway_dk", name: "Gateway Tire (D&K)" } as const;

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export function gatewayItemToOffer(
  item: Record<string, unknown>,
  qtyNeeded: number,
  verifiedAt: string,
): SupplierOffer {
  const sku = String(item.dk_part_number ?? "").trim();
  const brand = String(item.make ?? "").trim();
  const model = String(item.minor_name ?? "").replace(/^[A-Z]+\s*-\s*/, "").trim();
  const size = String(item.invent_size ?? "").trim();
  const description = String(item.display_name ?? `${brand} ${model}`).trim() || [brand, model, size].filter(Boolean).join(" ");

  const local = num(item.on_hand);
  const regional = num(item.total_qty);
  const cost = pickWholesaleCost(item);

  let tier: SupplierOffer["tier"];
  let qtyAvailable: number | null;
  let location: string;
  const notes: string[] = [];
  if (local !== null && local >= qtyNeeded) {
    tier = "shelf";
    qtyAvailable = local;
    location = "Local";
  } else if (regional !== null && regional >= qtyNeeded) {
    tier = "transfer";
    qtyAvailable = regional;
    location = "Regional";
    notes.push("Regional stock - D&K does not show how long it takes; call if the car is waiting");
  } else if (local === null && regional === null) {
    tier = "unknown";
    qtyAvailable = null;
    location = "Unknown";
  } else {
    // Neither bucket covers the job: report the bigger one so the counter sees the shortfall.
    const useLocal = (local ?? 0) >= (regional ?? 0) && (local ?? 0) > 0;
    tier = useLocal ? "shelf" : "transfer";
    qtyAvailable = Math.max(local ?? 0, regional ?? 0);
    location = useLocal ? "Local" : "Regional";
  }

  return {
    id: `${GATEWAY_SUPPLIER.id}:${sku || description}:${location}`,
    supplierId: GATEWAY_SUPPLIER.id,
    supplierName: GATEWAY_SUPPLIER.name,
    location,
    sku,
    brand,
    description: size && !description.includes(size) ? `${description} ${size}` : description,
    unitCost: cost > 0 ? cost : null,
    qtyAvailable,
    tier,
    statedArrival: null,
    runMinutes: tier === "shelf" ? { ...DEFAULT_RUN_MINUTES } : null,
    runSource: tier === "shelf" ? "default" : null,
    verifiedAt,
    source: "supplier_live",
    notes,
  };
}
