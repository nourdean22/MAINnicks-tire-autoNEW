/**
 * lib/services/cron-tree.ts · Phase VV (2026-05-22 ·
 * legacy-modernizer REST→tRPC system slice).
 *
 * The composite cron health + lineage feed for /system/crons. Lifted
 * verbatim from app/api/system/crons/route.ts so the legacy REST
 * endpoint AND the new `system.cronTree` tRPC procedure call the same
 * function · drift between consumers structurally impossible.
 *
 * Returns the CRONS manifest joined to live stats per cron (kill-switch
 * state · 14d success/fail · recent durations · next-run + drift), plus
 * a top-strip summary.
 *
 * Note: this is deliberately distinct from `cron-control.ts`'s
 * `cronCatalog` (the /settings panel) — that one carries scheduled +
 * mega-fanout virtual crons; this one carries the FULL manifest with
 * mode/foldedInto so the /system/crons lineage tree can render folded
 * and retired crons.
 */

import { prisma } from "@/lib/prisma";
import { CRONS, type CronDef } from "@/config/crons";
import {
  listCronControls,
  getCronStats,
  isHardFailure,
  normalizeCronStatus,
  type CronLastStatus,
} from "@/lib/services/cron-control";

export type CronRow = CronDef & {
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailAt: string | null;
  success14d: number;
  partial14d: number;
  fail14d: number;
  successRate: number | null; // 0-100; null when no runs (no rate exists)
  recentDurations: number[]; // oldest → newest (for sparkline), last 20
  lastRunAt: string | null;
  lastRunMs: number | null;
  lastStatus: CronLastStatus | null;
  nextRunAt: string | null; // ISO — null for folded/retired
  drift: number | null; // minutes elapsed since predicted next-run
};

function nextRunFromCron(expr: string, now: Date): Date | null {
  // Simple cron evaluator — covers the subset the manifest uses
  // (minute, hour, day-of-month, month, day-of-week · * */N lists ,).
  // Not a full cron engine but complete enough for the 31 jobs we ship.
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, mon, dow] = parts;

  const candidate = new Date(now);
  candidate.setSeconds(0, 0);
  candidate.setMinutes(candidate.getMinutes() + 1);

  // Search up to 365 days ahead.
  for (let i = 0; i < 365 * 24 * 60; i++) {
    if (
      matches(candidate.getUTCMinutes(), min) &&
      matches(candidate.getUTCHours(), hr) &&
      matches(candidate.getUTCDate(), dom) &&
      matches(candidate.getUTCMonth() + 1, mon) &&
      matches(candidate.getUTCDay(), dow)
    ) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  return null;
}

function matches(val: number, expr: string): boolean {
  if (expr === "*") return true;
  // Step: */N
  if (expr.startsWith("*/")) {
    const step = parseInt(expr.slice(2), 10);
    return !Number.isNaN(step) && val % step === 0;
  }
  // List: A,B,C
  if (expr.includes(",")) {
    return expr.split(",").some((p) => matches(val, p));
  }
  // Range: A-B
  if (expr.includes("-")) {
    const [a, b] = expr.split("-").map((n) => parseInt(n, 10));
    return val >= a && val <= b;
  }
  // Literal
  return val === parseInt(expr, 10);
}

