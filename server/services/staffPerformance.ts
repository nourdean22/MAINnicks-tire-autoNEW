/**
 * Staff Performance Service — Per-tech metrics for the admin dashboard.
 *
 * Metrics:
 *   - Jobs completed (30d)
 *   - Avg job duration ratio (actual vs estimated)
 *   - QC pass rate
 *   - Comeback rate
 *   - Revenue generated
 *   - Current load
 */
import { eq, and, gte, sql, inArray, desc } from "drizzle-orm";

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const schema = await import("../../drizzle/schema");
  const d = getDb();
  if (!d) throw new Error("Database not available");
  return { db: d, ...schema };
}

export interface TechPerformance {
  techId: number;
  name: string;
  role: string | null;
  clockedIn: boolean;
  currentLoad: number;
  metrics: {
    jobsCompleted30d: number;
    totalRevenue30d: number;
    avgJobDurationRatio: number;
    qcPassRate: number;
    comebackRate: number;
    qcFails30d: number;
    comebacks30d: number;
  };
}

export async function getTeamPerformance(): Promise<{
  techs: TechPerformance[];
  teamTotals: {
    totalJobs: number;
    totalRevenue: number;
    avgQcPassRate: number;
    avgComebackRate: number;
  };
}> {
  const { db, technicians, workOrders, qcChecklists, comebacks } = await getDbAndSchema();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Get all active techs
  const techs = await db.select().from(technicians).where(eq(technicians.isActive, 1));

  const results: TechPerformance[] = [];
  let teamJobs = 0;
  let teamRevenue = 0;

  for (const tech of techs) {
    // Jobs completed in last 30 days
    const [jobStats] = await db.select({
      count: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(cast(${workOrders.total} as decimal(10,2))), 0)`,
    }).from(workOrders)
      .where(and(
        eq(workOrders.assignedTechId, tech.id),
        gte(workOrders.completedAt, thirtyDaysAgo),
      ));

    // Current active load
    const [loadCount] = await db.select({
      count: sql<number>`count(*)`,
    }).from(workOrders)
      .where(and(
        eq(workOrders.assignedTechId, tech.id),
        inArray(workOrders.status, ["assigned", "in_progress"]),
      ));

    // QC results
    const [qcStats] = await db.select({
      total: sql<number>`count(*)`,
      passed: sql<number>`sum(case when ${qcChecklists.status} = 'passed' then 1 else 0 end)`,
      failed: sql<number>`sum(case when ${qcChecklists.status} = 'failed' then 1 else 0 end)`,
    }).from(qcChecklists)
      .where(and(
        eq(qcChecklists.completedBy, tech.name),
        gte(qcChecklists.createdAt, thirtyDaysAgo),
      ));

    // Comebacks
    const [comebackStats] = await db.select({
      count: sql<number>`count(*)`,
    }).from(comebacks)
      .where(and(
        eq(comebacks.originalTechId, tech.id),
        gte(comebacks.createdAt, thirtyDaysAgo),
      ));

    const jobsCompleted = jobStats?.count || 0;
    const revenue = jobStats?.revenue || 0;
    const qcTotal = qcStats?.total || 0;
    const qcPassed = qcStats?.passed || 0;
    const qcFailed = qcStats?.failed || 0;
    const comebackCount = comebackStats?.count || 0;

    const qcPassRate = qcTotal > 0 ? qcPassed / qcTotal : 1;
    const comebackRate = jobsCompleted > 0 ? comebackCount / jobsCompleted : 0;

    teamJobs += jobsCompleted;
    teamRevenue += Number(revenue);

    results.push({
      techId: tech.id,
      name: tech.name,
      role: tech.role,
      clockedIn: tech.clockedIn ?? false,
      currentLoad: loadCount?.count || 0,
      metrics: {
        jobsCompleted30d: jobsCompleted,
        totalRevenue30d: Number(revenue),
        avgJobDurationRatio: Number(tech.avgJobDurationRatio) || 1,
        qcPassRate: Math.round(qcPassRate * 100) / 100,
        comebackRate: Math.round(comebackRate * 100) / 100,
        qcFails30d: qcFailed,
        comebacks30d: comebackCount,
      },
    });
  }

  // Team averages
  const avgQcPassRate = results.length > 0
    ? results.reduce((s, r) => s + r.metrics.qcPassRate, 0) / results.length
    : 1;
  const avgComebackRate = results.length > 0
    ? results.reduce((s, r) => s + r.metrics.comebackRate, 0) / results.length
    : 0;

  return {
    techs: results.sort((a, b) => b.metrics.jobsCompleted30d - a.metrics.jobsCompleted30d),
    teamTotals: {
      totalJobs: teamJobs,
      totalRevenue: teamRevenue,
      avgQcPassRate: Math.round(avgQcPassRate * 100) / 100,
      avgComebackRate: Math.round(avgComebackRate * 100) / 100,
    },
  };
}
