/**
 * GET /api/cron/device-heartbeat-sentinel · 2026-09-08 · ADR-0017 / master-plan C8.
 *
 * The camera bridge PATCHes each camera device every 60 s. Before this route
 * nothing noticed when it stopped: the April 2026 local agent died and the
 * devices read ONLINE for months (RECONCILIATION "DIED Apr 14"). This sentinel
 * runs from the WORKER's node-cron every 15 minutes (the Neon-wake cadence
 * #1696 settled on — a 5-minute tick would keep the compute awake) and:
 *
 *   1. flips ONLINE -> OFFLINE for watched devices that HAVE reported at
 *      least once and have been silent longer than STALE_AFTER_MS, alerting
 *      ONCE per transition (Telegram + tagged push, so PR #1740 flood control
 *      applies). Devices that never reported are ignored by construction —
 *      the heartbeat birth-registry rule from #1737 (a never-run job must not
 *      page as "down").
 *   2. clears the flag and sends a low-priority "back online" push when a
 *      device the sentinel marked OFFLINE resumes heartbeats (the bridge's own
 *      PATCH restores status ONLINE; this route only tidies and tells).
 *
 * `alerted` reflects delivery: sendTelegram returns false instead of throwing.
 */
import type { Prisma } from "@prisma/client";
import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { sendTelegram, formatTelegramNotification } from "@/lib/services/telegram";
import { sendPush } from "@/lib/notifications/push";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/device-heartbeat-sentinel");

/** Two missed 60 s heartbeats plus one 15-min worker tick of slack. */
export const STALE_AFTER_MS = 20 * 60_000;

const WATCHED = {
  OR: [{ deviceType: "CAMERA" }, { deviceType: "BRIDGE" }, { platform: "V380" }, { platform: "FRIGATE" }],
};

const COCKPIT_URL = "https://bdnick.info/system/camera";

type SentinelMeta = {
  offlineAt: string;
  lastSeenAt: string | null;
  /** When at least one channel accepted the outage alert; null = still owed. */
  alertedAt: string | null;
  alertAttempts: number;
};

/** Stop retrying an undeliverable outage alert after ~3 h of 15-min ticks. */
const MAX_ALERT_ATTEMPTS = 12;

function readSentinel(metadata: unknown): SentinelMeta | null {
  const m = metadata as { sentinel?: Partial<SentinelMeta> } | null;
  if (!m?.sentinel?.offlineAt) return null;
  return {
    offlineAt: m.sentinel.offlineAt,
    lastSeenAt: m.sentinel.lastSeenAt ?? null,
    alertedAt: m.sentinel.alertedAt ?? null,
    alertAttempts: m.sentinel.alertAttempts ?? 0,
  };
}

type WatchedDevice = { id: string; name: string; platformDeviceId: string; lastSeenAt: Date | null; metadata: unknown };

/**
 * Telegram + tagged push. `delivered` is true only when a channel accepted
 * the message: sendTelegram returns false instead of throwing, and a push
 * with zero subscriptions reports `sent: 0`.
 */
async function deliverOutageAlert(d: WatchedDevice, silentMinutes: number): Promise<boolean> {
  const body =
    `${d.name} (${d.platformDeviceId}) last heartbeat ${silentMinutes} min ago — marked OFFLINE. ` +
    `Edge box: docker compose ps · visitd logs · Frigate 8971. Cockpit: ${COCKPIT_URL}`;
  const telegramOk = await sendTelegram(formatTelegramNotification("Camera bridge silent", body, "high"));
  if (!telegramOk) log.error("sentinel_alert_undelivered", { device: d.platformDeviceId, channel: "telegram" });
  let pushSent = 0;
  try {
    const res = await sendPush({
      title: "Camera bridge silent",
      body: `${d.name}: no heartbeat for ${silentMinutes} min`,
      level: "high",
      tag: `device-offline:${d.platformDeviceId}`,
      url: COCKPIT_URL,
      data: { deviceId: d.id, platformDeviceId: d.platformDeviceId, silentMinutes },
    });
    pushSent = res.sent;
  } catch (err) {
    log.warn("sentinel_push_failed", { error: err instanceof Error ? err.message : String(err) });
  }
  return telegramOk || pushSent > 0;
}

