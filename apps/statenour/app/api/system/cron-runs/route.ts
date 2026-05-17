/**
 * GET /api/system/cron-runs · v8.18 · Apr 29.
 *
 * Multi-job rollup. Returns one row per distinct jobName seen in
 * cron_job_logs over the requested window with:
 *   · success / fail counts
 *   · success rate
 *   · last status
 *   · last run timestamp
 *   · median duration
 *
 * Drives /system/cron-runs index page — one screen, every job, sortable.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { CRONS } from "@/config/crons";

interface AggRow {
  jobName: string;
  total: bigint;
  success: bigint;
  fail: bigint;
  lastRunAt: Date;
  lastStatus: string;
  lastDuration: number | null;
  medianDuration: number | null;
}

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const sinceDays = Math.min(
    Math.max(Number(url.searchParams.get("sinceDays")) || 7, 1),
    180,
  );
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  // One grouped query for counts + last-run metadata. Uses
  // PERCENTILE_CONT for the median; that's a window function so we
  // wrap it in a subquery to combine with the GROUP BY agg.
  const rows = await prisma.$queryRaw<AggRow[]>`
    WITH last_run AS (
      SELECT DISTINCT ON ("jobName")
        "jobName",
        "createdAt" AS "lastRunAt",
        status AS "lastStatus",
        duration AS "lastDuration"
      FROM cron_job_logs
      WHERE "createdAt" >= ${since}
      ORDER BY "jobName", "createdAt" DESC
    ),
    medians AS (
      SELECT "jobName",
             PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration)::int
               AS "medianDuration"
      FROM cron_job_logs
      WHERE "createdAt" >= ${since}
        AND status = 'success'
        AND duration IS NOT NULL
      GROUP BY "jobName"
    )
    SELECT
      l."jobName",
      COUNT(*)::bigint AS total,
      COUNT(*) FILTER (WHERE l.status = 'success')::bigint AS success,
      COUNT(*) FILTER (WHERE l.status <> 'success')::bigint AS fail,
      lr."lastRunAt",
      lr."lastStatus",
      lr."lastDuration",
      m."medianDuration"
    FROM cron_job_logs l
    JOIN last_run lr USING ("jobName")
    LEFT JOIN medians m USING ("jobName")
    WHERE l."createdAt" >= ${since}
    GROUP BY l."jobName", lr."lastRunAt", lr."lastStatus", lr."lastDuration", m."medianDuration"
    ORDER BY lr."lastRunAt" DESC
  `.catch(() => [] as AggRow[]);

  // Index the manifest so each row can carry its schedule + mode +
  // category. Lookup is O(n) once, then O(1) per row.
  const manifestByName = new Map(CRONS.map((c) => [c.name, c]));

  const jobs = rows.map((r) => {
    const total = Number(r.total);
    const success = Number(r.success);
    const fail = Number(r.fail);
    const successRate =
      total === 0 ? null : Math.round((success / total) * 1000) / 10;
    const def = manifestByName.get(r.jobName);
    return {
      jobName: r.jobName,
      total,
      success,
      fail,
      successRate,
      lastRunAt: r.lastRunAt.toISOString(),
      lastStatus: r.lastStatus,
      lastDurationMs: r.lastDuration,
      medianDurationMs: r.medianDuration,
      // v8.20 · manifest enrichment
      schedule: def?.schedule ?? null,
      mode: def?.mode ?? null,
      category: def?.category ?? null,
      foldedInto: def?.foldedInto ?? null,
    };
  });

  return {
    sinceDays,
    jobCount: jobs.length,
    totals: {
      runs: jobs.reduce((s, j) => s + j.total, 0),
      successes: jobs.reduce((s, j) => s + j.success, 0),
      failures: jobs.reduce((s, j) => s + j.fail, 0),
    },
    jobs,
    generatedAt: new Date().toISOString(),
  };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts