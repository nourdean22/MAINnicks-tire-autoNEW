/**
 * Camera visit ingest — the write side of nickstire.org/admin's Lot section.
 *
 * `camera-bridge/visitd` owns visit truth and persists it locally with a SQLite
 * ledger and an ordered outbox. This endpoint is the shop-side SINK for that
 * outbox: one row per visit in `vehicle_visits` (migration 0119), which the Lot
 * admin section reads.
 *
 * PRODUCERS (corrected 2026-09-09; the original "NO PRODUCER IS WIRED YET" note is
 * superseded, kept in drizzle/0119's header so the change of state is visible):
 *   · `camera-bridge/vision/run_live.py` — VisitSink + `--post-to`, and since
 *     migration 0120 a heartbeat every `--heartbeat-seconds` to the sibling route.
 *   · `camera-bridge/visitd/shop_mirror.py` — best-effort mirror off visitd's
 *     after_step, plus a heartbeat per camera from the live loop.
 * Both stamp `dataClass`; a commissioning run never counts as a customer arrival.
 *
 * Design rules, each for a specific failure mode:
 *
 *  · **Monotonic `seq`, enforced ATOMICALLY.** visitd emits an increasing sequence
 *    per visit and the outbox retries, so a replayed or reordered delivery must not
 *    walk a visit backwards. This is one `INSERT ... ON DUPLICATE KEY UPDATE` whose
 *    every assignment is guarded by `VALUES(seq) >= seq`. A read-then-write could
 *    not hold the invariant it claimed: two concurrent deliveries both read the old
 *    seq, and the later-arriving older one won.
 *  · **`seq` is REQUIRED.** It used to default to 0, which made the guard vacuous
 *    for any sender that omitted it — every stale full-state replay overwrote the
 *    current row.
 *  · **Fail closed.** No shared secret configured means 401, never "allow".
 *  · **A batch where nothing applied is not a success.** 207 has `res.ok === true`,
 *    so a caller using the standard idiom would mark an all-failed batch delivered
 *    and drop it.
 *  · **A malformed timestamp is a 400, not a silent null.** Coercing garbage into
 *    "not observed" is the mirror image of inventing a plausible time, and it feeds
 *    straight into the day-bucket and ordering logic downstream.
 *  · **Plate text is stored only when the read is CONFIRMED**, a `customerId` only
 *    for an EXACT match, and plates are never logged in the clear.
 */
import type { Express, Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { z } from "zod";
import { sql } from "drizzle-orm";

import { maskPlate, normalizePlate, PLATE_MATCH_CLASSES } from "../lib/plate";
import { deriveStateAtIngest } from "../lib/cameraHealth";
import { isUnknownColumnError } from "../lib/dbErrors";
import {
  CAMERA_RUNTIME_COLUMNS_SINCE_0124,
  heartbeatGuardedSetFor,
  resetStorableHeartbeatColumns,
  storableHeartbeatColumns,
} from "../lib/heartbeatStorableColumns";
import { cameraHealthProfileFor } from "../../shared/cameras";
import { cameraProducerAuthority } from "./cameraProducerAuthority";

/** Timing-safe, matching the sibling bridge routes. */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

const PLATE_STATUS = ["NONE", "UNREADABLE", "CANDIDATE", "CONFIRMED", "AMBIGUOUS"] as const;
const DATA_CLASSES = ["PRODUCTION", "COMMISSIONING", "REPLAY"] as const;
const HEARTBEAT_MODES = ["PRODUCTION", "SHADOW", "COMMISSIONING"] as const;

/**
 * ISO-8601 or epoch seconds. `null` stays null — an unobserved time is NOT "now".
 * A value that is present but unparseable REJECTS rather than degrading to null.
 */
const tsField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `unparseable timestamp: ${String(v)}` });
      return z.NEVER;
    }
    return d;
  });

const visitSchema = z.object({
  visitId: z.string().min(1).max(64),
  camera: z.string().min(1).max(64),
  state: z.string().min(1).max(32),
  /** REQUIRED. A default made the monotonicity guard a no-op. */
  seq: z.number().int().min(0),

  arrivedAt: tsField,
  waitStartedAt: tsField,
  bayEnteredAt: tsField,
  bayExitedAt: tsField,
  departedAt: tsField,
  bay: z.string().max(32).nullish(),

  plateText: z.string().max(16).nullish(),
  plateStatus: z.enum(PLATE_STATUS).default("NONE"),
  customerMatch: z.enum(PLATE_MATCH_CLASSES).default("NONE"),
  customerId: z.number().int().nullish(),

  preexisting: z.boolean().default(false),
  entryEvidence: z.string().max(191).nullish(),
  estimatedFields: z.array(z.string()).nullish(),
  evidenceRef: z.string().max(255).nullish(),
  sourceGeneration: z.string().max(64).nullish(),
  cameraPose: z.string().max(64).nullish(),
  /**
   * Episode identity (migration 0127). `nullish` throughout: a producer predating the
   * stitcher sends none of these and must keep ingesting unchanged.
   * Widths match the columns exactly -- TiDB runs STRICT_TRANS_TABLES, so an over-width
   * write is REJECTED and the row is LOST rather than truncated.
   */
  episodeId: z.string().max(64).nullish(),
  continuesVisitId: z.string().max(64).nullish(),
  memberTrackIds: z.array(z.number().int()).nullish(),
  detectorName: z.string().max(128).nullish(),
  calibrationVersion: z.string().max(32).nullish(),
  /**
   * PRODUCTION | COMMISSIONING | REPLAY (migration 0120). Defaults to PRODUCTION so
   * an older producer keeps working; a commissioning producer MUST send it, or its
   * test drive becomes today's customer arrival.
   */
  dataClass: z.enum(DATA_CLASSES).default("PRODUCTION"),
  commissioningRunId: z.string().max(64).nullish(),
});