export async function runHeartbeatSentinel(now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - STALE_AFTER_MS);

  // 1. Silent devices. `lastSeenAt: { lt }` excludes NULL, so a device that
  //    has never reported cannot be selected here.
  const stale = await prisma.smartDevice.findMany({
    where: { status: "ONLINE", lastSeenAt: { lt: cutoff }, ...WATCHED },
    select: { id: true, name: true, platformDeviceId: true, lastSeenAt: true, metadata: true },
  });

  const flipped: Array<{ id: string; platformDeviceId: string; silentMinutes: number; alerted: boolean }> = [];
  for (const d of stale) {
    const silentMinutes = d.lastSeenAt ? Math.round((now.getTime() - d.lastSeenAt.getTime()) / 60_000) : -1;
    const rest = (d.metadata as Record<string, unknown> | null) ?? {};
    const sentinel: SentinelMeta = {
      offlineAt: now.toISOString(),
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      alertedAt: null,
      alertAttempts: 0,
    };
    const metadata = { ...rest, sentinel } as Prisma.InputJsonObject;
    // Conditional write: the bridge's heartbeat PATCH runs independently and
    // may land between the findMany above and this update. Require the row
    // to STILL be silent, and only alert when the transition really happened
    // - otherwise a fresh ONLINE would be overwritten and a false outage paged.
    const transition = await prisma.smartDevice.updateMany({
      where: { id: d.id, status: "ONLINE", lastSeenAt: { lt: cutoff } },
      data: { status: "OFFLINE", metadata },
    });
    if (transition.count === 0) {
      log.info("sentinel_transition_skipped", { device: d.platformDeviceId, reason: "heartbeat_arrived_first" });
      continue;
    }

    const alerted = await deliverOutageAlert(d, silentMinutes);
    // Delivery state is persisted so an alert nobody received is retried
    // by pass 3 instead of being lost behind the OFFLINE status.
    await prisma.smartDevice.update({
      where: { id: d.id },
      data: {
        metadata: {
          ...rest,
          sentinel: { ...sentinel, alertedAt: alerted ? now.toISOString() : null, alertAttempts: 1 },
        } as Prisma.InputJsonObject,
      },
    });
    log.warn("device_marked_offline", { device: d.platformDeviceId, silentMinutes, alerted });
    flipped.push({ id: d.id, platformDeviceId: d.platformDeviceId, silentMinutes, alerted });
  }

  // 2. Recoveries: back ONLINE (the bridge PATCH did that) while our flag
  //    is still set — clear it and say so quietly.
  const online = await prisma.smartDevice.findMany({
    where: { status: "ONLINE", lastSeenAt: { gte: cutoff }, ...WATCHED },
    select: { id: true, name: true, platformDeviceId: true, lastSeenAt: true, metadata: true },
  });
  const recovered: Array<{ id: string; platformDeviceId: string; offlineAt: string }> = [];
  for (const d of online) {
    const flag = readSentinel(d.metadata);
    if (!flag) continue;
    const rest = { ...((d.metadata as Record<string, unknown> | null) ?? {}) };
    delete rest.sentinel;
    await prisma.smartDevice.update({ where: { id: d.id }, data: { metadata: rest as Prisma.InputJsonObject } });
    try {
      await sendPush({
        title: "Camera bridge back online",
        body: `${d.name} resumed heartbeats (offline since ${flag.offlineAt})`,
        level: "low",
        tag: `device-online:${d.platformDeviceId}`,
        url: COCKPIT_URL,
      });
    } catch (err) {
      log.warn("sentinel_recovery_push_failed", { error: err instanceof Error ? err.message : String(err) });
    }
    log.info("device_recovered", { device: d.platformDeviceId, offlineAt: flag.offlineAt });
    recovered.push({ id: d.id, platformDeviceId: d.platformDeviceId, offlineAt: flag.offlineAt });
  }

  // 3. Owed alerts: devices we flagged OFFLINE whose outage alert reached no
  //    channel. The OFFLINE status excludes them from pass 1 forever, so
  //    without this pass a transient Telegram/push failure would leave a dead
  //    bridge unannounced. Retried every tick, capped.
  const offline = await prisma.smartDevice.findMany({
    where: { status: "OFFLINE", ...WATCHED },
    select: { id: true, name: true, platformDeviceId: true, lastSeenAt: true, metadata: true },
  });
  const retried: Array<{ id: string; platformDeviceId: string; alerted: boolean; attempts: number }> = [];
  for (const d of offline) {
    const flag = readSentinel(d.metadata);
    if (!flag || flag.alertedAt || flag.alertAttempts >= MAX_ALERT_ATTEMPTS) continue;
    const silentMinutes = d.lastSeenAt ? Math.round((now.getTime() - d.lastSeenAt.getTime()) / 60_000) : -1;
    const alerted = await deliverOutageAlert(d, silentMinutes);
    const attempts = flag.alertAttempts + 1;
    const rest = (d.metadata as Record<string, unknown> | null) ?? {};
    await prisma.smartDevice.update({
      where: { id: d.id },
      data: {
        metadata: {
          ...rest,
          sentinel: { ...flag, alertedAt: alerted ? now.toISOString() : null, alertAttempts: attempts },
        } as Prisma.InputJsonObject,
      },
    });
    if (!alerted && attempts >= MAX_ALERT_ATTEMPTS) {
      log.error("sentinel_alert_abandoned", { device: d.platformDeviceId, attempts });
    }
    log.warn("sentinel_alert_retried", { device: d.platformDeviceId, attempts, alerted });
    retried.push({ id: d.id, platformDeviceId: d.platformDeviceId, alerted, attempts });
  }

  const ok = flipped.every((f) => f.alerted) && retried.every((r) => r.alerted);
  return {
    ok,
    staleAfterMs: STALE_AFTER_MS,
    checked: stale.length + online.length + offline.length,
    flipped,
    recovered,
    retried,
  };
}

export const GET = cronHandler(async () => runHeartbeatSentinel());
