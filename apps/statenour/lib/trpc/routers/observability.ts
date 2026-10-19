import { z } from "zod";
import { router, operatorProcedure } from "../trpc";
import {
  buildCostSloSnapshot,
  buildEvalResults,
  buildOsSnapshot,
} from "@/lib/services/system-observability";

/**
 * Observability Domain Router
 * Phase B of Operation Clear-Boundary
 * 
 * Replaces:
 * - GET /api/system/cost-slo
 * - GET /api/system/eval-results
 * - GET /api/system/os-snapshot
 */
export const observabilityRouter = router({
  costSlo: operatorProcedure.query(async () => {
    return await buildCostSloSnapshot();
  }),

  evalResults: operatorProcedure
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(90).optional().default(14),
        })
        .optional()
    )
    .query(async ({ input }) => {
      return await buildEvalResults(input?.limit);
    }),

  osSnapshot: operatorProcedure.query(async () => {
    return await buildOsSnapshot();
  }),
});
