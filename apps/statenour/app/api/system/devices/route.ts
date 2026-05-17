import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/system/devices — full device health feed (W3).
 *
 * Aggregates SmartDevice + DeviceCommand + DeviceEvent into one
 * composite. Powers /system/devices. The existing /devices page uses
 * a per-device detail surface; this is the fleet-level command deck.
 *
 * Returns:
 *   · rollup by status (ONLINE/OFFLINE/ERROR/UNKNOWN)
 *   · by platform (TUYA/RING/EUFY/GOOGLE_HOME/V380/MANUAL)
 *   · by location (shop, home-basement, etc.)
 *   · by type (CAMERA/LOCK/SPEAKER/…)
 *   · agent liveness — newest DeviceEvent createdAt in last 24h
 *   · command queue stats — pending / failed / reaped counts
 *   · per-device list with last-seen, staleness class, command
 *     backlog, recent-event count
 */

type Staleness = "live" | "stale" | "lost";

interface DeviceRow {
  id: string;
  name: string;
  platform: string;
  deviceType: string;
  location: string | null;
  status: string;
  lastSeenAt: string | null;
  minutesSinceLastSeen: number | null;
  staleness: Staleness;
  pendingCommands: number;
  failedCommands24h: number;
  recentEvents24h: number;
}

function classifyStaleness(lastSeenAt: Date | null): { cls: Staleness; mins: number | null } {
  if (!lastSeenAt) return { cls: "lost", mins: null };
  const mins = Math.round((Date.now() - lastSeenAt.getTime()) / 60000);
  if (mins < 10) return { cls: "live", mins };
  if (mins < 60 * 6) return { cls: "stale", mins };
  return { cls: "lost", mins };
}

export const GET = apiHandler(async () => {
  const since24h = new Date(Date.now() - 24 * 3600_000);

  const [devices, pendingCmds, failedCmds24h, recentEvents24h, newestEvent] = await Promise.all([
    prisma.smartDevice.findMany({
      orderBy: [{ status: "asc" }, { lastSeenAt: "desc" }],
    }),
    prisma.deviceCommand.groupBy({
      by: ["deviceId"],
      where: { status: "pending" },
      _count: { id: true },
    }),
    prisma.deviceCommand.groupBy({
      by: ["deviceId"],
      where: { status: "failed", createdAt: { gte: since24h } },
      _count: { id: true },
    }),
    prisma.deviceEvent.groupBy({
      by: ["deviceId"],
      where: { createdAt: { gte: since24h } },
      _count: { id: true },
    }),
    prisma.deviceEvent.findFirst({
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const pendingByDevice = new Map(pendingCmds.map((c) => [c.deviceId ?? "", c._count.id]));
  const failedByDevice = new Map(failedCmds24h.map((c) => [c.deviceId ?? "", c._count.id]));
  const eventsByDevice = new Map(recentEvents24h.map((e) => [e.deviceId ?? "", e._count.id]));

  const rows: DeviceRow[] = devices.map((d) => {
    const { cls, mins } = classifyStaleness(d.lastSeenAt);
    return {
      id: d.id,
      name: d.name,
      platform: d.platform,
      deviceType: d.deviceType,
      location: d.location,
      status: d.status,
      lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
      minutesSinceLastSeen: mins,
      staleness: cls,
      pendingCommands: pendingByDevice.get(d.id) ?? 0,
      failedCommands24h: failedByDevice.get(d.id) ?? 0,
      recentEvents24h: eventsByDevice.get(d.id) ?? 0,
    };
  });

  // Rollups
  const byStatus = { ONLINE: 0, OFFLINE: 0, ERROR: 0, UNKNOWN: 0 } as Record<string, number>;
  const byPlatform: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  const byType: Record<string, number> = {};
  const byStaleness: Record<Staleness, number> = { live: 0, stale: 0, lost: 0 };

  for (const d of rows) {
    byStatus[d.status] = (byStatus[d.status] ?? 0) + 1;
    byPlatform[d.platform] = (byPlatform[d.platform] ?? 0) + 1;
    const loc = d.location ?? "unknown";
    byLocation[loc] = (byLocation[loc] ?? 0) + 1;
    byType[d.deviceType] = (byType[d.deviceType] ?? 0) + 1;
    byStaleness[d.staleness] += 1;
  }

  // Agent liveness — the last time ANY device wrote an event
  const agentLastHeartbeatAt = newestEvent?.createdAt?.toISOString() ?? null;
  const agentMinutesSilent = newestEvent?.createdAt
    ? Math.round((Date.now() - newestEvent.createdAt.getTime()) / 60000)
    : null;
  const agentStatus: "live" | "stale" | "dead" | "never" =
    !agentLastHeartbeatAt
      ? "never"
      : agentMinutesSilent! < 15
        ? "live"
        : agentMinutesSilent! < 360
          ? "stale"
          : "dead";

  const commandQueue = {
    pending: [...pendingByDevice.values()].reduce((a, b) => a + b, 0),
    failed24h: [...failedByDevice.values()].reduce((a, b) => a + b, 0),
  };

  return {
    rows,
    summary: {
      total: rows.length,
      byStatus,
      byPlatform,
      byLocation,
      byType,
      byStaleness,
      commandQueue,
      agent: {
        status: agentStatus,
        lastHeartbeatAt: agentLastHeartbeatAt,
        minutesSilent: agentMinutesSilent,
      },
    },
    generatedAt: new Date().toISOString(),
  };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts