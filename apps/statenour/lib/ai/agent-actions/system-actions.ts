/**
 * System operator (God-Mode) action handlers.
 *
 * Extracted VERBATIM from lib/ai/nick-agent.ts executeAction (2026-06-02
 * structural split).
 */
import { prisma } from "@/lib/prisma";
import type { ActionParams, ActionResult } from "./types";

export async function handleSystemHealth(_params: ActionParams, type: string): Promise<ActionResult> {
  const [dbOk, memCount, alertCount, syncAge] = await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
    // deletedAt:null — God-Mode reports this to the operator as the brain's
    // size. The pruner soft-deletes decayed memories; they are not "held".
    prisma.brainMemory.count({ where: { deletedAt: null } }),
    (async () => {
      const { getUnresolvedAlerts } = await import("@/lib/mastery/drift-engine");
      return (await getUnresolvedAlerts().catch(() => [])).length;
    })(),
    prisma.auditEvent.findFirst({ where: { eventType: "business_metrics_sync" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  const syncMinutes = syncAge?.createdAt ? Math.floor((Date.now() - syncAge.createdAt.getTime()) / 60000) : -1;
  return { action: type, success: true, result: {
    database: dbOk ? "UP" : "DOWN",
    brainMemories: memCount,
    unackedAlerts: alertCount,
    lastSyncMinutesAgo: syncMinutes,
    nodeVersion: process.version,
    uptime: Math.floor(process.uptime()),
  }};
}

export async function handleSystemBrainStats(_params: ActionParams, type: string): Promise<ActionResult> {
  // deletedAt:null on all three — brain stats describe what Nick currently
  // knows. Tombstones from the confidence pruner are not knowledge, and they
  // drag avgConfidence down (the pruner targets low-confidence rows).
  const [total, byCategory, avgConf, recentInsights] = await Promise.all([
    prisma.brainMemory.count({ where: { deletedAt: null } }),
    prisma.brainMemory.groupBy({ by: ["category"], where: { deletedAt: null }, _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 10 }),
    prisma.brainMemory.aggregate({ where: { deletedAt: null }, _avg: { confidence: true } }),
    prisma.auditEvent.findMany({ where: { eventType: "brain_insight" }, orderBy: { createdAt: "desc" }, take: 5, select: { detail: true, createdAt: true } }),
  ]);
  return { action: type, success: true, result: {
    totalMemories: total,
    avgConfidence: (avgConf._avg.confidence ?? 0).toFixed(2),
    byCategory: byCategory.map(c => ({ category: c.category, count: c._count.id })),
    recentInsights: recentInsights.map(i => ({ insight: i.detail, when: i.createdAt })),
  }};
}

export async function handleSystemSyncNow(_params: ActionParams, type: string): Promise<ActionResult> {
  // Trigger immediate cross-site sync
  const { runBrainCycle } = await import("@/lib/brain/pipeline-controller");
  const result = await runBrainCycle();
  return { action: type, success: result.synced, result: {
    alerts: result.alerts.length,
    patterns: result.patterns.length,
    message: `Brain cycle complete: ${result.alerts.length} alerts, ${result.patterns.length} patterns detected`,
  }};
}

export async function handleSystemDeepScan(_params: ActionParams, type: string): Promise<ActionResult> {
  // Run the full deep scan pipeline — comprehensive analysis
  const { runDeepScan } = await import("@/lib/brain/deep-scan");
  const scanResult = await runDeepScan();
  return { action: type, success: true, result: {
    duration: `${scanResult.duration}ms`,
    dataPointsAnalyzed: scanResult.metrics.dataPointsAnalyzed,
    findings: scanResult.findings.length,
    patternsFound: scanResult.metrics.patternsFound,
    anomaliesDetected: scanResult.metrics.anomaliesDetected,
    recommendations: scanResult.metrics.recommendationsGenerated,
    details: scanResult.findings.map(f => `[${f.severity.toUpperCase()}] ${f.title}: ${f.detail}${f.recommendation ? ` → ${f.recommendation}` : ""}`),
  }};
}

export async function handleSystemClearAlerts(_params: ActionParams, type: string): Promise<ActionResult> {
  const { getUnresolvedAlerts, acknowledgeAlert } = await import("@/lib/mastery/drift-engine");
  const unresolved = await getUnresolvedAlerts().catch(() => []);
  await Promise.all(unresolved.map((a) => acknowledgeAlert(a.id)));
  return { action: type, success: true, result: { cleared: unresolved.length } };
}

export async function handleSystemPagePatterns(_params: ActionParams, type: string): Promise<ActionResult> {
  const visits = await prisma.auditEvent.findMany({
    where: { eventType: "page_visit", createdAt: { gte: new Date(Date.now() - 7 * 86400000) } },
    select: { detail: true },
    take: 500,
  });
  const counts: Record<string, number> = {};
  for (const v of visits) { counts[v.detail || "?"] = (counts[v.detail || "?"] || 0) + 1; }
  const sorted = Object.entries(counts).sort(([,a],[,b]) => b - a).slice(0, 10);
  return { action: type, success: true, result: {
    totalVisits: visits.length,
    topPages: sorted.map(([page, count]) => ({ page, count })),
  }};
}
