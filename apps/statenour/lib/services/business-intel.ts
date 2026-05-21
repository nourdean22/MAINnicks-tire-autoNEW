/**
 * Business intelligence for Nick's Tire & Auto.
 * Revenue analytics, customer insights, top services.
 *
 * v10.0.51 · Wave A · ghost-feeder migration finish.
 *
 * Pre-fix: every export read `Promise.resolve([] as any[])` /
 * `Promise.resolve(0)` placeholders. The customer/job tables that
 * fed these analytics never existed in the autonicks Neon DB —
 * those entities live on nickstire (TiDB on Railway). The migration
 * stub was added when the local mirror tables got dropped, with the
 * intent to wire each function to the queryNick bridge. That second
 * step never happened, so /api/analytics/revenue + /api/analytics/
 * dashboard + the getRevenueStats / getTopServices Nick tools have
 * been silently returning empty / zero for months.
 *
 * Now wired:
 *   · getRevenueStats(period)   → revenue_today / revenue_week /
 *                                  revenue_range (month + year)
 *   · getTopServices(limit)     → revenue_top_services bridge query
 *                                  (graceful empty fallback when
 *                                   the query isn't available yet)
 *   · getCustomerStats()        → customer_stats bridge query
 *                                  (graceful empty fallback)
 *   · getDashboardSummary()     → fans out to the above + reviews
 *
 * Design contract: bridge failure → empty/zero (NEVER fake data).
 * The /system/errors deck surfaces persistent bridge errors via
 * the logger.warn calls in fetchBridge.
 */

import { logger as rootLogger } from "@/lib/logger";
import {
  startOfDayET,
  startOfWeekET,
  startOfMonthET,
  startOfYearET,
} from "@/lib/utils/datetime";

const log = rootLogger.withSurface("services/business-intel");

function startOf(unit: "day" | "week" | "month" | "year"): Date {
  // ET-correct boundaries — the prior setHours(0,0,0,0) floored to
  // midnight in the SERVER zone (UTC). See lib/utils/datetime.ts.
  if (unit === "week") return startOfWeekET();
  if (unit === "month") return startOfMonthET();
  if (unit === "year") return startOfYearET();
  return startOfDayET();
}

/**
 * Bridge helper. Returns null on any failure (network, 4xx/5xx,
 * missing query type) so callers can degrade gracefully without
 * shipping zeros that look like real data.
 */
