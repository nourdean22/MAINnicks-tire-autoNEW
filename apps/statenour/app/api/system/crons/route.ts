import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { CRONS, type CronDef } from "@/config/crons";
import { listCronControls, getCronStats } from "@/lib/services/cron-control";

/**
 * GET /api/system/crons — the composite health feed for /system/crons.
 *
 * Returns manifest + live stats per cron, plus a top-strip summary
 * suitable for the page header. Auth: owner-only (matches the sibling
 * run + toggle sub-routes hardened in v10.0.120).
 *
 * Cache: response is tagged no-store upstream; the underlying
 * prisma queries are cheap enough (<100ms typical on a warm lambda)
 * that we can serve live data every 30s from the page.
 */

type CronRow = CronDef & {
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailAt: string | null;
  success14d: number;
  fail14d: number;
  successRate: number;          // 0-100; 100 when no runs
  recentDurations: number[];    // oldest → newest (for sparkline), last 20
  lastRunAt: string | null;
  lastRunMs: number | null;
  lastStatus: "success" | "failed" | null;
  nextRunAt: string | null;     // ISO — null for folded/retired
  drift: number | null;         // minutes elapsed since predicted next-run, negative = upcoming
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
    if (matches(candidate.getUTCMinutes(), min) &&
        matches(candidate.getUTCHours(), hr) &&
        matches(candidate.getUTCDate(), dom) &&
        matches(candidate.getUTCMonth() + 1, mon) &&
        matches(candidate.getUTCDay(), dow)) {
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

export const GET = apiHandler(async () => {
  const [controls, stats, recent] = await Promise.all([
    listCronControls(),
    getCronStats(),
    prisma.cronJobLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 800, // ~20 per cron × 31 active
      select: { jobName: true, status: true, duration: true, createdAt: true },
    }),
  ]);

  const controlByName = new Map(controls.map((c) => [c.jobName, c]));
  const logsByName = new Map<string, { status: string; duration: number | null; createdAt: Date }[]>();
  for (const r of recent) {
    if (!logsByName.has(r.jobName)) logsByName.set(r.jobName, []);
    logsByName.get(r.jobName)!.push(r);
  }

  const now = new Date();
  const rows: CronRow[] = CRONS.map((c): CronRow => {
    const ctl = controlByName.get(c.name);
    const st = stats[c.name] ?? { lastSuccessAt: null, lastFailAt: null, success14d: 0, fail14d: 0 };
    const logs = (logsByName.get(c.name) ?? []).slice(0, 20).reverse(); // oldest → newest
    const total = st.success14d + st.fail14d;
    const successRate = total > 0 ? Math.round((st.success14d / total) * 100) : 100;

    let lastRunAt: string | null = null;
    let lastRunMs: number | null = null;
    let lastStatus: "success" | "failed" | null = null;
    const newest = logs[logs.length - 1];
    if (newest) {
      lastRunAt = newest.createdAt.toISOString();
      lastRunMs = newest.duration;
      lastStatus = newest.status === "success" ? "success" : "failed";
    }

    let nextRunAt: string | null = null;
    let drift: number | null = null;
    if (c.mode === "active" && c.schedule) {
      const next = nextRunFromCron(c.schedule, now);
      if (next) {
        nextRunAt = next.toISOString();
        // If a run is more than 2× the expected interval overdue → drift.
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
    runs24h: recent.filter((r) => r.createdAt.getTime() > now.getTime() - 24 * 3600_000).length,
    failures24h: recent.filter(
      (r) => r.status === "failed" && r.createdAt.getTime() > now.getTime() - 24 * 3600_000,
    ).length,
    drifted: rows.filter((r) => r.drift !== null && r.drift > 0).length,
  };

  return { rows, summary, generatedAt: now.toISOString() };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts