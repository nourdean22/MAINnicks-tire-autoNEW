/**
 * Camera health owner alerts.
 *
 * Reuses the same proven alert rail used by other Nick's system monitors:
 *   camera_runtime -> deriveCameraState -> cron_alerts_fired atomic claim
 *   -> notifySystemAlert (CEO email + push, Telegram fallback)
 *
 * Design rules:
 * - commissioned cameras only. Planned/uncommissioned hardware is not an outage.
 * - UNKNOWN is never silently converted to healthy; the health lattice owns truth.
 * - STALE is intentionally not paged. The heartbeat tier runs every 5 minutes and
 *   the offline SLO is 120s, so a durable outage will be PRODUCER_OFFLINE by the
 *   next pass. Paging STALE as well creates two alerts for one interruption.
 * - one alert per camera/state/EPISODE via cron_alerts_fired (2026-10-07; it was per
 *   shop day, which deduped the second outage of a day against the first and re-paged
 *   an unchanged outage at midnight). A 30-minute cooldown per camera delays, never
 *   drops, so a flapping source cannot page 17 times in a morning.
 * - HEALTHY sends a recovery only when the latest prior camera alert was degraded, and
 *   not when a blind camera merely stopped being judged because the shop closed.
 * - no new alert table: cron_alerts_fired already survives pod restarts + multi-pod.
 * - the 0144 plausibility columns are read only once production has them
 *   (cameraRuntimeHasColumns); a hand-applied migration must not red this job.
 */

import { sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { deriveCameraState, shopOpenAt } from "../lib/cameraHealth";
import { solarExpectedOffline } from "../lib/solar";
import { cameraRuntimeHasColumns } from "../lib/heartbeatStorableColumns";
import { derivedStateBeganAtMs, derivedTransition } from "../lib/cameraTimeline";
import { isMissingTableError } from "../lib/dbErrors";
import { EXPECTED_CAMERAS, cameraPowerFor } from "../../shared/cameras";
import {
  cameraAlertClaim,
  cameraAlertCooldownSeconds,
  cameraAlertDecision,
  cameraAlertEpisode,
  deliverCameraAlertExternally,
  deliverWithConfirmedNotification,
  episodeFromAlertKey,
  formatCameraHealthAlert,
  type CameraHealthState as HealthState,
} from "./cameraHealthAlertPolicy";

const log = createLogger("camera-health-alerts");

type Db = NonNullable<Awaited<ReturnType<typeof import("../db")["getDb"]>>>;
type Claim = { key: string; firedFor: string };

const PLAUSIBILITY_COLUMNS = ["detectionsLast10m", "portalCrossingsLast60m"] as const;

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(Number(value));
}

async function claimAlert(
  db: Db,
  claim: Claim,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const [result] = await db.execute(sql`
    INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at, payload)
    VALUES (${claim.key}, ${claim.firedFor}, NOW(), ${JSON.stringify(payload)})
  `);
  return ((result as { affectedRows?: number })?.affectedRows ?? 0) === 1;
}

async function releaseAlertClaim(db: Db, claim: Claim): Promise<void> {
  await db.execute(sql`
    DELETE FROM cron_alerts_fired
     WHERE alert_key = ${claim.key}
       AND fired_for = ${claim.firedFor}
  `);
}

async function deliverClaimedAlert(input: {
  db: Db;
  camera: string;
  state: HealthState;
  claim: Claim;
  alert: { title: string; message: string };
}): Promise<void> {
  const [{ notifySystemAlert }, { sendTelegram }] = await Promise.all([
    import("../email-notify"),
    import("./telegram"),
  ]);
  await deliverWithConfirmedNotification({
    camera: input.camera,
    state: input.state,
    alert: input.alert,
    notify: (alert) =>
      deliverCameraAlertExternally({
        alert,
        notifySystem: notifySystemAlert,
        webhookConfigured: Boolean(process.env.NOTIFICATION_WEBHOOK_URL),
        sendTelegram,
      }),
    releaseClaim: () => releaseAlertClaim(input.db, input.claim),
  });
}

