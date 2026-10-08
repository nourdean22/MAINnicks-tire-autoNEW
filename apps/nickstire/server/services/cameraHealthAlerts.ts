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

/** The most recent page about this camera, degraded or recovery, and how long ago it fired. */
async function latestCameraAlert(
  db: Db,
  camera: string,
): Promise<{ key: string; ageSeconds: number | null } | null> {
  const prefix = `camera_health:${camera}:%`;
  const [rows] = await db.execute(sql`
    SELECT alert_key, UNIX_TIMESTAMP() - UNIX_TIMESTAMP(fired_at) AS ageSeconds
      FROM cron_alerts_fired
     WHERE alert_key LIKE ${prefix}
     ORDER BY fired_at DESC
     LIMIT 1
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  if (!row?.alert_key) return null;
  return { key: String(row.alert_key), ageSeconds: numberOrNull(row.ageSeconds) };
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
  const observed: string[] = [];

  for (const expected of commissioned) {
    const row = byCamera.get(expected.camera);
    const verdict = deriveCameraState(
      row
        ? {
            ageSeconds: numberOrNull(row.ageSeconds),
            observedAtEdgeEpoch: numberOrNull(row.observedAtEdgeEpoch),
            receivedAtEpoch: numberOrNull(row.receivedAtEpoch),
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

    const latest = await latestCameraAlert(db, expected.camera);
    const decision = cameraAlertDecision(
      verdict.state,
      latest?.key ?? null,
      verdict.facets,
      latest?.ageSeconds ?? null,
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
    });
    if (!claimed) continue;

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

  return {
    recordsProcessed: sent,
    details: `${sent} alert(s)${held ? `, ${held} held by the ${Math.round(cameraAlertCooldownSeconds() / 60)}-minute cooldown` : ""}; ${observed.join(", ")}`,
  };
}
