/**
 * lib/ai/prompt/sections/camera-intel.ts · Wave 84 · 2026-05-17
 *
 * Pure formatter for v1's camera-intelligence block
 * (system-prompt.ts:1143-1170 pre-split). Renders:
 *
 *   · Camera intelligence summary (today's traffic + bay utilization
 *     + alert counts), source: getCameraIntelligence()
 *   · Active camera alerts pulled from BrainMemory category=camera_alert
 *   · Desk vision events (V380 cameras, legacy)
 *
 * Caller owns the data fetching; this file does no I/O. The shape
 * of camIntelResult mirrors what getCameraIntelligence() returns;
 * we keep it inline to avoid a type import that would couple this
 * formatter to the camera-intelligence module's internals.
 */

type CameraIntelResult = {
  todayTraffic: { people: number; vehicles: number; peakHour: number };
  bayUtilization: number;
  avgDailyTraffic: number;
  alerts: { unresolved: number; critical: number };
};

interface CameraIntelInput {
  camIntelResult: CameraIntelResult | null;
  recentCamAlerts: { severity: string; alertType: string; description: string }[];
  recentVisionEvents: {
    timestamp: Date;
    event: string;
    camera: string | null;
    data: unknown;
  }[];
}

export function renderCameraIntel(input: CameraIntelInput): string[] {
  const { camIntelResult, recentCamAlerts, recentVisionEvents } = input;
  const p: string[] = [];

  if (camIntelResult) {
    try {
      p.push(`## Camera Intelligence`);
      p.push(`Traffic: ${camIntelResult.todayTraffic.people} people, ${camIntelResult.todayTraffic.vehicles} vehicles | Peak: ${camIntelResult.todayTraffic.peakHour}:00`);
      p.push(`Bay utilization: ${camIntelResult.bayUtilization}% | 7d avg: ${camIntelResult.avgDailyTraffic}`);
      if (camIntelResult.alerts.unresolved > 0) {
        p.push(`⚠ ${camIntelResult.alerts.unresolved} unresolved alerts (${camIntelResult.alerts.critical} critical)`);
      }
    } catch (err) {
      // Field-shape drift in CameraIntelligence shouldn't break the
      // chat path. Silent on purpose — matches v1's prior behavior.
      void import("@/lib/utils/error-log").then(({ logError }) => logError("ai.prompt.camera-intel", err, { fn: "renderCameraIntel" }, "warn"));
    }
  }

  if (recentCamAlerts.length > 0) {
    p.push(`## Active Camera Alerts (${recentCamAlerts.length})`);
    for (const a of recentCamAlerts) {
      p.push(`[${a.severity.toUpperCase()}] ${a.alertType}: ${a.description}`);
    }
  }

  // Legacy vision events (V380 desk cameras)
  if (recentVisionEvents && recentVisionEvents.length > 0) {
    p.push(`## Desk Vision Events`);
    for (const v of recentVisionEvents.slice(0, 3)) {
      const ts = new Date(v.timestamp).toISOString().slice(0, 16);
      const d = v.data as Record<string, unknown> | null;
      const detail = d?.response
        ? String(d.response).slice(0, 100)
        : d?.duration_minutes
          ? `${d.duration_minutes}min`
          : d?.score
            ? `motion score ${d.score}`
            : "";
      p.push(`${ts} [${v.camera || "?"}] ${v.event}${detail ? ": " + detail : ""}`);
    }
  }
  p.push(``);

  return p;
}

