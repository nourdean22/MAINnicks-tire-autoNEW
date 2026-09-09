/**
 * ONE READ THAT ANSWERS "IS THE REEL MACHINE OK?".
 *
 * Every number here was reachable before, and none of it was on a screen. The
 * questions that actually decide whether this account posts got answered today
 * by running ad-hoc SQL against production, one probe at a time:
 *
 *   - Is anything scheduled for tomorrow, and for the day after?
 *   - How many finished reels are waiting, and are any of them stuck?
 *   - Of the reels that DID publish, which openings held viewers?
 *   - What does a published reel actually cost?
 *   - Are the lanes that do this work still running?
 *
 * An operator should not need a database client to ask those. This assembles
 * them into one payload for the admin.
 *
 * COLUMN NAMING IS A REAL HAZARD HERE and the queries below are written the
 * hard way on purpose. This schema mixes conventions - `reel_jobs.createdAt` and
 * `ig_metric_snapshots.postId` are camelCase while `skip_rate`,
 * `avg_watch_time_ms` and `publication_intended_at` are snake_case, sometimes in
 * the same row. A wrong guess does not fail loudly at build time; it throws at
 * runtime, which is exactly how kpi-snapshot ran 5 times and succeeded 0 times.
 * Every identifier below was executed against production before being written
 * here.
 *
 * READ-ONLY. Nothing in this module writes.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("services:reel-pipeline-health");

export interface ScheduleDay {
  /** YYYY-MM-DD, local shop calendar. */
  date: string;
  jobId: number | null;
  status: string | null;
  /** True when no job exists for this day at all - the account goes quiet. */
  gap: boolean;
}

export interface PublishedReel {
  jobId: number | null;
  postId: string;
  /** Percentage of viewers who left inside three seconds. Lower is better. */
  skipPct: number | null;
  watchMs: number | null;
  reach: number | null;
  shares: number | null;
  /** Beat 1's on-screen text: the words a scrolling viewer actually saw. */
  hook: string | null;
}

export interface ReelPipelineHealth {
  available: boolean;
  reason?: string;
  generatedAt: string;
  /** Forward schedule. `gap: true` days are days with nothing to post. */
  schedule: ScheduleDay[];
  /** First day with no job at all, or null when the window is fully covered. */
  firstGap: string | null;
  daysCovered: number;
  queue: Array<{ status: string; count: number }>;
  published: PublishedReel[];
  hooks: { sampleSize: number; meanSkipPct: number | null; best: PublishedReel[]; worst: PublishedReel[] };
  economics: {
    windowDays: number;
    estimatedSpendUsd: number;
    posted: number;
    costPerPublishedUsd: number | null;
  };
  lanes: Array<{ name: string; runs: number; failed: number; lastRun: string | null; lastDetail: string | null }>;
}

const LANES = ["reel-pipeline", "daily-reel-post", "ig-autopost"];
const SCHEDULE_DAYS = 30;

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Beat 1's on-screen text from a persisted brief, or null when unreadable. */
function hookFromPayload(payload: unknown): string | null {
  if (typeof payload !== "string") return null;
  try {
    const brief = JSON.parse(payload) as { storyboardBeats?: Array<{ onScreenText?: string; visual?: string }> };
    const first = brief.storyboardBeats?.[0];
    const text = String(first?.onScreenText || first?.visual || "").replace(/\s+/g, " ").trim();
    return text ? text.slice(0, 140) : null;
  } catch {
    // One unreadable payload must not blank the whole board.
    return null;
  }
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) {
    const first = (result as unknown[])[0];
    if (Array.isArray(first)) return first as Array<Record<string, unknown>>;
    return result as Array<Record<string, unknown>>;
  }
  return [];
}

