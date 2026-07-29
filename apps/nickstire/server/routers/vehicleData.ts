/**
 * Vehicle data router (WP-23, 2026-07-29) — read-only NHTSA lookups
 * for lead/quote enrichment. Admin-gated; the service enforces the
 * advisor framing (source label + disclaimer travel in the payload).
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { decodeVin, recallsByVehicle } from "../services/vehicleData";

export const vehicleDataRouter = router({
  decodeVin: adminProcedure
    .input(z.object({ vin: z.string().min(11).max(17) }))
    .query(async ({ input }) => decodeVin(input.vin)),

  recalls: adminProcedure
    .input(
      z.object({
        year: z.string().regex(/^\d{4}$/),
        make: z.string().min(1).max(40),
        model: z.string().min(1).max(60),
      }),
    )
    .query(async ({ input }) => recallsByVehicle(input)),
});
