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
 * 4. **Drive-bys are not arrivals, departures or abandonments (2026-10-07).** A
 *    PASS_THROUGH row carries an `arrivedAt` and a `departedAt` and never a bay, so it
 *    counted once in `arrivalsToday`, once in `departuresToday` and once in
 *    `leftWithoutBay` -- three customer-shaped numbers from a car that turned around
 *    (17 of 111 rows on 2026-09-18). They are now excluded from all three and counted
 *    on their own as `passThroughsToday`. `arrivalsToday` also counts EPISODES
 *    (`COALESCE(episodeId, visitId)`), so a track the stitcher folded into an earlier
 *    visit is one car, not two.
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
import { deriveCameraState, HEALTH_THRESHOLDS, shopOpenAt } from "../lib/cameraHealth";
import { solarExpectedOffline } from "../lib/solar";
import { CAMERA_RUNTIME_WINDOW_COLUMNS_0144, cameraRuntimeHasColumns } from "../lib/heartbeatStorableColumns";
import {
  assessEdgeQuiescence, buildCommissioningReport, EDGE_SETTLE_MS, estimateClockOffset,
  machineEventsFromVisit, QUIESCENCE_HEARTBEAT_MAX_AGE_S, TRUTH_EVENTS,
} from "../lib/commissioningReport";
import { EXPECTED_CAMERAS, cameraPowerFor } from "../../shared/cameras";
import { VISIT_MARKS } from "../../shared/visitMarks";
import { deriveVisitMarkState, type VisitMarkRow } from "../lib/visitMarks";
import { isDuplicateKeyError, isMissingTableError, logSafeErrorMessage } from "../lib/dbErrors";
import { insertedId, writeResult } from "../lib/dbResult";
import { createLogger } from "../lib/logger";
import { jsonArray, transcriptCoverage } from "../lib/conversationQuality";
import { conversationEpisodeColumnReady, officeVisualColumnReady, storedVisual, __resetOfficeVisualCalibration } from "../services/officeVisual";

const log = createLogger("routers:lot");

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

/**
 * The MINIMUM wait after a run ends before its verdict may be recorded.
 *
 * The edge emits a terminal state only after its departure grace and then drains the shop
 * projection on a timer with retries, so the last events of a run legitimately arrive
 * after the operator has pressed End.
 *
 * ⚠ ELAPSED TIME ALONE IS NOT QUIESCENCE, and treating it as such was the bug. The shop
 * outbox retries an unreachable row INDEFINITELY, so a two-minute WAN outage would let
 * this window pass with the terminal row still queued -- freezing a missing-departure
 * FAIL for a run that was fine (Codex P1 on #2255). Settlement therefore also requires
 * the camera's own heartbeat to report an EMPTY outbox: the edge saying "I have nothing
 * left to send" is an acknowledgement, where a clock is only a hope.
 */

/**
 * Load one commissioning run and diff it against what the machine recorded.
 *
 * Shared by the report query and the end mutation so the two can never disagree about the
 * same run. Every timestamp is converted to epoch MILLISECONDS by SQL
 * (`ROUND(UNIX_TIMESTAMP(col) * 1000)`) rather than by parsing a Date in JS: this is a
 * measurement of sub-second differences, and a driver timezone shift would not look wrong
 * here -- it would look like a catastrophic pipeline latency.
 */
async function loadCommissioningReport(
  d: NonNullable<Awaited<ReturnType<typeof dbTyped>>>,
  runId: string,
  toleranceMs: number,
) {
  const run = rowsOf(await d.execute(sql`
    SELECT runId, camera, label, verdict, clockOffsetMs, clockRttMs, clockSamples,
           ${sql.raw("ROUND(UNIX_TIMESTAMP(startedAt) * 1000)")} AS startedMs,
           ${sql.raw("ROUND(UNIX_TIMESTAMP(endedAt) * 1000)")} AS endedMs,
           ${sql.raw("ROUND(UNIX_TIMESTAMP(monoOriginAt) * 1000)")} AS monoOriginMs
    FROM commissioning_runs WHERE runId = ${runId}
  `))[0];
  if (!run) return null;

  // Both clocks come back: the wall reading (corrected by the run's offset) AND the
  // monotonic offset. The report prefers the monotonic one and discloses any disagreement,
  // because a phone that stepped its wall clock mid-run would otherwise fail a correct
  // pipeline with a jump it recorded about itself.
  const taps = rowsOf(await d.execute(sql`
    SELECT event, phoneMonoMs,
           ${sql.raw("ROUND(UNIX_TIMESTAMP(COALESCE(correctedAt, phoneWallAt)) * 1000)")} AS atMs
    FROM commissioning_truth_events
    WHERE runId = ${runId}
    ORDER BY COALESCE(correctedAt, phoneWallAt) ASC
  `));

  const visits = rowsOf(await d.execute(sql`
    SELECT visitId, arrivedAt, bayEnteredAt, departedAt
    FROM vehicle_visits WHERE commissioningRunId = ${runId}
  `));

  const clock = run.clockSamples === null || run.clockSamples === undefined
    ? null
    : { offsetMs: num(run.clockOffsetMs), rttMs: num(run.clockRttMs), samples: num(run.clockSamples) };

  // ANCHOR THE MONOTONIC TAPS TO THE PHONE'S OWN ZERO POINT. `phoneMonoMs` counts from the
  // instant the CLIENT zeroed its timer, which is after `startCommissioning` returned;
  // anchoring to the server's `startedAt` would add the whole request round trip to every
  // tap as a constant error, so a slow start would read as a wall-clock step or push a
  // valid run past the tolerance (Codex P2 on #2255). Fall back to `startedAt` only for
  // runs recorded before the anchor existed -- and those keep the old, slightly-off
  // behaviour rather than silently losing their monotonic reading altogether.
  const startedMs = numOrNull(run.startedMs);
  const monoOriginMs = numOrNull(run.monoOriginMs) ?? startedMs;
  const report = buildCommissioningReport(
    taps
      .filter((t) => t.atMs !== null && t.atMs !== undefined)
      .map((t) => ({
        event: String(t.event),
        atMs: num(t.atMs),
        monoAtMs: monoOriginMs === null || t.phoneMonoMs === null || t.phoneMonoMs === undefined
          ? null
          : monoOriginMs + num(t.phoneMonoMs),
      })),
    visits.flatMap((v) => machineEventsFromVisit({
      visitId: String(v.visitId),
      arrivedAt: (v.arrivedAt as Date | string | null) ?? null,
      bayEnteredAt: (v.bayEnteredAt as Date | string | null) ?? null,
      departedAt: (v.departedAt as Date | string | null) ?? null,
    })),
    clock,
    { toleranceMs },
  );

  // HAS THE EDGE FINISHED SPEAKING? Two conditions, and the second is the one that makes
  // this an observation rather than a guess: enough time for the departure grace, AND the
  // camera's own latest heartbeat reporting an EMPTY shop outbox. A queue that is still
  // draining -- or a producer that has gone quiet and cannot vouch for anything -- leaves
  // the run unsettled, so a WAN outage postpones the verdict instead of freezing a wrong one.
  const endedMs = numOrNull(run.endedMs);
  const drain = rowsOf(await d.execute(sql`
    SELECT outboxDepth,
           ${sql.raw("UNIX_TIMESTAMP() - UNIX_TIMESTAMP(receivedAt)")} AS ageSeconds,
           -- lastHealthyFrameAt, NOT lastFrameAt. The first draft read the latter, which NO
           -- producer anywhere writes (grep camera-bridge: zero hits; the heartbeat body
           -- carries lastHealthyFrameAt only). It would have been NULL forever, so the
           -- frames check would have been false forever and NO run would ever settle -- a
           -- false pass swapped for a permanent hang. It is also the stronger claim, and
           -- the one cameraHealth.ts already uses for its frames facet: a frozen camera
           -- keeps delivering frames, just not healthy ones.
           ${sql.raw("UNIX_TIMESTAMP() - UNIX_TIMESTAMP(lastHealthyFrameAt)")} AS frameAgeSeconds,
           ${sql.raw("ROUND(UNIX_TIMESTAMP(receivedAt) * 1000)")} AS receivedMs
    FROM camera_runtime WHERE camera = ${String(run.camera)}
  `))[0];
  const drainAge = drain ? numOrNull(drain.ageSeconds) : null;
  const drainDepth = drain ? numOrNull(drain.outboxDepth) : null;
  const drainReceivedMs = drain ? numOrNull(drain.receivedMs) : null;
  const drainFrameAge = drain ? numOrNull(drain.frameAgeSeconds) : null;
  const quiescence = assessEdgeQuiescence({
    endedMs,
    nowMs: Date.now(),
    heartbeatAgeS: drainAge,
    heartbeatReceivedMs: drainReceivedMs,
    frameAgeS: drainFrameAge,
    outboxDepth: drainDepth,
  });
  const settled = quiescence.settled;
  const unsettledReason = quiescence.reason;

  return {
    run: {
      runId: String(run.runId),
      camera: String(run.camera),
      label: (run.label as string | null) ?? null,
      startedMs,
      endedMs,
      open: !run.endedMs,
      clock,
      settled,
      unsettledReason,
      settleSeconds: Math.round(EDGE_SETTLE_MS / 1000),
    },
    report,
  };
}