export async function runCameraHealthAlertSelfTest(input?: {
  notifySystem?: (alert: { title: string; message: string }) => Promise<{
    emailSent: boolean;
    pushSent: boolean;
  }>;
  sendTelegram?: (text: string) => Promise<boolean>;
  webhookConfigured?: boolean;
}): Promise<{ recordsProcessed: number; details: string }> {
  const notifySystem =
    input?.notifySystem ??
    (await import("../email-notify")).notifySystemAlert;
  const sendTelegram =
    input?.sendTelegram ??
    (await import("./telegram")).sendTelegram;

  const alert = {
    title: "Camera alert delivery test — Nick's Tire",
    message:
      "✅ Live camera-health notification self-test.\n\n" +
      "No camera state was changed and no outage was synthesized. " +
      "This message proves the external owner-delivery rail accepted a real notification.",
  };

  const delivery = await deliverCameraAlertExternally({
    alert,
    notifySystem,
    webhookConfigured:
      input?.webhookConfigured ?? Boolean(process.env.NOTIFICATION_WEBHOOK_URL),
    sendTelegram,
  });

  const accepted = [
    delivery.emailAccepted ? "email" : null,
    delivery.webhookAccepted ? "webhook" : null,
    delivery.telegramAccepted ? "telegram" : null,
  ].filter(Boolean) as string[];

  if (accepted.length === 0) {
    throw new Error("camera-health-alert-selftest: no external delivery surface accepted the test");
  }

  return {
    recordsProcessed: 1,
    details: `camera alert self-test externally accepted by ${accepted.join(", ")}`,
  };
}

/**
 * The most recent page about this camera, degraded or recovery, how long ago it fired, and the
 * vision facet recorded with it (null for a claim written before that field existed).
 */
