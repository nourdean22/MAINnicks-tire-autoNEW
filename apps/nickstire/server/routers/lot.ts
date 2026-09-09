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
 * PRODUCER STATUS (corrected 2026-09-09). This header used to say "NO PRODUCER IS
 * WIRED YET". That was true when it was written and is now false: `visitd`'s
 * `shop_mirror` posts visit rows from its `after_step`, and `vision/run_live.py`'s
 * `VisitSink` posts pipeline emissions directly. Both are merged.
 *
 * What remains true: until migration `0119_vehicle_visits` is applied to production
 * AND a producer runs against a live camera, these reads return
 * `neverIngested: true` and the section says "awaiting first event". That is the
 * honest state, not a bug in these queries.
 */
import { z } from "zod";
import { sql } from "drizzle-orm";

import { router, adminProcedure } from "../_core/trpc";
import { dbTyped } from "../lib/db-helper";
import { deriveCameraState, HEALTH_THRESHOLDS } from "../lib/cameraHealth";
import { EXPECTED_CAMERAS } from "../../shared/cameras";

/** Start of the shop's day, in SQL, as UTC epoch seconds. Never computed in JS. */
const ET_DAY_START = sql`UNIX_TIMESTAMP(CONVERT_TZ(DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York')), 'America/New_York', '+00:00'))`;

/** Age of a column in whole minutes, timezone-independent. */
const ageMinutes = (col: string) =>
  sql.raw(`FLOOR((UNIX_TIMESTAMP() - UNIX_TIMESTAMP(${col})) / 60)`);

/**
 * Whole minutes between two columns, in SQL, NULL-safe at BOTH ends.
 *
 * `from` is the anchor: if it is NULL the answer is NULL, never 0 — an unobserved
 * arrival must not render as "here 0 minutes", which reads as "just pulled in".
 * `toCoalesce` lets an OPEN interval run to NOW(), so a car still on the lot shows a
 * growing number instead of a blank.
 *
 * This is SQL and not JS on purpose. `apps/nickstire/AGENTS.md`: driver-parsed TiDB
 * DATETIME values come back shifted on ET, so subtracting them in JavaScript produces
 * durations that are wrong by the UTC offset -- four or five hours, silently, and
 * worst in exactly the "how long has this car been waiting" number an operator acts on.
 */
const minutesBetween = (from: string, toCoalesce: string[]) =>
  sql.raw(
    `CASE WHEN ${from} IS NULL THEN NULL ELSE GREATEST(0, FLOOR(` +
    `(UNIX_TIMESTAMP(COALESCE(${toCoalesce.join(", ")})) - UNIX_TIMESTAMP(${from})) / 60)) END`,
  );

const OPEN_VISIT_CAP = 500;

/**
 * WHAT THIS CAMERA CAN AND CANNOT KNOW ABOUT SERVICE.
 *
 * Operator, 2026-09-09, in two parts. First: "we change tires, do plugs, n small shit
 * outside with the cars on jacks in the blue; all the mechanic work needs a lift goes
 * inside." Then, when asked to confirm a work zone: "we will jack the cars up wherever
 * necessary."
 *
 * That second sentence is the important one, and it kills a whole class of metric.
 * OUTSIDE SERVICE HAS NO FIXED LOCATION, so it cannot be recognised by geometry. A car
 * standing on the apron may be queueing or may be up on jacks having a plug fitted, and
 * this system cannot tell which. An earlier version of this file tried to solve it with
 * an `outside_*` zone; that was wrong, and a zone that can never be populated is worse
 * than no zone -- it is a permanently-zero number that reads as "no outside work today".
 *
 * So the counters below claim only what the camera can actually establish:
 *
 *   inBays            a vehicle is inside bay 1 or bay 3    -- OBSERVED
 *   onLotNotInBay     on the property, not in a bay         -- OBSERVED, and it
 *                     deliberately is NOT called "waiting": some of these cars are
 *                     being worked on where they stand.
 *   leftWithoutBay    departed having never entered a bay   -- OBSERVED, and NOT called
 *                     "abandoned": a finished outside tyre job looks exactly like a
 *                     customer who gave up, and calling good business a loss is the
 *                     worse error of the two.
 *
 * Wait times are only computable for vehicles that reached a bay, and are labelled as
 * time-to-bay rather than as the shop's wait. Turning "on the lot" into a trustworthy
 * queue needs a service-start signal the camera does not have -- a repair order opening,
 * or a check-in -- not a cleverer polygon.
 *
 * BAY LAYOUT (operator): vehicles drive into bays 1 and 3 ONLY. Bay 2 holds the tire
 * machines and bay 4 is stock, so neither ever contains a customer vehicle; drawing them
 * as service bays would manufacture service events from cars parked in front of a
 * machine room. Corroborated in the live frame, where tyre stacks sit in front of the
 * rightmost opening.
 */

