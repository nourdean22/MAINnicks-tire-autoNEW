/**
 * Lot router — live camera visit truth for nickstire.org/admin.
 *
 * Product boundary (ADR-0017, refined 2026-09-09): operational shop intelligence
 * lives here, in the shop's own admin. StateNour consumes owner-level summaries
 * and anomalies, not the shop-operations cockpit.
 *
 * Every read is a DISCRIMINATED result: `{ ok: true, ... }` or
 * `{ ok: false, reason }`. It must never be possible for a failed read, a missing
 * table, or an unreachable database to render as a confident zero — a "0 cars on
 * the lot" card that actually means "the query threw" is the exact defect shape
 * this repo keeps removing. `staleSeconds` is surfaced for the same reason: a
 * stale count is not a current one, and the operator gets told which it is.
 *
 * Counts come from `vehicle_visits` (migration 0119), written by camera-bridge's
 * visitd over event contract v2. Until the edge is live the table is simply
 * empty, and an empty table reports `ok: true` with zeros AND `neverIngested:
 * true`, which the UI renders as "waiting for the first camera event" rather
 * than as a quiet, wrong "0".
 */
import { z } from "zod";
import { desc, gte, isNull, sql } from "drizzle-orm";

import { router, adminProcedure } from "../_core/trpc";
import { dbTyped } from "../lib/db-helper";
import { vehicleVisits, type VehicleVisit } from "../../drizzle/schema";
import { clevelandDayStart } from "../services/autonomyControl";

function minutesBetween(from: Date | null, to: Date): number | null {
  if (!from) return null;
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

/** A visit is "on property" once observed and not yet departed. */
function isOpen(v: VehicleVisit): boolean {
  return !v.departedAt;
}

export const lotRouter = router({
  /**
   * The counter card: what is on the lot right now.
   *
   * `preexisting` is reported SEPARATELY from `arrivalsToday` on purpose. A car
   * that was already parked when the detector started occupies space but never
   * arrived, and collapsing the two is precisely the false-arrival defect the
   * vision layer exists to prevent.
   */
  now: adminProcedure.query(async () => {
    const d = await dbTyped();
    if (!d) {
      return { ok: false as const, reason: "database unavailable" };
    }

    try {
      const dayStart = clevelandDayStart();
      const now = new Date();

      const [open, today] = await Promise.all([
        d.select().from(vehicleVisits).where(isNull(vehicleVisits.departedAt)).limit(500),
        d.select().from(vehicleVisits).where(gte(vehicleVisits.arrivedAt, dayStart)).limit(1000),
      ]);

      const [{ total } = { total: 0 }] = await d
        .select({ total: sql<number>`count(*)` })
        .from(vehicleVisits);

      const onProperty = open.filter(isOpen);
      const inBays = onProperty.filter((v) => v.bayEnteredAt && !v.bayExitedAt);
      const postService = onProperty.filter((v) => v.bayExitedAt);
      const waiting = onProperty.filter((v) => !v.bayEnteredAt && !v.preexisting);
      const preexisting = onProperty.filter((v) => v.preexisting);

      const waitMinutes = waiting
        .map((v) => minutesBetween(v.waitStartedAt ?? v.arrivedAt, now))
        .filter((m): m is number => m !== null);
      const oldestWait = waitMinutes.length ? Math.max(...waitMinutes) : null;

      // Completed waits today, for median/P90. Only visits that actually reached
      // a bay have a finished wait; the rest are still accruing.
      const completedWaits = today
        .filter((v) => v.bayEnteredAt && (v.waitStartedAt ?? v.arrivedAt))
        .map((v) => minutesBetween(v.waitStartedAt ?? v.arrivedAt, v.bayEnteredAt as Date))
        .filter((m): m is number => m !== null)
        .sort((a, b) => a - b);

      const bays = new Map<string, { bay: string; occupiedMinutes: number | null; visitId: string }>();
      for (const v of inBays) {
        if (!v.bay) continue;
        bays.set(v.bay, {
          bay: v.bay,
          occupiedMinutes: minutesBetween(v.bayEnteredAt, now),
          visitId: v.visitId,
        });
      }

      let lastUpdate: Date | null = null;
      for (const v of open.concat(today)) {
        if (v.updatedAt && (!lastUpdate || v.updatedAt > lastUpdate)) lastUpdate = v.updatedAt;
      }

      return {
        ok: true as const,
        asOf: now.toISOString(),
        neverIngested: Number(total) === 0,
        staleSeconds: lastUpdate ? Math.round((now.getTime() - lastUpdate.getTime()) / 1000) : null,
        counts: {
          onProperty: onProperty.length,
          waiting: waiting.length,
          inBays: inBays.length,
          postService: postService.length,
          preexisting: preexisting.length,
          arrivalsToday: today.filter((v) => !v.preexisting).length,
          departuresToday: today.filter((v) => v.departedAt).length,
          abandonedBeforeBay: today.filter((v) => v.departedAt && !v.bayEnteredAt && !v.preexisting).length,
        },
        waits: {
          oldestWaitMinutes: oldestWait,
          medianMinutes: percentile(completedWaits, 50),
          p90Minutes: percentile(completedWaits, 90),
          sampleSize: completedWaits.length,
        },
        bays: [...bays.values()].sort((a, b) => a.bay.localeCompare(b.bay)),
        identity: {
          plateConfirmed: today.filter((v) => v.plateStatus === "CONFIRMED").length,
          plateAmbiguous: today.filter((v) => v.plateStatus === "AMBIGUOUS").length,
          customerExact: today.filter((v) => v.customerMatch === "EXACT").length,
          // Deliberately surfaced: a confusable match is NOT a customer identity
          // and must never be auto-bound to one.
          customerConfusable: today.filter((v) => v.customerMatch === "CONFUSABLE_UNIQUE").length,
          customerAmbiguous: today.filter((v) => v.customerMatch === "AMBIGUOUS").length,
        },
      };
    } catch (err) {
      // A missing table (edge not deployed yet) lands here too. Reporting the
      // reason beats rendering zeros that look like a quiet, empty lot.
      return {
        ok: false as const,
        reason: err instanceof Error ? err.message : "vehicle_visits read failed",
      };
    }
  }),

  /** Recent visit rows for the operator table. */
  visits: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(200).default(50),
      openOnly: z.boolean().default(false),
    }).default({ limit: 50, openOnly: false }))
    .query(async ({ input }) => {
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "database unavailable" };

      try {
        const rows = await d
          .select()
          .from(vehicleVisits)
          .where(input.openOnly ? isNull(vehicleVisits.departedAt) : undefined)
          .orderBy(desc(vehicleVisits.arrivedAt))
          .limit(input.limit);

        return {
          ok: true as const,
          rows: rows.map((v) => ({
            visitId: v.visitId,
            camera: v.camera,
            state: v.state,
            arrivedAt: v.arrivedAt?.toISOString() ?? null,
            bayEnteredAt: v.bayEnteredAt?.toISOString() ?? null,
            bayExitedAt: v.bayExitedAt?.toISOString() ?? null,
            departedAt: v.departedAt?.toISOString() ?? null,
            bay: v.bay,
            preexisting: v.preexisting,
            entryEvidence: v.entryEvidence,
            plateStatus: v.plateStatus,
            // Plate text is shown only when the read is CONFIRMED. A candidate or
            // ambiguous string on screen becomes a fact in someone's head.
            plateText: v.plateStatus === "CONFIRMED" ? v.plateText : null,
            customerMatch: v.customerMatch,
            customerId: v.customerMatch === "EXACT" ? v.customerId : null,
            estimatedFields: (v.estimatedFields as string[] | null) ?? [],
            evidenceRef: v.evidenceRef,
            cameraPose: v.cameraPose,
          })),
        };
      } catch (err) {
        return {
          ok: false as const,
          reason: err instanceof Error ? err.message : "vehicle_visits read failed",
        };
      }
    }),

  /**
   * Capture/vision health. Derived from ingest freshness rather than asserted,
   * so "healthy" always means "we saw something recently", never "the config
   * says a camera exists".
   */
  health: adminProcedure.query(async () => {
    const d = await dbTyped();
    if (!d) return { ok: false as const, reason: "database unavailable" };

    try {
      const rows = await d
        .select({
          camera: vehicleVisits.camera,
          lastSeen: sql<Date>`max(${vehicleVisits.updatedAt})`,
          pose: sql<string | null>`max(${vehicleVisits.cameraPose})`,
          detector: sql<string | null>`max(${vehicleVisits.detectorName})`,
          openVisits: sql<number>`sum(case when ${vehicleVisits.departedAt} is null then 1 else 0 end)`,
        })
        .from(vehicleVisits)
        .groupBy(vehicleVisits.camera);

      const now = Date.now();
      return {
        ok: true as const,
        cameras: rows.map((r) => {
          const last = r.lastSeen ? new Date(r.lastSeen) : null;
          const ageSeconds = last ? Math.round((now - last.getTime()) / 1000) : null;
          return {
            camera: r.camera,
            lastSeen: last?.toISOString() ?? null,
            ageSeconds,
            // Unknown age is UNKNOWN, not healthy.
            status: ageSeconds === null ? "unknown" : ageSeconds < 300 ? "healthy" : "stale",
            pose: r.pose,
            detector: r.detector,
            openVisits: Number(r.openVisits ?? 0),
          };
        }),
      };
    } catch (err) {
      return {
        ok: false as const,
        reason: err instanceof Error ? err.message : "vehicle_visits health read failed",
      };
    }
  }),
});
