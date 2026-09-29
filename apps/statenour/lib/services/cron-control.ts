/**
 * Cron Control — kill switches + manual triggers for every scheduled
 * cron in vercel.json. Apr 18.
 *
 * Storage: BrainMemory rows with category="cron_control", key=<jobName>.
 * Content = JSON { enabled: boolean, updatedAt: ISO string, note?: string }.
 * Using BrainMemory avoids a dedicated settings table — the same retention
 * + backup story already applies, and the row shape is tiny.
 *
 * Runtime check: `isCronEnabled(jobName)` — used by cron routes to bail out
 * gracefully when killed. Default is ENABLED (absence = enabled). This means
 * a fresh install runs every cron automatically; the kill switch is an
 * opt-in disable.
 *
 * Manual trigger: `triggerCronByName(jobName)` fires the route via fetch.
 * Returns {ok, status, durationMs}. Uses CRON_SECRET so the target route
 * accepts it as a legitimate cron call.
 */

import { prisma } from "@/lib/prisma";
import { CRONS } from "@/config/crons";
import {
  HARD_FAILURE_STATUSES,
  isHardFailure,
} from "@/lib/services/cron-status";
export {
  HARD_FAILURE_STATUSES,
  isHardFailure,
} from "@/lib/services/cron-status";
import { ServiceError } from "@/lib/utils/service-error";

const CATEGORY = "cron_control";

// ── kill switch ─────────────────────────────────────────────────────────

/** Read enabled/disabled state for a named cron. Default: enabled. */
export async function isCronEnabled(jobName: string): Promise<boolean> {
  try {
    const row = await prisma.brainMemory.findUnique({
      where: { category_key: { category: CATEGORY, key: jobName } },
      select: { content: true },
    });
    if (!row) return true;
    const parsed = JSON.parse(row.content) as { enabled?: boolean };
    return parsed.enabled !== false;
  } catch {
    return true;
  }
}

/** Flip a cron's enabled flag. Returns the new state. */
export async function setCronEnabled(
  jobName: string,
  enabled: boolean,
  note?: string,
): Promise<boolean> {
  const content = JSON.stringify({
    enabled,
    updatedAt: new Date().toISOString(),
    note: note ?? null,
  });
  await prisma.brainMemory.upsert({
    where: { category_key: { category: CATEGORY, key: jobName } },
    create: {
      category: CATEGORY,
      key: jobName,
      content,
      confidence: 1,
      source: "settings_ui",
    },
    update: { content, lastSeen: new Date(), seenCount: { increment: 1 } },
  });
  return enabled;
}

/** Bulk fetch all cron control states for the Settings UI. */
export async function listCronControls(): Promise<
  Array<{ jobName: string; enabled: boolean; updatedAt: string | null; note: string | null }>
> {
  const rows = await prisma.brainMemory.findMany({
    where: { category: CATEGORY },
    select: { key: true, content: true },
  });
  return rows.map((r) => {
    try {
      const p = JSON.parse(r.content) as { enabled?: boolean; updatedAt?: string; note?: string };
      return {
        jobName: r.key,
        enabled: p.enabled !== false,
        updatedAt: p.updatedAt ?? null,
        note: p.note ?? null,
      };
    } catch {
      return { jobName: r.key, enabled: true, updatedAt: null, note: null };
    }
  });
}

// ── manual trigger ──────────────────────────────────────────────────────

export interface CronTriggerResult {
  ok: boolean;
  status: number;
  durationMs: number;
  body?: string;
  error?: string;
}

/** Build the base URL for self-fetch — Railway (APP_BASE_URL) takes
 *  priority post-CP5 · Vercel env stays as fallback for dual-write
 *  window · NEXT_PUBLIC_APP_URL still works in dev · localhost final. */
function baseUrl(): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  return "http://localhost:3001";
}

/**
 * Phase NN (2026-05-19 AM) · derive path from jobName and trigger.
 *
 * The legacy `/api/settings/crons/trigger` REST endpoint takes `{path}`
 * which was an operator-hostile shape — the UI knows `jobName`, not
 * the path-with-query-string. The cron-diagnostics page was actually
 * shipping the wrong body shape (sending `{jobName}` to a `{path}`-
 * expecting handler) so the "run now" button was broken in prod
 * since at least wave-181.4.
 *
 * The new tRPC mutation `system.runCron({jobName})` calls this
 * helper · derives path from the scheduled-cron catalog · falls back
 * to `/api/cron/${jobName}` for mega-fanout virtual crons (which
 * don't have catalog rows). Drift-proof against the catalog logic
 * already in `app/api/settings/crons/route.ts`.
 */
const MEGA_FANOUT_JOBS = new Set([
  "device-sync", "learn", "stale-tasks", "device-health", "brain-cycle",
  "notification-sender", "journal-checkin", "embed-backfill",
  "reflect", "predict", "think", "consolidate", "drift-check",
  "data-cleanup", "intelligence",
]);