/** Manifest + live stats per cron + a top-strip summary. */
export async function buildCronTree() {
  const dayAgo = new Date(Date.now() - 24 * 3600_000);
  const [controls, stats, recent, latestStamps, statuses24h] = await Promise.all([
    listCronControls(),
    getCronStats(),
    // The sparkline only: a busy job fills this sample (08-F12), so nothing else reads it.
    prisma.cronJobLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 800, // ~20 per cron × 31 active
      select: {
        jobName: true,
        status: true,
        duration: true,
        createdAt: true,
      },
    }),
    // Newest row per manifest job over the whole table: a weekly job read "never ran" from the sample.
    prisma.cronJobLog.groupBy({
      by: ["jobName"],
      where: { jobName: { in: CRONS.map((c) => c.name) } },
      _max: { createdAt: true },
    }),
    prisma.cronJobLog.groupBy({
      by: ["status"],
      where: { createdAt: { gte: dayAgo } },
      _count: { _all: true },
    }),
  ]);
  const stamped = latestStamps.filter((g) => g._max.createdAt);
  const latestRows =
    stamped.length > 0
      ? await prisma.cronJobLog.findMany({
          where: { OR: stamped.map((g) => ({ jobName: g.jobName, createdAt: g._max.createdAt! })) },
          select: { jobName: true, status: true, duration: true, createdAt: true },
        })
      : [];
  const latestByName = new Map<string, (typeof latestRows)[number]>();
  for (const r of latestRows) if (!latestByName.has(r.jobName)) latestByName.set(r.jobName, r);

  const controlByName = new Map(controls.map((c) => [c.jobName, c]));
  const logsByName = new Map<
    string,
    { status: string; duration: number | null; createdAt: Date }[]
  >();
  for (const r of recent) {
    if (!logsByName.has(r.jobName)) logsByName.set(r.jobName, []);
    logsByName.get(r.jobName)!.push(r);
  }

  const now = new Date();
  const rows: CronRow[] = CRONS.map((c): CronRow => {
    const ctl = controlByName.get(c.name);
    const st = stats[c.name] ?? {
      lastSuccessAt: null,
      lastFailAt: null,
      success14d: 0,
      partial14d: 0,
      fail14d: 0,
    };
    const logs = (logsByName.get(c.name) ?? []).slice(0, 20).reverse(); // oldest → newest
    // Denominator must include `partial`, or a job whose every run is
    // partial divides by zero and reports a triumphant 100%. mega-evening
    // did exactly that for 1,248 consecutive runs.
    const total = st.success14d + st.partial14d + st.fail14d;
    // 2026-10-10 · an empty window has no rate; it read "100%" before.
    const successRate =
      total > 0 ? Math.round((st.success14d / total) * 100) : null;

    let lastRunAt: string | null = null;
    let lastRunMs: number | null = null;
    let lastStatus: CronLastStatus | null = null;
    const newest = latestByName.get(c.name);
    if (newest) {
      lastRunAt = newest.createdAt.toISOString();
      lastRunMs = newest.duration;
      lastStatus = normalizeCronStatus(newest.status);
    }

    let nextRunAt: string | null = null;
    let drift: number | null = null;
    if (c.mode === "active" && c.schedule) {
      const next = nextRunFromCron(c.schedule, now);
      if (next) {
        nextRunAt = next.toISOString();
        // If a run is more than 1.5× the expected interval overdue → drift.
        if (lastRunAt) {
          const lastMs = new Date(lastRunAt).getTime();
          const expectedGap = next.getTime() - lastMs;
          const actualGap = now.getTime() - lastMs;
          if (actualGap > expectedGap * 1.5) {
            drift = Math.round((actualGap - expectedGap) / 60000);
          }
        }
      }
    }

    return {
      ...c,
      enabled: ctl?.enabled !== false,
      lastSuccessAt: st.lastSuccessAt,
      lastFailAt: st.lastFailAt,
      success14d: st.success14d,
      partial14d: st.partial14d,
      fail14d: st.fail14d,
      successRate,
      recentDurations: logs.map((l) => l.duration ?? 0),
      lastRunAt,
      lastRunMs,
      lastStatus,
      nextRunAt,
      drift,
    };
  });

  const summary = {
    active: rows.filter((r) => r.mode === "active").length,
    disabled: rows.filter((r) => !r.enabled).length,
    folded: rows.filter((r) => r.mode === "folded").length,
    retired: rows.filter((r) => r.mode === "retired").length,
    runs24h: statuses24h.reduce((n, g) => n + g._count._all, 0),
    failures24h: statuses24h.reduce((n, g) => n + (isHardFailure(g.status) ? g._count._all : 0), 0),
    drifted: rows.filter((r) => r.drift !== null && r.drift > 0).length,
  };

  return { rows, summary, generatedAt: now.toISOString() };
}
