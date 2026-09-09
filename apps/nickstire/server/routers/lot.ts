/**
 * Lot router — live camera visit truth for nickstire.org/admin.
 *
 * Product boundary (ADR-0017, refined 2026-09-09): operational shop intelligence
 * lives here, in the shop's own admin. StateNour consumes owner-level summaries
 * and anomalies, not the shop-operations cockpit.
 *
 * Every read is a DISCRIMINATED result: `{ ok: true, ... }` or
 * `{ ok: false, reason }`. It must never be possible for a failed read, a missing
 * table, or an unreachable database to render as a confident zero.
 *
 * THREE CORRECTIONS FROM REVIEW, each of which had produced plausible wrong numbers:
 *
 * 1. **Aggregates are computed in SQL, not in JS.** The first version pulled up to
 *    1,500 whole rows per poll and counted them in JavaScript. That silently
 *    TRUNCATED once open visits passed the limit — reporting exactly 500 forever,
 *    and an undefined 500 at that — and it subtracted driver-parsed dates.
 *    `apps/nickstire/AGENTS.md` is explicit that TiDB values come back shifted on
 *    ET and that ages and day-buckets belong in SQL. Every age here is
 *    `UNIX_TIMESTAMP()` arithmetic, unambiguous regardless of the session or
 *    process timezone, and every count is a `SUM(CASE ...)` over the whole table.
 * 2. **Daily departures are filtered on `departedAt`.** They were derived from
 *    today's ARRIVALS, so a car that arrived at 5pm yesterday and left at 9am today
 *    counted in neither `departuresToday` nor `abandonedBeforeBay` — every morning
 *    with overnight vehicles under-reported.
 * 3. **Freshness is measured over the whole table.** Deriving it from open visits
 *    alone meant every quiet morning showed a green "Live" badge with zero
 *    counters even if ingest had stopped hours earlier.
 *
 * `arrivalTimeUnknown` exists for the same honesty reason: a visit whose arrival
 * was never observed is excluded from "today" by SQL NULL semantics, and letting
 * that quietly shrink the arrival count is an unknown rendering as a zero.
 *
 * WARNING: NO PRODUCER IS WIRED YET. visitd posts to StateNour's device-events
 * route, not to `POST /api/camera/visits`, so until it gains a second sink these
 * reads return `neverIngested: true` and the section says "awaiting first event".
 * That is the honest state, not a bug in these queries.
 */
import { z } from "zod";
import { sql } from "drizzle-orm";

import { router, adminProcedure } from "../_core/trpc";
import { dbTyped } from "../lib/db-helper";

/** Start of the shop's day, in SQL, as UTC epoch seconds. Never computed in JS. */
const ET_DAY_START = sql`UNIX_TIMESTAMP(CONVERT_TZ(DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')), 'America/New_York', '+00:00'))`;

/** Age of a column in whole minutes, timezone-independent. */
const ageMinutes = (col: string) =>
  sql.raw(`FLOOR((UNIX_TIMESTAMP() - UNIX_TIMESTAMP(${col})) / 60)`);

const OPEN_VISIT_CAP = 500;

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** mysql2 returns [rows, fields] for raw execute; drizzle may hand back either shape. */
function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as Array<Record<string, unknown>>;
  }
  return (Array.isArray(result) ? result : []) as Array<Record<string, unknown>>;
}

/**
 * Nearest-rank percentile on an ascending array. Not interpolated: at n=2 the median
 * is the LOWER of the pair, which is the conservative reading for a wait time.
 */