async function latestCameraAlert(
  db: Db,
  camera: string,
): Promise<{ key: string; ageSeconds: number | null; vision: string | null; frames: string | null } | null> {
  const prefix = `camera_health:${camera}:%`;
  const [rows] = await db.execute(sql`
    SELECT alert_key, payload, UNIX_TIMESTAMP() - UNIX_TIMESTAMP(fired_at) AS ageSeconds
      FROM cron_alerts_fired
     WHERE alert_key LIKE ${prefix}
     ORDER BY fired_at DESC
     LIMIT 1
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row?.alert_key) return null;
  let vision: string | null = null;
  let frames: string | null = null;
  try {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
    if (payload && typeof payload === "object") {
      const p = payload as { vision?: unknown; frames?: unknown };
      if (typeof p.vision === "string") vision = p.vision;
      if (typeof p.frames === "string") frames = p.frames;
    }
  } catch {
    vision = null; // an unreadable payload is "not recorded", which the policy treats cautiously
    frames = null;
  }
  return { key: String(row.alert_key), ageSeconds: numberOrNull(row.ageSeconds), vision, frames };
}

/**
 * The health TIMELINE's second writer (audit N6). The heartbeat ingest logs the producer's own
 * state changes into `camera_health_events`; it cannot log STALE, PRODUCER_OFFLINE or
 * EXPECTED_SOLAR_OFFLINE, because no heartbeat arrives to log them, so until this pass the
 * table read HEALTHY straight through every outage. Each tick compares the state this job
 * DERIVES with the last row for the camera and writes one transition when they differ.
 *
 * A missing table is logged once and skipped (the table is hand-applied, like every migration
 * here); any other failure propagates to the caller, which pages first and throws after -- a
 * timeline that stopped must not pass as a quiet tick.
 */
let timelineTableMissingLogged = false;
export async function recordDerivedHealthTransition(
  db: Db,
  camera: string,
  verdict: { state: HealthState; reason: string },
  producerInstanceId: string | null,
  /** When the derived state BEGAN on the heartbeat clock (derivedStateBeganAtMs), epoch seconds; null = now. */
  beganAtEpoch: number | null = null,
): Promise<boolean> {
  try {
    const [rows] = await db.execute(sql`
      SELECT toState, UNIX_TIMESTAMP(at) AS atEpoch FROM camera_health_events
       WHERE camera = ${camera}
       ORDER BY at DESC, id DESC
       LIMIT 1
    `);
    const latest = (rows as Array<Record<string, unknown>>)[0];
    const latestToState = latest?.toState == null ? null : String(latest.toState);
    const latestAtEpoch = latest?.atEpoch == null ? null : Number(latest.atEpoch);
    const transition = derivedTransition(latestToState, verdict);
    if (!transition) return false;
    // Stamped where the state began, not when this tick noticed it: a row stamped at the tick
    // counted up to five minutes of a dead producer as watched (review on #2929). Never before
    // the row it follows (the timeline is read in `at` order) and never in the future.
    const nowEpoch = Math.floor(Date.now() / 1000);
    let atEpoch: number | null = beganAtEpoch === null ? null : Math.min(Math.floor(beganAtEpoch), nowEpoch);
    if (atEpoch !== null && latestAtEpoch !== null && Number.isFinite(latestAtEpoch) && atEpoch <= latestAtEpoch) {
      atEpoch = Math.min(latestAtEpoch + 1, nowEpoch);
    }
    await db.execute(sql`
      INSERT INTO camera_health_events (camera, fromState, toState, reason, producerInstanceId, sourceGeneration, at)
      VALUES (${camera}, ${transition.from}, ${transition.to}, ${transition.reason}, ${producerInstanceId}, ${null},
              ${atEpoch === null ? sql`NOW()` : sql`FROM_UNIXTIME(${atEpoch})`})
    `);
    log.info("camera health timeline: derived transition recorded", {
      camera,
      from: transition.from,
      to: transition.to,
    });
    return true;
  } catch (err) {
    if (isMissingTableError(err)) {
      if (!timelineTableMissingLogged) {
        timelineTableMissingLogged = true;
        log.warn("camera_health_events is missing; derived transitions are not recorded until it is applied", { camera });
      }
      return false;
    }
    throw err;
  }
}

export async function runCameraHealthAlerts(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("camera-health-alerts: database unavailable");

  const commissioned = EXPECTED_CAMERAS.filter((camera) => camera.commissioned);
  if (commissioned.length === 0) {
    return { recordsProcessed: 0, details: "no commissioned cameras" };
  }

  const shopOpen = shopOpenAt();
  // Same sky as lot.health: a solar camera dark between civil dusk and ~2 h after sunrise is
  // EXPECTED_SOLAR_OFFLINE (non-paging), the same loss at noon pages as before (audit N3).
  const solar = solarExpectedOffline(new Date());
  const hasPlausibility = await cameraRuntimeHasColumns(db, PLAUSIBILITY_COLUMNS);
  const cameraNames = commissioned.map((camera) => camera.camera);
  const [rows] = await db.execute(sql`
    SELECT camera,
           producerInstanceId,
           heartbeatSeq,
           UNIX_TIMESTAMP() - UNIX_TIMESTAMP(receivedAt) AS ageSeconds,
           UNIX_TIMESTAMP(observedAtEdge) AS observedAtEdgeEpoch,
           UNIX_TIMESTAMP(receivedAt) AS receivedAtEpoch,
           UNIX_TIMESTAMP(stateSince) AS stateSinceEpoch,
           sourceConnected,
           UNIX_TIMESTAMP(lastHealthyFrameAt) AS lastHealthyFrameAtEpoch,
           frameOk,
           poseOk,
           calibrationVersion,
           authPlaneOk,
           eventPlaneOk,
           controlPlaneOk,
           mediaPlaneOk,
           ptzHomeOk,
           outboxDepth,
           oldestOutboxAgeSeconds,
           deadLetterDepth,
           UNIX_TIMESTAMP() - UNIX_TIMESTAMP(lastInferenceAt) AS inferenceAgeSeconds
           ${hasPlausibility ? sql`, detectionsLast10m, portalCrossingsLast60m` : sql``}
      FROM camera_runtime
     WHERE camera IN (${sql.join(cameraNames.map((name) => sql`${name}`), sql`, `)})
  `);

  const byCamera = new Map(
    (rows as Array<Record<string, unknown>>).map((row) => [String(row.camera), row]),
  );

  let sent = 0;
  let held = 0;
  let recorded = 0;
  let timelineFailure: unknown = null;
  // One camera's undeliverable page must not stop the next camera from being judged, recorded
  // and paged on the same tick (review on #2929); the failure is thrown after the loop.
  let deliveryFailure: unknown = null;
  const observed: string[] = [];
  const nowMs = Date.now();

  for (const expected of commissioned) {
    const row = byCamera.get(expected.camera);
    const verdict = deriveCameraState(
      row
        ? {
            ageSeconds: numberOrNull(row.ageSeconds),
            observedAtEdgeEpoch: numberOrNull(row.observedAtEdgeEpoch),
            receivedAtEpoch: numberOrNull(row.receivedAtEpoch),
            heartbeatSeq: numberOrNull(row.heartbeatSeq),
            sourceConnected: boolOrNull(row.sourceConnected),
            lastHealthyFrameAtEpoch: numberOrNull(row.lastHealthyFrameAtEpoch),
            frameOk: boolOrNull(row.frameOk),
            poseOk: boolOrNull(row.poseOk),
            calibrationVersion:
              row.calibrationVersion === null || row.calibrationVersion === undefined
                ? null
                : String(row.calibrationVersion),
            authPlaneOk: boolOrNull(row.authPlaneOk),
            eventPlaneOk: boolOrNull(row.eventPlaneOk),
            controlPlaneOk: boolOrNull(row.controlPlaneOk),
            mediaPlaneOk: boolOrNull(row.mediaPlaneOk),
            ptzHomeOk: boolOrNull(row.ptzHomeOk),
            detectionsLast10m: numberOrNull(row.detectionsLast10m),
            portalCrossingsLast60m: numberOrNull(row.portalCrossingsLast60m),
            inferenceAgeSeconds: numberOrNull(row.inferenceAgeSeconds),
            shopOpen,
            outboxDepth: numberOrNull(row.outboxDepth),
            oldestOutboxAgeSeconds: numberOrNull(row.oldestOutboxAgeSeconds),
            deadLetterDepth: numberOrNull(row.deadLetterDepth),
          }
        : null,
      expected.healthProfile,
      { solar: cameraPowerFor(expected.camera) === "solar" ? solar : null },
    );
    observed.push(`${expected.camera}=${verdict.state}`);

    // The timeline row for the state this pass derived (audit N6), written before the page so
    // the two agree on what happened. A failure is kept, not thrown here: every camera is still
    // judged and paged, then the run fails loudly at the end.
    try {
      const beganAtMs = derivedStateBeganAtMs({
        state: verdict.state,
        receivedAtEpoch: row ? numberOrNull(row.receivedAtEpoch) : null,
        ageSeconds: row ? numberOrNull(row.ageSeconds) : null,
        stateSinceEpoch: row ? numberOrNull(row.stateSinceEpoch) : null,
        nowMs,
      });
      if (
        await recordDerivedHealthTransition(
          db,
          expected.camera,
          verdict,
          row?.producerInstanceId == null ? null : String(row.producerInstanceId),
          beganAtMs === null ? null : Math.floor(beganAtMs / 1000),
        )
      ) {
        recorded++;
      }
    } catch (err) {
      timelineFailure = err;
    }

    const latest = await latestCameraAlert(db, expected.camera);
    const decision = cameraAlertDecision(
      verdict.state,
      latest?.key ?? null,
      verdict.facets,
      latest?.ageSeconds ?? null,
      latest?.vision,
      latest?.frames,
    );
    if (decision.held) held++;
    if (!decision.notify) continue;

    // A recovery closes the episode it recovers FROM, so it is keyed on that episode: the
    // producer's HEALTHY `stateSince` may predate several outages (an offline producer never
    // changes its reported state), and keying on it would dedupe the second recovery away.
    const episode = decision.recovery
      ? (episodeFromAlertKey(latest?.key ?? null) ??
        cameraAlertEpisode({
          state: verdict.state,
          stateSinceEpoch: row ? numberOrNull(row.stateSinceEpoch) : null,
          receivedAtEpoch: row ? numberOrNull(row.receivedAtEpoch) : null,
        }))
      : cameraAlertEpisode({
          state: verdict.state,
          stateSinceEpoch: row ? numberOrNull(row.stateSinceEpoch) : null,
          receivedAtEpoch: row ? numberOrNull(row.receivedAtEpoch) : null,
        });
    const claim = cameraAlertClaim(expected.camera, verdict.state, episode);

    const claimed = await claimAlert(db, claim, {
      camera: expected.camera,
      role: expected.role,
      state: verdict.state,
      reason: verdict.reason,
      recovery: decision.recovery,
      episode,
      // The vision AND frames facets AT PAGE TIME, so a later HEALTHY can tell a blind-canary
      // page (recovery waits for the detector to see again) from a frozen-capture page (recovers
      // like any other): on a quiet lot a frozen capture reads vision=blind too.
      vision: verdict.facets.vision,
      frames: verdict.facets.frames,
    });
    if (!claimed) continue;

    try {
      await deliverClaimedAlert({
        db,
        camera: expected.camera,
        state: verdict.state,
        claim,
        alert: formatCameraHealthAlert({
          camera: expected.camera,
          label: expected.label,
          role: expected.role,
          verdict,
          recovery: decision.recovery,
        }),
      });
    } catch (err) {
      // The claim was released inside deliverWithConfirmedNotification, so the page is retried
      // next tick; the other cameras still get their turn on this one.
      deliveryFailure = err;
      log.error("camera health alert delivery failed; continuing with the other cameras", {
        camera: expected.camera,
        state: verdict.state,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    sent++;
    if (decision.recovery) {
      log.info("camera health recovery fired", {
        camera: expected.camera,
        state: verdict.state,
        episode,
      });
    } else {
      log.warn("camera health alert fired", {
        camera: expected.camera,
        state: verdict.state,
        reason: verdict.reason,
        episode,
      });
    }
  }

  if (timelineFailure) {
    throw new Error(
      `camera-health-alerts: ${sent} alert(s) sent, then the health timeline write failed: ${
        timelineFailure instanceof Error ? timelineFailure.message : String(timelineFailure)
      }`,
    );
  }
  if (deliveryFailure) {
    throw deliveryFailure instanceof Error
      ? deliveryFailure
      : new Error(`camera-health-alerts: ${sent} alert(s) sent, one delivery failed: ${String(deliveryFailure)}`);
  }

  return {
    recordsProcessed: sent,
    details: `${sent} alert(s)${held ? `, ${held} held by the ${Math.round(cameraAlertCooldownSeconds() / 60)}-minute cooldown` : ""}${recorded ? `, ${recorded} timeline transition(s) recorded` : ""}; ${observed.join(", ")}`,
  };
}
