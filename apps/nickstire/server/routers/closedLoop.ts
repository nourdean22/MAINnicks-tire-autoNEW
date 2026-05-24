/**
 * closedLoop router — wave-181.x Today page Phase 4
 *
 * Exposes the wave_metrics measurement results so the admin Today
 * page can surface "did the work we shipped actually move the
 * needle." The closed-loop framework cron writes measurements daily ·
 * this router reads them out for the operator surface.
 *
 * Only renders when there are real measurements · empty state hides
 * the surface entirely (clarity-gate · don't render fake signal).
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";
import { createLogger } from "../lib/logger";

const log = createLogger("router:closed-loop");

export const closedLoopRouter = router({
  /**
   * recent — last N wave-metric measurements (status != pending).
   *
   * Returns an array of:
   *   waveId · metricKey · status · deltaPercent · measuredValue ·
   *   baselineValue · measuredAt · notes
   *
   * Sorted by measuredAt DESC. Empty array when no measurements yet
   * (framework just shipped · daily cron hasn't fired yet).
   */
  recent: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(8) }).optional())
    .query(async ({ input }) => {
      const limit = input?.limit ?? 8;
      try {
        const { getDb } = await import("../db");
        const { waveMetrics } = await import("../../drizzle/schema");
        const { desc, ne } = await import("drizzle-orm");
        const d = await getDb();
        if (!d) return { measurements: [], total: 0 };
        const rows = await d
          .select({
            id: waveMetrics.id,
            waveId: waveMetrics.waveId,
            metricKey: waveMetrics.metricKey,
            baselineValue: waveMetrics.baselineValue,
            measuredValue: waveMetrics.measuredValue,
            deltaPercent: waveMetrics.deltaPercent,
            status: waveMetrics.status,
            measuredAt: waveMetrics.measuredAt,
            notes: waveMetrics.notes,
          })
          .from(waveMetrics)
          .where(ne(waveMetrics.status, "pending"))
          .orderBy(desc(waveMetrics.measuredAt))
          .limit(limit);
        return {
          measurements: rows.map((r: typeof rows[number]) => ({
            id: r.id,
            waveId: r.waveId,
            metricKey: r.metricKey,
            baselineValue: r.baselineValue ? Number(r.baselineValue) : 0,
            measuredValue: r.measuredValue ? Number(r.measuredValue) : null,
            deltaPercent: r.deltaPercent ? Number(r.deltaPercent) : null,
            status: r.status,
            measuredAt: r.measuredAt,
            notes: r.notes,
          })),
          total: rows.length,
        };
      } catch (err) {
        log.warn("closedLoop.recent failed", {
          err: err instanceof Error ? err.message : String(err),
        });
        return { measurements: [], total: 0 };
      }
    }),

  /**
   * summary — quick aggregate · how many lifted / no-lift / regression
   * across all measurements. Used for an at-a-glance tile heading.
   */
  summary: adminProcedure.query(async () => {
    try {
      const { getDb } = await import("../db");
      const { waveMetrics } = await import("../../drizzle/schema");
      const { sql, eq } = await import("drizzle-orm");
      const d = await getDb();
      if (!d) return { lifted: 0, noLift: 0, regression: 0, total: 0, pending: 0 };
      const counts = await d.execute(sql`
        SELECT status, COUNT(*) AS n FROM wave_metrics GROUP BY status
      `);
      const rows = (Array.isArray(counts) && Array.isArray(counts[0]) ? counts[0] : counts) as Array<{ status: string; n: number }>;
      // suppress eslint · eq imported for typing parity
      void eq;
      const map: Record<string, number> = {};
      for (const r of rows) map[r.status] = Number(r.n);
      return {
        lifted: map.lifted ?? 0,
        noLift: map.no_lift ?? 0,
        regression: map.regression ?? 0,
        pending: map.pending ?? 0,
        total: (map.lifted ?? 0) + (map.no_lift ?? 0) + (map.regression ?? 0) + (map.pending ?? 0),
      };
    } catch (err) {
      log.warn("closedLoop.summary failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      return { lifted: 0, noLift: 0, regression: 0, pending: 0, total: 0 };
    }
  }),
});