export async function buildReelPipelineHealth(windowDays = 30): Promise<ReelPipelineHealth> {
  const empty: ReelPipelineHealth = {
    available: false,
    generatedAt: new Date().toISOString(),
    schedule: [],
    firstGap: null,
    daysCovered: 0,
    queue: [],
    published: [],
    hooks: { sampleSize: 0, meanSkipPct: null, best: [], worst: [] },
    economics: { windowDays, estimatedSpendUsd: 0, posted: 0, costPerPublishedUsd: null },
    lanes: [],
  };

  try {
    const { getDb } = await import("../db");
    const d = await getDb();
    if (!d) return { ...empty, reason: "Database not available" };
    const { sql } = await import("drizzle-orm");

    // ── 1. Forward schedule. briefId carries the intended date for the
    //       autopost lane; publication_intended_at is the column the enqueue
    //       writes. Both are read, because a job can carry one without the other.
    const scheduleRows = rowsOf(
      await d.execute(sql`
        SELECT id, briefId, status, publication_intended_at AS intended
          FROM reel_jobs
         WHERE briefId LIKE 'autopost-%'
           AND status IN ('assembled', 'posted', 'published', 'publishing')
         ORDER BY briefId ASC
      `),
    );
    const byDate = new Map<string, { jobId: number; status: string }>();
    for (const r of scheduleRows) {
      const m = /autopost-(\d{4}-\d{2}-\d{2})/.exec(String(r.briefId ?? ""));
      if (!m) continue;
      byDate.set(m[1], { jobId: Number(r.id), status: String(r.status) });
    }

    const today = new Date();
    const cursor = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));
    const schedule: ScheduleDay[] = [];
    let firstGap: string | null = null;
    let daysCovered = 0;
    for (let i = 0; i < SCHEDULE_DAYS; i++) {
      const key = iso(new Date(cursor.getTime() + i * 86400000));
      const hit = byDate.get(key);
      const gap = !hit;
      if (gap && firstGap === null) firstGap = key;
      if (hit && hit.status === "assembled") daysCovered++;
      schedule.push({ date: key, jobId: hit?.jobId ?? null, status: hit?.status ?? null, gap });
    }

    // ── 2. Queue by status.
    const queue = rowsOf(
      await d.execute(sql`SELECT status, COUNT(*) AS n FROM reel_jobs GROUP BY status ORDER BY n DESC`),
    ).map((r) => ({ status: String(r.status), count: Number(r.n) }));

    // ── 3. Published reels with their MEASURED hook performance.
    //       One row per post (latest snapshot), reach > 0 so an unviewed post
    //       cannot masquerade as a perfect 0.00 skip rate - that row exists.
    const publishedRows = rowsOf(
      await d.execute(sql`
        SELECT j.id AS jobId, s.postId AS postId, s.skip_rate AS skipRate,
               s.avg_watch_time_ms AS watchMs, s.reach AS reach, s.shares AS shares,
               j.payload AS payload
          FROM reel_jobs j
          JOIN ig_metric_snapshots s ON s.postId = j.igPostId
          JOIN (SELECT postId, MAX(capturedAt) AS mx
                  FROM ig_metric_snapshots WHERE skip_rate IS NOT NULL
                 GROUP BY postId) l
            ON l.postId = s.postId AND l.mx = s.capturedAt
         WHERE j.igPostId IS NOT NULL AND s.skip_rate IS NOT NULL AND s.reach > 0
         ORDER BY s.skip_rate ASC
      `),
    );
    const published: PublishedReel[] = publishedRows.map((r) => ({
      jobId: r.jobId == null ? null : Number(r.jobId),
      postId: String(r.postId ?? ""),
      skipPct: r.skipRate == null ? null : Number(r.skipRate),
      watchMs: r.watchMs == null ? null : Number(r.watchMs),
      reach: r.reach == null ? null : Number(r.reach),
      shares: r.shares == null ? null : Number(r.shares),
      hook: hookFromPayload(r.payload),
    }));
    const skips = published.map((p) => p.skipPct).filter((n): n is number => typeof n === "number");
    const meanSkipPct = skips.length
      ? Math.round((skips.reduce((a, b) => a + b, 0) / skips.length) * 10) / 10
      : null;

    // ── 4. Economics. The honest denominator is reels that actually PUBLISHED,
    //       over ALL spend in the window including the ones that never shipped.
    const spendRow = rowsOf(
      await d.execute(sql`
        SELECT COALESCE(SUM(estimated_cost_usd), 0) AS est
          FROM generation_reservations
         WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${windowDays} DAY)
      `),
    )[0];
    const postedRow = rowsOf(
      await d.execute(sql`
        SELECT COUNT(*) AS n FROM reel_jobs
         WHERE status IN ('posted', 'published')
           AND updatedAt >= DATE_SUB(NOW(), INTERVAL ${windowDays} DAY)
      `),
    )[0];
    const estimatedSpendUsd = Math.round(Number(spendRow?.est ?? 0) * 100) / 100;
    const posted = Number(postedRow?.n ?? 0);

    // ── 5. Are the lanes that do this work still running?
    const laneRows = rowsOf(
      await d.execute(sql`
        SELECT job_name, COUNT(*) AS runs, SUM(status = 'failed') AS failed,
               MAX(started_at) AS last_run
          FROM cron_log
         WHERE started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
         GROUP BY job_name
      `),
    );
    const lastDetails = rowsOf(
      await d.execute(sql`
        SELECT job_name, details FROM cron_log
         WHERE started_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
         ORDER BY started_at DESC LIMIT 200
      `),
    );
    const detailByLane = new Map<string, string>();
    for (const r of lastDetails) {
      const name = String(r.job_name);
      if (!detailByLane.has(name)) detailByLane.set(name, String(r.details ?? ""));
    }
    const lanes = LANES.map((name) => {
      const row = laneRows.find((r) => String(r.job_name) === name);
      return {
        name,
        runs: Number(row?.runs ?? 0),
        failed: Number(row?.failed ?? 0),
        lastRun: row?.last_run ? new Date(String(row.last_run)).toISOString() : null,
        lastDetail: detailByLane.get(name) ?? null,
      };
    });

    return {
      available: true,
      generatedAt: new Date().toISOString(),
      schedule,
      firstGap,
      daysCovered,
      queue,
      published,
      hooks: {
        sampleSize: skips.length,
        meanSkipPct,
        best: published.slice(0, 5),
        worst: published.slice(-5).reverse(),
      },
      economics: {
        windowDays,
        estimatedSpendUsd,
        posted,
        costPerPublishedUsd: posted > 0 ? Math.round((estimatedSpendUsd / posted) * 100) / 100 : null,
      },
      lanes,
    };
  } catch (e) {
    // A dashboard that cannot read must say so, not render zeros. An empty
    // schedule and a broken query look identical once they reach a chart.
    log.warn("reel pipeline health unavailable", { e: e instanceof Error ? e.message : String(e) });
    return { ...empty, reason: e instanceof Error ? e.message.slice(0, 200) : "unknown error" };
  }
}