function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Like `num`, but preserves NULL. Used for durations, where NULL means "we never saw
 * the start" and 0 means "it started this minute" -- two different facts that `num`
 * would flatten into the same reassuring zero.
 */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
function percentile(sorted: number[], p: number): number | null {
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
          SUM(CASE WHEN departedAt IS NULL
                    AND NOT (bayEnteredAt IS NOT NULL AND bayExitedAt IS NULL) THEN 1 ELSE 0 END) AS onLotNotInBay,
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
        WHERE dataClass = 'PRODUCTION'
      `));

      const r = agg[0];
      if (!r) return { ok: false as const, reason: "vehicle_visits returned no aggregate row" };

      const waits = rowsOf(await d.execute(sql`
        SELECT ${sql.raw("FLOOR((UNIX_TIMESTAMP(bayEnteredAt) - UNIX_TIMESTAMP(COALESCE(waitStartedAt, arrivedAt))) / 60)")} AS m
        FROM vehicle_visits
        WHERE bayEnteredAt IS NOT NULL
          AND dataClass = 'PRODUCTION'
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
          AND dataClass = 'PRODUCTION'
          AND bay IS NOT NULL
        GROUP BY bay
        ORDER BY bay
      `));

      // Commissioning / replay rows are excluded from every counter above and are
      // never deleted; this count keeps them visible so "no production visit yet"
      // can be told apart from "nothing has ever been written".
      const nonProd = rowsOf(await d.execute(sql`
        SELECT COUNT(*) AS n FROM vehicle_visits WHERE dataClass <> 'PRODUCTION'
      `))[0];

      const total = num(r.total);
      const onProperty = num(r.onProperty);
      return {
        ok: true as const,
        asOf: new Date().toISOString(),
        neverIngested: total === 0,
        commissioningVisits: num(nonProd?.n ?? 0),
        // The counters are exact SQL aggregates; this flags the one place a cap still
        // bites, so a large backlog is disclosed rather than presented as a total.
        truncated: onProperty > OPEN_VISIT_CAP,
        staleSeconds: total === 0 ? null : num(r.staleSeconds),
        counts: {
          onProperty,
          // Every car on the property that is not in a bay RIGHT NOW: cars that never
          // entered one, cars that came back out, and cars that were already here at
          // startup. This is the population the label names. `waitingForBay` is the
          // narrower never-entered, non-preexisting set the wait clock runs on; it
          // was the value shown here before, and it undercounted a car waiting
          // outside after leaving a bay (Codex P2 on #2250).
          onLotNotInBay: num(r.onLotNotInBay),
          waitingForBay: num(r.waiting),
          // Service, split by WHERE it happens. `inService` is the honest headline --
          // a car on jacks outside is being worked on just as much as one on a lift.
          inBays: num(r.inBays),
          bayUnknown: num(r.bayUnknown),
          postService: num(r.postService),
          preexisting: num(r.preexisting),
          preexistingWaiting: num(r.preexistingWaiting),
          arrivalsToday: num(r.arrivalsToday),
          departuresToday: num(r.departuresToday),
          leftWithoutBay: num(r.abandonedBeforeBay),
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
      /** Commissioning / replay rows are hidden unless asked for, never deleted. */
      includeCommissioning: z.boolean().default(false),
    }).default({ limit: 50, openOnly: false, includeCommissioning: false }))
    .query(async ({ input }) => {
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "database unavailable" };

      try {
        // COALESCE(arrivedAt, createdAt): MySQL sorts NULLs lowest, so a plain
        // `arrivedAt DESC` pushed every never-observed-arrival visit to the END of the
        // ordering. Past `limit` rows those became permanently invisible — the rows the
        // schema deliberately permits were exactly the ones the table hid.
        // The four duration columns below, explained OUT HERE rather than as `--`
        // comments inside the template literal. `rawSqlTablesExist.test.ts` scans raw
        // SQL for table references and does not strip comments, so ordinary prose
        // containing the word "from" mints a phantom table -- this exact block failed
        // that gate with a table named `the`, out of "from the wait clock". Prose in a
        // SQL string is parseable by the auditor and unreadable to it; keep it in TS.
        //
        //   onPropertyMinutes      arrival -> departure or now. NULL when the arrival
        //                          was never observed, so the UI says "first seen"
        //                          rather than inventing a start.
        //   sinceFirstSeenMinutes  createdAt -> departure or now. createdAt is NOT
        //                          NULL, so an unobserved arrival still gets an honest
        //                          floor: "here at least this long".
        //   waitMinutes            wait clock (or arrival) -> bay, departure, or now.
        //                          A still-waiting car keeps counting up.
        //   bayMinutes             bay entry -> bay exit, departure, or now.
        const list = rowsOf(await d.execute(sql`
          SELECT visitId, camera, state, arrivedAt, waitStartedAt, bayEnteredAt,
                 bayExitedAt, departedAt,
                 bay, preexisting, entryEvidence, plateStatus, plateText, customerMatch,
                 estimatedFields, cameraPose, dataClass, commissioningRunId,
                 ${minutesBetween("arrivedAt", ["departedAt", "NOW()"])} AS onPropertyMinutes,
                 ${minutesBetween("createdAt", ["departedAt", "NOW()"])} AS sinceFirstSeenMinutes,
                 ${minutesBetween("COALESCE(waitStartedAt, arrivedAt)", ["bayEnteredAt", "departedAt", "NOW()"])} AS waitMinutes,
                 ${minutesBetween("bayEnteredAt", ["bayExitedAt", "departedAt", "NOW()"])} AS bayMinutes
          FROM vehicle_visits
          WHERE ${input.includeCommissioning ? sql`1 = 1` : sql`dataClass = 'PRODUCTION'`}
            ${input.openOnly ? sql`AND departedAt IS NULL` : sql``}
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
            waitStartedAt: iso(v.waitStartedAt),
            bayEnteredAt: iso(v.bayEnteredAt),
            bayExitedAt: iso(v.bayExitedAt),
            departedAt: iso(v.departedAt),
            // Durations arrive already computed by SQL. `numOrNull`, not `num`: these
            // are deliberately nullable and 0 is a REAL value ("just arrived"), so
            // collapsing NULL to 0 here would erase the distinction the CASE above
            // exists to preserve.
            onPropertyMinutes: numOrNull(v.onPropertyMinutes),
            sinceFirstSeenMinutes: numOrNull(v.sinceFirstSeenMinutes),
            waitMinutes: numOrNull(v.waitMinutes),
            bayMinutes: numOrNull(v.bayMinutes),
            open: !v.departedAt,
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
            dataClass: String(v.dataClass ?? "PRODUCTION"),
            commissioningRunId: (v.commissioningRunId as string | null) ?? null,
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
   * CAMERA HEALTH -- the infrastructure fact, kept apart from visits.
   *
   * Joins the registry of cameras the shop EXPECTS (shared/cameras.ts) to the latest
   * producer heartbeat per camera (camera_runtime, migration 0120). A camera that has
   * never reported renders NEVER_INGESTED instead of vanishing from the list -- the
   * previous implementation derived the camera list from vehicle_visits, so a healthy
   * producer on a quiet lot was indistinguishable from no producer at all.
   *
   * Liveness (STALE / PRODUCER_OFFLINE) is derived HERE from heartbeat age; every
   * other dimension is what the producer reported about itself. Ages are SQL epoch
   * arithmetic, never JS date math (driver-parsed TiDB timestamps shift on ET).
   */
  health: adminProcedure.query(async () => {
    const d = await dbTyped();
    if (!d) return { ok: false as const, reason: "database unavailable" };

    try {
      const runtime = rowsOf(await d.execute(sql`
        SELECT r.camera, r.producerInstanceId, r.producerVersion, r.gitSha, r.heartbeatSeq,
               r.mode, r.commissioningRunId,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.receivedAt) AS ageSeconds,
               UNIX_TIMESTAMP(r.receivedAt) AS receivedAtEpoch,
               UNIX_TIMESTAMP(r.observedAtEdge) AS observedAtEdgeEpoch,
               UNIX_TIMESTAMP(r.lastHealthyFrameAt) AS lastHealthyFrameAtEpoch,
               r.sourceType, r.sourceGeneration, r.sourceConnected, r.captureFps,
               r.frameOk, r.poseOk, r.poseDelta, r.calibrationVersion, r.detectorName,
               r.modelSha256, r.inferenceP95Ms, r.outboxDepth, r.oldestOutboxAgeSeconds,
               r.deadLetterDepth,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastCloudAckAt) AS cloudAckAgeSeconds,
               r.diskFreeBytes, r.restores,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.stateSince) AS stateForSeconds,
               (SELECT COUNT(*) FROM vehicle_visits o
                 WHERE o.camera = r.camera AND o.departedAt IS NULL
                   AND o.dataClass = 'PRODUCTION') AS openVisits
        FROM camera_runtime r
      `));
      const transitions = rowsOf(await d.execute(sql`
        SELECT camera, fromState, toState, reason,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(at) AS agoSeconds
        FROM camera_health_events
        ORDER BY at DESC
        LIMIT 20
      `));

      const byCamera = new Map(runtime.map((r) => [String(r.camera), r]));
      const bool = (v: unknown): boolean | null =>
        v === null || v === undefined ? null : Boolean(Number(v));
      const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

      const describe = (camera: string, label: string, commissioned: boolean, registered: boolean) => {
        const r = byCamera.get(camera) ?? null;
        const verdict = deriveCameraState(
          r === null
            ? null
            : {
                ageSeconds: numOrNull(r.ageSeconds),
                observedAtEdgeEpoch: numOrNull(r.observedAtEdgeEpoch),
                receivedAtEpoch: numOrNull(r.receivedAtEpoch),
                sourceConnected: bool(r.sourceConnected),
                lastHealthyFrameAtEpoch: numOrNull(r.lastHealthyFrameAtEpoch),
                frameOk: bool(r.frameOk),
                poseOk: bool(r.poseOk),
                calibrationVersion: str(r.calibrationVersion),
                outboxDepth: numOrNull(r.outboxDepth),
                oldestOutboxAgeSeconds: numOrNull(r.oldestOutboxAgeSeconds),
                deadLetterDepth: numOrNull(r.deadLetterDepth),
              },
        );
        return {
          camera,
          label,
          commissioned,
          registered,
          state: verdict.state,
          facets: verdict.facets,
          reason: verdict.reason,
          ageSeconds: r ? numOrNull(r.ageSeconds) : null,
          stateForSeconds: r ? numOrNull(r.stateForSeconds) : null,
          mode: r ? String(r.mode ?? "PRODUCTION") : null,
          commissioningRunId: r ? str(r.commissioningRunId) : null,
          producer: r
            ? { instanceId: String(r.producerInstanceId), version: str(r.producerVersion), gitSha: str(r.gitSha), heartbeatSeq: num(r.heartbeatSeq) }
            : null,
          source: r
            ? { type: str(r.sourceType), generation: str(r.sourceGeneration), fps: numOrNull(r.captureFps), restores: numOrNull(r.restores) }
            : null,
          vision: r
            ? { detector: str(r.detectorName), modelSha256: str(r.modelSha256), inferenceP95Ms: numOrNull(r.inferenceP95Ms), poseDelta: numOrNull(r.poseDelta), calibrationVersion: str(r.calibrationVersion) }
            : null,
          cloud: r
            ? { outboxDepth: numOrNull(r.outboxDepth), oldestOutboxAgeSeconds: numOrNull(r.oldestOutboxAgeSeconds), deadLetterDepth: numOrNull(r.deadLetterDepth), cloudAckAgeSeconds: numOrNull(r.cloudAckAgeSeconds), diskFreeBytes: numOrNull(r.diskFreeBytes) }
            : null,
          openVisits: r ? num(r.openVisits) : 0,
        };
      };

      const expected = EXPECTED_CAMERAS.map((c) => describe(c.camera, c.label, c.commissioned, true));
      const known = new Set<string>(EXPECTED_CAMERAS.map((c) => c.camera));
      // A producer nobody registered is shown, not hidden: it is either a config typo
      // (camera id mismatch) or something posting under the shop's key that should not be.
      const unregistered = runtime
        .filter((r) => !known.has(String(r.camera)))
        .map((r) => describe(String(r.camera), `Unregistered producer: ${String(r.camera)}`, false, false));
      const cameras = [...expected, ...unregistered];

      return {
        ok: true as const,
        asOf: new Date().toISOString(),
        thresholds: HEALTH_THRESHOLDS,
        cameras,
        healthy: cameras.filter((c) => c.state === "HEALTHY").length,
        expected: expected.length,
        transitions: transitions.map((t) => ({
          camera: String(t.camera),
          from: str(t.fromState),
          to: String(t.toState),
          reason: str(t.reason),
          agoSeconds: num(t.agoSeconds),
        })),
      };
    } catch (err) {
      return {
        ok: false as const,
        reason: err instanceof Error ? err.message : "camera_runtime health read failed",
      };
    }
  }),
});
