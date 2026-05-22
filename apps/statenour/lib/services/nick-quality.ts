/**
 * lib/services/nick-quality.ts · Phase VV (2026-05-22 ·
 * legacy-modernizer REST→tRPC system slice).
 *
 * The Nick-quality trend aggregator (W12.1). Lifted verbatim from
 * app/api/system/quality/route.ts so the legacy REST endpoint AND the
 * new `system.quality` tRPC procedure call the same function · drift
 * between consumers structurally impossible.
 *
 * Source: BrainMemory(category="nick_quality") rows, written by the
 * post-stream output-critic block. Empty windows return a zeroed
 * struct so the UI stays stable on first render.
 */

import { prisma } from "@/lib/prisma";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

interface ScorecardMeta {
  overall?: number;
  specificity?: number;
  cliche?: number;
  antiNour?: number;
  length?: number;
  shouldRegen?: boolean;
  wordCount?: number;
  turnIntent?: string;
  turnShape?: string;
  persona?: string;
}

function midnightUTC(daysAgo: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.round((sortedAsc.length - 1) * p)),
  );
  return Math.round(sortedAsc[idx]);
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

async function windowAggregate(since: Date) {
  // v8.27 · soft-delete retrofit · quality scorecards from deleted chat
  // turns shouldn't pollute the rolling Nick-quality average.
  const rows = await prisma.brainMemory.findMany({
    where: {
      category: BRAIN_CATEGORIES.NICK_QUALITY,
      createdAt: { gte: since },
      deletedAt: null,
    },
    select: { metadata: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const scores: number[] = [];
  const spec: number[] = [];
  const cliche: number[] = [];
  const antiNour: number[] = [];
  const lengthArr: number[] = [];
  let regens = 0;
  const turnIntents = new Map<string, number>();
  const shapes = new Map<string, number>();

  for (const r of rows) {
    const m = (r.metadata as ScorecardMeta | null) ?? {};
    if (typeof m.overall === "number") scores.push(m.overall);
    if (typeof m.specificity === "number") spec.push(m.specificity);
    if (typeof m.cliche === "number") cliche.push(m.cliche);
    if (typeof m.antiNour === "number") antiNour.push(m.antiNour);
    if (typeof m.length === "number") lengthArr.push(m.length);
    if (m.shouldRegen) regens++;
    if (m.turnIntent)
      turnIntents.set(m.turnIntent, (turnIntents.get(m.turnIntent) ?? 0) + 1);
    if (m.turnShape)
      shapes.set(m.turnShape, (shapes.get(m.turnShape) ?? 0) + 1);
  }

  const sortedScores = [...scores].sort((a, b) => a - b);

  return {
    replies: rows.length,
    overall: {
      avg: avg(scores),
      median: percentile(sortedScores, 0.5),
      p25: percentile(sortedScores, 0.25),
      p75: percentile(sortedScores, 0.75),
    },
    axes: {
      specificity: avg(spec),
      cliche: avg(cliche),
      antiNour: avg(antiNour),
      length: avg(lengthArr),
    },
    regenRate: rows.length > 0 ? Math.round((regens / rows.length) * 100) : 0,
    byIntent: [...turnIntents.entries()]
      .map(([intent, count]) => ({ intent, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    byShape: [...shapes.entries()]
      .map(([shape, count]) => ({ shape, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}

/** Three-window (today/7d/30d) Nick-quality rollup + 14-day trend. */
export async function buildNickQualityFeed() {
  const start14d = midnightUTC(14);
  const start7d = midnightUTC(7);
  const start30d = midnightUTC(30);
  const todayStart = midnightUTC(0);

  const [today, last7d, last30d, dailyRaw] = await Promise.all([
    windowAggregate(todayStart),
    windowAggregate(start7d),
    windowAggregate(start30d),
    prisma.brainMemory.findMany({
      where: {
        category: BRAIN_CATEGORIES.NICK_QUALITY,
        createdAt: { gte: start14d },
        deletedAt: null,
      },
      select: { createdAt: true, metadata: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // 14-day daily trend of mean overall score
  const byDay = new Map<string, { sum: number; count: number }>();
  for (const r of dailyRaw) {
    const day = r.createdAt.toISOString().slice(0, 10);
    const m = (r.metadata as ScorecardMeta | null) ?? {};
    if (typeof m.overall !== "number") continue;
    if (!byDay.has(day)) byDay.set(day, { sum: 0, count: 0 });
    const b = byDay.get(day)!;
    b.sum += m.overall;
    b.count += 1;
  }
  const trend: { day: string; mean: number; count: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = midnightUTC(i);
    const iso = d.toISOString().slice(0, 10);
    const b = byDay.get(iso);
    trend.push({
      day: iso,
      mean: b ? Math.round(b.sum / b.count) : 0,
      count: b?.count ?? 0,
    });
  }

  // Direction signal — compare 7d vs 30d - 7d (prior 23 days).
  const prior7dStart = start30d;
  const prior7dEnd = start7d;
  const prior = await windowAggregate(prior7dStart);
  const prior7Only = last30d.replies - last7d.replies;
  const delta = last7d.overall.avg - (prior7Only > 0 ? prior.overall.avg : 0);
  const direction: "rising" | "falling" | "flat" =
    delta >= 3 ? "rising" : delta <= -3 ? "falling" : "flat";
  // avoid unused variable warning
  void prior7dEnd;

  return {
    today,
    last7d,
    last30d,
    trend,
    delta,
    direction,
    generatedAt: new Date().toISOString(),
  };
}
