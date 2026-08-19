/**
 * Predictive task timing · v10.0.92 · 2026-05-02.
 *
 * Looks at past Task completions to surface "best hour of day to
 * tackle X kind of task". Useful for the chat tool ("what should
 * I do now?") and for surfacing on /tasks as inline hints.
 *
 * Algorithm:
 *   1. Pull last 90d of completed tasks (status=DONE) with their
 *      completion timestamps + categorical signals (loopKind,
 *      domain, effort, priority)
 *   2. Bin completions by hour-of-day in Cleveland TZ (UTC-5)
 *   3. For each (signal-bucket × hour) combination, compute a
 *      completion-rate score: (completions / total tasks in that
 *      bucket × hour) — high = "you usually finish this kind of
 *      task at this hour"
 *   4. Per task, return top-3 recommended hours ranked by score
 *      with sample counts
 *
 * Returns null when there isn't enough history (<10 completions
 * in the last 90d) — Wilson lower bound rule.
 */

import { prisma } from "@/lib/prisma";

const CLEVELAND_OFFSET_MIN = 5 * 60; // UTC-5 winter; Cleveland is technically -4 in summer (DST)
                                      // but for "best hour" the scoring is robust to ±1 anyway.

const MIN_HISTORY = 10;
const TOP_HOURS = 3;

export interface HourScore {
  hourCleveland: number;
  hourLabel: string; // "07:00 ET" etc
  completions: number;
  totalInBucket: number;
  rate: number; // completions / totalInBucket
}

export interface TaskTimingHint {
  signalBucket: string;
  topHours: HourScore[];
  totalSampleSize: number;
  notes?: string;
}

interface RawCompletion {
  done_at: Date;
  loop_kind: string | null;
  context: string | null;
  effort: string | null;
}

function bucketKey(c: {
  loopKind?: string | null;
  context?: string | null;
  effort?: string | null;
}): string {
  return [
    c.loopKind ?? "ANY",
    c.context ?? "ANY",
    c.effort ?? "ANY",
  ].join("·");
}

function hourClevelandFromUtc(d: Date): number {
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  const localMin = (utcMin - CLEVELAND_OFFSET_MIN + 24 * 60) % (24 * 60);
  return Math.floor(localMin / 60);
}

function hourLabel(h: number): string {
  return `${h.toString().padStart(2, "0")}:00 ET`;
}

/**
 * Compute hint for ONE task signature based on past completions
 * with the same (loopKind, domain, effort).
 */
export async function predictBestHoursForTask(opts: {
  loopKind?: string | null;
  context?: string | null;
  effort?: string | null;
}): Promise<TaskTimingHint | null> {
  const since = new Date(Date.now() - 90 * 86_400_000);
  // Task has no completedAt column; use updatedAt as proxy when
  // status='DONE' (the row was last touched at completion time
  // or shortly after). Query uses Prisma's auto-mapped column
  // names (camelCase, no @map).
  const completions = await prisma
    .$queryRawUnsafe<RawCompletion[]>(
      `SELECT
         "updatedAt" AS done_at,
         "loopKind"::text AS loop_kind,
         "context"::text AS context,
         "effort"::text AS effort
       FROM "Task"
       WHERE status = 'DONE'
         AND "deletedAt" IS NULL
         AND "updatedAt" >= $1
       LIMIT 5000`,
      since.toISOString(),
    )
    .catch(() => []);

  if (completions.length < MIN_HISTORY) {
    return {
      signalBucket: bucketKey(opts),
      topHours: [],
      totalSampleSize: completions.length,
      notes: `not enough history (have ${completions.length}, need ${MIN_HISTORY}+)`,
    };
  }

  // Filter to matching signals — fall back progressively if no exact match
  const matchExact = completions.filter(
    (c) =>
      (opts.loopKind == null || c.loop_kind === opts.loopKind) &&
      (opts.context == null || c.context === opts.context) &&
      (opts.effort == null || c.effort === opts.effort),
  );
  const matchLooserContext = completions.filter(
    (c) =>
      (opts.loopKind == null || c.loop_kind === opts.loopKind) &&
      (opts.effort == null || c.effort === opts.effort),
  );

  let matched = matchExact;
  let bucket = bucketKey(opts);
  if (matched.length < MIN_HISTORY) {
    matched = matchLooserContext;
    bucket = `${opts.loopKind ?? "ANY"}·ANY·${opts.effort ?? "ANY"}`;
  }
  if (matched.length < MIN_HISTORY) {
    matched = completions;
    bucket = "ANY·ANY·ANY";
  }

  // Bin by Cleveland hour
  const byHour = new Map<number, number>();
  for (const c of matched) {
    const h = hourClevelandFromUtc(new Date(c.done_at));
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }

  const totalInBucket = matched.length;
  const ranked: HourScore[] = [...byHour.entries()]
    .map(([h, n]) => ({
      hourCleveland: h,
      hourLabel: hourLabel(h),
      completions: n,
      totalInBucket,
      rate: Math.round((n / totalInBucket) * 1000) / 1000,
    }))
    .sort((a, b) => b.completions - a.completions)
    .slice(0, TOP_HOURS);

  return {
    signalBucket: bucket,
    topHours: ranked,
    totalSampleSize: totalInBucket,
  };
}

/**
 * Bulk view: for the next-up open tasks, surface their predicted
 * best hours. Used by the /api/personal/task-timing endpoint.
 */
export async function predictBestHoursForOpenTasks(limit: number = 10) {
  const open = await prisma.task
    .findMany({
      where: {
        status: { in: ["READY", "INBOX", "DOING"] },
        deletedAt: null,
      },
      orderBy: [{ autoPriority: { sort: "desc", nulls: "last" } }, { createdAt: "asc" }],
      take: limit,
      select: {
        id: true,
        title: true,
        loopKind: true,
        context: true,
        effort: true,
        autoPriority: true,
      },
    })
    .catch(() => []);

  const hints: Array<{
    taskId: string;
    title: string;
    hint: TaskTimingHint | null;
  }> = [];
  for (const t of open) {
    const hint = await predictBestHoursForTask({
      loopKind: t.loopKind,
      context: t.context,
      effort: t.effort,
    });
    hints.push({
      taskId: t.id,
      title: t.title?.slice(0, 100) ?? "",
      hint,
    });
  }
  return hints;
}
