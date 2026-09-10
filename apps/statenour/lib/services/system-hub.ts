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
        // `fatal24h` counts level='error' — the FIELD NAME is kept for the
        // consumers (same precedent as system-pulse.ts:130) but no writer has
        // ever emitted level='fatal' (re-verified live 2026-08-04: fatal=0
        // rows ever), so the old FILTER was a dead discriminator and the
        // critical branches keyed on it could structurally never fire.
        // Operator-approved repoint 2026-08-04, thresholds calibrated from
        // the live baseline (9/24h · 88/7d ≈ 12.6 errors/day): consumers
        // treat >20/24h as warning-worthy and >=40/24h (~3x mean) as
        // critical — never bare >0, which would flag most ordinary days.
        const rows = await prisma.$queryRaw<
          Array<{ errors: bigint; fatal: bigint }>
        >`
          SELECT
            COUNT(*)::bigint AS errors,
            COUNT(*) FILTER (WHERE level = 'error')::bigint AS fatal
          FROM error_logs
          WHERE created_at >= ${since24h}
        `;
        const r = rows[0];
        return {
          count24h: Number(r?.errors ?? 0),
          fatal24h: Number(r?.fatal ?? 0),
        };
      },
      null,
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
      null,
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
      null,
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
      null,
      { label: "hub.ai" },
    ),

    getPowerSettings().catch(() => null),

    // 2026-08-23 · THE TABLE IS GONE. `model DriftAlert` was removed from
    // schema.prisma, `prisma.driftAlert` has zero callers, and nothing writes
    // drift_alerts any more. The raw query here outlived the model because raw
    // SQL is not typechecked — the "a DROP must prune every re-apply path"
    // failure the statenour-migration skill documents.
    //
    // It threw `42P01 relation "drift_alerts" does not exist` 814 times over a
    // month. safeQuery swallows ONLY quota errors and rethrows everything else,
    // so this did not degrade the pulse sub-rollup — it failed the ENTIRE
    // system.hub payload, every time, and surfaced as "Database hiccup".
    //
    // No query and NO GUARD: a guarded call to a table that will never exist is
    // dead code with a pulse. The slot stays only to hold the array position the
    // destructure depends on. null means UNMEASURED, which is not the same claim
    // as 0 — the feature moved to BrainMemory-backed storage (getUnresolvedAlerts
    // reads prisma.brainMemory); re-point this at that if the chip is ever wanted
    // back.
    Promise.resolve<number | null>(null),

    safeQuery(
      async () => {
        const count = await prisma.autonomousAction.count({
          where: { approval: "pending" },
        });
        return count;
      },
      null,
      { label: "hub.governance" }
    ),
  ]);

  // Every section carries `measured`. A sub-rollup that crashed or was
  // swallowed by the quota circuit resolves to null above, and its zeros
  // below are FILLER for shape stability — a chip that renders "healthy"
  // (or "no devices", or "$0.00") off filler is fabricating an all-clear,
  // which is exactly what the 2026-08-04 false-green sweep registered
  // against this payload. Consumers must branch on `measured === false`.
  return {
    crons: {
      declared: cronReport?.summary.declaredActiveCrons ?? 0,
      silent: cronReport?.summary.silentDeclaredCrons ?? 0,
      logRows48h: cronReport?.summary.totalLogRowsLast48h ?? 0,
      killed: cronReport?.summary.killedIndividually ?? 0,
      measured: cronReport !== null,
    },
    errors: {
      count24h: errorStats?.count24h ?? 0,
      fatal24h: errorStats?.fatal24h ?? 0,
      measured: errorStats !== null,
    },
    stale: {
      totalRows: staleReport?.totalStaleRows ?? 0,
      categories:
        staleReport?.categories.filter((c) => c.count > 0).length ?? 0,
      /**
       * 2026-09-10 · `measured` was already the right idea and already
       * paired with the `?? 0` above -- it just only knew about TOTAL
       * failure (`staleReport === null`). The scanner runs eight
       * independent reads, any of which could return a fabricated empty
       * on its own, and a partial outage still produced a confident
       * `measured: true` beside a total that was really only a floor.
       *
       * So: measured means every scan actually ran.
       */
      measured: staleReport !== null && staleReport.degradedReads.length === 0,
      /** Which scans were not measured. Empty on a healthy scan. */
      unmeasuredScans: staleReport?.degradedReads ?? [],
    },
    brain: {
      totalMemories: brainStats?.totalMemories ?? 0,
      permanent: brainStats?.permanent ?? 0,
      avgConfidence: brainStats?.avgConfidence ?? 0,
      measured: brainStats !== null,
    },
    devices: {
      online: deviceStats?.online ?? 0,
      offline: deviceStats?.offline ?? 0,
      total: deviceStats?.total ?? 0,
      measured: deviceStats !== null,
    },
    pulse: {
      priorityCount: pulsePriority ?? 0,
      measured: pulsePriority !== null,
    },
    ai: {
      calls24h: aiStats?.calls24h ?? 0,
      costCents7d: aiStats?.costCents7d ?? 0,
      measured: aiStats !== null,
    },
    power: {
      paused: powerSettings?.pauseAllCrons ?? false,
      measured: powerSettings !== null,
    },
    governance: {
      pendingCount: governanceCount ?? 0,
      measured: governanceCount !== null,
    },
    generatedAt: new Date().toISOString(),
  };
}
