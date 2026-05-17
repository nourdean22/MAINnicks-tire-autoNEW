import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

const CAMERA_EVENT_TYPES = [
  "motion_detected",
  "person_detected",
  "vehicle_detected",
  "doorbell_ring",
] as const;

/**
 * GET /api/cameras/intelligence
 *
 * v10.0.60 · Wave A part 3 · Pre-fix this route was three dead
 * `Promise.resolve([] as any[])` placeholders pretending to read
 * from cameraMetric / cameraAlert / licensePlateLog tables that
 * don't exist in the schema. v10.0.55 + v10.0.59 wired the real
 * persistence — camera-intelligence module derives metrics from
 * `prisma.deviceEvent` directly, alerts go to BrainMemory category=
 * "camera_alert". This route now returns the same data the
 * /system/diagnostics dashboard sees.
 *
 * Plate logs return empty (ALPR pipeline not yet wired into the
 * deviceEvent payload — see lib/ai/system-prompt v10.0.59 note).
 */
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  // v10.0.123 cleanup · was parsed-but-never-used (lint had it
  // prefixed `_days`). Now actually drives the alert-window lookback,
  // bounded [1, 90] so an attacker can't blow up the brainMemory scan.
  const daysParam = Number(url.searchParams.get("days") ?? "7");
  const days = Number.isFinite(daysParam)
    ? Math.max(1, Math.min(90, Math.floor(daysParam)))
    : 7;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const lookbackStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  // ── Hourly metrics for today (derived from deviceEvent) ──
  const todayEvents = (await prisma.deviceEvent.findMany({
    where: {
      event: { in: [...CAMERA_EVENT_TYPES] },
      timestamp: { gte: todayStart },
    },
    select: { event: true, timestamp: true },
  }).catch(() => [])) as Array<{ event: string; timestamp: Date }>;

  // Bucket by hour
  const hourMap = new Map<
    number,
    { hour: number; persons: number; vehicles: number }
  >();
  for (const e of todayEvents) {
    const h = e.timestamp.getHours();
    const cur = hourMap.get(h) ?? { hour: h, persons: 0, vehicles: 0 };
    if (e.event === "person_detected") cur.persons++;
    else if (e.event === "vehicle_detected") cur.vehicles++;
    hourMap.set(h, cur);
  }
  const metrics = [...hourMap.values()].sort((a, b) => a.hour - b.hour);

  const totalPersons = metrics.reduce((s, m) => s + m.persons, 0);
  const totalVehicles = metrics.reduce((s, m) => s + m.vehicles, 0);

  // Bay occupancy proxy: fraction of elapsed hours with shop activity.
  const elapsedHours = Math.max(1, new Date().getHours() + 1);
  const activeHours = metrics.filter((m) => m.persons + m.vehicles > 0).length;
  const avgBayOccupancy = Math.round((activeHours / elapsedHours) * 100);

  const peakMetric = metrics.length > 0
    ? metrics.reduce((best, m) =>
        m.persons + m.vehicles > best.persons + best.vehicles ? m : best,
      )
    : null;
  const peakHour = peakMetric ? `${peakMetric.hour}:00` : "";

  // ── Recent alerts (BrainMemory category="camera_alert", last 7d) ──
  const alertRows = await prisma.brainMemory
    .findMany({
      where: {
        category: "camera_alert",
        deletedAt: null,
        createdAt: { gte: lookbackStart },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, key: true, content: true, createdAt: true },
    })
    .catch((): Array<{ id: string; key: string; content: string; createdAt: Date }> => []);

  const alerts = alertRows.map((a) => {
    const lower = a.content.toLowerCase();
    const severity: "critical" | "high" | "medium" | "low" =
      /critical|breach/.test(lower)
        ? "critical"
        : /after-hours|long wait/.test(lower)
          ? "high"
          : /alert/.test(lower)
            ? "medium"
            : "low";
    const alertType = /after-hours/i.test(lower)
      ? "after_hours_motion"
      : /wait/i.test(lower)
        ? "long_customer_wait"
        : "general";
    return {
      id: a.id,
      cameraId: "unknown", // not surfaced in the brainMemory content; future ALPR-pipeline upgrade may add
      alertType,
      severity,
      description: a.content,
      createdAt: a.createdAt.toISOString(),
    };
  });

  // ── Recent plate logs (ALPR not yet wired) ──
  const plates: Array<{
    plateNumber: string;
    cameraId: string;
    direction: "in" | "out";
    vehicleType: string;
    createdAt: string;
  }> = [];

  return {
    summary: {
      totalPersons,
      totalVehicles,
      avgBayOccupancy,
      peakHour,
      alertCount: alerts.length,
    },
    alerts,
    plates,
    metrics,
  };
// v10.0.121 audit-pattern follow-up · was unauthenticated. Exposes
// private security-camera events + alerts. Owner-gated.
}, { auth: "owner" });