async function fetchBridge<T = unknown>(
  query: string,
  filters: Record<string, unknown> = {},
): Promise<T | null> {
  try {
    const { queryNick } = await import("@/lib/nickstire/query");
    const res = await queryNick<T>(query, filters);
    if ("error" in res) {
      log.warn("bridge_query_failed", { query, error: res.error });
      return null;
    }
    return res.data;
  } catch (err) {
    log.warn("bridge_query_threw", {
      query,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

interface BridgeRevenuePayload {
  totalDollars?: number;
  jobs?: Array<{ totalRevenue?: number; jobDate?: string | Date; serviceCategory?: string }>;
  jobCount?: number;
  byDay?: Record<string, number>;
}

export async function getRevenueStats(period: "day" | "week" | "month" | "year" = "month") {
  const since = startOf(period);

  // Pick the cheapest bridge query that gives us this window.
  // - day: revenue_today (single-day rollup, includes byDay implicit)
  // - week/month/year: revenue_range with explicit from/to · v10.0.331
  //   collapsed week-specific path · revenue_week was never in the
  //   contract (NICKSTIRE-QUERY-CONTRACT.md), nickstire returned
  //   "Unknown query" every call.
  const today = new Date();
  const fromIso = since.toISOString().slice(0, 10); // YYYY-MM-DD
  const toIso = today.toISOString().slice(0, 10);
  const data: BridgeRevenuePayload | null =
    period === "day"
      ? await fetchBridge<BridgeRevenuePayload>("revenue_today")
      : await fetchBridge<BridgeRevenuePayload>("revenue_range", {
          from: fromIso,
          to: toIso,
        });

  // Rebuild the same response shape the API + Nick tool expect.
  // Bridge can return `totalDollars` (rolled up) or a `jobs` list
  // (richer payload). Compute both consistently regardless of shape.
  const jobs = Array.isArray(data?.jobs) ? data!.jobs! : [];
  const total =
    typeof data?.totalDollars === "number"
      ? data.totalDollars
      : jobs.reduce((s, j) => s + Number(j.totalRevenue ?? 0), 0);
  const jobCount =
    typeof data?.jobCount === "number" ? data.jobCount : jobs.length;
  const avgTicket = jobCount > 0 ? total / jobCount : 0;

  // byDay: prefer the bridge's pre-bucketed map; otherwise derive from jobs.
  let byDay: Record<string, number> = {};
  if (data?.byDay && typeof data.byDay === "object") {
    byDay = data.byDay;
  } else {
    for (const job of jobs) {
      if (!job.jobDate) continue;
      const day = new Date(job.jobDate).toISOString().slice(0, 10);
      byDay[day] = (byDay[day] || 0) + Number(job.totalRevenue ?? 0);
    }
  }

  return {
    period,
    since: since.toISOString(),
    totalRevenue: total.toFixed(2),
    jobCount,
    avgTicket: avgTicket.toFixed(2),
    byDay,
    // v10.0.51 — bridge availability flag so consumers can render a
    // "shop bridge offline" notice instead of pretending it's a real
    // zero day. UI consumers (analytics page) should check this.
    bridgeAvailable: data != null,
  };
}

export async function getTopServices(limit = 10) {
  // Bridge query `revenue_top_services` returns pre-aggregated
  // service totals — much cheaper than streaming raw jobs. If the
  // bridge doesn't expose it yet, gracefully return empty so the
  // Nick `getTopServices` tool returns "[] (bridge unavailable)"
  // rather than fabricating data.
  const data = await fetchBridge<{
    services?: Array<{ service: string; count: number; revenue: number }>;
  }>("revenue_top_services", { limit });

  const services = data?.services ?? [];
  return services
    .map((s) => ({
      service: s.service,
      count: s.count,
      revenue: s.revenue,
      revenueFormatted: Number(s.revenue ?? 0).toFixed(2),
    }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}

export async function getCustomerStats() {
  // `customer_stats` bridge query returns the rollup the dashboard
  // displays: total / new-this-month / with-phone / returning, plus
  // a top-customers list. Graceful empty when bridge is unavailable.
  const data = await fetchBridge<{
    total?: number;
    newThisMonth?: number;
    withPhone?: number;
    returning?: number;
    topCustomers?: Array<{
      id: string;
      fullName: string;
      phone: string | null;
      visitCount: number;
      totalSpend: number | string;
    }>;
  }>("customer_stats");

  const total = Number(data?.total ?? 0);
  const newThisMonth = Number(data?.newThisMonth ?? 0);
  const withPhone = Number(data?.withPhone ?? 0);
  const returning = Number(data?.returning ?? 0);
  const topCustomers = data?.topCustomers ?? [];

  return {
    total,
    newThisMonth,
    withPhone,
    returning,
    topCustomers: topCustomers.map((c) => ({
      id: c.id,
      name: c.fullName,
      phone: c.phone,
      visitCount: c.visitCount,
      lifetimeValue: Number(c.totalSpend).toFixed(2),
    })),
    bridgeAvailable: data != null,
  };
}

export async function getDashboardSummary() {
  // Note: each sub-query has its own bridge fallback, so the dashboard
  // will degrade per-card rather than failing the whole route.
  const [revenue, customers, reviewStats, todayJobsData] = await Promise.all([
    getRevenueStats("month"),
    getCustomerStats(),
    import("@/lib/integrations/google-reviews").then((m) => m.getReviewStats()),
    fetchBridge<{ count?: number }>("jobs_today"),
  ]);

  const todayJobs = Number(todayJobsData?.count ?? 0);

  return {
    revenue,
    customers: { total: customers.total, newThisMonth: customers.newThisMonth },
    reviews: {
      average: reviewStats.average,
      total: reviewStats.total,
      unresponded: reviewStats.unresponded,
    },
    jobs: { today: todayJobs },
    // Surface bridge health so the dashboard can show a "shop offline"
    // banner if both shop-side reads failed.
    bridgeHealth: {
      revenue: revenue.bridgeAvailable,
      customers: customers.bridgeAvailable,
      jobsToday: todayJobsData != null,
    },
  };
}