export function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export const lotRouter = router({
  /**
   * The counter card: what is on the lot right now.
   *
   * `preexisting` is reported SEPARATELY from `arrivalsToday`. A car already parked
   * when the detector started occupies space but never arrived, and collapsing the
   * two is precisely the false-arrival defect the vision layer exists to prevent.
   */
  now: adminProcedure.query(async () => {
    const d = await dbTyped();
    if (!d) return { ok: false as const, reason: "database unavailable" };

    try {
      const agg = rowsOf(await d.execute(sql`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN departedAt IS NULL THEN 1 ELSE 0 END) AS onProperty,
          SUM(CASE WHEN departedAt IS NULL AND bayEnteredAt IS NOT NULL
                    AND bayExitedAt IS NULL THEN 1 ELSE 0 END) AS inBays,
          SUM(CASE WHEN departedAt IS NULL AND bayEnteredAt IS NOT NULL
                    AND bayExitedAt IS NULL AND bay IS NULL THEN 1 ELSE 0 END) AS bayUnknown,
          SUM(CASE WHEN departedAt IS NULL AND bayExitedAt IS NOT NULL THEN 1 ELSE 0 END) AS postService,
          SUM(CASE WHEN departedAt IS NULL AND bayEnteredAt IS NULL
                    AND preexisting = 0 THEN 1 ELSE 0 END) AS waiting,
          SUM(CASE WHEN departedAt IS NULL AND preexisting = 1 THEN 1 ELSE 0 END) AS preexisting,
          SUM(CASE WHEN departedAt IS NULL AND bayEnteredAt IS NULL
                    AND preexisting = 1 THEN 1 ELSE 0 END) AS preexistingWaiting,
          MAX(CASE WHEN departedAt IS NULL AND bayEnteredAt IS NULL AND preexisting = 0
                   THEN ${ageMinutes("COALESCE(waitStartedAt, arrivedAt)")} END) AS oldestWaitMinutes,
          SUM(CASE WHEN preexisting = 0 AND UNIX_TIMESTAMP(arrivedAt) >= ${ET_DAY_START}
                   THEN 1 ELSE 0 END) AS arrivalsToday,
          SUM(CASE WHEN UNIX_TIMESTAMP(departedAt) >= ${ET_DAY_START} THEN 1 ELSE 0 END) AS departuresToday,
          SUM(CASE WHEN preexisting = 0 AND bayEnteredAt IS NULL
                    AND UNIX_TIMESTAMP(departedAt) >= ${ET_DAY_START} THEN 1 ELSE 0 END) AS abandonedBeforeBay,
          SUM(CASE WHEN preexisting = 0 AND arrivedAt IS NULL THEN 1 ELSE 0 END) AS arrivalTimeUnknown,
          SUM(CASE WHEN plateStatus = 'CONFIRMED'
                    AND UNIX_TIMESTAMP(arrivedAt) >= ${ET_DAY_START} THEN 1 ELSE 0 END) AS plateConfirmed,
          SUM(CASE WHEN plateStatus = 'AMBIGUOUS'
                    AND UNIX_TIMESTAMP(arrivedAt) >= ${ET_DAY_START} THEN 1 ELSE 0 END) AS plateAmbiguous,
          SUM(CASE WHEN customerMatch = 'EXACT'
                    AND UNIX_TIMESTAMP(arrivedAt) >= ${ET_DAY_START} THEN 1 ELSE 0 END) AS customerExact,
          SUM(CASE WHEN customerMatch = 'CONFUSABLE_UNIQUE'
                    AND UNIX_TIMESTAMP(arrivedAt) >= ${ET_DAY_START} THEN 1 ELSE 0 END) AS customerConfusable,
          SUM(CASE WHEN customerMatch = 'AMBIGUOUS'
                    AND UNIX_TIMESTAMP(arrivedAt) >= ${ET_DAY_START} THEN 1 ELSE 0 END) AS customerAmbiguous,
          MIN(UNIX_TIMESTAMP() - UNIX_TIMESTAMP(updatedAt)) AS staleSeconds
        FROM vehicle_visits
      `));

      const r = agg[0];
      if (!r) return { ok: false as const, reason: "vehicle_visits returned no aggregate row" };

      const waits = rowsOf(await d.execute(sql`
        SELECT ${sql.raw("FLOOR((UNIX_TIMESTAMP(bayEnteredAt) - UNIX_TIMESTAMP(COALESCE(waitStartedAt, arrivedAt))) / 60)")} AS m
        FROM vehicle_visits
        WHERE bayEnteredAt IS NOT NULL
          AND COALESCE(waitStartedAt, arrivedAt) IS NOT NULL
          AND UNIX_TIMESTAMP(bayEnteredAt) >= ${ET_DAY_START}
        ORDER BY bayEnteredAt DESC
        LIMIT 1000
      `))
        .map((w) => num(w.m))
        .filter((m) => Number.isFinite(m) && m >= 0)
        .sort((a, b) => a - b);

      const bays = rowsOf(await d.execute(sql`
        SELECT bay, MIN(${ageMinutes("bayEnteredAt")}) AS occupiedMinutes
        FROM vehicle_visits
        WHERE departedAt IS NULL AND bayEnteredAt IS NOT NULL AND bayExitedAt IS NULL
          AND bay IS NOT NULL
        GROUP BY bay
        ORDER BY bay
      `));

      const total = num(r.total);
      const onProperty = num(r.onProperty);
      return {
        ok: true as const,
        asOf: new Date().toISOString(),
        neverIngested: total === 0,
        // The counters are exact SQL aggregates; this flags the one place a cap still
        // bites, so a large backlog is disclosed rather than presented as a total.
        truncated: onProperty > OPEN_VISIT_CAP,
        staleSeconds: total === 0 ? null : num(r.staleSeconds),
        counts: {
          onProperty,
          waiting: num(r.waiting),
          inBays: num(r.inBays),
          bayUnknown: num(r.bayUnknown),
          postService: num(r.postService),
          preexisting: num(r.preexisting),
          preexistingWaiting: num(r.preexistingWaiting),
          arrivalsToday: num(r.arrivalsToday),
          departuresToday: num(r.departuresToday),
          abandonedBeforeBay: num(r.abandonedBeforeBay),
          arrivalTimeUnknown: num(r.arrivalTimeUnknown),
        },
        waits: {
          oldestWaitMinutes:
            r.oldestWaitMinutes === null || r.oldestWaitMinutes === undefined
              ? null
              : num(r.oldestWaitMinutes),
          medianMinutes: percentile(waits, 50),
          p90Minutes: percentile(waits, 90),
          sampleSize: waits.length,
        },
        bays: bays.map((b) => ({
          bay: String(b.bay),
          occupiedMinutes: b.occupiedMinutes === null ? null : num(b.occupiedMinutes),
        })),
        identity: {
          plateConfirmed: num(r.plateConfirmed),
          plateAmbiguous: num(r.plateAmbiguous),
          customerExact: num(r.customerExact),
          // Deliberately surfaced: a confusable match is NOT a customer identity and
          // must never be auto-bound to one.
          customerConfusable: num(r.customerConfusable),
          customerAmbiguous: num(r.customerAmbiguous),
        },
      };
    } catch (err) {
      // A missing table (migration not applied yet) lands here too. Reporting the
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
        // COALESCE(arrivedAt, createdAt): MySQL sorts NULLs lowest, so a plain
        // `arrivedAt DESC` pushed every never-observed-arrival visit to the END of the
        // ordering. Past `limit` rows those became permanently invisible — the rows the
        // schema deliberately permits were exactly the ones the table hid.
        const list = rowsOf(await d.execute(sql`
          SELECT visitId, camera, state, arrivedAt, bayEnteredAt, bayExitedAt, departedAt,
                 bay, preexisting, entryEvidence, plateStatus, plateText, customerMatch,
                 estimatedFields, cameraPose
          FROM vehicle_visits
          ${input.openOnly ? sql`WHERE departedAt IS NULL` : sql``}
          ORDER BY COALESCE(arrivedAt, createdAt) DESC
          LIMIT ${input.limit}
        `));

        const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);
        return {
          ok: true as const,
          rows: list.map((v) => ({
            visitId: String(v.visitId),
            camera: String(v.camera),
            state: String(v.state),
            arrivedAt: iso(v.arrivedAt),
            bayEnteredAt: iso(v.bayEnteredAt),
            bayExitedAt: iso(v.bayExitedAt),
            departedAt: iso(v.departedAt),
            bay: (v.bay as string | null) ?? null,
            preexisting: Boolean(v.preexisting),
            entryEvidence: (v.entryEvidence as string | null) ?? null,
            plateStatus: String(v.plateStatus ?? "NONE"),
            // Plate text is shown only when the read is CONFIRMED. A candidate or
            // ambiguous string on screen becomes a fact in someone's head.
            plateText: v.plateStatus === "CONFIRMED" ? ((v.plateText as string | null) ?? null) : null,
            customerMatch: String(v.customerMatch ?? "NONE"),
            // customerId is deliberately NOT sent: nothing renders it, and shipping a
            // customer identifier to the browser unrendered is PII on the wire.
            estimatedFields: Array.isArray(v.estimatedFields) ? (v.estimatedFields as string[]) : [],
            cameraPose: (v.cameraPose as string | null) ?? null,
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
   * EVENT FRESHNESS, not camera health.
   *
   * This ages the most recent VISIT ROW per camera. visitd emits nothing while the
   * lot is quiet, so a perfectly healthy camera watching an empty lot looks old
   * here — the first version called that "stale", which reads as a broken camera.
   * True liveness is the device heartbeat visitd PATCHes every 60s, which this
   * router does not have. The states are `recent` / `quiet` / `unknown` so nobody
   * mistakes silence for failure.
   */
  health: adminProcedure.query(async () => {
    const d = await dbTyped();
    if (!d) return { ok: false as const, reason: "database unavailable" };

    try {
      // Pose and detector come from the LATEST row, not MAX() over the group: MAX on a
      // varchar is alphabetical, so a camera re-posed from `north-high` to `east-low`
      // would report `north-high` forever — and pose is the provenance that says
      // whether detections are valid at all.
      const list = rowsOf(await d.execute(sql`
        SELECT v.camera,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(v.updatedAt) AS ageSeconds,
               v.updatedAt AS lastSeen,
               v.cameraPose, v.detectorName,
               (SELECT COUNT(*) FROM vehicle_visits o
                 WHERE o.camera = v.camera AND o.departedAt IS NULL) AS openVisits
        FROM vehicle_visits v
        INNER JOIN (
          SELECT camera, MAX(updatedAt) AS mx FROM vehicle_visits GROUP BY camera
        ) latest ON latest.camera = v.camera AND latest.mx = v.updatedAt
        GROUP BY v.camera, v.updatedAt, v.cameraPose, v.detectorName
        ORDER BY v.camera
      `));

      return {
        ok: true as const,
        cameras: list.map((r) => {
          const ageSeconds =
            r.ageSeconds === null || r.ageSeconds === undefined ? null : num(r.ageSeconds);
          return {
            camera: String(r.camera),
            lastSeen: r.lastSeen ? new Date(r.lastSeen as string | Date).toISOString() : null,
            ageSeconds,
            // Unknown age is UNKNOWN, never healthy.
            status: ageSeconds === null ? "unknown" : ageSeconds < 300 ? "recent" : "quiet",
            pose: (r.cameraPose as string | null) ?? null,
            detector: (r.detectorName as string | null) ?? null,
            openVisits: num(r.openVisits),
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
