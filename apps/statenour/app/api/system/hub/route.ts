/**
 * GET /api/system/hub — rollup for the /system hub landing page.
 *
 * Returns ONE compact payload feeding every subsurface card's live
 * chip. Avoids N parallel fetches on a page that has 15+ links.
 *
 * Shape (all keys optional — downstream rollups are independent and
 * safeQuery'd so one broken one doesn't poison the rest):
 *   {
 *     crons: { declared, silent, logRows48h },
 *     errors: { count24h, fatal24h },
 *     stale: { totalRows },
 *     brain: { totalMemories, permanent, avgConfidence },
 *     devices: { online, offline, total },
 *     pulse: { priorityCount, measured },   // measured:false ⇒ priorityCount is filler, not a reading
 *     ai: { calls24h, costCents7d },
 *     power: { paused },
 *     generatedAt: ISO,
 *   }
 */

import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeQuery } from "@/lib/db/safe-prisma";
import { scanCronHealth } from "@/lib/system/cron-diagnostics";
import { scanStaleData } from "@/lib/system/stale-data-scanner";
import { getPowerSettings } from "@/lib/services/power-panel";
import { requireSession } from "@/lib/auth-guard";
import { sanitizeError } from "@/lib/utils/sanitize-error";

export async function GET(req: Request) {
  await requireSession(req);
  const since24h = new Date(Date.now() - 24 * 3600_000);
  const since7d = new Date(Date.now() - 7 * 86400_000);

  try {
    const [
      cronReport,
      staleReport,
      errorStats,
      brainStats,
      deviceStats,
      aiStats,
      powerSettings,
      pulsePriority,
    ] = await Promise.all([
      scanCronHealth().catch(() => null),
      scanStaleData().catch(() => null),

      safeQuery(
        async () => {
          // ErrorLog has `level` (error/warn/fatal), not `severity`.
          // Earlier draft of this query used `severity` and silently
          // returned zeros via safeQuery's fallback — no errors logged
          // because Prisma threw 42703 inside the wrapper.
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

      // Pulse-priority — counted in parallel with the rest. Was a
      // sequential await after the Promise.all, adding one round-trip
      // (~50ms) on every /system page load for no good reason.
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
    ]);

    return NextResponse.json({
      data: {
        crons: {
          declared: cronReport?.summary.declaredActiveCrons ?? 0,
          silent: cronReport?.summary.silentDeclaredCrons ?? 0,
          logRows48h: cronReport?.summary.totalLogRowsLast48h ?? 0,
          killed: cronReport?.summary.killedIndividually ?? 0,
        },
        errors: errorStats,
        stale: {
          totalRows: staleReport?.totalStaleRows ?? 0,
          categories: staleReport?.categories.filter((c) => c.count > 0).length ?? 0,
        },
        brain: brainStats,
        devices: deviceStats,
        // Mirrors buildSystemHub exactly (system-hub.ts:200-203). hub-grid.tsx:78
        // types priorityCount as a non-nullable number, so the null must be
        // absorbed here — and `measured` is what carries the difference between
        // "zero alerts" and "cannot know". Emitting the 0 without the flag is the
        // fabricated all-clear this whole change exists to remove.
        pulse: { priorityCount: pulsePriority ?? 0, measured: pulsePriority !== null },
        ai: aiStats,
        power: {
          paused: powerSettings?.pauseAllCrons ?? false,
        },
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        data: null,
        error: sanitizeError(err),
      },
      { status: 500 },
    );
  }
}
