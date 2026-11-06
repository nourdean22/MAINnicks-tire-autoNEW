/**
 * Supplier comparison for the counter (Shop OS plan 26-VENDOR-SCHEMATICS screens 1 and 3).
 *
 * Read-only: looks up live offers and ranks them; it never places or drafts a supplier order
 * (root AGENTS.md - supplier orders are a protected operation, and 18's rule: AI never buys).
 * Connected today: Gateway/D&K tires. Every other supplier is listed as not connected rather than
 * shown with made-up stock.
 */
import { z } from "zod";
import { adminProcedure, router } from "../_core/trpc";
import { compareOffers, normalizeTireSize, type OfferComparison } from "@shared/sourcing";
import { GATEWAY_PORTAL_BASE, getLastGatewayFailure, searchTiresBySize } from "../services/gatewayClient";
import { GATEWAY_SUPPLIER, gatewayItemToOffer } from "../services/sourcingGateway";
import { createLogger } from "../lib/logger";

const log = createLogger("routers:sourcing");

/** Suppliers audited in docs/plans/shop-os 22-29 that have no adapter yet, by what they sell. */
const NOT_CONNECTED = {
  tires: ["ATD", "Capital Tire"],
  parts: ["Parts Authority", "O'Reilly", "Federated / Fisher", "AutoZone", "Amazon Business"],
} as const;

export interface SupplierStatus {
  id: string;
  name: string;
  status: "live" | "no_results" | "unavailable";
  detail: string | null;
  portalUrl: string | null;
}


export const sourcingRouter = router({
  compareTires: adminProcedure
    .input(z.object({ size: z.string().min(5).max(20), qty: z.number().int().min(1).max(12).default(4) }))
    .query(async ({ input }) => {
      const size = normalizeTireSize(input.size);
      if (!size) {
        return { size: null, comparison: null, suppliers: [] as SupplierStatus[], notConnected: NOT_CONNECTED.tires, error: "Enter a tire size like 225/65R17." };
      }
      const verifiedAt = new Date().toISOString();
      let raw: Record<string, unknown>[] | null = null;
      try {
        raw = await searchTiresBySize(size);
      } catch (err) {
        log.warn("[sourcing:compareTires] gateway search threw:", err instanceof Error ? err.message : err);
      }
      const portalUrl = `${GATEWAY_PORTAL_BASE}/dashboard?search=${encodeURIComponent(size)}`;
      const failure = raw === null ? getLastGatewayFailure() : null;
      const gateway: SupplierStatus = {
        id: GATEWAY_SUPPLIER.id,
        name: GATEWAY_SUPPLIER.name,
        status: raw === null ? "unavailable" : raw.length === 0 ? "no_results" : "live",
        detail: raw === null ? (failure?.reason ?? "Gateway did not answer") : null,
        portalUrl,
      };
      const offers = (raw ?? []).map((item) => gatewayItemToOffer(item, input.qty, verifiedAt));
      const comparison: OfferComparison = compareOffers(offers, input.qty);
      return { size, comparison, suppliers: [gateway], notConnected: NOT_CONNECTED.tires, error: null as string | null };
    }),
});
