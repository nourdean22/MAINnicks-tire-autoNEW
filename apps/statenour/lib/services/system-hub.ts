/**
 * lib/services/system-hub.ts · Phase VV (2026-05-22 ·
 * legacy-modernizer REST→tRPC system slice).
 *
 * The /system hub landing-page rollup. Lifted verbatim from
 * app/api/system/hub/route.ts so the legacy REST endpoint AND the new
 * `system.hub` tRPC procedure call the same function · drift between
 * consumers structurally impossible.
 *
 * One compact payload feeding every subsurface card's live chip — the
 * hub page has 15+ links, so a single rollup avoids 15 parallel
 * fetches. Every sub-rollup is `safeQuery`'d so one broken query
 * doesn't poison the rest.
 */

import { prisma } from "@/lib/prisma";
import { safeQuery } from "@/lib/db/safe-prisma";
import { scanCronHealth } from "@/lib/system/cron-diagnostics";
import { scanStaleData } from "@/lib/system/stale-data-scanner";
import { getPowerSettings } from "@/lib/services/power-panel";

/** Composite /system hub payload — all keys independent + fault-isolated. */
export async function buildSystemHub() {
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const since7d = new Date(Date.now() - 7 * 86400_000);

  const [
    cronReport,
    staleReport,
    errorStats,
    brainStats,
    deviceStats,
    aiStats,
    powerSettings,
    pulsePriority,
    governanceCount,
  ] = await Promise.all([
    scanCronHealth().catch(() => null),
    scanStaleData().catch(() => null),

    safeQuery(
      async () => {
        // ErrorLog has `level` (error/warn/fatal), not `severity`.
        const rows = await prisma.$queryRaw<
          Array<{ errors: bigint; fatal: bigint }>
        >`
          SELECT
            COUNT(*)::bigint AS errors,
            COUNT(*) FILTER (WHERE level = 'fatal')::bigint AS fatal
          FROM error_logs
          WHERE created_at >= ${since24h}
        `;
        const r = rows[0];
        return {
          count24h: Number(r?.errors ?? 0),
          fatal24h: Number(r?.fatal ?? 0),
        };
      },
      { count24h: 0, fatal24h: 0 },
      { label: "hub.errors" },
    ),

    safeQuery(
      async () => {
        const row = await prisma.$queryRaw<
          Array<{ total: bigint; perm: bigint; avg: number | null }>
        >`
          SELECT
            COUNT(*)::bigint AS total,
            COUNT(*) FILTER (WHERE expires_at IS NULL)::bigint AS perm,
            AVG(confidence)::float8 AS avg
          FROM brain_memories
        `;
        const r = row[0];
        return {
          totalMemories: Number(r?.total ?? 0),
          permanent: Number(r?.perm ?? 0),
          avgConfidence: Number(r?.avg ?? 0),
        };
      },
      { totalMemories: 0, permanent: 0, avgConfidence: 0 },
      { label: "hub.brain" },
    ),

    safeQuery(
      async () => {
        const rows = await prisma.smartDevice.findMany({
          select: { status: true },
        });
        const online = rows.filter((r) => r.status === "ONLINE").length;
        const offline = rows.filter((r) => r.status === "OFFLINE").length;
        return { online, offline, total: rows.length };
      },
      { online: 0, offline: 0, total: 0 },
      { label: "hub.devices" },
    ),

    safeQuery(
      async () => {
        const rows = await prisma.$queryRaw<
          Array<{ calls: bigint; cost_cents: bigint | null }>
        >`
          SELECT
            COUNT(*) FILTER (WHERE created_at >= ${since24h})::bigint AS calls,
            COALESCE(SUM(cost_cents) FILTER (WHERE created_at >= ${since7d}), 0)::bigint AS cost_cents
          FROM ai_generations
        `;
        const r = rows[0];
        return {
          calls24h: Number(r?.calls ?? 0),
          costCents7d: Number(r?.cost_cents ?? 0),
        };
      },
      { calls24h: 0, costCents7d: 0 },
      { label: "hub.ai" },
    ),

    getPowerSettings().catch(() => null),

    safeQuery(
      async () => {
        const rows = await prisma.$queryRaw<Array<{ c: bigint }>>`
          SELECT COUNT(*)::bigint AS c
          FROM drift_alerts
          WHERE resolved = false
        `;
        return Number(rows[0]?.c ?? 0);
      },
      0,
      { label: "hub.pulse" },
    ),

    safeQuery(
      async () => {
        const count = await prisma.autonomousAction.count({
          where: { approval: "pending" },
        });
        return count;
      },
      0,
      { label: "hub.governance" }
    ),
  ]);

  return {
    crons: {
      declared: cronReport?.summary.declaredActiveCrons ?? 0,
      silent: cronReport?.summary.silentDeclaredCrons ?? 0,
      logRows48h: cronReport?.summary.totalLogRowsLast48h ?? 0,
      killed: cronReport?.summary.killedIndividually ?? 0,
    },
    errors: errorStats,
    stale: {
      totalRows: staleReport?.totalStaleRows ?? 0,
      categories:
        staleReport?.categories.filter((c) => c.count > 0).length ?? 0,
    },
    brain: brainStats,
    devices: deviceStats,
    pulse: { priorityCount: pulsePriority },
    ai: aiStats,
    power: {
      paused: powerSettings?.pauseAllCrons ?? false,
    },
    governance: {
      pendingCount: governanceCount,
    },
    generatedAt: new Date().toISOString(),
  };
}
