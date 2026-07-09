/**
 * Deep Scan System — Server-Side ALG Data Analysis Pipeline
 *
 * Runs comprehensive analysis across all data from Auto Labor Guide:
 * - Revenue trends and anomalies
 * - Customer behavior patterns
 * - Service mix analysis
 * - Conversion funnel health
 * - Inventory/ordering patterns
 *
 * Called by Nick AI via system.deepScan command or by cron.
 * Results stored as brain insights for proactive surfacing.
 */

import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { recentScoreSnapshots } from "@/lib/brain/legacy-shims";

interface DeepScanResult {
  timestamp: string;
  duration: number;
  findings: DeepScanFinding[];
  metrics: {
    dataPointsAnalyzed: number;
    patternsFound: number;
    anomaliesDetected: number;
    recommendationsGenerated: number;
  };
}

interface DeepScanFinding {
  type: "pattern" | "anomaly" | "opportunity" | "risk" | "milestone";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  metric?: { current: number; expected: number; unit: string };
  recommendation?: string;
}

/**
 * Run a comprehensive deep scan across all synced data.
 */
export async function runDeepScan(): Promise<DeepScanResult> {
  const startTime = Date.now();
  const findings: DeepScanFinding[] = [];
  let dataPoints = 0;

  // ── 1. Score trend analysis ──
  // v10.0.55 · scores via legacy-shim. 14d window so the recent7
  // / prev7 split below has data on both sides.
  const scores = await recentScoreSnapshots(14);

  dataPoints += scores.length;

  if (scores.length >= 7) {
    const recent7 = scores.slice(0, 7);
    const prev7 = scores.slice(7, 14);
    // v10.0.55 · LegacyScoreRow.overallScore is nullable (snapshot
    // rows can omit `score`). Coalesce to 0 for the average.
    const recentAvg = recent7.reduce((s, r) => s + (r.overallScore ?? 0), 0) / recent7.length;
    const prevAvg = prev7.length > 0 ? prev7.reduce((s, r) => s + (r.overallScore ?? 0), 0) / prev7.length : recentAvg;

    if (recentAvg < prevAvg - 1.5) {
      findings.push({
        type: "anomaly", severity: "warning",
        title: "Score downtrend detected",
        detail: `Average score dropped from ${prevAvg.toFixed(1)} to ${recentAvg.toFixed(1)} over the last 7 days`,
        metric: { current: recentAvg, expected: prevAvg, unit: "/10" },
        recommendation: "Review what changed — sleep, workouts, stress? The data shows a decline.",
      });
    }

    const workoutRate = recent7.filter(s => s.workoutDone).length / recent7.length;
    if (workoutRate < 0.3) {
      findings.push({
        type: "risk", severity: "warning",
        title: "Workout frequency critical",
        detail: `Only ${Math.round(workoutRate * 100)}% workout completion this week (${recent7.filter(s => s.workoutDone).length}/7)`,
        recommendation: "Non-negotiable. Body = business performance. Schedule ONE workout today.",
      });
    }

    // Mood pattern
    const moodCounts: Record<string, number> = {};
    for (const s of recent7) { if (s.mood) moodCounts[s.mood] = (moodCounts[s.mood] || 0) + 1; }
    const topMood = Object.entries(moodCounts).sort(([,a],[,b]) => b - a)[0];
    if (topMood && (topMood[0] === "stressed" || topMood[0] === "anxious") && topMood[1] >= 4) {
      findings.push({
        type: "pattern", severity: "warning",
        title: `Persistent ${topMood[0]} mood`,
        detail: `${topMood[0]} reported ${topMood[1]} out of 7 days — this affects decision quality`,
        recommendation: "Identify the root cause. Is it business, personal, or health? Address the source, not the symptom.",
      });
    }
  } else if (scores.length < 3) {
    findings.push({
      type: "risk", severity: "critical",
      title: "Insufficient scoring data",
      detail: `Only ${scores.length} scores logged recently — the brain can't analyze trends without data`,
      recommendation: "Log your daily score. It takes 60 seconds and feeds the entire intelligence system.",
    });
  }

  // ── 2. Business sync freshness ──
  const lastSync = await prisma.auditEvent.findFirst({
    where: { eventType: "business_metrics_sync" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true, payload: true },
  }).catch(() => null);

  if (lastSync) {
    dataPoints += 1;
    const syncAge = Math.floor((Date.now() - lastSync.createdAt.getTime()) / 60000);
    if (syncAge > 360) {
      findings.push({
        type: "anomaly", severity: "critical",
        title: "Business sync stale",
        detail: `Last sync from nickstire.org was ${Math.floor(syncAge / 60)} hours ago`,
        recommendation: "Check if the nickstire.org bridge is running and the cron jobs are firing.",
      });
    }

    // Revenue analysis from synced data
    const payload = lastSync.payload as any;
    if (payload?.revenue || payload?.intelligence?.shopPulse) {
      const pulse = payload.intelligence?.shopPulse || {};
      const weekRev = pulse.thisWeek?.revenue || payload.revenue?.weekRevenue || 0;
      const dailyPace = weekRev / 7;
      const monthlyProjection = dailyPace * 30;

      const { MONTHLY_REVENUE_TARGET } = await import("@/lib/config/business");
      if (monthlyProjection < MONTHLY_REVENUE_TARGET * 0.8) {
        findings.push({
          type: "risk", severity: "warning",
          title: `Revenue below $${(MONTHLY_REVENUE_TARGET / 1000).toFixed(0)}K target pace`,
          detail: `Weekly revenue $${Math.round(weekRev)} projects to $${Math.round(monthlyProjection)}/month — below $${(MONTHLY_REVENUE_TARGET / 1000).toFixed(0)}K target`,
          metric: { current: monthlyProjection, expected: MONTHLY_REVENUE_TARGET, unit: "$/month" },
          recommendation: "Focus on: estimate follow-ups, Google reviews, and fleet outreach. These are the highest-leverage revenue drivers.",
        });
      }

      if (pulse.thisWeek?.walkRate > 40) {
        findings.push({
          type: "opportunity", severity: "warning",
          title: "High walk rate = revenue leaking",
          detail: `${pulse.thisWeek.walkRate}% walk rate means customers are getting estimates but not converting`,
          recommendation: "Call back every estimate from today. Price objection? Offer a $25 discount to close same-day.",
        });
      }
    }
  }

  // ── 3. Memory health ──
  const [memCount, avgConf] = await Promise.all([
    prisma.brainMemory.count(),
    prisma.brainMemory.aggregate({ _avg: { confidence: true } }),
  ]);
  dataPoints += memCount;

  if ((avgConf._avg.confidence ?? 0) < 0.2) {
    findings.push({
      type: "anomaly", severity: "warning",
      title: "Brain memory confidence low",
      detail: `Average memory confidence is ${((avgConf._avg.confidence ?? 0) * 100).toFixed(0)}% — memories may be decaying too fast`,
      recommendation: "Increase interaction frequency. The brain gets smarter with more data.",
    });
  }

  // ── 4. Active tasks and commitments ──
  // Apr 18: OpenLoop retired → unified Task surface.
  const [loops, commitments] = await Promise.all([
    prisma.task.count({ where: { status: { in: ["INBOX", "READY", "DOING"] } } }),
    prisma.commitment.count({ where: { status: { in: ["active", "in_progress"] } } }),
  ]);
  dataPoints += loops + commitments;

  if (loops > 10) {
    findings.push({
      type: "risk", severity: "warning",
      title: "Loop overload",
      detail: `${loops} open loops — cognitive load is high. Decision quality drops with >7 open items.`,
      recommendation: "Close 3 loops today. Drop anything that's been open >14 days without progress.",
    });
  }

  // ── 5. Generate milestone findings ──
  if (memCount >= 1000) {
    findings.push({
      type: "milestone", severity: "info",
      title: `Brain milestone: ${memCount.toLocaleString()} memories`,
      detail: "The neural core is building substantial pattern recognition capability.",
    });
  }

  // ── Store significant findings as brain insights ──
  // v10.0.46 — replaced `Date.now()` in the key with the ET date
  // string. Pre-fix every 6h cron run wrote a brand-new row per
  // finding (5 findings × 4 runs/day = ~7,300 new rows/year that
  // never dedupe). With a stable `scan_${type}_${date}` key the
  // daily upsert overwrites instead.
  const todayKeyDate = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const significant = findings.filter(f => f.severity === "critical" || f.severity === "warning");
  for (const finding of significant.slice(0, 5)) {
    await brainMemory.remember(
      "deep_scan",
      `scan_${finding.type}_${todayKeyDate}`,
      `[${finding.type.toUpperCase()}] ${finding.title}: ${finding.detail}${finding.recommendation ? ` → ${finding.recommendation}` : ""}`,
      "deep_scan"
    ).catch(() => {});
  }

  // ── Store scan result ──
  await prisma.auditEvent.create({
    data: {
      actor: "deep_scan",
      eventType: "deep_scan_complete",
      detail: `Deep scan: ${findings.length} findings (${significant.length} actionable) from ${dataPoints} data points`,
      payload: {
        findingsCount: findings.length,
        bySeverity: { critical: findings.filter(f => f.severity === "critical").length, warning: findings.filter(f => f.severity === "warning").length, info: findings.filter(f => f.severity === "info").length },
        byType: { pattern: findings.filter(f => f.type === "pattern").length, anomaly: findings.filter(f => f.type === "anomaly").length, opportunity: findings.filter(f => f.type === "opportunity").length, risk: findings.filter(f => f.type === "risk").length, milestone: findings.filter(f => f.type === "milestone").length },
        dataPoints,
      },
    },
  }).catch(() => {});

  return {
    timestamp: new Date().toISOString(),
    duration: Date.now() - startTime,
    findings,
    metrics: {
      dataPointsAnalyzed: dataPoints,
      patternsFound: findings.filter(f => f.type === "pattern").length,
      anomaliesDetected: findings.filter(f => f.type === "anomaly").length,
      recommendationsGenerated: findings.filter(f => !!f.recommendation).length,
    },
  };
}