const bodySchema = z.object({
  visits: z.array(visitSchema).min(1).max(100),
});

/** Only a CONFIRMED read is durable. Everything else keeps its status, loses its text. */
export function plateTextToStore(
  plateStatus: string,
  plateText: string | null | undefined,
): string | null {
  if (plateStatus !== "CONFIRMED") return null;
  const n = normalizePlate(plateText);
  return n || null;
}

/** Columns written on insert, in order. `seq` leads so the guard reads naturally. */
export const COLUMNS = [
  "visitId", "camera", "state", "seq",
  "arrivedAt", "waitStartedAt", "bayEnteredAt", "bayExitedAt", "departedAt", "bay",
  "plateText", "plateStatus", "customerMatch", "customerId",
  "preexisting", "entryEvidence", "estimatedFields", "evidenceRef",
  "sourceGeneration", "cameraPose", "detectorName", "calibrationVersion",
  "dataClass", "commissioningRunId",
  // 0127 episode trail. THIS LIST IS THE CONSUMER: a field can pass the zod schema and
  // still never reach the row, because the write names these columns and nothing else.
  // `continuesVisitId` is listed but the producer deliberately never sends it -- see the
  // note in `vision/run_live.py`: the stitcher owns TRACK ids, and putting one in a
  // column named `...VisitId` reads as one thing and means another.
  "episodeId", "continuesVisitId", "memberTrackIds",
] as const;

/**
 * Columns a producer LEARNS over the life of a visit and can never un-learn.
 *
 * The mirror accumulates per-visit state IN MEMORY, and that memory does not survive a
 * producer restart. After one, the tracker is restored from the edge's own ledger but the
 * mirror's accumulator is empty, so the next emission renders a full row with NULL
 * arrival and bay times -- and at a higher seq, so the guard ACCEPTS it and the complete
 * row is overwritten with nulls. A routine restart would silently erase a visit's timing
 * (Codex P1 on #2255).
 *
 * `COALESCE(VALUES(c), c)` makes that impossible: a delivery that does not know a
 * timestamp leaves the known one alone. These values are only ever LEARNED -- a car does
 * not un-arrive -- so there is no legitimate write that needs to clear them.
 */
const LEARNED_ONCE = new Set<string>([
  "arrivedAt", "waitStartedAt", "bayEnteredAt", "bayExitedAt", "departedAt",
  "bay", "entryEvidence", "evidenceRef",
  // 0127 episode trail. Without COALESCE preservation, ANY later higher-seq payload that
  // omits these writes SQL NULL over a recorded trail -- and two ordinary paths omit them:
  // a rollback to a producer that predates the stitcher, and the standalone sink's terminal
  // emission, which looks up timing AFTER `_track_visit` has been popped. Erasing the audit
  // trail for a corrected `arrivedAt` is worse than never having written it, because the
  // corrected time survives while the explanation for it disappears.
  "episodeId", "continuesVisitId", "memberTrackIds",
]);

/**
 * Columns fixed at INSERT and never updated: a visit belongs to the run it STARTED in.
 *
 * Without this, a producer restarted across a commissioning boundary would reclassify an
 * in-flight visit — a real customer becoming COMMISSIONING and vanishing from the shop's
 * KPIs, or a test drive becoming PRODUCTION and being counted as one.
 */
const IMMUTABLE_AFTER_INSERT = new Set<string>(["dataClass", "commissioningRunId"]);

/**
 * Columns a RETENTION SCRUB has removed, which no delivery may ever put back.
 *
 * The seq guard alone is not enough here, and the hole is a real one (Codex P1 on #2270).
 * The edge's durable shop outbox retries a full row indefinitely, so a delivery carrying
 * the ORIGINAL plate text can arrive at an EQUAL seq days after `plate-retention-scrub`
 * nulled it -- `VALUES(seq) >= seq` accepts equality by design, because a redelivery of the
 * same emission must be idempotent. The row would then flip from SCRUBBED back to CONFIRMED
 * with the plate text restored, past the 30-day ADR-0017 window, and nothing anywhere would
 * report it: the scrub already ran, the cron already went green, and the next run only looks
 * at rows older than the cutoff whose text is non-NULL -- which this one now is again, so it
 * would be scrubbed a second time and could be restored a third.
 *
 * So the stored `plateStatus` gates these two columns before the seq guard is consulted.
 * `plateText` is assigned BEFORE `plateStatus` in COLUMNS order, and MySQL evaluates
 * ON DUPLICATE KEY UPDATE assignments left to right, so both right-hand sides read the OLD
 * status -- the check cannot be defeated by its own update.
 */
const NEVER_UNSCRUBBED = new Set<string>(["plateText", "plateStatus"]);

/** Every column updates only when the incoming seq is at least the stored one. */
export const GUARDED_SET = COLUMNS.filter(
  (c) => c !== "visitId" && !IMMUTABLE_AFTER_INSERT.has(c),
)
  .map((c) => {
    const incoming = LEARNED_ONCE.has(c) ? `COALESCE(VALUES(\`${c}\`), \`${c}\`)` : `VALUES(\`${c}\`)`;
    const guarded = `IF(VALUES(\`seq\`) >= \`seq\`, ${incoming}, \`${c}\`)`;
    return NEVER_UNSCRUBBED.has(c)
      ? `\`${c}\` = IF(\`plateStatus\` = 'SCRUBBED', \`${c}\`, ${guarded})`
      : `\`${c}\` = ${guarded}`;
  })
  .join(", ");

