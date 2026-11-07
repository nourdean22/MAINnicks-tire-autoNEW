/**
 * sourcing.compareTires: one read-only Gateway/D&K size search, mapped to the supplier offer contract
 * (shared/sourcing.ts). The client ranks it (compareOffers) against its own clock, so a lookup that ages past the
 * shelf limit stops ranking on screen without a re-fetch. No cart, no order, no write of any kind.
 */
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { normalizeTireSize } from "@shared/sourcing";
import { adminProcedure, router } from "../_core/trpc";
import { GATEWAY_PORTAL_BASE, searchTiresWithReason } from "../services/gatewayClient";
import { gatewayItemsToOffers } from "../services/sourcingGateway";

/** Tire suppliers the shop buys from that have no connection here yet: named on screen so a blank is not read as "none". */
const NOT_CONNECTED = ["ATD", "Capital Tire"];

export const sourcingRouter = router({
  compareTires: adminProcedure.input(z.object({ size: z.string().max(40) })).query(async ({ input }) => {
    const size = normalizeTireSize(input.size);
    if (!size) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Enter a size like 225/65R17. LT sizes are not supported yet." });
    }
    const lookedUpAt = new Date().toISOString();
    const { rows, reason } = await searchTiresWithReason(size);
    const portalUrl = `${GATEWAY_PORTAL_BASE}/dashboard?search=${encodeURIComponent(size)}`;
    const offers = rows ? gatewayItemsToOffers(rows, { size, verifiedAt: lookedUpAt }) : [];
    // Rows that were all malformed are a failed answer, not an empty one.
    const status = rows === null || (rows.length > 0 && offers.length === 0) ? "unavailable" : rows.length === 0 ? "no_results" : "live";
    return {
      size,
      lookedUpAt,
      suppliers: [
        {
          id: "gateway_dk",
          name: "Gateway Tire (D&K)",
          status: status as "live" | "no_results" | "unavailable",
          // This call's own short code: the shared last-failure slot can hold another caller's failure.
          reason: status !== "unavailable" ? null : (reason ?? "bad_rows"),
          portalUrl,
        },
      ],
      notConnected: NOT_CONNECTED,
      offers,
    };
  }),
});
