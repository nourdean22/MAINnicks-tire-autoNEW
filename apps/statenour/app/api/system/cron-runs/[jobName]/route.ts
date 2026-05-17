/**
 * GET /api/system/cron-runs/[jobName] · v8.14 · Apr 29.
 *
 * Per-job run history. Returns the last N rows from cron_job_logs
 * with status, duration, error preview, and a computed success-rate
 * + median duration over the requested window.
 *
 * Drives /system/cron-runs/[jobName] drill-down page. Composes on the
 * v6 cron_job_logs schema — no new tables.
 */

import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

interface RunRow {
  id: string;
  status: string;
  duration: number | null;
  error: string | null;
  createdAt: Date;
}

export const GET = apiHandler(async (req, ctx) => {
  const params = ctx.params ? ((await ctx.params) as { jobName: string }) : { jobName: "" };
  const jobName = params.jobName;
  const url = new URL(req.url);
  const limit = Math.min(
    Math.max(Number(url.searchParams.get("limit")) || 100, 1),
    500,
  );
  const sinceDays = Math.min(
    Math.max(Number(url.searchParams.get("sinceDays")) || 7, 1),
    180,
  );
  const since = new Date(Date.now() - sinceDays * 86_400_000);

  const rows = (await prisma.cronJobLog.findMany({
    where: {
      jobName: { contains: jobName },
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      status: true,
      duration: true,
      error: true,
      createdAt: true,
    },
  })) as RunRow[];

  const succ = rows.filter((r) => r.status === "success");
  const fail = rows.filter((r) => r.status !== "success");
  const successRate =
    rows.length === 0 ? null : Math.round((succ.length / rows.length) * 1000) / 10;

  const durations = succ
    .map((r) => r.duration)
    .filter((d): d is number => typeof d === "number")
    .sort((a, b) => a - b);
  const median =
    durations.length === 0
      ? null
      : durations[Math.floor(durations.length / 2)] ?? null;
  const p95 =
    durations.length === 0
      ? null
      : durations[Math.floor(durations.length * 0.95)] ?? null;

  return {
    jobName,
    sinceDays,
    counts: {
      total: rows.length,
      success: succ.length,
      fail: fail.length,
    },
    successRate,
    median,
    p95,
    runs: rows.map((r) => ({
      id: r.id,
      status: r.status,
      durationMs: r.duration,
      errorPreview: r.error ? r.error.slice(0, 240) : null,
      createdAt: r.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}, { auth: "owner" }); // v9.1.17 · added by add-get-route-auth.ts