export function registerCameraVisitsRoute(app: Express): void {
  app.post("/api/camera/visits", async (req: Request, res: Response) => {
    // Prefer a dedicated edge key. The StateNour bridge key remains a fallback so the
    // endpoint is usable before a new secret is rolled out, but it widens what that key
    // authorizes — provision CAMERA_INGEST_KEY and the fallback stops being used.
    const key = process.env.CAMERA_INGEST_KEY || process.env.STATENOUR_SYNC_KEY || "";
    const provided = (req.headers["x-sync-key"] as string) || "";
    if (!key || !provided || !safeCompare(provided, key)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid body", issues: parsed.error.issues.slice(0, 8) });
    }

    const { getDbTyped } = await import("../db");
    const d = await getDbTyped();
    if (!d) return res.status(503).json({ error: "database unavailable" });

    // Authority and visit writes share ONE transaction. SELECT ... FOR UPDATE locks each
    // camera_runtime owner row until every visit in the batch is written, so a heartbeat
    // takeover cannot slip between "authorized" and INSERT and create split-brain rows.
    const providedProducer = (req.headers["x-camera-producer"] as string | undefined) || undefined;
    type Outcome = "applied" | "stale" | "failed";
    const results: Array<{ visitId: string; outcome: Outcome; reason?: string }> = [];
    let standbyCamera: string | null = null;

    try {
      await d.transaction(async (tx) => {
        // Lock in deterministic order so a future multi-camera batch cannot deadlock
        // against another request that names the same cameras in the opposite order.
        for (const camera of [...new Set(parsed.data.visits.map((v) => v.camera))].sort()) {
          const runtimeRows = await tx.execute(sql`
            SELECT producerInstanceId,
                   TIMESTAMPDIFF(SECOND, receivedAt, NOW()) AS ageSeconds
            FROM camera_runtime
            WHERE camera = ${camera}
            LIMIT 1
            FOR UPDATE
          `);
          const runtimeList = (Array.isArray(runtimeRows) ? runtimeRows[0] : runtimeRows) as
            unknown as Array<Record<string, unknown>> | undefined;
          const row = Array.isArray(runtimeList) && runtimeList.length ? runtimeList[0] : null;
          const current = row ? {
            producerInstanceId: String(row.producerInstanceId),
            ageSeconds: Math.max(0, Number(row.ageSeconds ?? 0)),
          } : null;
          if (!cameraProducerAuthority.visitProducerAuthorized(providedProducer, current)) {
            standbyCamera = camera;
            return;
          }
        }
        if (standbyCamera) return;

        for (const v of parsed.data.visits) {
          const values: Record<string, unknown> = {
            visitId: v.visitId,
            camera: v.camera,
            state: v.state,
            seq: v.seq,
            arrivedAt: v.arrivedAt ?? null,
            waitStartedAt: v.waitStartedAt ?? null,
            bayEnteredAt: v.bayEnteredAt ?? null,
            bayExitedAt: v.bayExitedAt ?? null,
            departedAt: v.departedAt ?? null,
            bay: v.bay ?? null,
            plateText: plateTextToStore(v.plateStatus, v.plateText),
            plateStatus: v.plateStatus,
            customerMatch: v.customerMatch,
            customerId: v.customerMatch === "EXACT" ? (v.customerId ?? null) : null,
            preexisting: v.preexisting ? 1 : 0,
            entryEvidence: v.entryEvidence ?? null,
            episodeId: v.episodeId ?? null,
            continuesVisitId: v.continuesVisitId ?? null,
            memberTrackIds: v.memberTrackIds ? JSON.stringify(v.memberTrackIds) : null,
            estimatedFields: v.estimatedFields ? JSON.stringify(v.estimatedFields) : null,
            evidenceRef: v.evidenceRef ?? null,
            sourceGeneration: v.sourceGeneration ?? null,
            cameraPose: v.cameraPose ?? null,
            detectorName: v.detectorName ?? null,
            calibrationVersion: v.calibrationVersion ?? null,
            dataClass: v.dataClass,
            commissioningRunId: v.commissioningRunId ?? null,
          };
          try {
            const placeholders = COLUMNS.map((c) => sql`${values[c]}`);
            const result = await tx.execute(sql`
              INSERT INTO vehicle_visits (${sql.raw(COLUMNS.map((c) => `\`${c}\``).join(", "))})
              VALUES (${sql.join(placeholders, sql`, `)})
              ON DUPLICATE KEY UPDATE ${sql.raw(GUARDED_SET)}
            `);
            const info = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
            const affected = Number(info?.affectedRows ?? 0);
            results.push({
              visitId: v.visitId,
              outcome: affected === 0 ? "stale" : "applied",
              ...(affected === 0 ? { reason: `seq ${v.seq} not newer than the stored row` } : {}),
            });
          } catch (err) {
            results.push({
              visitId: v.visitId,
              outcome: "failed",
              reason: err instanceof Error ? err.message : "write failed",
            });
          }
        }
      });
    } catch (err) {
      return res.status(500).json({
        error: err instanceof Error ? err.message : "camera visit transaction failed",
      });
    }
    if (standbyCamera) {
      return res.status(409).json({
        error: "producer standby",
        camera: standbyCamera,
        authoritative: false,
      });
    }

    const applied = results.filter((r) => r.outcome === "applied").length;
    const failed = results.filter((r) => r.outcome === "failed").length;

    // Plates are masked: this logs every call and lint:pii cannot read log output.
    console.info(
      `[camera-visits] ${applied} applied, ${results.length - applied - failed} stale, ${failed} failed`,
      parsed.data.visits.map((v) => ({ visitId: v.visitId, state: v.state, plate: maskPlate(v.plateText) })),
    );

    // A batch in which EVERY write failed is a server-side failure, not a partial
    // success. 207 carries res.ok === true, so returning it here would let a caller
    // mark the batch delivered and drop it — silent loss on the fail-loudly path.
    if (failed === results.length) {
      return res.status(502).json({ error: "every write failed", applied: 0, results });
    }
    return res.status(failed === 0 ? 200 : 207).json({ applied, failed, results });
  });
}

/**
 * Producer heartbeat ingest -- the INFRASTRUCTURE fact, kept apart from visits.
 *
 * One row per camera in `camera_runtime` (migration 0120), upserted. Before this
 * route, `lot.health` inferred camera existence from `vehicle_visits`, so a healthy
 * producer on a quiet lot rendered `cameras: []` -- indistinguishable from no
 * producer at all.
 *
 *  - **Idempotency key = (producerInstanceId, heartbeatSeq), enforced ATOMICALLY.**
 *    Every assignment in the ON DUPLICATE KEY UPDATE is guarded by ACCEPT: a replayed
 *    or reordered heartbeat from the SAME instance cannot move the row backwards,
 *    while a NEW instance (a restart legitimately resets its sequence) is accepted.
 *  - **Two clocks.** `observedAtEdge` is the producer's; `receivedAt` is ours. Frame
 *    freshness is judged on the producer's clock, liveness on ours, so transport
 *    delay and clock skew can be told apart.
 *  - **Transitions, not heartbeats, are logged.** `camera_health_events` gets a row
 *    only when the producer-reported state changes, or the instance changes (a
 *    restart). Liveness states are derived at read time and are never logged here --
 *    no heartbeat arrives to log them.
 *  - Same secret and fail-closed rule as the visit ingest.
 */
const heartbeatSchema = z.object({
  camera: z.string().min(1).max(64),
  producerInstanceId: z.string().min(1).max(64),
  producerVersion: z.string().max(64).nullish(),
  gitSha: z.string().max(40).nullish(),
  heartbeatSeq: z.number().int().min(0),
  observedAtEdge: tsField,
  mode: z.enum(HEARTBEAT_MODES).default("PRODUCTION"),
  commissioningRunId: z.string().max(64).nullish(),
  sourceType: z.string().max(32).nullish(),
  sourceGeneration: z.string().max(64).nullish(),
  sourceConnected: z.boolean().nullish(),
  lastFrameAt: tsField,
  lastHealthyFrameAt: tsField,
  captureFps: z.number().nullish(),
  frameOk: z.boolean().nullish(),
  poseOk: z.boolean().nullish(),
  poseDelta: z.number().nullish(),
  // Interaction/PTZ planes. NULL/omitted = not proven, not success.
  authPlaneOk: z.boolean().nullish(),
  eventPlaneOk: z.boolean().nullish(),
  controlPlaneOk: z.boolean().nullish(),
  mediaPlaneOk: z.boolean().nullish(),
  ptzHomeOk: z.boolean().nullish(),
  lastEventProofAt: tsField,
  lastControlProofAt: tsField,
  lastMediaProofAt: tsField,
  lastPtzNotifyAt: tsField,
  // Office conversation worker facets (0135). They describe a sibling worker on the same
  // edge host and deliberately do NOT participate in the camera health verdict.
  conversationWorkerOk: z.boolean().nullish(),
  conversationWorkerState: z.string().max(32).nullish(),
  conversationWorkerHeartbeatAt: tsField,
  conversationAudioSource: z.string().max(64).nullish(),
  conversationCaptureHost: z.string().max(64).nullish(),
  conversationSttEngine: z.string().max(128).nullish(),
  conversationQueueDepth: z.number().int().min(0).nullish(),
  conversationLastTrigger: z.string().max(32).nullish(),
  lastConversationEventAt: tsField,
  lastConversationCaptureAt: tsField,
  lastConversationSttAt: tsField,
  lastConversationPostAt: tsField,
  lastConversationSummaryAt: tsField,
  lastConversationCoverage: z.number().min(0).max(1).nullish(),
  conversationFailuresToday: z.number().int().min(0).nullish(),
  conversationLastError: z.string().max(500).nullish(),
  // Office listening truth over the last hour (0143). NULL = the worker receipt predates
  // these, or under five eligible minutes to judge. Never a guess.
  conversationListeningCoverage60m: z.number().min(0).max(1).nullish(),
  conversationCaptureSecondsLast60m: z.number().min(0).nullish(),
  conversationCapturesLast60m: z.number().int().min(0).nullish(),
  conversationCaptureFailuresLast60m: z.number().int().min(0).nullish(),
  conversationWakeTriggersLast60m: z.number().int().min(0).nullish(),
  conversationTranscribeBacklog: z.number().int().min(0).nullish(),
  calibrationVersion: z.string().max(32).nullish(),
  detectorName: z.string().max(128).nullish(),
  modelSha256: z.string().max(64).nullish(),
  lastInferenceAt: tsField,
  inferenceP95Ms: z.number().nullish(),
  openVisits: z.number().int().nullish(),
  outboxDepth: z.number().int().nullish(),
  oldestOutboxAgeSeconds: z.number().int().nullish(),
  deadLetterDepth: z.number().int().nullish(),
  lastCloudAckAt: tsField,
  diskFreeBytes: z.number().nullish(),
  restores: z.number().int().nullish(),
  /**
   * Revalidation passes that produced NO binding. `nullish`, not defaulted: a producer that
   * does not track it has not measured zero of them, and the card distinguishes the two.
   */
  relocateFailures: z.number().int().nullish(),
  /** Cars the census called already-there that the portal then watched drive in. */
  preexistingCrossed: z.number().int().nullish(),
  /** Stitch counters (0127). `arrivalsAfterStitch` shadows `arrivals`, never replaces it. */
  arrivalsAfterStitch: z.number().int().nullish(),
  stitchedTotal: z.number().int().nullish(),
  stitchRefusedAmbiguous: z.number().int().nullish(),
  /**
   * Rolling-window plausibility counters (0143). `lastInferenceAt` says the detector RAN;
   * these say what it SAW. `nullish`, never defaulted: a producer that does not keep the
   * window has not measured zero.
   */
  detectionsLast10m: z.number().int().min(0).nullish(),
  portalCrossingsLast60m: z.number().int().min(0).nullish(),
});
export function parseHeartbeat(body: unknown) {
  return heartbeatSchema.safeParse(body);
}

/** Columns written from the body, in order. `camera` is the key; `state` is derived here. */
export const HEARTBEAT_COLUMNS = [
  "camera", "producerInstanceId", "producerVersion", "gitSha", "heartbeatSeq", "observedAtEdge",
  "mode", "commissioningRunId", "sourceType", "sourceGeneration", "sourceConnected",
  "lastFrameAt", "lastHealthyFrameAt", "captureFps", "frameOk", "poseOk", "poseDelta",
  "authPlaneOk", "eventPlaneOk", "controlPlaneOk", "mediaPlaneOk", "ptzHomeOk",
  "lastEventProofAt", "lastControlProofAt", "lastMediaProofAt", "lastPtzNotifyAt",
  "conversationWorkerOk", "conversationWorkerState", "conversationWorkerHeartbeatAt",
  "conversationAudioSource", "conversationCaptureHost", "conversationSttEngine",
  "conversationQueueDepth", "conversationLastTrigger", "lastConversationEventAt",
  "lastConversationCaptureAt", "lastConversationSttAt", "lastConversationPostAt",
  "lastConversationSummaryAt", "lastConversationCoverage", "conversationFailuresToday",
  "conversationLastError",
  "calibrationVersion", "detectorName", "modelSha256", "lastInferenceAt", "inferenceP95Ms",
  "openVisits", "outboxDepth", "oldestOutboxAgeSeconds", "deadLetterDepth", "lastCloudAckAt",
  "diskFreeBytes", "restores", "relocateFailures", "preexistingCrossed", "state",
  // 0127 stitch counters. THIS LIST IS THE CONSUMER: a field can pass the zod schema and
  // still be dropped here, silently, because the write names these columns and nothing
  // else. Adding to the schema without adding here is a writer with no reader.
  "arrivalsAfterStitch", "stitchedTotal", "stitchRefusedAmbiguous",
  // 0143 rolling windows: what the detector saw, and what the office worker heard.
  "detectionsLast10m", "portalCrossingsLast60m",
  "conversationListeningCoverage60m", "conversationCaptureSecondsLast60m",
  "conversationCapturesLast60m", "conversationCaptureFailuresLast60m",
  "conversationWakeTriggersLast60m", "conversationTranscribeBacklog",
] as const;

/**
 * Atomic authority + replay fence. A higher-priority machine may preempt immediately;
 * a lower-priority machine may take over only after the current owner is stale. Same-role
 * restarts may replace one another immediately, while one instance still needs monotonic seq.
 */
const incomingPrioritySql = "(CASE WHEN VALUES(`producerInstanceId`) LIKE 'p1-%' THEN 1 WHEN VALUES(`producerInstanceId`) LIKE 'p2-%' THEN 2 WHEN VALUES(`producerInstanceId`) LIKE 'p3-%' THEN 3 ELSE 99 END)";
const storedPrioritySql = "(CASE WHEN `producerInstanceId` LIKE 'p1-%' THEN 1 WHEN `producerInstanceId` LIKE 'p2-%' THEN 2 WHEN `producerInstanceId` LIKE 'p3-%' THEN 3 ELSE 99 END)";
export const HEARTBEAT_ACCEPT =
  "((VALUES(`producerInstanceId`) = `producerInstanceId` AND VALUES(`heartbeatSeq`) >= `heartbeatSeq`)"
  + " OR (VALUES(`producerInstanceId`) <> `producerInstanceId` AND ("
  + incomingPrioritySql + " <= " + storedPrioritySql
  + " OR `receivedAt` < DATE_SUB(NOW(), INTERVAL " + cameraProducerAuthority.staleSeconds + " SECOND))))";

/**
 * Columns that any guard READS. Every one of them has to be assigned after everything
 * that reads it -- see the ordering derivation below.
 */
const HEARTBEAT_READ_BY_GUARDS = ["state", "heartbeatSeq", "producerInstanceId"] as const;

/**
 * Every column updates only under HEARTBEAT_ACCEPT, with the two server clocks.
 *
 * ⚠ THE ORDER OF THESE ASSIGNMENTS IS SEMANTIC, NOT COSMETIC, AND IT IS DERIVED BELOW.
 *
 * MySQL and TiDB evaluate `ON DUPLICATE KEY UPDATE` assignments LEFT TO RIGHT, and a bare
 * column reference reads the value as updated SO FAR IN THE SAME STATEMENT, while
 * `VALUES(col)` always reads the incoming row. So any guard that reads a column the
 * statement also assigns means something different depending on where it sits.
 *
 * Two live defects came from getting this wrong, both measured rather than reasoned:
 *
 *  1. `producerInstanceId` was assigned FIRST, so every later guard compared the new
 *     instance id to ITSELF (always false) and collapsed to `VALUES(heartbeatSeq) >=
 *     heartbeatSeq`. A RESTARTED producer arrives with a new id and a sequence back at 1,
 *     so it updated its id and failed that on everything else: the row kept the DEAD
 *     producer's state, fps, calibration and frame times while advertising the live
 *     producer's id, and the shop's camera card stayed frozen until the new sequence
 *     climbed past the old one (~120 heartbeats after an hour of uptime). `affectedRows`
 *     was non-zero throughout, so the route reported `accepted: true` the whole time.
 *     Verified against production 2026-09-09: instance A seq 9 stored HEALTHY; instance B
 *     seq 1 without calibration returned `accepted:true, state:CALIBRATION_INVALID`; the
 *     next read still showed HEALTHY.
 *  2. `stateSince` guards on `VALUES(state) <> state`, and `state` was assigned BEFORE it,
 *     so it compared the new state to itself. It never moved once. "How long has this
 *     camera been offline" was frozen at the row's creation time from the first release.
 *
 * THE DERIVATION. Assign in this order, so every authority guard reads the OLD
 * `receivedAt`, `state`, sequence and instance id:
 *   1. plain columns        guarded by the complete pre-statement authority predicate
 *   2. `stateSince`         reads old `state` and old `receivedAt`
 *   3. `state`
 *   4. `heartbeatSeq`
 *   5. `producerInstanceId`
 *   6. `receivedAt`         LAST. By then the owner/seq fields encode whether the claim
 *                           was accepted, so a post-accept predicate can refresh liveness
 *                           without re-reading the now-mutated stale-owner clock.
 *
 * Putting `receivedAt` earlier is a split-brain bug: a lower-priority takeover accepted
 * because the owner was stale would refresh the clock halfway through the statement and
 * make later assignments reject that same takeover.
 *
 * Checked case by case against `applyOnDuplicateKeyUpdate` in the test, which simulates
 * the left-to-right rule and runs THIS string: restart applies, replay is a no-op, a
 * newer heartbeat applies, and `stateSince` moves only on a real state change.
 */
export const HEARTBEAT_GUARDED_SET = heartbeatGuardedSetFor(
  HEARTBEAT_COLUMNS, HEARTBEAT_ACCEPT, HEARTBEAT_READ_BY_GUARDS,
);

const epoch = (d: Date | null | undefined): number | null => (d ? Math.floor(d.getTime() / 1000) : null);

export type ActiveRun = { runId: string; label: string | null };

/**
 * THREE states, not two, and the producer depends on telling them apart.
 *
 * `visitd.shop_mirror.apply_active_run` holds its current mode when the key is ABSENT and
 * ends commissioning only on an EXPLICIT null. So:
 *
 *   a run is open      -> send it
 *   looked, none open  -> send null   (this is what ENDS a run)
 *   could NOT look     -> omit it     (a transient DB error must not end a live run)
 *
 * The third case is the one that was wrong: the route always sent the key, so one failed
 * query mid-run told the producer the run was over and the rest of the test drive was
 * tagged PRODUCTION -- permanently, since the ingest treats dataClass as immutable after
 * insert. The second case is the one it is easy to break while fixing the third: omitting
 * the key on a successful empty read would mean a run could be started and never ended.
 */
export function activeRunField(
  activeRun: ActiveRun | null | undefined,
): Record<string, unknown> {
  return activeRun === undefined ? {} : { activeCommissioningRun: activeRun };
}

export function registerCameraHeartbeatRoute(app: Express): void {
  app.post("/api/camera/heartbeat", async (req: Request, res: Response) => {
    const key = process.env.CAMERA_INGEST_KEY || process.env.STATENOUR_SYNC_KEY || "";
    const provided = (req.headers["x-sync-key"] as string) || "";
    if (!key || !provided || !safeCompare(provided, key)) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const parsed = heartbeatSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "invalid body", issues: parsed.error.issues.slice(0, 8) });
    }
    const b = parsed.data;

    const { getDbTyped } = await import("../db");
    const d = await getDbTyped();
    if (!d) return res.status(503).json({ error: "database unavailable" });

    // The producer-side verdict. Liveness is trivially alive at the instant of receipt;
    // the read side re-derives it with the real age.
    const verdict = deriveStateAtIngest({
      observedAtEdgeEpoch: epoch(b.observedAtEdge),
      receivedAtEpoch: Math.floor(Date.now() / 1000),
      sourceConnected: b.sourceConnected ?? null,
      lastHealthyFrameAtEpoch: epoch(b.lastHealthyFrameAt),
      frameOk: b.frameOk ?? null,
      poseOk: b.poseOk ?? null,
      calibrationVersion: b.calibrationVersion ?? null,
      authPlaneOk: b.authPlaneOk ?? null,
      eventPlaneOk: b.eventPlaneOk ?? null,
      controlPlaneOk: b.controlPlaneOk ?? null,
      mediaPlaneOk: b.mediaPlaneOk ?? null,
      ptzHomeOk: b.ptzHomeOk ?? null,
      outboxDepth: b.outboxDepth ?? null,
      oldestOutboxAgeSeconds: b.oldestOutboxAgeSeconds ?? null,
      deadLetterDepth: b.deadLetterDepth ?? null,
    }, cameraHealthProfileFor(b.camera));

    const values: Record<(typeof HEARTBEAT_COLUMNS)[number], unknown> = {
      camera: b.camera,
      producerInstanceId: b.producerInstanceId,
      producerVersion: b.producerVersion ?? null,
      gitSha: b.gitSha ?? null,
      heartbeatSeq: b.heartbeatSeq,
      observedAtEdge: b.observedAtEdge ?? null,
      mode: b.mode,
      commissioningRunId: b.commissioningRunId ?? null,
      sourceType: b.sourceType ?? null,
      sourceGeneration: b.sourceGeneration ?? null,
      sourceConnected: b.sourceConnected == null ? null : b.sourceConnected ? 1 : 0,
      lastFrameAt: b.lastFrameAt ?? null,
      lastHealthyFrameAt: b.lastHealthyFrameAt ?? null,
      captureFps: b.captureFps ?? null,
      frameOk: b.frameOk == null ? null : b.frameOk ? 1 : 0,
      poseOk: b.poseOk == null ? null : b.poseOk ? 1 : 0,
      poseDelta: b.poseDelta ?? null,
      authPlaneOk: b.authPlaneOk == null ? null : b.authPlaneOk ? 1 : 0,
      eventPlaneOk: b.eventPlaneOk == null ? null : b.eventPlaneOk ? 1 : 0,
      controlPlaneOk: b.controlPlaneOk == null ? null : b.controlPlaneOk ? 1 : 0,
      mediaPlaneOk: b.mediaPlaneOk == null ? null : b.mediaPlaneOk ? 1 : 0,
      ptzHomeOk: b.ptzHomeOk == null ? null : b.ptzHomeOk ? 1 : 0,
      lastEventProofAt: b.lastEventProofAt ?? null,
      lastControlProofAt: b.lastControlProofAt ?? null,
      lastMediaProofAt: b.lastMediaProofAt ?? null,
      lastPtzNotifyAt: b.lastPtzNotifyAt ?? null,
      conversationWorkerOk: b.conversationWorkerOk == null ? null : b.conversationWorkerOk ? 1 : 0,
      conversationWorkerState: b.conversationWorkerState ?? null,
      conversationWorkerHeartbeatAt: b.conversationWorkerHeartbeatAt ?? null,
      conversationAudioSource: b.conversationAudioSource ?? null,
      conversationCaptureHost: b.conversationCaptureHost ?? null,
      conversationSttEngine: b.conversationSttEngine ?? null,
      conversationQueueDepth: b.conversationQueueDepth ?? null,
      conversationLastTrigger: b.conversationLastTrigger ?? null,
      lastConversationEventAt: b.lastConversationEventAt ?? null,
      lastConversationCaptureAt: b.lastConversationCaptureAt ?? null,
      lastConversationSttAt: b.lastConversationSttAt ?? null,
      lastConversationPostAt: b.lastConversationPostAt ?? null,
      lastConversationSummaryAt: b.lastConversationSummaryAt ?? null,
      lastConversationCoverage: b.lastConversationCoverage ?? null,
      conversationFailuresToday: b.conversationFailuresToday ?? null,
      conversationLastError: b.conversationLastError ?? null,
      calibrationVersion: b.calibrationVersion ?? null,
      detectorName: b.detectorName ?? null,
      modelSha256: b.modelSha256 ?? null,
      lastInferenceAt: b.lastInferenceAt ?? null,
      inferenceP95Ms: b.inferenceP95Ms ?? null,
      openVisits: b.openVisits ?? null,
      outboxDepth: b.outboxDepth ?? null,
      oldestOutboxAgeSeconds: b.oldestOutboxAgeSeconds ?? null,
      deadLetterDepth: b.deadLetterDepth ?? null,
      lastCloudAckAt: b.lastCloudAckAt ?? null,
      diskFreeBytes: b.diskFreeBytes ?? null,
      restores: b.restores ?? null,
      relocateFailures: b.relocateFailures ?? null,
      preexistingCrossed: b.preexistingCrossed ?? null,
      arrivalsAfterStitch: b.arrivalsAfterStitch ?? null,
      stitchedTotal: b.stitchedTotal ?? null,
      stitchRefusedAmbiguous: b.stitchRefusedAmbiguous ?? null,
      detectionsLast10m: b.detectionsLast10m ?? null,
      portalCrossingsLast60m: b.portalCrossingsLast60m ?? null,
      conversationListeningCoverage60m: b.conversationListeningCoverage60m ?? null,
      conversationCaptureSecondsLast60m:
        b.conversationCaptureSecondsLast60m == null ? null : Math.round(b.conversationCaptureSecondsLast60m),
      conversationCapturesLast60m: b.conversationCapturesLast60m ?? null,
      conversationCaptureFailuresLast60m: b.conversationCaptureFailuresLast60m ?? null,
      conversationWakeTriggersLast60m: b.conversationWakeTriggersLast60m ?? null,
      conversationTranscribeBacklog: b.conversationTranscribeBacklog ?? null,
      state: verdict.state,
    };

    try {
      // Previous producer-reported state, so a transition can be logged. A race
      // between two heartbeats for one camera is benign: the guard orders the
      // rows, and the worst case is one duplicated transition line.
      const prevRows = await d.execute(sql`
        SELECT state, producerInstanceId FROM camera_runtime WHERE camera = ${b.camera}
      `);
      const prevList = (Array.isArray(prevRows) ? prevRows[0] : prevRows) as unknown as Array<Record<string, unknown>> | undefined;
      const prev = Array.isArray(prevList) && prevList.length ? prevList[0] : null;

      // Only columns production HAS (lib/heartbeatStorableColumns.ts): a hand-applied
      // migration that is late drops its new fields, logged once, instead of rejecting
      // every camera heartbeat until it lands.
      const upsert = async () => {
        const columns = await storableHeartbeatColumns(d, HEARTBEAT_COLUMNS, CAMERA_RUNTIME_COLUMNS_SINCE_0124);
        const placeholders = columns.map((c) => sql`${values[c]}`);
        return d.execute(sql`
          INSERT INTO camera_runtime (${sql.raw(columns.map((c) => `\`${c}\``).join(", "))}, \`receivedAt\`, \`stateSince\`)
          VALUES (${sql.join(placeholders, sql`, `)}, NOW(), NOW())
          ON DUPLICATE KEY UPDATE ${sql.raw(heartbeatGuardedSetFor(columns, HEARTBEAT_ACCEPT, HEARTBEAT_READ_BY_GUARDS))}
        `);
      };
      let result: unknown;
      try {
        result = await upsert();
      } catch (err) {
        // The catalog said a column existed and the write disagreed (a column dropped, or a
        // cache from before a rollback). Ask again, once, rather than rejecting the heartbeat.
        if (!isUnknownColumnError(err)) throw err;
        resetStorableHeartbeatColumns();
        result = await upsert();
      }
      const info = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
      const accepted = Number(info?.affectedRows ?? 0) !== 0;
      // Read back the elected owner. `affectedRows` can be zero for an identical heartbeat,
      // but authority is a fact about the stored row, not about whether MySQL changed bytes.
      const ownerRows = await d.execute(sql`
        SELECT producerInstanceId FROM camera_runtime WHERE camera = ${b.camera} LIMIT 1
      `);
      const ownerList = (Array.isArray(ownerRows) ? ownerRows[0] : ownerRows) as
        unknown as Array<Record<string, unknown>> | undefined;
      const authorityProducer = Array.isArray(ownerList) && ownerList.length
        ? String(ownerList[0].producerInstanceId)
        : null;
      const authoritative = authorityProducer === b.producerInstanceId;

      let transition: { from: string | null; to: string; reason: string } | null = null;
      if (accepted) {
        const prevState = prev ? String(prev.state) : null;
        const prevInstance = prev ? String(prev.producerInstanceId) : null;
        if (prevState === null) {
          transition = { from: null, to: verdict.state, reason: "first heartbeat" };
        } else if (prevState !== verdict.state) {
          transition = { from: prevState, to: verdict.state, reason: verdict.reason };
        } else if (prevInstance !== null && prevInstance !== b.producerInstanceId) {
          transition = { from: prevState, to: verdict.state, reason: "producer restarted (new instance id)" };
        }
        if (transition) {
          await d.execute(sql`
            INSERT INTO camera_health_events (camera, fromState, toState, reason, producerInstanceId, sourceGeneration)
            VALUES (${b.camera}, ${transition.from}, ${transition.to}, ${transition.reason.slice(0, 191)},
                    ${b.producerInstanceId}, ${b.sourceGeneration ?? null})
          `);
        }
      }

      // THE COMMISSIONING HANDSHAKE, and it rides the heartbeat on purpose.
      //
      // `startCommissioning` only writes a row; nothing told the PRODUCER. So pressing
      // "Start a run" left the edge in PRODUCTION: the controlled drive would enter the
      // shop's real KPIs, its visits would carry no `commissioningRunId`, and the report
      // would find no machine events to compare against -- the whole exercise would run
      // and prove nothing (Codex P1 on #2255).
      //
      // The producer already talks to this route every 30 s, so the open run for this
      // camera comes back in the reply and the producer adopts it. No new endpoint, no
      // polling loop, and no way for the two to disagree about which run is live: the
      // database is the single answer and the heartbeat is the only question.
      //
      // The producer then REPORTS the run id in its next heartbeat, which lands in
      // `camera_runtime.commissioningRunId` -- so the admin can show that the edge has
      // actually acknowledged the run rather than assuming it did.
      // `undefined` means COULD NOT LOOK; `null` means LOOKED AND THERE IS NONE. The
      // producer relies on that distinction and the first version of this did not make
      // it: `apply_active_run` keeps its current mode when the key is ABSENT and ends
      // commissioning only on an EXPLICIT null, but this route always sent the key. So a
      // single transient DB error mid-run sent `null`, the producer left commissioning,
      // and the REST OF THE TEST DRIVE was tagged PRODUCTION -- permanently, because the
      // ingest treats dataClass as immutable after insert. That is the exact failure
      // dataClass exists to prevent. Found in this branch's own adversarial re-read.
      let activeRun: { runId: string; label: string | null } | null | undefined;
      try {
        const openRun = (await d.execute(sql`
          SELECT runId, label FROM commissioning_runs
          WHERE camera = ${b.camera} AND endedAt IS NULL
          ORDER BY startedAt DESC LIMIT 1
        `)) as unknown;
        const list = (Array.isArray(openRun) ? openRun[0] : openRun) as Array<Record<string, unknown>> | undefined;
        // EXPLICITLY null when the query succeeded and found nothing. Leaving it undefined
        // here would omit the key on a successful empty read, and the producer holds its
        // mode when the key is absent -- so a run could be started but never ENDED. The
        // sentinel only means "could not look"; "looked, found none" must still say null.
        activeRun = Array.isArray(list) && list.length
          ? { runId: String(list[0].runId), label: (list[0].label as string | null) ?? null }
          : null;
      } catch {
        // A missing commissioning table (migration 0123 unapplied) must NOT break the
        // heartbeat: producer health is the more important of the two, and a producer
        // that cannot report itself because a newer feature is half-deployed would be a
        // strictly worse outcome than one that simply never enters commissioning mode.
        //
        // Left UNDEFINED, not null, so the key is omitted and a producer already in a run
        // holds its mode instead of being told the run ended. Before the table exists the
        // producer has no run to hold, so this reads the same as before for that case.
        activeRun = undefined;
      }

      console.info(
        `[camera-heartbeat] ${b.camera} seq=${b.heartbeatSeq} ${accepted ? "accepted" : "stale"} state=${verdict.state}` +
        ` authoritative=${authoritative} owner=${authorityProducer ?? "-"}` +
        (transition ? ` transition=${transition.from ?? "-"}->${transition.to}` : "") +
        (activeRun ? ` activeRun=${activeRun.runId}` : ""),
      );
      return res.status(200).json({
        accepted,
        authoritative,
        authorityProducer,
        authorityLeaseSeconds: cameraProducerAuthority.leaseSeconds,
        state: verdict.state,
        facets: verdict.facets,
        reason: verdict.reason,
        transition,
        // Omitted entirely when the run could not be read; see `activeRunField`.
        ...activeRunField(activeRun),
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "heartbeat write failed" });
    }
  });
}
