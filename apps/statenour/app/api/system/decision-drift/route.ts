import { apiHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/system/decision-drift — Nour's decision follow-through pulse (W12.2).
 *
 * Decision drift = the gap between what Nour decided and what actually
 * happened. Every MasteryDecision row has three quality signals:
 *   · chosen           — what he picked
 *   · predictedOutcome — what he expected
 *   · actualOutcome    — populated when he later graded the decision
 *   · grade            — A/B/C/D/F score on the outcome
 *
 * Metrics:
 *   · reviewRate       — % of decisions that got an actualOutcome filled in
 *                        (dropping reviewRate = decisions going unreviewed =
 *                         Nour losing self-awareness)
 *   · gradeDistribution — A/B/C/D/F counts over window
 *   · gradeTrend       — per-week grade average (numeric: A=4 B=3 C=2 D=1 F=0)
 *   · misses           — decisions with A/B prediction but D/F actual
 *   · overdue          — past reviewDate but no actualOutcome
 *   · domainBreakdown  — per-domain review rate + avg grade
 *
 * Windows: today · 7d · 30d · 90d (enough history to spot trend).
 */

const GRADE_TO_NUM: Record<string, number> = {
  A: 4, "A+": 4, "A-": 3.7,
  B: 3, "B+": 3.3, "B-": 2.7,
  C: 2, "C+": 2.3, "C-": 1.7,
  D: 1, "D+": 1.3, "D-": 0.7,
  F: 0,
};

function gradeToNum(g: string | null | undefined): number | null {
  if (!g) return null;
  const n = GRADE_TO_NUM[g.toUpperCase()];
  return typeof n === "number" ? n : null;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}

async function windowAggregate(since: Date) {
  const rows = await prisma.masteryDecision.findMany({
    where: { createdAt: { gte: since }, deletedAt: null },
    select: {
      id: true,
      date: true,
      title: true,
      domain: true,
      stakes: true,
      chosen: true,
      predictedOutcome: true,
      actualOutcome: true,
      grade: true,
      reviewDate: true,
      createdAt: true,
    },
  });

  const reviewed = rows.filter((r) => r.actualOutcome != null && r.actualOutcome.trim() !== "");
  const reviewRate = rows.length > 0 ? Math.round((reviewed.length / rows.length) * 100) : 0;

  const gradeDistribution: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0, ungraded: 0 };
  const gradeNumbers: number[] = [];
  for (const r of rows) {
    if (!r.grade) {
      gradeDistribution.ungraded++;
      continue;
    }
    const letter = r.grade.toUpperCase().charAt(0);
    if (letter in gradeDistribution) gradeDistribution[letter]++;
    else gradeDistribution.ungraded++;
    const n = gradeToNum(r.grade);
    if (n !== null) gradeNumbers.push(n);
  }
  const avgGrade = gradeNumbers.length > 0
    ? Math.round((gradeNumbers.reduce((a, b) => a + b, 0) / gradeNumbers.length) * 100) / 100
    : null;

  const misses = rows
    .filter((r) => {
      const g = gradeToNum(r.grade);
      return g !== null && g <= 1;
    })
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      chosen: r.chosen,
      predictedOutcome: r.predictedOutcome,
      actualOutcome: r.actualOutcome,
      grade: r.grade,
      domain: r.domain,
    }));

  const today = new Date().toISOString().slice(0, 10);
  const overdue = rows
    .filter((r) => r.reviewDate && r.reviewDate < today && !r.actualOutcome)
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      title: r.title,
      date: r.date,
      reviewDate: r.reviewDate,
      chosen: r.chosen,
      domain: r.domain,
    }));

  // Domain breakdown
  const byDomain: Record<string, { count: number; reviewed: number; gradeSum: number; gradeN: number }> = {};
  for (const r of rows) {
    const d = r.domain ?? "unclassified";
    if (!byDomain[d]) byDomain[d] = { count: 0, reviewed: 0, gradeSum: 0, gradeN: 0 };
    const b = byDomain[d];
    b.count++;
    if (r.actualOutcome && r.actualOutcome.trim() !== "") b.reviewed++;
    const gn = gradeToNum(r.grade);
    if (gn !== null) {
      b.gradeSum += gn;
      b.gradeN++;
    }
  }
  const domainBreakdown = Object.entries(byDomain)
    .map(([domain, d]) => ({
      domain,
      count: d.count,
      reviewRate: d.count > 0 ? Math.round((d.reviewed / d.count) * 100) : 0,
      avgGrade: d.gradeN > 0 ? Math.round((d.gradeSum / d.gradeN) * 100) / 100 : null,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    total: rows.length,
    reviewed: reviewed.length,
    reviewRate,
    avgGrade,
    gradeDistribution,
    misses,
    overdue,
    domainBreakdown,
  };
}

export const GET = apiHandler(async () => {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const [todayAgg, last7d, last30d, last90d, weeklyRaw] = await Promise.all([
    windowAggregate(today),
    windowAggregate(daysAgo(7)),
    windowAggregate(daysAgo(30)),
    windowAggregate(daysAgo(90)),
    // 12-week trend: per ISO-week avg grade
    prisma.$queryRawUnsafe<{ week: string; avg_grade: number | null; n: number }[]>(`
      SELECT
        TO_CHAR(DATE_TRUNC('week', created_at), 'IYYY-IW') as week,
        AVG(CASE grade
          WHEN 'A' THEN 4 WHEN 'A+' THEN 4 WHEN 'A-' THEN 3.7
          WHEN 'B' THEN 3 WHEN 'B+' THEN 3.3 WHEN 'B-' THEN 2.7
          WHEN 'C' THEN 2 WHEN 'C+' THEN 2.3 WHEN 'C-' THEN 1.7
          WHEN 'D' THEN 1 WHEN 'D+' THEN 1.3 WHEN 'D-' THEN 0.7
          WHEN 'F' THEN 0
          ELSE NULL END
        ) as avg_grade,
        COUNT(*)::int as n
      FROM mastery_decisions
      WHERE created_at >= $1 AND grade IS NOT NULL
      GROUP BY 1
      ORDER BY 1 DESC
      LIMIT 12
    `, daysAgo(84)).catch(() => [] as { week: string; avg_grade: number | null; n: number }[]),
  ]);

  // Build dense 12-week series oldest → newest
  const trend = weeklyRaw
    .map((r) => ({ week: r.week, avgGrade: r.avg_grade, count: r.n }))
    .reverse();

  // Direction: compare 7d avg vs 30d avg
  const delta = last7d.avgGrade !== null && last30d.avgGrade !== null
    ? Math.round((last7d.avgGrade - last30d.avgGrade) * 100) / 100
    : 0;
  const direction: "rising" | "falling" | "flat" =
    delta >= 0.2 ? "rising" : delta <= -0.2 ? "falling" : "flat";

  return {
    today: todayAgg,
    last7d,
    last30d,
    last90d,
    trend,
    delta,
    direction,
    generatedAt: new Date().toISOString(),
  };
}, { auth: "owner" }); // v9.1.14 · was leaking decision quality + grade distribution
