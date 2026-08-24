/**
 * Time-of-Day Intelligence
 *
 * Analyzes WHEN Nour performs best across all domains:
 * - When he logs scores (consistency windows)
 * - When he chats with Nick (activity patterns)
 * - When decisions are made (and their quality by hour)
 * - When drift happens (temporal drift patterns)
 * - When revenue peaks (day-of-week + hour patterns)
 *
 * Produces a personal performance heatmap and peak window detection.
 */

import { prisma } from "@/lib/prisma";
import { daysAgo, hourET, today, weekdayET } from "@/lib/utils/datetime";
import { recentScoreSnapshots, recentShopJobs } from "@/lib/brain/legacy-shims";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

export interface TimePattern {
  category: string;
  peakWindow: string; // e.g. "9am-11am"
  lowWindow: string; // e.g. "9pm-midnight"
  detail: string;
}

export interface TimeIntelligence {
  chatActivity: Record<number, number>; // hour -> count
  scoreLoggingHours: Record<number, number>;
  peakProductivity: string;
  driftWindow: string;
  dayOfWeekPatterns: Record<string, { score: number; revenue: number }>;
  patterns: TimePattern[];
}

/**
 * Analyze temporal patterns across 30 days of data.
 */
export async function analyzeTimePatterns(): Promise<TimeIntelligence> {
  const thirtyDaysAgo = daysAgo(30);

  const [chatMessages, scores, decisions, jobs] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, role: "user" },
      select: { createdAt: true },
    }),
    // v10.0.55 · scores + jobs via legacy-shims.
    recentScoreSnapshots(30),
    prisma.masteryDecision.findMany({
      where: { createdAt: { gte: thirtyDaysAgo }, deletedAt: null },
      select: { createdAt: true, grade: true },
    }),
    recentShopJobs(30),
  ]);

  // Chat activity by hour (Cleveland timezone)
  const chatActivity: Record<number, number> = {};
  for (const msg of chatMessages) {
    const hour = new Date(msg.createdAt).toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    });
    const h = parseInt(hour, 10);
    chatActivity[h] = (chatActivity[h] || 0) + 1;
  }

  // Score logging hours
  const scoreLoggingHours: Record<number, number> = {};
  for (const s of scores) {
    const hour = new Date(s.createdAt).toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hour12: false,
    });
    const h = parseInt(hour, 10);
    scoreLoggingHours[h] = (scoreLoggingHours[h] || 0) + 1;
  }

  // Day-of-week patterns
  const dayOfWeekPatterns: Record<string, { scores: number[]; revenue: number }> = {};
  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  for (const s of scores) {
    const dayIdx = weekdayET(new Date(s.date + "T12:00:00"));
    const day = dayNames[dayIdx];
    if (!dayOfWeekPatterns[day]) dayOfWeekPatterns[day] = { scores: [], revenue: 0 };
    dayOfWeekPatterns[day].scores.push(s.overallScore ?? 0);
  }

  for (const j of jobs) {
    const dayIdx = weekdayET(new Date(j.createdAt));
    const day = dayNames[dayIdx];
    if (!dayOfWeekPatterns[day]) dayOfWeekPatterns[day] = { scores: [], revenue: 0 };
    dayOfWeekPatterns[day].revenue += Number(j.totalRevenue ?? 0);
  }

  // Find peak activity window
  const sortedHours = Object.entries(chatActivity)
    .sort(([, a], [, b]) => b - a)
    .map(([h]) => parseInt(h, 10));
  const peakHour = sortedHours[0] ?? 10;
  const peakProductivity = `${peakHour}:00-${peakHour + 2}:00`;

  // Find drift window (low activity + low scores)
  const lowHours = Object.entries(chatActivity)
    .filter(([h]) => parseInt(h, 10) >= 12) // only afternoon+
    .sort(([, a], [, b]) => a - b)
    .map(([h]) => parseInt(h, 10));
  const driftHour = lowHours[0] ?? 21;
  const driftWindow = `${driftHour}:00-${driftHour + 2}:00`;

  // Build patterns
  const patterns: TimePattern[] = [];

  // Best/worst days
  const dayAvgs = Object.entries(dayOfWeekPatterns)
    .map(([day, data]) => ({
      day,
      avgScore: data.scores.length > 0
        ? data.scores.reduce((s, v) => s + v, 0) / data.scores.length
        : 0,
      revenue: data.revenue,
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  if (dayAvgs.length >= 3) {
    patterns.push({
      category: BRAIN_CATEGORIES.DAY_OF_WEEK,
      peakWindow: dayAvgs[0]?.day || "unknown",
      lowWindow: dayAvgs[dayAvgs.length - 1]?.day || "unknown",
      detail: `Best: ${dayAvgs[0]?.day} (${dayAvgs[0]?.avgScore.toFixed(1)}/10), Worst: ${dayAvgs[dayAvgs.length - 1]?.day} (${dayAvgs[dayAvgs.length - 1]?.avgScore.toFixed(1)}/10)`,
    });
  }

  // Decision quality by time
  const morningDecisions = decisions.filter((d) => {
    const h = hourET(new Date(d.createdAt));
    return h >= 6 && h < 12;
  });
  const eveningDecisions = decisions.filter((d) => {
    const h = hourET(new Date(d.createdAt));
    return h >= 18;
  });

  if (morningDecisions.length >= 2 && eveningDecisions.length >= 2) {
    const gradeMap: Record<string, number> = {
      "A+": 10, A: 9, "A-": 8, "B+": 7, B: 6, "B-": 5,
      "C+": 4, C: 3, "C-": 2, "D": 1, "F": 0,
    };
    const morningAvg = morningDecisions
      .map((d) => gradeMap[d.grade || "C"] ?? 3)
      .reduce((s, v) => s + v, 0) / morningDecisions.length;
    const eveningAvg = eveningDecisions
      .map((d) => gradeMap[d.grade || "C"] ?? 3)
      .reduce((s, v) => s + v, 0) / eveningDecisions.length;

    patterns.push({
      category: BRAIN_CATEGORIES.DECISION_TIMING,
      peakWindow: "6am-12pm",
      lowWindow: "6pm-midnight",
      detail: `Morning decisions avg grade: ${morningAvg.toFixed(1)}/10, Evening: ${eveningAvg.toFixed(1)}/10`,
    });
  }

  // Revenue by day of week
  const revByDay = dayAvgs.sort((a, b) => b.revenue - a.revenue);
  if (revByDay.length >= 3 && revByDay[0].revenue > 0) {
    patterns.push({
      category: BRAIN_CATEGORIES.REVENUE_TIMING,
      peakWindow: revByDay[0].day,
      lowWindow: revByDay[revByDay.length - 1].day,
      detail: `Best revenue day: ${revByDay[0].day} ($${revByDay[0].revenue.toFixed(0)}), Worst: ${revByDay[revByDay.length - 1].day} ($${revByDay[revByDay.length - 1].revenue.toFixed(0)})`,
    });
  }

  // Store patterns as brain memories
  for (const p of patterns) {
    await prisma.brainMemory.upsert({
      where: {
        category_key: {
          category: BRAIN_CATEGORIES.TIME_PATTERN,
          key: `time_${p.category}`,
        },
      },
      create: {
        category: BRAIN_CATEGORIES.TIME_PATTERN,
        key: `time_${p.category}`,
        content: `${p.category}: Peak=${p.peakWindow}, Low=${p.lowWindow}. ${p.detail}`,
        confidence: 0.7,
        source: "time_intelligence",
      },
      update: {
        content: `${p.category}: Peak=${p.peakWindow}, Low=${p.lowWindow}. ${p.detail}`,
        seenCount: { increment: 1 },
      },
    }).catch(() => {});
  }

  return {
    chatActivity,
    scoreLoggingHours,
    peakProductivity,
    driftWindow,
    dayOfWeekPatterns: Object.fromEntries(
      Object.entries(dayOfWeekPatterns).map(([day, data]) => [
        day,
        {
          score:
            data.scores.length > 0
              ? data.scores.reduce((s, v) => s + v, 0) / data.scores.length
              : 0,
          revenue: data.revenue,
        },
      ])
    ),
    patterns,
  };
}

/**
 * Get time intelligence for system prompt.
 */
export async function getTimeIntelligenceContext(): Promise<string> {
  const patterns = await prisma.brainMemory
    .findMany({
      where: { category: BRAIN_CATEGORIES.TIME_PATTERN },
      orderBy: { confidence: "desc" },
      take: 5,
      select: { content: true },
    })
    .catch(() => []);

  if (patterns.length === 0) return "";

  const lines = [`\n## Time Intelligence (${patterns.length} patterns)`];
  for (const p of patterns) {
    lines.push(p.content.slice(0, 200));
  }

  return lines.join("\n");
}
