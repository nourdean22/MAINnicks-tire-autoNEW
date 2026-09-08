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

type SentinelMeta = { offlineAt: string; lastSeenAt: string | null };

function readSentinel(metadata: unknown): SentinelMeta | null {
  const m = metadata as { sentinel?: Partial<SentinelMeta> } | null;
  return m?.sentinel?.offlineAt ? { offlineAt: m.sentinel.offlineAt, lastSeenAt: m.sentinel.lastSeenAt ?? null } : null;
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
    const metadata = {
      ...((d.metadata as Record<string, unknown> | null) ?? {}),
      sentinel: { offlineAt: now.toISOString(), lastSeenAt: d.lastSeenAt?.toISOString() ?? null },
    } as Prisma.InputJsonObject;
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

    const body =
      `${d.name} (${d.platformDeviceId}) last heartbeat ${silentMinutes} min ago — marked OFFLINE. ` +
      `Edge box: docker compose ps · visitd logs · Frigate 8971. Cockpit: ${COCKPIT_URL}`;
    const alerted = await sendTelegram(formatTelegramNotification("Camera bridge silent", body, "high"));
    if (!alerted) log.error("sentinel_alert_undelivered", { device: d.platformDeviceId });
    try {
      await sendPush({
        title: "Camera bridge silent",
        body: `${d.name}: no heartbeat for ${silentMinutes} min`,
        level: "high",
        tag: `device-offline:${d.platformDeviceId}`,
        url: COCKPIT_URL,
        data: { deviceId: d.id, platformDeviceId: d.platformDeviceId, silentMinutes },
      });
    } catch (err) {
      log.warn("sentinel_push_failed", { error: err instanceof Error ? err.message : String(err) });
    }
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

  const ok = flipped.every((f) => f.alerted);
  return { ok, staleAfterMs: STALE_AFTER_MS, checked: stale.length + online.length, flipped, recovered };
}

export const GET = cronHandler(async () => runHeartbeatSentinel());
