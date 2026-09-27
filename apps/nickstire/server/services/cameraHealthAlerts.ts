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
 * - one alert per camera/state/shop-day via cron_alerts_fired.
 * - HEALTHY sends a recovery only when the latest prior camera alert was degraded.
 * - no new alert table: cron_alerts_fired already survives pod restarts + multi-pod.
 */

import { sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { deriveCameraState } from "../lib/cameraHealth";
import { EXPECTED_CAMERAS } from "../../shared/cameras";
import {
  cameraAlertDecision,
  cameraAlertShopDay,
  deliverCameraAlertExternally,
  deliverWithConfirmedNotification,
  formatCameraHealthAlert,
  type CameraHealthState as HealthState,
} from "./cameraHealthAlertPolicy";

const log = createLogger("camera-health-alerts");

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Boolean(Number(value));
}

function alertKey(camera: string, state: HealthState): string {
  return `camera_health:${camera}:${state}`;
}

async function claimAlert(
  db: Awaited<ReturnType<typeof import("../db")["getDb"]>>,
  camera: string,
  state: HealthState,
  shopDay: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!db) return false;
  const key = alertKey(camera, state);
  const [claim] = await db.execute(sql`
    INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at, payload)
    VALUES (${key}, ${shopDay}, NOW(), ${JSON.stringify(payload)})
  `);
  return ((claim as { affectedRows?: number })?.affectedRows ?? 0) === 1;
}

async function releaseAlertClaim(
  db: NonNullable<Awaited<ReturnType<typeof import("../db")["getDb"]>>>,
  camera: string,
  state: HealthState,
  shopDay: string,
): Promise<void> {
  const key = alertKey(camera, state);
  await db.execute(sql`
    DELETE FROM cron_alerts_fired
     WHERE alert_key = ${key}
       AND fired_for = ${shopDay}
  `);
}

async function deliverClaimedAlert(input: {
  db: NonNullable<Awaited<ReturnType<typeof import("../db")["getDb"]>>>;
  camera: string;
  state: HealthState;
  shopDay: string;
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
    releaseClaim: () =>
      releaseAlertClaim(input.db, input.camera, input.state, input.shopDay),
  });
}

async function latestCameraAlertKey(
  db: NonNullable<Awaited<ReturnType<typeof import("../db")["getDb"]>>>,
  camera: string,
): Promise<string | null> {
  const prefix = `camera_health:${camera}:%`;
  const [rows] = await db.execute(sql`
    SELECT alert_key
      FROM cron_alerts_fired
     WHERE alert_key LIKE ${prefix}
     ORDER BY fired_at DESC
     LIMIT 1
  `);
  const row = (rows as Array<Record<string, unknown>>)[0];
  return row?.alert_key ? String(row.alert_key) : null;
}

export async function runCameraHealthAlerts(): Promise<{
  recordsProcessed: number;
  details: string;
}> {
  const { getDb } = await import("../db");
  const db = await getDb();
  if (!db) throw new Error("camera-health-alerts: database unavailable");

  const shopDay = cameraAlertShopDay();
  const commissioned = EXPECTED_CAMERAS.filter((camera) => camera.commissioned);
  if (commissioned.length === 0) {
    return { recordsProcessed: 0, details: "no commissioned cameras" };
  }

  const cameraNames = commissioned.map((camera) => camera.camera);
  const [rows] = await db.execute(sql`
    SELECT camera,
           UNIX_TIMESTAMP() - UNIX_TIMESTAMP(receivedAt) AS ageSeconds,
           UNIX_TIMESTAMP(observedAtEdge) AS observedAtEdgeEpoch,
           UNIX_TIMESTAMP(receivedAt) AS receivedAtEpoch,
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
           deadLetterDepth
      FROM camera_runtime
     WHERE camera IN (${sql.join(cameraNames.map((name) => sql`${name}`), sql`, `)})
  `);

  const byCamera = new Map(
    (rows as Array<Record<string, unknown>>).map((row) => [String(row.camera), row]),
  );

  let sent = 0;
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
            outboxDepth: numberOrNull(row.outboxDepth),
            oldestOutboxAgeSeconds: numberOrNull(row.oldestOutboxAgeSeconds),
            deadLetterDepth: numberOrNull(row.deadLetterDepth),
          }
        : null,
      expected.healthProfile,
    );
    observed.push(`${expected.camera}=${verdict.state}`);

    const latest = await latestCameraAlertKey(db, expected.camera);
    const decision = cameraAlertDecision(verdict.state, latest);
    if (!decision.notify) continue;

    const claimed = await claimAlert(db, expected.camera, verdict.state, shopDay, {
      camera: expected.camera,
      role: expected.role,
      state: verdict.state,
      reason: verdict.reason,
      recovery: decision.recovery,
    });
    if (!claimed) continue;

    await deliverClaimedAlert({
      db,
      camera: expected.camera,
      state: verdict.state,
      shopDay,
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
      });
    } else {
      log.warn("camera health alert fired", {
        camera: expected.camera,
        state: verdict.state,
        reason: verdict.reason,
      });
    }
  }

  return {
    recordsProcessed: sent,
    details: `${sent} alert(s); ${observed.join(", ")}`,
  };
}