/**
 * Record the verdict of every SETTLED run in `runIds` that needs it. Returns how many.
 *
 * Called from the history read, which the panel polls, so a finished run finalises on its
 * own instead of waiting for somebody to reopen the report -- the UI opens the report once,
 * immediately, while it is still provisional, so a reopen-triggered write meant the chip
 * stayed blank forever (Codex P2 on #2255).
 *
 * The stored verdict is REWRITTEN, not written once. A frozen answer sounds tidier, but a
 * late-arriving departure legitimately changes it, and a permanently wrong FAIL on the
 * record is worse than a value that converges. It only ever moves while the run is
 * settled, so it cannot flap.
 */
async function finalizeSettledVerdicts(
  d: NonNullable<Awaited<ReturnType<typeof dbTyped>>>,
  runIds: string[],
): Promise<number> {
  let written = 0;
  for (const runId of runIds) {
    try {
      const built = await loadCommissioningReport(d, runId, 3000);
      if (!built || !built.run.settled) continue;
      await d.execute(sql`
        UPDATE commissioning_runs
           SET verdict = ${built.report.verdict},
               verdictReason = ${(built.report.findings[0] ?? "").slice(0, 500) || null}
         WHERE runId = ${runId}
      `);
      written++;
    } catch (err) {
      // One run that cannot be finalised must not stop the others, and must never fail
      // the history read the operator is actually looking at -- so this stays caught.
      //
      // But it must not be SILENT. A settled run with no verdict looks exactly like a run
      // still settling, so a finalizer that throws on every call (a schema drift, a driver
      // change) would leave every verdict unwritten forever with nothing anywhere saying
      // why: the operator would read "provisional" and wait for something that is never
      // coming. Found in this branch's own adversarial re-read.
      log.warn("could not finalise a settled commissioning verdict", {
        runId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return written;
}

export const lotRouter = router({
  /**
   * Counter conversations — operational summaries only.
   *
   * Privacy/truth boundary:
   * - raw audio is never returned here
   * - full transcripts are never returned here
   * - candidate visit/work-order links stay explicitly confidence-scored
   * - self-test rows are hidden by default so commissioning does not look like customers
   *
   * Coverage is recomputed from timed transcript intervals rather than trusting a stored
   * scalar. Overlapping diarizer windows count once, and NULL means "cannot know" rather
   * than a reassuring zero.
   */
  conversations: adminProcedure
    .input(z.object({
      limit: z.number().int().min(1).max(100).default(25),
      includeSelftest: z.boolean().default(false),
    }).optional())
    .query(async ({ input }) => {
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "database unavailable" };

      const limit = input?.limit ?? 25;
      const includeSelftest = input?.includeSelftest ?? false;
      try {
        const where = includeSelftest ? sql`1 = 1` : sql`source <> 'selftest'`;
        // `visual` (migration 0140) is selected only once the column exists, so this read keeps
        // working on a database where the migration has not been applied yet.
        const visualReady = await officeVisualColumnReady(d);
        const gistReady = await conversationEpisodeColumnReady(d, "gist");
        const rows = rowsOf(await d.execute(sql`
          SELECT episodeId, source, cameraSerial, captureHost, triggerType,
                 ROUND(UNIX_TIMESTAMP(triggeredAt) * 1000) AS triggeredAtMs,
                 ROUND(UNIX_TIMESTAMP(startedAt) * 1000) AS startedAtMs,
                 durationSeconds, meanVolumeDb,
                 transcriptStatus, transcriptError, transcript,
                 sttEngine, sttModel, sttLatencyMs, speakerCount,
                 facts, summary,
                 vehicleVisitId, workOrderId, linkConfidence
                 ${visualReady ? sql`, visual` : sql``}
                 ${gistReady ? sql`, gist` : sql``}
            FROM conversation_episodes
           WHERE ${where}
           ORDER BY COALESCE(startedAt, createdAt) DESC
           LIMIT ${limit}
        `));

        return {
          ok: true as const,
          conversations: rows.map((r) => ({
            episodeId: String(r.episodeId),
            source: String(r.source),
            cameraSerial: r.cameraSerial == null ? null : String(r.cameraSerial),
            captureHost: r.captureHost == null ? null : String(r.captureHost),
            triggerType: r.triggerType == null ? null : String(r.triggerType),
            triggeredAtMs: numOrNull(r.triggeredAtMs),
            startedAtMs: numOrNull(r.startedAtMs),
            durationSeconds: numOrNull(r.durationSeconds),
            meanVolumeDb: numOrNull(r.meanVolumeDb),
            transcriptStatus: String(r.transcriptStatus ?? "PENDING"),
            transcriptError: r.transcriptError == null ? null : String(r.transcriptError),
            sttEngine: r.sttEngine == null ? null : String(r.sttEngine),
            sttModel: r.sttModel == null ? null : String(r.sttModel),
            sttLatencyMs: numOrNull(r.sttLatencyMs),
            speakerCount: numOrNull(r.speakerCount),
            coverage: transcriptCoverage(r.transcript, r.durationSeconds),
            factCount: jsonArray(r.facts).length,
            summary: r.summary == null ? null : String(r.summary),
            candidateVehicleVisitId: r.vehicleVisitId == null ? null : String(r.vehicleVisitId),
            candidateWorkOrderId: r.workOrderId == null ? null : String(r.workOrderId),
            linkConfidence: numOrNull(r.linkConfidence),
            visual: storedVisual(r.visual),
            gist: r.gist == null ? null : String(r.gist),
          })),
          visualAvailable: visualReady,
        };
      } catch (err) {
        return {
          ok: false as const,
          reason: err instanceof Error ? err.message : "conversation read failed",
        };
      }
    }),

  /**
   * Operator verdict on what the office camera "Saw" for one conversation. This is the
   * self-learning loop: reviewed descriptions become calibration notes in the next vision
   * prompt (services/officeVisual.ts loadVisualCalibrationDetailed), so a correction here changes how
   * the camera describes the next customer. Stored inside the existing `visual` JSON
   * (JSON_SET), so no migration; refused when the episode has no visual to review.
   */
  reviewConversationVisual: adminProcedure
    .input(z.object({
      episodeId: z.string().min(1).max(64),
      verdict: z.enum(["correct", "wrong"]),
      note: z.string().trim().max(300).nullish(),
    }))
    .mutation(async ({ input }) => {
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "database unavailable" };
      try {
        if (!(await officeVisualColumnReady(d))) return { ok: false as const, reason: "visual column not available" };
        const review = {
          verdict: input.verdict,
          note: input.verdict === "wrong" && input.note ? input.note : null,
          at: new Date().toISOString(),
        };
        const res = await d.execute(sql`
          UPDATE conversation_episodes
             SET visual = JSON_SET(visual, '$.review', CAST(${JSON.stringify(review)} AS JSON))
           WHERE episodeId = ${input.episodeId} AND visual IS NOT NULL
        `);
        // A header without affectedRows is "unknown", not zero (lib/dbResult.ts); only a reported
        // 0 means there was no stored description to review.
        if (writeResult(res).affectedRows === 0) return { ok: false as const, reason: "no camera description stored for that conversation" };
        __resetOfficeVisualCalibration();
        return { ok: true as const, review };
      } catch (err) {
        return { ok: false as const, reason: err instanceof Error ? err.message : "could not save the review" };
      }
    }),

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
          COUNT(DISTINCT CASE WHEN preexisting = 0 AND state <> 'PASS_THROUGH'
                              AND UNIX_TIMESTAMP(arrivedAt) >= ${ET_DAY_START}
                              THEN COALESCE(episodeId, visitId) END) AS arrivalsToday,
          SUM(CASE WHEN preexisting = 0 AND state = 'PASS_THROUGH'
                    AND UNIX_TIMESTAMP(arrivedAt) >= ${ET_DAY_START} THEN 1 ELSE 0 END) AS passThroughsToday,
          SUM(CASE WHEN state <> 'PASS_THROUGH'
                    AND UNIX_TIMESTAMP(departedAt) >= ${ET_DAY_START} THEN 1 ELSE 0 END) AS departuresToday,
          SUM(CASE WHEN preexisting = 0 AND state <> 'PASS_THROUGH' AND bayEnteredAt IS NULL
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

      // OPERATOR MARKS on the cars currently on the property (migration 0145; audit N1): how
      // many of them anyone has said anything about, and what. `available: false` means the
      // table is not there yet -- shown as such, never as zero marks.
      const marks = {
        available: false,
        openMarked: 0,
        customerWaiting: 0,
        serviceStarted: 0,
        serviceDone: 0,
        notAJob: 0,
      };
      try {
        const byMark = rowsOf(await d.execute(sql`
          SELECT m.mark, COUNT(DISTINCT m.visitId) AS n
          FROM vehicle_visit_marks m
          JOIN vehicle_visits v ON v.visitId = m.visitId
          WHERE v.departedAt IS NULL AND v.dataClass = 'PRODUCTION'
          GROUP BY m.mark
        `));
        const openMarked = rowsOf(await d.execute(sql`
          SELECT COUNT(DISTINCT m.visitId) AS n
          FROM vehicle_visit_marks m
          JOIN vehicle_visits v ON v.visitId = m.visitId
          WHERE v.departedAt IS NULL AND v.dataClass = 'PRODUCTION'
        `));
        const countOf = (mark: string) => num(byMark.find((row) => String(row.mark) === mark)?.n ?? 0);
        marks.available = true;
        marks.openMarked = num(openMarked[0]?.n ?? 0);
        marks.customerWaiting = countOf("CUSTOMER_WAITING");
        marks.serviceStarted = countOf("SERVICE_STARTED");
        marks.serviceDone = countOf("SERVICE_DONE");
        marks.notAJob = countOf("NOT_A_JOB");
      } catch (err) {
        if (!isMissingTableError(err)) throw err;
      }

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
          // Cars that crossed the portal and left without staying. Shipped beside the
          // arrivals so the two can never be read as one number again.
          passThroughsToday: num(r.passThroughsToday),
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
        marks: {
          ...marks,
          // The share never ships without its denominator: cars on the property right now.
          markedShare: marks.available && onProperty > 0 ? marks.openMarked / onProperty : null,
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

  /**
   * WHEN the lot is busy, and how much of that is real.
   *
   * Every other counter here is a scalar for "now" or "today", which cannot answer the
   * question the shop actually asks -- when do cars come in, and is this morning unusual.
   * This buckets arrivals by ET hour across an 8-day window so today can be read against
   * its own history.
   *
   * ⚠ BUCKET IN SQL, NEVER IN JS. `arrivedAt` is stored UTC and the node driver hands
   * JS a Date shifted +4h (verified 2026-09-18: stored 12:50 while the driver rendered
   * 16:50Z), so an hour computed in TypeScript is wrong by a third of a workday and
   * looks plausible. `CONVERT_TZ(col,'+00:00','America/New_York')` is the only correct
   * basis and is what `ET_DAY_START` already uses.
   *
   * ⚠ PASS_THROUGH ROWS CARRY AN `arrivedAt`. They are cars that crossed the portal and
   * left without staying -- someone turning around, not a customer. `counts.arrivalsToday`
   * includes them, so it overstates arrivals (17 of 111 rows measured 2026-09-18). Here
   * they are counted SEPARATELY and never folded into `arrivals`, and both numbers ship
   * so a share can never be read without its denominator.
   */
  activity: adminProcedure.query(async () => {
    const d = await dbTyped();
    if (!d) return { ok: false as const, reason: "database unavailable" };

    try {
      const etDate = (col: string) =>
        sql.raw(`DATE(CONVERT_TZ(${col}, '+00:00', 'America/New_York'))`);
      const rows = rowsOf(await d.execute(sql`
        SELECT
          DATEDIFF(${etDate("NOW()")}, ${etDate("arrivedAt")}) AS dayOffset,
          ${sql.raw("HOUR(CONVERT_TZ(arrivedAt, '+00:00', 'America/New_York'))")} AS etHour,
          SUM(CASE WHEN state <> 'PASS_THROUGH' THEN 1 ELSE 0 END) AS arrivals,
          SUM(CASE WHEN state =  'PASS_THROUGH' THEN 1 ELSE 0 END) AS passThroughs
        FROM vehicle_visits
        WHERE dataClass = 'PRODUCTION'
          AND preexisting = 0
          AND arrivedAt IS NOT NULL
          AND ${etDate("arrivedAt")} > DATE_SUB(${etDate("NOW()")}, INTERVAL 8 DAY)
        GROUP BY dayOffset, etHour
      `));

      const byDay = new Map<number, { arrivals: number; passThroughs: number }>();
      const today = Array.from({ length: 24 }, () => ({ arrivals: 0, passThroughs: 0 }));
      const priorTotals = Array.from({ length: 24 }, () => 0);

      for (const row of rows) {
        const off = num(row.dayOffset);
        const hour = num(row.etHour);
        const arrivals = num(row.arrivals);
        const passThroughs = num(row.passThroughs);
        if (hour < 0 || hour > 23) continue;

        const day = byDay.get(off) ?? { arrivals: 0, passThroughs: 0 };
        day.arrivals += arrivals;
        day.passThroughs += passThroughs;
        byDay.set(off, day);

        if (off === 0) {
          today[hour] = { arrivals, passThroughs };
        } else if (off >= 1 && off <= 7) {
          priorTotals[hour] += arrivals;
        }
      }

      // A DAY WITH NO ROWS IS NOT A QUIET DAY. The producer has been up for hours, not
      // weeks, and it dies unpredictably -- so dividing by a fixed 7 would spread real
      // traffic across days that were never observed and render a flat, reassuring
      // baseline out of missing data. Average over days that ACTUALLY reported, and ship
      // the count so the UI can say how thin the history is (or refuse to draw it).
      const priorDaysWithData = [...byDay.keys()].filter((o) => o >= 1 && o <= 7).length;
      const baseline = priorDaysWithData === 0
        ? null
        : priorTotals.map((t) => t / priorDaysWithData);

      const todayArrivals = byDay.get(0)?.arrivals ?? 0;
      const todayPassThroughs = byDay.get(0)?.passThroughs ?? 0;
      const crossings = todayArrivals + todayPassThroughs;

      return {
        ok: true as const,
        asOf: new Date().toISOString(),
        hours: today.map((h, hour) => ({
          hour,
          arrivals: h.arrivals,
          passThroughs: h.passThroughs,
          baselineArrivals: baseline === null ? null : baseline[hour],
        })),
        totals: {
          arrivals: todayArrivals,
          passThroughs: todayPassThroughs,
          // The denominator ships with the share, always. A share on its own invites
          // "15% drive-by" off a sample of two.
          crossings,
          passThroughShare: crossings === 0 ? null : todayPassThroughs / crossings,
        },
        history: {
          priorDaysWithData,
          days: [...byDay.entries()]
            .filter(([off]) => off >= 0 && off <= 7)
            .sort((a, b) => a[0] - b[0])
            .map(([dayOffset, v]) => ({ dayOffset, ...v })),
        },
      };
    } catch (err) {
      // Same rule as `now`: a failed read is reported, never rendered as an empty chart.
      return {
        ok: false as const,
        reason: err instanceof Error ? err.message : "vehicle_visits activity read failed",
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
                 ${minutesBetween("bayEnteredAt", ["bayExitedAt", "departedAt", "NOW()"])} AS bayMinutes,
                 ${sql.raw("UNIX_TIMESTAMP(bayEnteredAt)")} AS bayEnteredEpoch,
                 ${sql.raw("UNIX_TIMESTAMP(bayExitedAt)")} AS bayExitedEpoch,
                 ${sql.raw("UNIX_TIMESTAMP(departedAt)")} AS departedEpoch
          FROM vehicle_visits
          WHERE ${input.includeCommissioning ? sql`1 = 1` : sql`dataClass = 'PRODUCTION'`}
            ${input.openOnly ? sql`AND departedAt IS NULL` : sql``}
          ORDER BY COALESCE(arrivedAt, createdAt) DESC
          LIMIT ${input.limit}
        `));

        // OPERATOR MARKS (migration 0145; audit N1), read in one query for the page of visits
        // and derived per visit against the camera's clocks in server/lib/visitMarks.ts. The
        // clocks go through UNIX_TIMESTAMP so no driver time-zone shift reaches the derivation.
        // A missing table is reported as `marksAvailable: false` -- the floor board then shows
        // no buttons and says why -- never as "no marks", which would read as a quiet lot.
        const marksByVisit = new Map<string, VisitMarkRow[]>();
        let marksAvailable = true;
        if (list.length) {
          try {
            const ids = list.map((v) => String(v.visitId));
            const markRows = rowsOf(await d.execute(sql`
              SELECT visitId, mark, ${sql.raw("UNIX_TIMESTAMP(markedAt)")} AS markedEpoch, note
              FROM vehicle_visit_marks
              WHERE visitId IN (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
              ORDER BY markedAt ASC, id ASC
            `));
            for (const m of markRows) {
              const key = String(m.visitId);
              const bucket = marksByVisit.get(key) ?? [];
              bucket.push({
                mark: String(m.mark),
                markedAtMs: num(m.markedEpoch) * 1000,
                note: (m.note as string | null) ?? null,
              });
              marksByVisit.set(key, bucket);
            }
          } catch (err) {
            if (!isMissingTableError(err)) throw err;
            marksAvailable = false;
          }
        }
        const nowMs = Date.now();
        const epochMs = (v: unknown): number | null => {
          const n = numOrNull(v);
          return n === null ? null : n * 1000;
        };

        const iso = (v: unknown) => (v ? new Date(v as string | Date).toISOString() : null);
        return {
          ok: true as const,
          marksAvailable,
          rows: list.map((v) => ({
            marks: marksAvailable
              ? deriveVisitMarkState(
                  { bayEnteredAtMs: epochMs(v.bayEnteredEpoch), bayExitedAtMs: epochMs(v.bayExitedEpoch), departedAtMs: epochMs(v.departedEpoch) },
                  marksByVisit.get(String(v.visitId)) ?? [],
                  nowMs,
                )
              : null,
            markHistory: (marksByVisit.get(String(v.visitId)) ?? []).map((m) => ({ mark: m.mark, atMs: m.markedAtMs, note: m.note })),
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
      // The 0144 rolling-window columns are selected only once production has them, the
      // way `conversations` treats `visual` and `gist`: a hand-applied migration that lags
      // the deploy must cost eight NULLs on the cards, not the whole Lot page.
      const windowColumnsStored = await cameraRuntimeHasColumns(d, CAMERA_RUNTIME_WINDOW_COLUMNS_0144);
      const shopOpen = shopOpenAt();
      // One sky for the whole read: a solar camera (registry `power`) dark inside this window
      // reads EXPECTED_SOLAR_OFFLINE instead of a fault (audit N3). Mains cameras get null.
      const solar = solarExpectedOffline(new Date());
      const runtime = rowsOf(await d.execute(sql`
        SELECT r.camera, r.producerInstanceId, r.producerVersion, r.gitSha, r.heartbeatSeq,
               r.mode, r.commissioningRunId,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.receivedAt) AS ageSeconds,
               UNIX_TIMESTAMP(r.receivedAt) AS receivedAtEpoch,
               UNIX_TIMESTAMP(r.observedAtEdge) AS observedAtEdgeEpoch,
               UNIX_TIMESTAMP(r.lastHealthyFrameAt) AS lastHealthyFrameAtEpoch,
               ${windowColumnsStored
                 ? sql`r.detectionsLast10m, r.portalCrossingsLast60m,
               r.conversationListeningCoverage60m, r.conversationCaptureSecondsLast60m,
               r.conversationCapturesLast60m, r.conversationCaptureFailuresLast60m,
               r.conversationWakeTriggersLast60m, r.conversationTranscribeBacklog,`
                 : sql``}
               r.sourceType, r.sourceGeneration, r.sourceConnected, r.captureFps,
               r.frameOk, r.poseOk, r.poseDelta,
               r.authPlaneOk, r.eventPlaneOk, r.controlPlaneOk, r.mediaPlaneOk, r.ptzHomeOk,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastEventProofAt) AS eventProofAgeSeconds,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastControlProofAt) AS controlProofAgeSeconds,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastMediaProofAt) AS mediaProofAgeSeconds,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastPtzNotifyAt) AS ptzNotifyAgeSeconds,
               r.conversationWorkerOk, r.conversationWorkerState,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.conversationWorkerHeartbeatAt) AS conversationWorkerAgeSeconds,
               r.conversationAudioSource, r.conversationCaptureHost, r.conversationSttEngine,
               r.conversationQueueDepth, r.conversationLastTrigger, r.lastConversationCoverage,
               r.conversationFailuresToday, r.conversationLastError,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastConversationEventAt) AS conversationEventAgeSeconds,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastConversationCaptureAt) AS conversationCaptureAgeSeconds,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastConversationSttAt) AS conversationSttAgeSeconds,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastConversationPostAt) AS conversationPostAgeSeconds,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastConversationSummaryAt) AS conversationSummaryAgeSeconds,
               r.calibrationVersion, r.detectorName,
               r.modelSha256, r.inferenceP95Ms, r.outboxDepth, r.oldestOutboxAgeSeconds,
               -- As an AGE, matching cloudAckAgeSeconds two lines down. A raw timestamp on a
               -- card asks the reader to do date arithmetic to answer the only question they
               -- have, which is "how long since the detector last ran".
               ${sql.raw("UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastInferenceAt)")} AS inferenceAgeSeconds,
               r.deadLetterDepth,
               UNIX_TIMESTAMP() - UNIX_TIMESTAMP(r.lastCloudAckAt) AS cloudAckAgeSeconds,
               r.diskFreeBytes, r.restores, r.relocateFailures, r.preexistingCrossed,
               r.arrivalsAfterStitch, r.stitchedTotal, r.stitchRefusedAmbiguous,
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

      // HOW STEADY HAS IT BEEN, not just what is it now.
      //
      // A card showing `HEALTHY` says nothing about whether the source has been dropping all
      // morning, and the 20-row transition list above is shared across every camera, so a
      // busy one crowds the others out of it entirely. Measured 2026-09-18: `sign` went to
      // CAMERA_OFFLINE 17 times and DEGRADED_VISION 12 times between 08:05 and 10:50 while
      // the badge read HEALTHY whenever anyone happened to look -- which is exactly how a
      // flapping source gets reported as a stable one.
      //
      // `drops` counts only the states where the lot is NOT being watched. A return to
      // HEALTHY is not an incident, so counting every transition would double every outage
      // and make a recovering camera look worse than one that stayed down.
      const stability = rowsOf(await d.execute(sql`
        SELECT camera,
               SUM(CASE WHEN toState IN ('CAMERA_OFFLINE','DEGRADED_VISION','PRODUCER_OFFLINE',
                                         'CALIBRATION_INVALID','STALE','AUTH_DEGRADED',
                                         'EVENTS_DEGRADED','CONTROL_DEGRADED','MEDIA_DEGRADED',
                                         'PTZ_HOME_INVALID') THEN 1 ELSE 0 END) AS drops,
               COUNT(*) AS transitions
        FROM camera_health_events
        WHERE ${sql.raw("DATE(CONVERT_TZ(at, '+00:00', 'America/New_York'))")}
            = ${sql.raw("DATE(CONVERT_TZ(NOW(), '+00:00', 'America/New_York'))")}
        GROUP BY camera
      `));
      const byStability = new Map(stability.map((s) => [String(s.camera), s]));

      const byCamera = new Map(runtime.map((r) => [String(r.camera), r]));
      const bool = (v: unknown): boolean | null =>
        v === null || v === undefined ? null : Boolean(Number(v));
      const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

      const describe = (
        camera: string,
        label: string,
        role: string,
        healthProfile: "fixed_geometry" | "interaction_ptz",
        commissioned: boolean,
        registered: boolean,
      ) => {
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
                authPlaneOk: bool(r.authPlaneOk),
                eventPlaneOk: bool(r.eventPlaneOk),
                controlPlaneOk: bool(r.controlPlaneOk),
                mediaPlaneOk: bool(r.mediaPlaneOk),
                ptzHomeOk: bool(r.ptzHomeOk),
                // Absent columns read as undefined -> null: "not reported", never zero.
                detectionsLast10m: numOrNull(r.detectionsLast10m),
                portalCrossingsLast60m: numOrNull(r.portalCrossingsLast60m),
                inferenceAgeSeconds: numOrNull(r.inferenceAgeSeconds),
                shopOpen,
                outboxDepth: numOrNull(r.outboxDepth),
                oldestOutboxAgeSeconds: numOrNull(r.oldestOutboxAgeSeconds),
                deadLetterDepth: numOrNull(r.deadLetterDepth),
              },
          healthProfile,
          { solar: cameraPowerFor(camera) === "solar" ? solar : null },
        );
        return {
          camera,
          label,
          role,
          healthProfile,
          commissioned,
          registered,
          state: verdict.state,
          facets: verdict.facets,
          reason: verdict.reason,
          ageSeconds: r ? numOrNull(r.ageSeconds) : null,
          // A READ-derived state (STALE / PRODUCER_OFFLINE / EXPECTED_SOLAR_OFFLINE) began when
          // the heartbeats stopped, not when `stateSince` last moved: no heartbeat arrives to
          // move it, so the row still says HEALTHY-since-this-morning while the camera has been
          // dark since dusk. The alert policy already keys those states on the last heartbeat;
          // the card and the confidence strip must say the same number.
          stateForSeconds: r
            ? (verdict.state === "STALE" || verdict.state === "PRODUCER_OFFLINE" || verdict.state === "EXPECTED_SOLAR_OFFLINE"
                ? numOrNull(r.ageSeconds)
                : numOrNull(r.stateForSeconds))
            : null,
          // NULL, not 0, when this camera has no row today. "It has not dropped" and "no
          // event was ever recorded for it" are different claims, and a camera that has
          // never reported must not render as the steadiest one on the screen.
          stability: byStability.has(camera)
            ? {
                dropsToday: num(byStability.get(camera)!.drops),
                transitionsToday: num(byStability.get(camera)!.transitions),
              }
            : null,
          mode: r ? String(r.mode ?? "PRODUCTION") : null,
          commissioningRunId: r ? str(r.commissioningRunId) : null,
          producer: r
            ? { instanceId: String(r.producerInstanceId), version: str(r.producerVersion), gitSha: str(r.gitSha), heartbeatSeq: num(r.heartbeatSeq) }
            : null,
          source: r
            ? { type: str(r.sourceType), generation: str(r.sourceGeneration), fps: numOrNull(r.captureFps), restores: numOrNull(r.restores) }
            : null,
          vision: r
            ? { detector: str(r.detectorName), modelSha256: str(r.modelSha256), inferenceP95Ms: numOrNull(r.inferenceP95Ms), inferenceAgeSeconds: numOrNull(r.inferenceAgeSeconds), poseDelta: numOrNull(r.poseDelta), calibrationVersion: str(r.calibrationVersion), relocateFailures: numOrNull(r.relocateFailures), preexistingCrossed: numOrNull(r.preexistingCrossed), arrivalsAfterStitch: numOrNull(r.arrivalsAfterStitch), stitchedTotal: numOrNull(r.stitchedTotal), stitchRefusedAmbiguous: numOrNull(r.stitchRefusedAmbiguous), detectionsLast10m: numOrNull(r.detectionsLast10m), portalCrossingsLast60m: numOrNull(r.portalCrossingsLast60m) }
            : null,
          transport: r
            ? {
                eventProofAgeSeconds: numOrNull(r.eventProofAgeSeconds),
                controlProofAgeSeconds: numOrNull(r.controlProofAgeSeconds),
                mediaProofAgeSeconds: numOrNull(r.mediaProofAgeSeconds),
                ptzNotifyAgeSeconds: numOrNull(r.ptzNotifyAgeSeconds),
              }
            : null,
          conversation: r
            ? {
                workerOk: bool(r.conversationWorkerOk),
                state: str(r.conversationWorkerState),
                workerAgeSeconds: numOrNull(r.conversationWorkerAgeSeconds),
                audioSource: str(r.conversationAudioSource),
                captureHost: str(r.conversationCaptureHost),
                sttEngine: str(r.conversationSttEngine),
                queueDepth: numOrNull(r.conversationQueueDepth),
                lastTrigger: str(r.conversationLastTrigger),
                eventAgeSeconds: numOrNull(r.conversationEventAgeSeconds),
                captureAgeSeconds: numOrNull(r.conversationCaptureAgeSeconds),
                sttAgeSeconds: numOrNull(r.conversationSttAgeSeconds),
                postAgeSeconds: numOrNull(r.conversationPostAgeSeconds),
                summaryAgeSeconds: numOrNull(r.conversationSummaryAgeSeconds),
                lastCoverage: numOrNull(r.lastConversationCoverage),
                failuresToday: numOrNull(r.conversationFailuresToday),
                lastError: str(r.conversationLastError),
                // Listening coverage over the last hour (0144). "How much of the hour did
                // the mic actually record" is the number the Office lane was missing: on
                // 2026-10-03 to 10-05 it listened about 8% of the day while every state
                // string said READY. NULL until the migration is applied and the worker
                // reports.
                listeningCoverage60m: numOrNull(r.conversationListeningCoverage60m),
                captureSecondsLast60m: numOrNull(r.conversationCaptureSecondsLast60m),
                capturesLast60m: numOrNull(r.conversationCapturesLast60m),
                captureFailuresLast60m: numOrNull(r.conversationCaptureFailuresLast60m),
                wakeTriggersLast60m: numOrNull(r.conversationWakeTriggersLast60m),
                transcribeBacklog: numOrNull(r.conversationTranscribeBacklog),
              }
            : null,
          cloud: r
            ? { outboxDepth: numOrNull(r.outboxDepth), oldestOutboxAgeSeconds: numOrNull(r.oldestOutboxAgeSeconds), deadLetterDepth: numOrNull(r.deadLetterDepth), cloudAckAgeSeconds: numOrNull(r.cloudAckAgeSeconds), diskFreeBytes: numOrNull(r.diskFreeBytes) }
            : null,
          openVisits: r ? num(r.openVisits) : 0,
        };
      };

      const expected = EXPECTED_CAMERAS.map((c) =>
        describe(c.camera, c.label, c.role, c.healthProfile, c.commissioned, true),
      );
      const known = new Set<string>(EXPECTED_CAMERAS.map((c) => c.camera));
      // A producer nobody registered is shown, not hidden: it is either a config typo
      // (camera id mismatch) or something posting under the shop's key that should not be.
      const unregistered = runtime
        .filter((r) => !known.has(String(r.camera)))
        .map((r) =>
          describe(
            String(r.camera),
            `Unregistered producer: ${String(r.camera)}`,
            "unregistered",
            "fixed_geometry",
            false,
            false,
          ),
        );
      const cameras = [...expected, ...unregistered];

      return {
        ok: true as const,
        asOf: new Date().toISOString(),
        thresholds: HEALTH_THRESHOLDS,
        /** False until drizzle/0144 is applied: the window fields above are then NULL by absence, not by measurement. */
        windowColumnsStored,
        shopOpen,
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

  // ─── Commissioning: the human witness ────────────────────────────────────
  //
  // A controlled drive-in is the only evidence separating "the pipeline is green" from
  // "the pipeline is right". The phone records what a person SAW; these procedures store
  // it and diff it against what the machine recorded.
  //
  // Every timestamp below is turned into epoch MILLISECONDS by SQL
  // (`ROUND(UNIX_TIMESTAMP(col) * 1000)`), never by parsing a Date in JS: driver-parsed
  // TiDB timestamps come back shifted on ET, and this is precisely a measurement of
  // sub-second differences, so a four-hour shift would not even look wrong -- it would
  // look like a catastrophic pipeline latency.

  /**
   * Server time, for the phone's clock-offset estimate.
   *
   * The phone calls this several times, records its own send/receive instants around each
   * call, and keeps the exchange with the LOWEST round-trip: a delayed packet biases the
   * estimate one way only, so the fastest exchange is the one whose one-way times are
   * most nearly equal. Deliberately does no database work — a query that waited on TiDB
   * would measure the database, not the network.
   */
  clock: adminProcedure.query(() => ({ ok: true as const, serverMs: Date.now() })),

  startCommissioning: adminProcedure
    .input(z.object({
      camera: z.string().min(1).max(64),
      label: z.string().max(191).optional(),
      /** Round trips measured by the phone: t0/t1 are ITS clock, serverMs is ours. */
      clockSamples: z.array(z.object({
        t0: z.number(), serverMs: z.number(), t1: z.number(),
      })).max(20).default([]),
      /**
       * The phone's wall clock at the instant it zeroed its monotonic timer. Taps are
       * reconstructed from THIS plus `phoneMonoMs`, not from the server's `startedAt`:
       * the two differ by the whole start-request round trip, and folding that into every
       * tap as a constant error would make a slow start look like a wall-clock step.
       */
      monoOriginWallMs: z.number().int().nullish(),
    }))
    .mutation(async ({ input, ctx }) => {
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "database unavailable" };
      const clock = estimateClockOffset(input.clockSamples);
      // Run ids are date-scoped and sequential so the operator can say "C-20260910-001"
      // out loud on site; the count is of runs for the SAME camera on the SAME ET day.
      const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" }).replace(/-/g, "");
      try {
        // Corrected by the SAME offset the taps are, so the anchor and the offsets it
        // anchors live on one timeline.
        const originMs = input.monoOriginWallMs != null && clock
          ? input.monoOriginWallMs + clock.offsetMs
          : input.monoOriginWallMs ?? null;

        // ALLOCATE BY INSERT-AND-RETRY, not read-then-insert.
        //
        // Counting first and inserting second is a race: two admin tabs, or two cameras
        // being commissioned together, both read the same COUNT and construct the same
        // `runId` -- which is the PRIMARY KEY, so the loser dies on a duplicate key
        // (Codex P2 on #2255, second pass). The insert itself is the only atomic step
        // available here, so let IT arbitrate: on a collision, recount and try the next
        // ordinal. Bounded, because an unbounded retry on a non-collision error would
        // spin. Counted GLOBALLY for the day so the id stays short enough to say out loud
        // on site, which was the point of the format.
        let runId = "";
        for (let attempt = 0; attempt < 12; attempt += 1) {
          const existing = rowsOf(await d.execute(sql`
            SELECT COUNT(*) AS n FROM commissioning_runs WHERE runId LIKE ${`C-${day}-%`}
          `))[0];
          // `n + 1`, NOT `n + 1 + attempt`. The count is re-read every iteration, so it
          // already includes whoever won the last collision; adding the attempt on top of
          // that skips an ordinal each time (two tabs reading n=0 would produce 001 and
          // then 003). Progress is still guaranteed, because every collision means some
          // other request inserted and raised the count.
          const candidate = `C-${day}-${String(num(existing?.n ?? 0) + 1).padStart(3, "0")}`;
          try {
            await d.execute(sql`
              INSERT INTO commissioning_runs (runId, camera, label, startedBy, clockOffsetMs, clockRttMs, clockSamples, monoOriginAt)
              VALUES (${candidate}, ${input.camera}, ${input.label ?? null},
                      ${ctx.user?.email ?? ctx.user?.name ?? "admin"},
                      ${clock?.offsetMs ?? null}, ${clock?.rttMs ?? null}, ${clock?.samples ?? null},
                      ${originMs === null ? null : sql`FROM_UNIXTIME(${originMs} / 1000)`})
            `);
            runId = candidate;
            break;
          } catch (err) {
            if (!isDuplicateKeyError(err)) throw err;
          }
        }
        if (!runId) {
          return { ok: false as const, reason: "could not allocate a run id; try again in a moment" };
        }

        // CLOSE ANY RUN ALREADY OPEN ON THIS CAMERA -- and only now that ours exists.
        // Closing first meant a request that then lost the id race left the camera with
        // NO open run at all: it had ended the previous one on behalf of a run it never
        // managed to create. Ordering it after the insert makes the failure mode "the old
        // run stays open", which the next successful start closes. The `runId <>` guard
        // is what keeps this from immediately ending the run we just opened. The rule it
        // enforces is unchanged: the heartbeat hands the producer the most recent open
        // run, so an abandoned one (a reloaded PWA, a killed tab) would otherwise be
        // picked up again and leave the edge in commissioning mode indefinitely, quietly
        // excluding real visits from the shop's metrics (Codex P1 on #2255).
        // ORDERED BY runId, not merely "everything but mine".
        //
        // `runId <> mine` is not a serialisation. Two tabs starting the same camera can
        // both INSERT (different ids, the retry loop guarantees that) before either
        // UPDATE runs; each update then matches the other's brand-new row, both mutations
        // return ok, and the camera is left with NO open run at all -- neither UI can arm
        // and the producer is handed nothing (Codex P2 on #2255, round 8).
        //
        // Closing only STRICTLY EARLIER ids makes the outcome deterministic under any
        // interleaving: whoever holds the highest id survives, everyone else closes,
        // exactly one run remains open. `C-YYYYMMDD-NNN` is zero-padded and date-led, so
        // lexicographic order is chronological order, and a run left open from a previous
        // day sorts below today's and is closed too. The invariant this enforces is
        // unchanged -- the heartbeat hands the producer the most recent open run, so an
        // abandoned one (a reloaded PWA, a killed tab) would otherwise be picked up again
        // and leave the edge in commissioning mode indefinitely, quietly excluding real
        // visits from the shop's metrics (Codex P1 on #2255, round 5).
        await d.execute(sql`
          UPDATE commissioning_runs SET endedAt = NOW(3)
           WHERE camera = ${input.camera} AND endedAt IS NULL AND runId < ${runId}
        `);
        return { ok: true as const, runId, clock };
      } catch (err) {
        return { ok: false as const, reason: err instanceof Error ? err.message : "could not start the run" };
      }
    }),

  /**
   * OPERATOR MARK on a visit (migration 0145; camera audit 2026-10-07, N1). One tap on the
   * floor board for what the camera cannot see: customer waiting, service started (in the
   * lot, no bay), service done, not a job. Same shape as `recordTruth`: the SERVER clock is the
   * mark's time, and a tap on a car that has already left is refused rather than appended --
   * a late tap would move a closed record. The table missing (0145 not applied) is refused BY
   * NAME, never swallowed into "ok". Nothing here binds a phone, a customer or an invoice, and
   * no customer-facing mutation (work order, booking) is called.
   */
  markVisit: adminProcedure
    .input(z.object({
      visitId: z.string().min(1).max(64),
      mark: z.enum(VISIT_MARKS),
      note: z.string().max(191).nullish(),
    }))
    .mutation(async ({ ctx, input }) => {
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "database unavailable" };
      try {
        const visit = rowsOf(await d.execute(sql`
          SELECT visitId, departedAt FROM vehicle_visits WHERE visitId = ${input.visitId} LIMIT 1
        `))[0];
        if (!visit) return { ok: false as const, reason: `no visit ${input.visitId}` };
        if (visit.departedAt) return { ok: false as const, reason: "this car has left; marks are for cars on the property" };
        const note = input.note?.trim() ? input.note.trim().slice(0, 191) : null;
        const inserted = await d.execute(sql`
          INSERT INTO vehicle_visit_marks (visitId, mark, markedBy, note)
          VALUES (${input.visitId}, ${input.mark}, ${ctx.user.openId}, ${note})
        `);
        // Read back THIS row by its id: "the latest mark for the visit" could be another
        // admin's tap in the same second. No id from the driver -> the server clock stands in.
        const id = insertedId(inserted);
        const stamped = id === null
          ? null
          : rowsOf(await d.execute(sql`
              SELECT ${sql.raw("UNIX_TIMESTAMP(markedAt)")} AS markedEpoch FROM vehicle_visit_marks WHERE id = ${id} LIMIT 1
            `))[0];
        const markedAtMs = stamped?.markedEpoch != null ? num(stamped.markedEpoch) * 1000 : Date.now();
        return { ok: true as const, mark: input.mark, markedAtMs };
      } catch (err) {
        if (isMissingTableError(err)) {
          return { ok: false as const, reason: "visit marks need migration 0145 (vehicle_visit_marks) applied first" };
        }
        // Never the raw driver message: a wrapped query error carries its params, and one of them
        // is the admin's openId, which this table's own comment promises never reaches the browser.
        return { ok: false as const, reason: `could not record the mark: ${logSafeErrorMessage(err)}` };
      }
    }),

  recordTruth: adminProcedure
    .input(z.object({
      runId: z.string().min(1).max(64),
      event: z.enum(TRUTH_EVENTS),
      /** The phone's wall clock at the tap, epoch ms. */
      phoneWallMs: z.number().int(),
      /** Milliseconds since the run started, from a MONOTONIC source. Survives a clock step. */
      phoneMonoMs: z.number().int().nullish(),
      note: z.string().max(191).nullish(),
    }))
    .mutation(async ({ input }) => {
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "database unavailable" };
      try {
        const run = rowsOf(await d.execute(sql`
          SELECT clockOffsetMs, endedAt FROM commissioning_runs WHERE runId = ${input.runId}
        `))[0];
        if (!run) return { ok: false as const, reason: `no commissioning run ${input.runId}` };
        // A tap after the run ended is refused rather than silently appended: the report
        // is a record of one bounded drive, and a late tap would move its verdict.
        if (run.endedAt) return { ok: false as const, reason: `run ${input.runId} has already ended` };

        const offset = numOrNull(run.clockOffsetMs);
        const correctedMs = offset === null ? null : input.phoneWallMs + offset;
        await d.execute(sql`
          INSERT INTO commissioning_truth_events (runId, event, phoneWallAt, phoneMonoMs, correctedAt)
          VALUES (${input.runId}, ${input.event},
                  FROM_UNIXTIME(${input.phoneWallMs} / 1000),
                  ${input.phoneMonoMs ?? null},
                  ${correctedMs === null ? null : sql`FROM_UNIXTIME(${correctedMs} / 1000)`})
        `);
        return { ok: true as const, event: input.event, correctedMs };
      } catch (err) {
        return { ok: false as const, reason: err instanceof Error ? err.message : "could not record the tap" };
      }
    }),

  endCommissioning: adminProcedure
    .input(z.object({ runId: z.string().min(1).max(64), toleranceMs: z.number().int().min(100).max(60_000).default(3000) }))
    .mutation(async ({ input }) => {
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "database unavailable" };
      try {
        await d.execute(sql`
          UPDATE commissioning_runs SET endedAt = NOW(3) WHERE runId = ${input.runId} AND endedAt IS NULL
        `);
        // PERSIST THE VERDICT. It used to be computed on demand and never stored, so the
        // history list rendered a `verdict` column that no code path ever wrote -- every
        // finished run showed a blank chip forever (Codex P2 on #2255). Recomputing it on
        // every history render would also mean a run's verdict could silently change months
        // later if the tolerances were retuned; freezing it at the end of the run is what
        // makes it a RECORD rather than a live opinion.
        const built = await loadCommissioningReport(d, input.runId, input.toleranceMs);
        if (!built) return { ok: true as const, verdict: null, provisional: true, findings: [] };
        // Never persisted here: a run that ended a second ago has not settled by
        // construction. The report query freezes it once the window has passed.
        return {
          ok: true as const,
          verdict: built.report.verdict,
          provisional: true,
          findings: built.report.findings,
        };
      } catch (err) {
        return { ok: false as const, reason: err instanceof Error ? err.message : "could not end the run" };
      }
    }),

  commissioningRuns: adminProcedure
    .input(z.object({ limit: z.number().int().min(1).max(50).default(10) }).default({ limit: 10 }))
    .query(async ({ input }) => {
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "database unavailable" };
      try {
        const rows = rowsOf(await d.execute(sql`
          SELECT r.runId, r.camera, r.label, r.verdict, r.clockOffsetMs, r.clockRttMs, r.clockSamples,
                 ${sql.raw("ROUND(UNIX_TIMESTAMP(r.startedAt) * 1000)")} AS startedMs,
                 ${sql.raw("ROUND(UNIX_TIMESTAMP(r.endedAt) * 1000)")} AS endedMs,
                 (SELECT COUNT(*) FROM commissioning_truth_events e WHERE e.runId = r.runId) AS taps,
                 (SELECT COUNT(*) FROM vehicle_visits v WHERE v.commissioningRunId = r.runId) AS visits
          FROM commissioning_runs r
          ORDER BY r.startedAt DESC
          LIMIT ${input.limit}
        `));
        // Finalise here rather than in the report: this is the read the panel polls, so a
        // completed run records its verdict without anyone reopening anything.
        await finalizeSettledVerdicts(
          d,
          rows.filter((r) => r.endedMs && !r.verdict).map((r) => String(r.runId)),
        );
        const acknowledged = rowsOf(await d.execute(sql`
          SELECT camera, commissioningRunId, mode,
                 ${sql.raw("UNIX_TIMESTAMP() - UNIX_TIMESTAMP(receivedAt)")} AS ageSeconds
          FROM camera_runtime
        `));
        const ackByCamera = new Map(acknowledged.map((a) => [String(a.camera), a]));

        return {
          ok: true as const,
          runs: rows.map((r) => ({
            runId: String(r.runId),
            camera: String(r.camera),
            label: (r.label as string | null) ?? null,
            verdict: (r.verdict as string | null) ?? null,
            startedMs: numOrNull(r.startedMs),
            endedMs: numOrNull(r.endedMs),
            open: !r.endedMs,
            taps: num(r.taps),
            visits: num(r.visits),
            clock: r.clockSamples === null || r.clockSamples === undefined
              ? null
              : { offsetMs: num(r.clockOffsetMs), rttMs: num(r.clockRttMs), samples: num(r.clockSamples) },
            // Has the PRODUCER acknowledged this exact run? The panel keeps the run screen
            // disarmed until it has: the edge only learns of a run on its next heartbeat,
            // and a car driven during that gap is recorded as PRODUCTION with no run id --
            // which the now-immutable ingest fields make unrepairable.
            acknowledged: (() => {
              const a = ackByCamera.get(String(r.camera));
              if (!a) return false;
              const age = numOrNull(a.ageSeconds);
              return String(a.commissioningRunId ?? "") === String(r.runId)
                && age !== null && age <= QUIESCENCE_HEARTBEAT_MAX_AGE_S;
            })(),
          })),
        };
      } catch (err) {
        return { ok: false as const, reason: err instanceof Error ? err.message : "commissioning_runs read failed" };
      }
    }),

  /** The diff: what the human witnessed vs what the machine recorded, and a verdict. */
  commissioningReport: adminProcedure
    .input(z.object({ runId: z.string().min(1).max(64), toleranceMs: z.number().int().min(100).max(60_000).default(3000) }))
    .query(async ({ input }) => {
      const d = await dbTyped();
      if (!d) return { ok: false as const, reason: "database unavailable" };
      try {
        const built = await loadCommissioningReport(d, input.runId, input.toleranceMs);
        if (!built) return { ok: false as const, reason: `no commissioning run ${input.runId}` };
        // Recording happens in the history read, which the panel polls -- so a finished
        // run finalises whether or not anyone opens this. Doing it here too keeps a report
        // opened long after the fact from showing a verdict the history has not caught up
        // with yet.
        if (built.run.settled) await finalizeSettledVerdicts(d, [input.runId]);
        return { ok: true as const, ...built };
      } catch (err) {
        return { ok: false as const, reason: err instanceof Error ? err.message : "commissioning report failed" };
      }
    }),
});
