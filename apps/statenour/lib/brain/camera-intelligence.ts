/**
 * Camera intelligence · v10.0.55 · Wave A · cleanup.
 *
 * Pre-cleanup: 8 dead Promise.resolve sites that referenced a
 * `cameraMetric` / `cameraAlert` Prisma model that doesn't exist in
 * the schema (intended persistence layer for hourly camera roll-ups
 * was never built). The reads always returned [], the writes silently
 * dropped data, and `getCameraIntelligence` always returned zeros.
 *
 * Post-cleanup: aggregations derived directly from `prisma.deviceEvent`
 * (the real camera-event ingest table). No separate metrics table —
 * the daily/weekly traffic counts are computed on-demand from raw
 * events. Brain insight writes (the only persistence that mattered)
 * still go through `brainMemory.remember`. After-hours alerts still
 * fire to Telegram.
 *
 * What's gone (no replacement needed):
 *  · Hourly cameraMetric upsert — analytics derive on-read instead
 *  · cameraAlert table — alerts go straight to Telegram + brainMemory
 *  · Bay-utilization metric persistence — derived from event count
 *
 * What's preserved:
 *  · After-hours motion → Telegram alert
 *  · Long customer wait → Telegram alert
 *  · Daily traffic insight → BrainMemory category="shop_traffic"
 *  · Morning employee arrival → BrainMemory category="employee_attendance"
 *  · getCameraIntelligence() return shape — consumers unchanged
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { sendTelegram } from "@/lib/services/telegram";
import { hourET, startOfDayET, toDateString, today } from "@/lib/utils/datetime";

const CAMERA_EVENT_TYPES = [
  "motion_detected",
  "person_detected",
  "vehicle_detected",
  "doorbell_ring",
] as const;

interface DeviceEventRow {
  deviceId: string;
  event: string;
  timestamp: Date;
  device: {
    id: string;
    name: string | null;
    deviceType: string | null;
    location: string | null;
  } | null;
}

/**
 * Process camera events and extract intelligence.
 *
 * NOT SCHEDULED (verified 2026-09-08, ADR-0017 / master-plan C2): no cron
 * route, Inngest function or fan-out calls this — the "brain-cycle cron" the
 * previous docstring named does not exist in config/crons.ts. Every alert it
 * computes (after-hours motion, long customer wait, daily traffic, employee
 * arrival) is therefore inert until it is wired. Wire it once real vehicle
 * events exist (Phase 3 of the plan), not before: with zero events every
 * branch below is a no-op and would only add a Neon wake.
 */
