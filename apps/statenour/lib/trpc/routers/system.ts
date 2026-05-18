/**
 * lib/trpc/routers/system.ts · Phase S.2 (2026-05-18 PM)
 *
 * System telemetry procedures · per the J tRPC migration plan, this is
 * the third domain router (after `nick` for reasoning + `operator` for
 * forward-looking state). Lives separately so future /system/* surface
 * migrations have a natural home without ballooning the nick router.
 *
 * Replaces (coexistence · legacy REST stays mounted):
 *   · GET /api/system/health-report → healthReport
 *
 * Both call the same `buildHealthReport()` service so the legacy REST
 * consumers and the new tRPC consumers can't drift.
 */

import { z } from "zod";
import { router, operatorProcedure } from "../trpc";
import { buildHealthReport } from "@/lib/services/system-health";

const HealthRangeSchema = z.enum(["24h", "7d", "30d"]);

export const systemRouter = router({
  /**
   * Owner-only · returns the same HealthReport shape the legacy REST
   * endpoint returned. Default range = 7d to match prior behavior.
   */
  healthReport: operatorProcedure
    .input(z.object({ range: HealthRangeSchema.default("7d") }))
    .query(async ({ input }) => {
      return buildHealthReport({ range: input.range });
    }),
});