export async function triggerCronByName(
  jobName: string,
): Promise<CronTriggerResult> {
  const scheduled = await listScheduledCrons();
  const found = scheduled.find((c) => c.jobName === jobName);
  if (found) {
    return triggerCronByPath(found.path);
  }
  if (MEGA_FANOUT_JOBS.has(jobName)) {
    return triggerCronByPath(`/api/cron/${jobName}`);
  }
  return {
    ok: false,
    status: 0,
    durationMs: 0,
    body: `unknown jobName: ${jobName}`,
  };
}

/**
 * Manually fire a cron by its path (e.g. "/api/cron/drift-check" or
 * "/api/cron/mega?slot=morning"). Passes CRON_SECRET so the target
 * route authorizes the call. Returns timing + status for UI feedback.
 */
export async function triggerCronByPath(path: string): Promise<CronTriggerResult> {
  const start = Date.now();
  // v8.21 · explicit env-missing handling. Sending Bearer "" would
  // 401 every target route; surface the misconfig clearly instead.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - start,
      body: "CRON_SECRET not configured",
    };
  }
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        // v10.0.115 · removed dead x-vercel-cron: '1' header. The
        // bypass it triggered on receivers was a CRITICAL spoofable
        // hole closed in v10.0.114; this header now does nothing.
      },
      signal: AbortSignal.timeout(55000),
    });
    const body = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      durationMs: Date.now() - start,
      body: body.slice(0, 2000),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── vercel.json catalog ─────────────────────────────────────────────────

export interface ScheduledCron {
  jobName: string;
  path: string;
  schedule: string;
}

/**
 * Parse vercel.json crons into a stable catalog. Uses fs — only works
 * on the server. The file ships with the deployment so this is safe in
 * a Vercel lambda and in local dev.
 */
export async function listScheduledCrons(): Promise<ScheduledCron[]> {
  const fs = await import("fs");
  const path = await import("path");
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), "vercel.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      crons?: Array<{ path: string; schedule: string }>;
    };
    return (parsed.crons ?? []).map((c) => {
      const match = c.path.match(/\/api\/cron\/([^/?]+)/);
      const baseName = match ? match[1] : c.path;
      // v11 fix · jobs like mega?slot=morning + mega?slot=evening share
      // the same base name but represent different scheduled runs. Keep
      // them distinct by suffixing the query slot so React keys stay
      // unique and stats maps don't collide.
      const slotMatch = c.path.match(/[?&]slot=([^&]+)/);
      const jobName = slotMatch ? `${baseName}-${slotMatch[1]}` : baseName;
      return { jobName, path: c.path, schedule: c.schedule };
    });
  } catch {
    return [];
  }
}

// ── recent-run stats for UI ─────────────────────────────────────────────

/** Last success + failure count (14d window) per job. For Settings UI. */
export async function getCronStats(): Promise<
  Record<string, CronJobStats>
> {
  const since = new Date(Date.now() - 14 * 86400_000);
  const rows = await prisma.cronJobLog.groupBy({
    by: ["jobName", "status"],
    where: { createdAt: { gte: since } },
    _count: { id: true },
  });
  const stats: Record<string, CronJobStats> = {};
  for (const r of rows) {
    if (!stats[r.jobName]) {
      stats[r.jobName] = { lastSuccessAt: null, lastFailAt: null, success14d: 0, partial14d: 0, fail14d: 0 };
    }
    if (r.status === "success") stats[r.jobName].success14d = r._count.id;
    // `partial` is its own bucket. Folding it into either neighbour is the
    // 2026-08-20 defect: dropped from BOTH counters, mega-evening looked
    // like it had never run at all, and its success rate read 100%.
    if (r.status === "partial") stats[r.jobName].partial14d = r._count.id;
    // 2026-09-22 · every hard-failure status is its own groupBy row, so SUM them.
    // A literal "failed" here left `interrupted` (an age-settled dead run, defined
    // as terminal and NOT ok) out of the tally and the displayed rate at 100%.
    if (isHardFailure(r.status)) stats[r.jobName].fail14d += r._count.id;
  }

  // Pull lastSuccessAt / lastFailAt per job in a second cheap query
  const jobNames = Object.keys(stats);
  if (jobNames.length > 0) {
    const latest = await prisma.cronJobLog.findMany({
      where: { jobName: { in: jobNames } },
      orderBy: { createdAt: "desc" },
      take: jobNames.length * 4,
      select: { jobName: true, status: true, createdAt: true },
    });
    for (const r of latest) {
      const s = stats[r.jobName];
      if (r.status === "success" && !s.lastSuccessAt) s.lastSuccessAt = r.createdAt.toISOString();
      if (isHardFailure(r.status) && !s.lastFailAt) s.lastFailAt = r.createdAt.toISOString();
    }
  }

  return stats;
}