export async function analyzeCameraData(): Promise<{
  alerts: number;
  metrics: number;
  insights: number;
}> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  let alerts = 0;
  let metrics = 0;
  let insights = 0;

  // ── 1. Recent camera events ────────────────────────────────
  const recentEvents = (await prisma.deviceEvent.findMany({
    where: {
      event: { in: [...CAMERA_EVENT_TYPES] },
      timestamp: { gte: oneHourAgo },
    },
    include: {
      device: {
        select: { id: true, name: true, deviceType: true, location: true },
      },
    },
  })) as DeviceEventRow[];

  // Group by camera and count metrics in-memory (replaces the dead
  // cameraMetric upsert; these counts feed the alerts + insights below
  // and the per-camera roll-up is logged via brainMemory below).
  const byCamera: Record<string, DeviceEventRow[]> = {};
  for (const e of recentEvents) {
    if (!byCamera[e.deviceId]) byCamera[e.deviceId] = [];
    byCamera[e.deviceId].push(e);
  }
  metrics = Object.keys(byCamera).length;

  // ── 2. After-hours security detection ──────────────────────
  const hour = hourET();
  const isShopClosed = hour >= 20 || hour < 7; // 8pm-7am

  if (isShopClosed) {
    const shopMotion = recentEvents.filter((e) => {
      const loc = e.device?.location ?? "";
      return loc.includes("shop") && e.event === "motion_detected";
    });

    if (shopMotion.length > 0) {
      await sendTelegram(
        `🚨 <b>After-Hours Motion — Shop</b>\n\n` +
          `${shopMotion.length} motion events detected\n` +
          `Camera: ${shopMotion[0].device?.name ?? "Unknown"}\n` +
          `Time: ${new Date().toLocaleTimeString()}\n\n` +
          `Check cameras at bdnick.info/cameras`,
      ).catch(() => {});

      // Persist alert as a brainMemory row (replaces the dead
      // cameraAlert.create).
      await brainMemory
        .remember(
          "camera_alert",
          `after_hours_${Date.now()}`,
          `After-hours shop motion: ${shopMotion.length} events on ${shopMotion[0].device?.name ?? "unknown camera"} at ${new Date().toISOString()}.`,
          "camera-intelligence",
        )
        .catch(() => undefined);
      alerts++;
    }
  }

  // ── 3. Customer wait time analysis ──────────────────────────
  const shopPersonEvents = recentEvents.filter((e) => {
    const loc = e.device?.location ?? "";
    return loc.includes("shop") && e.event === "person_detected";
  });

  if (shopPersonEvents.length > 0) {
    const firstEvent = shopPersonEvents[shopPersonEvents.length - 1]?.timestamp;
    const lastEvent = shopPersonEvents[0]?.timestamp;
    if (firstEvent && lastEvent) {
      const waitMins = Math.round(
        (lastEvent.getTime() - firstEvent.getTime()) / 60000,
      );
      if (waitMins > 30) {
        await sendTelegram(
          `⏰ <b>Long Customer Wait</b>\n\n` +
            `Someone has been at the shop for ~${waitMins} minutes.\n` +
            `${shopPersonEvents.length} person detections in the last hour.`,
        ).catch(() => {});
        alerts++;
      }
    }
  }

  // ── 4. Daily traffic insight ────────────────────────────────
  // ET day, not server-local: bare setHours(0,0,0,0) floors to UTC midnight
  // on Railway = 8pm ET the previous evening, so "today" leaked 4-5h of
  // yesterday. Same trap datetime.ts startOfDay already documents.
  const todayStart = startOfDayET();

  const todayEvents = (await prisma.deviceEvent.findMany({
    where: {
      event: { in: [...CAMERA_EVENT_TYPES] },
      timestamp: { gte: todayStart },
    },
    select: { event: true, timestamp: true },
  })) as Array<{ event: string; timestamp: Date }>;

  if (todayEvents.length >= 4) {
    const totalPeople = todayEvents.filter((e) => e.event === "person_detected").length;
    const totalVehicles = todayEvents.filter((e) => e.event === "vehicle_detected").length;

    // Peak-hour bucket — group by event hour and find the one with
    // the most people+vehicle detections.
    const hourCounts = new Map<number, { p: number; v: number }>();
    for (const e of todayEvents) {
      const h = hourET(e.timestamp);
      const cur = hourCounts.get(h) ?? { p: 0, v: 0 };
      if (e.event === "person_detected") cur.p++;
      else if (e.event === "vehicle_detected") cur.v++;
      hourCounts.set(h, cur);
    }
    let peakHour = 0;
    let peakSum = -1;
    let peakP = 0;
    let peakV = 0;
    for (const [h, c] of hourCounts.entries()) {
      const sum = c.p + c.v;
      if (sum > peakSum) {
        peakHour = h;
        peakSum = sum;
        peakP = c.p;
        peakV = c.v;
      }
    }

    await brainMemory
      .remember(
        "shop_traffic",
        `traffic_${today()}`,
        `Shop traffic today: ${totalPeople} people, ${totalVehicles} vehicles across ${hourCounts.size} active hours. Peak hour: ${peakHour}:00 (${peakP} people, ${peakV} vehicles).`,
        "camera-intelligence",
      )
      .catch(() => undefined);
    insights++;
  }

  // ── 5. Employee arrival tracking ────────────────────────────
  const morningWindow = hour >= 7 && hour <= 9;
  if (morningWindow) {
    const morningPerson = shopPersonEvents.filter(
      (e) => hourET(e.timestamp) >= 7 && hourET(e.timestamp) <= 9,
    );

    if (morningPerson.length > 0) {
      const firstArrival = morningPerson[morningPerson.length - 1]?.timestamp;
      if (firstArrival) {
        await brainMemory
          .remember(
            "employee_attendance",
            `arrival_${today()}`,
            `First person detected at shop: ${firstArrival.toLocaleTimeString()}. ${morningPerson.length} person events during morning window (7-9am).`,
            "camera-intelligence",
          )
          .catch(() => undefined);
        insights++;
      }
    }
  }

  return { alerts, metrics, insights };
}

/**
 * Get camera intelligence summary for AI chat and dashboards.
 *
 * Pre-cleanup: returned all zeros because cameraMetric reads were
 * dead. Now derives counts directly from `prisma.deviceEvent` and the
 * brainMemory shop_traffic insight.
 */
export async function getCameraIntelligence(): Promise<{
  todayTraffic: { people: number; vehicles: number; peakHour: number };
  alerts: { unresolved: number; critical: number };
  bayUtilization: number;
  avgDailyTraffic: number;
}> {
  const todayStart = startOfDayET();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Today's events for live counts
  const todayEvents = (await prisma.deviceEvent.findMany({
    where: {
      event: { in: [...CAMERA_EVENT_TYPES] },
      timestamp: { gte: todayStart },
    },
    select: { event: true, timestamp: true, deviceId: true },
  }).catch(() => [])) as Array<{ event: string; timestamp: Date; deviceId: string }>;

  const people = todayEvents.filter((e) => e.event === "person_detected").length;
  const vehicles = todayEvents.filter((e) => e.event === "vehicle_detected").length;

  // Peak hour
  const hourCounts = new Map<number, number>();
  for (const e of todayEvents) {
    if (e.event !== "person_detected" && e.event !== "vehicle_detected") continue;
    hourCounts.set(hourET(e.timestamp), (hourCounts.get(hourET(e.timestamp)) ?? 0) + 1);
  }
  let peakHour = 0;
  let peakCount = -1;
  for (const [h, c] of hourCounts.entries()) {
    if (c > peakCount) {
      peakHour = h;
      peakCount = c;
    }
  }

  // Alerts — pull recent camera_alert brainMemory rows for this week.
  const recentAlerts = await prisma.brainMemory
    .findMany({
      where: {
        category: "camera_alert",
        deletedAt: null,
        createdAt: { gte: weekAgo },
      },
      select: { content: true },
    })
    .catch((): Array<{ content: string }> => []);
  const unresolvedAlerts = recentAlerts.length;
  const criticalAlerts = recentAlerts.filter((a) =>
    /after-hours|critical|breach/i.test(a.content),
  ).length;

  // Bay utilization — fraction of active hours in the day. With no
  // bayOccupied flag in deviceEvent, we approximate as the ratio of
  // hours with shop activity over the day's elapsed ET hours. Both sides
  // of the ratio are ET-framed now that todayStart is startOfDayET();
  // the clamp inside utilizationPct keeps any future frame mismatch from
  // publishing >100%.
  const elapsedHours = Math.max(1, hourET() + 1);
  const activeHours = hourCounts.size;
  const bayUtilization = utilizationPct(activeHours, elapsedHours);

  // 7-day average daily traffic, averaged over days that actually saw
  // events — a /7 calendar denominator reads as "traffic halved" whenever
  // cameras were offline half the week (same denominator rule as #1913's
  // avgDailyVisits fix in page-intelligence).
  const weekEventRows = (await prisma.deviceEvent.findMany({
    where: {
      event: { in: ["person_detected", "vehicle_detected"] },
      timestamp: { gte: weekAgo },
    },
    select: { timestamp: true },
  }).catch(() => [] as Array<{ timestamp: Date }>)) as Array<{ timestamp: Date }>;
  const { avg: avgDaily } = avgDailyOverActiveDays(
    weekEventRows.map((r) => r.timestamp),
  );

  return {
    todayTraffic: { people, vehicles, peakHour },
    alerts: { unresolved: unresolvedAlerts, critical: criticalAlerts },
    bayUtilization,
    avgDailyTraffic: avgDaily,
  };
}

/**
 * Pure denominators for the read path, exported for direct unit testing
 * (the computePromiseIntegrity / sanitizeDeadline precedent).
 *
 * Days are bucketed in ET via toDateString — a 23:30 ET event belongs to
 * the ET day it happened on, not to the next UTC calendar day the server
 * clock would file it under. Zero active days returns 0, not NaN: an
 * unobserved week is UNMEASURED, not "no traffic".
 */
export function avgDailyOverActiveDays(timestamps: Date[]): {
  avg: number;
  activeDays: number;
} {
  const activeDays = new Set(timestamps.map((t) => toDateString(t))).size;
  return {
    activeDays,
    avg: activeDays > 0 ? Math.round(timestamps.length / activeDays) : 0,
  };
}

/** 0-100 only: if an activity window ever outruns the elapsed-hours
 *  denominator again (the UTC-day/ET-hours mismatch this file shipped
 *  with), clamp rather than publish 120%. */
export function utilizationPct(
  activeHours: number,
  elapsedHours: number,
): number {
  return Math.min(
    100,
    Math.round((activeHours / Math.max(1, elapsedHours)) * 100),
  );
}
