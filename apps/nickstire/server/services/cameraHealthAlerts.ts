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

const log = createLogger("camera-health-alerts");

type HealthState = ReturnType<typeof deriveCameraState>["state"];
type HealthVerdict = ReturnType<typeof deriveCameraState>;

const NON_PAGING_STATES = new Set<HealthState>(["HEALTHY", "STALE"]);

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

export function isCameraPagingState(state: HealthState): boolean {
  return !NON_PAGING_STATES.has(state);
}

export function formatCameraHealthAlert(input: {
  camera: string;
  label: string;
  role: string;
  verdict: HealthVerdict;
  recovery: boolean;
}): { title: string; message: string } {
  const { label, role, verdict, recovery } = input;
  const facetSummary = Object.entries(verdict.facets)
    .filter(([, value]) => value !== "not_required")
    .map(([key, value]) => `${key}=${value}`)
    .join(" · ");

  if (recovery) {
    return {
      title: `Camera recovered — ${label}`,
      message:
        `✅ ${label} is HEALTHY again.\n\n` +
        `Authority: ${role.replace(/_/g, " ")}\n` +
        `Proof: ${facetSummary}\n\n` +
        `Review: Admin → Lot / Cameras.`,
    };
  }

  return {
    title: `Camera degraded — ${label}`,
    message:
      `🔴 ${label} entered ${verdict.state}.\n\n` +
      `Authority: ${role.replace(/_/g, " ")}\n` +
      `Reason: ${verdict.reason}\n` +
      `Proof: ${facetSummary}\n\n` +
      `Review: Admin → Lot / Cameras.`,
  };
}

async function claimAlert(
  db: Awaited<ReturnType<typeof import("../db")["getDb"]>>,
  camera: string,
  state: HealthState,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (!db) return false;
  const key = alertKey(camera, state);
  const [claim] = await db.execute(sql`
    INSERT IGNORE INTO cron_alerts_fired (alert_key, fired_for, fired_at, payload)
    VALUES (${key}, CURDATE(), NOW(), ${JSON.stringify(payload)})
  `);
  return ((claim as { affectedRows?: number })?.affectedRows ?? 0) === 1;
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
    const latestWasHealthy = latest?.endsWith(":HEALTHY") === true;

    if (verdict.state === "HEALTHY") {
      // A green camera with no prior degraded alert is normal, not a recovery.
      if (!latest || latestWasHealthy) continue;
      const claimed = await claimAlert(db, expected.camera, "HEALTHY", {
        camera: expected.camera,
        role: expected.role,
        state: verdict.state,
        reason: verdict.reason,
        recovery: true,
      });
      if (!claimed) continue;

      const { notifySystemAlert } = await import("../email-notify");
      await notifySystemAlert(
        formatCameraHealthAlert({
          camera: expected.camera,
          label: expected.label,
          role: expected.role,
          verdict,
          recovery: true,
        }),
      );
      sent++;
      continue;
    }

    if (!isCameraPagingState(verdict.state)) continue;

    const claimed = await claimAlert(db, expected.camera, verdict.state, {
      camera: expected.camera,
      role: expected.role,
      state: verdict.state,
      reason: verdict.reason,
      recovery: false,
    });
    if (!claimed) continue;

    const { notifySystemAlert } = await import("../email-notify");
    await notifySystemAlert(
      formatCameraHealthAlert({
        camera: expected.camera,
        label: expected.label,
        role: expected.role,
        verdict,
        recovery: false,
      }),
    );
    sent++;
    log.warn("camera health alert fired", {
      camera: expected.camera,
      state: verdict.state,
      reason: verdict.reason,
    });
  }

  return {
    recordsProcessed: sent,
    details: `${sent} alert(s); ${observed.join(", ")}`,
  };
}