// ── manifest-validated manual trigger ──────────────────────────────────

/**
 * Phase B.7a (2026-05-22) · validate a jobName against the
 * `config/crons.ts` manifest, then fire it. Lifted verbatim from
 * `app/api/system/crons/run/route.ts` so the legacy REST endpoint AND
 * the new `system.runManifestCron` tRPC procedure call the SAME
 * function · drift between consumers structurally impossible.
 *
 * Distinct from `triggerCronByName` (NN · vercel.json catalog) — this
 * is the `/system/crons` + `/system/cron-runs` deck path which checks
 * the typed CronDef manifest and rejects retired jobs.
 *
 * Throws ServiceError(404) for an unknown job, ServiceError(410) for a
 * retired one — both transports reject identically.
 */
/**
 * The tri-state a finished cron run can be in.
 *
 * 2026-08-20 · `partial` used to be invisible here: both cron-tree and
 * system-pages collapsed every non-"success" row into "failed". That lie
 * cost a night. `mega-evening` only ever writes `partial` (a fan-out where
 * SOME children failed), so it read as a hard failure in the UI *and* the
 * autonomic healer treated it as broken and re-ran it — while the
 * success/fail counters, which count neither, simultaneously reported it
 * had "never run". A partial run is degraded, not dead, and not absent.
 */
export type CronLastStatus = "success" | "partial" | "failed";

/** 14-day per-job tallies. `partial` is tracked separately, never folded. */
export type CronJobStats = {
  lastSuccessAt: string | null;
  lastFailAt: string | null;
  success14d: number;
  partial14d: number;
  fail14d: number;
};

/**
 * A HARD failure — the run threw or the route died. A `partial` fan-out is
 * degraded, not dead, so it is deliberately excluded.
 *
 * Single source of truth: system-health.ts already carried a private copy of
 * this rule, and the copies drifted — the healer and the health page could
 * disagree about whether the same run had failed.
 */
/**
 * 2026-09-22 · POSITIVE LIST. The negative form (`!== success && !== partial`)
 * admitted every status invented after it was written: from 2026-09-17 the
 * lifecycle's `started` ("invoked, outcome unknown") counted as a hard failure
 * in system-health, system-pages and the brain-insights trend - an in-flight
 * run reported as a dead one, and 49 duplicate `started` rows of runs that
 * SUCCEEDED (mega-fanout's parallel steps each fire onRunStart) read as 49
 * failures. Prod census the same day, all time: success 10,522 · started 49 ·
 * partial 15 · failed 8 - nothing else exists, so naming the failures misses
 * no real one. Mirror image of TERMINAL_OK_STATUSES in
 * lib/inngest/cron-lifecycle.ts: a new token is neither ok nor failed until a
 * human says which. `interrupted` (an age-settled dead run) IS a failure.
 */
export type CronWindowTally = { success: number; partial: number; failed: number; totalMs: number };

/**
 * Per-job tallies over a window of cron rows - the one place that decides which
 * bucket a status lands in, for every health surface that shows a window.
 *
 * 2026-09-22 · system-health's own loop was `if success / else if partial / else
 * failed`, so an in-flight `started` row (and a `duplicate`) counted as a CURRENT
 * failure while the prior window already used isHardFailure() - the two windows
 * classified the same status differently and the trend compared them anyway.
 * Neither-ok-nor-failed rows count in NO bucket; their duration is null anyway.
 */
export function tallyCronWindow(
  logs: ReadonlyArray<{ jobName: string; status: string; duration: number | null }>,
): Map<string, CronWindowTally> {
  const byJob = new Map<string, CronWindowTally>();
  for (const l of logs) {
    const e = byJob.get(l.jobName) ?? { success: 0, partial: 0, failed: 0, totalMs: 0 };
    if (l.status === "success") e.success++;
    else if (l.status === "partial") e.partial++;
    else if (isHardFailure(l.status)) e.failed++;
    e.totalMs += l.duration ?? 0;
    byJob.set(l.jobName, e);
  }
  return byJob;
}

/** Map a raw CronJobLog.status onto that tri-state. Never collapse. */
export function normalizeCronStatus(status: string): CronLastStatus {
  if (status === "success") return "success";
  if (status === "partial") return "partial";
  return "failed";
}

export async function runManifestCron(
  jobName: string,
): Promise<CronTriggerResult & { jobName: string }> {
  const def = CRONS.find((c) => c.name === jobName);
  if (!def) {
    throw new ServiceError(`unknown cron: ${jobName}`, 404);
  }
  if (def.mode === "retired") {
    throw new ServiceError(`cron ${jobName} is retired`, 410);
  }
  const path = def.path ?? `/api/cron/${jobName}`;
  const result = await triggerCronByPath(path);
  return { jobName, ...result };
}
