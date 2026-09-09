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
] as const;

/** Every column updates only when the incoming seq is at least the stored one. */
export const GUARDED_SET = COLUMNS.filter((c) => c !== "visitId")
  .map((c) => `\`${c}\` = IF(VALUES(\`seq\`) >= \`seq\`, VALUES(\`${c}\`), \`${c}\`)`)
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

    type Outcome = "applied" | "stale" | "failed";
    const results: Array<{ visitId: string; outcome: Outcome; reason?: string }> = [];

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
        // Only an EXACT match may carry a customer id into the read model.
        customerId: v.customerMatch === "EXACT" ? (v.customerId ?? null) : null,
        preexisting: v.preexisting ? 1 : 0,
        entryEvidence: v.entryEvidence ?? null,
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
        const result = await d.execute(sql`
          INSERT INTO vehicle_visits (${sql.raw(COLUMNS.map((c) => `\`${c}\``).join(", "))})
          VALUES (${sql.join(placeholders, sql`, `)})
          ON DUPLICATE KEY UPDATE ${sql.raw(GUARDED_SET)}
        `);
        // mysql2 affectedRows: 1 = inserted, 2 = updated, 0 = matched but nothing changed.
        // A guarded no-op (stale delivery) and an identical re-delivery both land on 0,
        // which is the correct outcome for each: the row already reflects the newer state.
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
});
export function parseHeartbeat(body: unknown) {
  return heartbeatSchema.safeParse(body);
}

/** Columns written from the body, in order. `camera` is the key; `state` is derived here. */
export const HEARTBEAT_COLUMNS = [
  "camera", "producerInstanceId", "producerVersion", "gitSha", "heartbeatSeq", "observedAtEdge",
  "mode", "commissioningRunId", "sourceType", "sourceGeneration", "sourceConnected",
  "lastFrameAt", "lastHealthyFrameAt", "captureFps", "frameOk", "poseOk", "poseDelta",
  "calibrationVersion", "detectorName", "modelSha256", "lastInferenceAt", "inferenceP95Ms",
  "openVisits", "outboxDepth", "oldestOutboxAgeSeconds", "deadLetterDepth", "lastCloudAckAt",
  "diskFreeBytes", "restores", "state",
] as const;

/** A newer sequence from the same producer, or any sequence from a new producer instance. */
export const HEARTBEAT_ACCEPT =
  "(VALUES(`producerInstanceId`) <> `producerInstanceId` OR VALUES(`heartbeatSeq`) >= `heartbeatSeq`)";

/** Every column updates only under HEARTBEAT_ACCEPT; the two server clocks are set here too. */
export const HEARTBEAT_GUARDED_SET = [
  ...HEARTBEAT_COLUMNS.filter((c) => c !== "camera").map(
    (c) => `\`${c}\` = IF(${HEARTBEAT_ACCEPT}, VALUES(\`${c}\`), \`${c}\`)`,
  ),
  `\`receivedAt\` = IF(${HEARTBEAT_ACCEPT}, NOW(), \`receivedAt\`)`,
  `\`stateSince\` = IF(${HEARTBEAT_ACCEPT} AND VALUES(\`state\`) <> \`state\`, NOW(), \`stateSince\`)`,
].join(", ");

const epoch = (d: Date | null | undefined): number | null => (d ? Math.floor(d.getTime() / 1000) : null);

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
      outboxDepth: b.outboxDepth ?? null,
      oldestOutboxAgeSeconds: b.oldestOutboxAgeSeconds ?? null,
      deadLetterDepth: b.deadLetterDepth ?? null,
    });

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

      const placeholders = HEARTBEAT_COLUMNS.map((c) => sql`${values[c]}`);
      const result = await d.execute(sql`
        INSERT INTO camera_runtime (${sql.raw(HEARTBEAT_COLUMNS.map((c) => `\`${c}\``).join(", "))}, \`receivedAt\`, \`stateSince\`)
        VALUES (${sql.join(placeholders, sql`, `)}, NOW(), NOW())
        ON DUPLICATE KEY UPDATE ${sql.raw(HEARTBEAT_GUARDED_SET)}
      `);
      const info = (Array.isArray(result) ? result[0] : result) as { affectedRows?: number } | undefined;
      const accepted = Number(info?.affectedRows ?? 0) !== 0;

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

      console.info(
        `[camera-heartbeat] ${b.camera} seq=${b.heartbeatSeq} ${accepted ? "accepted" : "stale"} state=${verdict.state}` +
        (transition ? ` transition=${transition.from ?? "-"}->${transition.to}` : ""),
      );
      return res.status(200).json({
        accepted,
        state: verdict.state,
        facets: verdict.facets,
        reason: verdict.reason,
        transition,
      });
    } catch (err) {
      return res.status(500).json({ error: err instanceof Error ? err.message : "heartbeat write failed" });
    }
  });
}
