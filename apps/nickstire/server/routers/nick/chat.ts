/**
 * Nick AI Agent — Chat/communication handlers: social, media, reviews, memory.
 * Handles: socialPost, socialStatus, reviewContent, sendMedia, remember, memories,
 *          cameraFeed, cameras, setCamera, shopPulse, shopDriverStatus,
 *          schedulerStatus, triggerPrerender, syncShopDriver, customerIntelligence
 */

// ─── Shop Pulse ───────────────────────────────────────

export async function handleShopPulse() {
  // 2026-05-05 — when Nick chat asks for the shop pulse (revenue today,
  // jobs closed, walk rate), fire a demand-driven ALG probe so Nick
  // answers with FRESH data, not cached. Probe budget dedups across
  // multiple chat queries within 30s.
  // Fire-and-forget — don't block the response on it. If probe takes
  // 8s and chat is impatient, the next query gets the fresh numbers.
  import("../../services/algProbeBudget").then(({ requestAlgProbe }) =>
    requestAlgProbe("chat_query", { detail: "shop_pulse" }),
  ).catch(() => { /* probe is fire-and-forget */ });

  const { getShopPulse } = await import("../../services/nickIntelligence");
  return getShopPulse();
}

const OBSERVER_JOB = "cron-failure-observer";

// A TIMESTAMP comes back as "YYYY-MM-DD HH:mm:ss" (UTC digits) through the house driver config, or as a Date.
function toIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(`${String(value).replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// ─── Cron Health Summary (one row per job · last 24h of cron_log) ───
// 2026-10-25 · cronHealth above returns the newest 500 runs flat; with ~116 jobs the tab showed 80 "completed"
// rows and buried the failures and the observer's stuck queues. Two grouped reads, no row cap:
//   (a) per job: runs, failed, skipped, last start, last success (GROUP BY job_name);
//   (b) the latest row per job, via a join on MAX(started_at) per job (a correlated subquery would run once per
//       row; one ordered fetch of the window would drag every run's details text over the wire for a latest-only read).
// A failed read throws; it is never an empty summary. Counts are plain SQL aggregates, the job name is written the
// same way in SELECT and GROUP BY (TiDB only_full_group_by).
export async function handleCronHealthSummary() {
  const { getDbTyped } = await import("../../db");
  const { sql } = await import("drizzle-orm");
  const { parseObserverDetails } = await import("../../cron/observerSummary");
  const db = await getDbTyped();
  if (!db) throw new Error("Database not available: cron health summary cannot be read");
  const to = new Date();
  const since = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  const sinceParam = since.toISOString().slice(0, 19).replace("T", " ");

  const [grouped] = await db.execute(sql`
    SELECT job_name AS jobName, COUNT(*) AS runs,
      SUM(status = 'failed') AS failed, SUM(status = 'skipped') AS skipped,
      MAX(started_at) AS lastStartedAt,
      MAX(CASE WHEN status = 'completed' THEN started_at END) AS lastSuccessAt
    FROM cron_log
    WHERE started_at >= ${sinceParam}
    GROUP BY job_name
  `);
  const [latestRows] = await db.execute(sql`
    SELECT c.job_name AS jobName, c.status AS status, c.duration_ms AS durationMs, c.details AS details,
      c.error_message AS errorMessage, c.started_at AS startedAt
    FROM cron_log c
    INNER JOIN (
      SELECT job_name, MAX(started_at) AS lastAt
      FROM cron_log
      WHERE started_at >= ${sinceParam}
      GROUP BY job_name
    ) l ON c.job_name = l.job_name AND c.started_at = l.lastAt
  `);

  type Latest = { jobName: string; status: string; durationMs: number | null; details: string | null; errorMessage: string | null; startedAt: unknown };
  const latest = new Map<string, Latest>();
  for (const r of latestRows as unknown as Latest[]) if (!latest.has(r.jobName)) latest.set(r.jobName, r);

  const jobs = (grouped as unknown as Array<Record<string, unknown>>).map((g) => {
    const jobName = String(g.jobName);
    const l = latest.get(jobName);
    return {
      jobName,
      lastStatus: l?.status ?? "unknown",
      lastStartedAt: toIso(g.lastStartedAt) ?? to.toISOString(),
      lastDurationMs: l?.durationMs ?? null,
      lastDetails: l?.details ?? null,
      lastErrorMessage: l?.errorMessage ?? null,
      lastSuccessAt: toIso(g.lastSuccessAt),
      runs: Number(g.runs),
      failed: Number(g.failed),
      skipped: Number(g.skipped),
    };
  });
  const rank = (status: string) => (status === "failed" ? 0 : status === "skipped" ? 1 : 2);
  jobs.sort((a, b) => rank(a.lastStatus) - rank(b.lastStatus) || b.lastStartedAt.localeCompare(a.lastStartedAt));

  const obs = latest.get(OBSERVER_JOB);
  const observer = obs?.details
    ? { at: toIso(obs.startedAt) ?? to.toISOString(), ...parseObserverDetails(obs.details) }
    : null;

  return { since: since.toISOString(), to: to.toISOString(), jobs, observer };
}

// ─── Cron Health (read-only · last 24h of cron_log) ───
// wave-149 · the operator had NO UI to see which of ~40 crons ran / failed /
// silently skipped — the exact blind spot that hid the never-scheduled
// follow-up-cadence cron this session. Reads the existing cron_log table
// (failed jobs put their error in `details`). No schema change.
export async function handleCronHealth() {
  const { getDb } = await import("../../db");
  const { cronLog } = await import("../../../drizzle/schema");
  const { desc, gte } = await import("drizzle-orm");
  const db = await getDb();
  if (!db) return [];
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return db.select({
    jobName: cronLog.jobName,
    status: cronLog.status,
    durationMs: cronLog.durationMs,
    recordsProcessed: cronLog.recordsProcessed,
    details: cronLog.details,
    startedAt: cronLog.startedAt,
    completedAt: cronLog.completedAt,
  }).from(cronLog).where(gte(cronLog.startedAt, since)).orderBy(desc(cronLog.startedAt)).limit(500);
}
