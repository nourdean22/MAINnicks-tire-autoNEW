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
 *   · getRevenueStats(period)   → revenue_today / revenue_range
 *                                  (week, month + year)
 *   · getCustomerStats()        → customer_stats bridge query
 *                                  (bridgeAvailable: false when it
 *                                   cannot be read)
 *   · getDashboardSummary()     → fans out to the above + reviews
 *
 * 2026-10-08: nickstire never had a `revenue_top_services` or a
 * `customer_stats` handler, so both reads failed on every call since they
 * were wired (found when the bridge contract guard learned multi-line
 * calls). `customer_stats` is now a nickstire handler returning exactly the
 * two counts read here. `getTopServices` and its Nick tool are RETIRED:
 * invoice service descriptions have mostly stopped arriving (1 of 30 in
 * Aug 2026), so a ranking would describe a sliver of the tickets.
 *
 * Same day: revenue reads parsed `jobCount`, which no handler sends
 * (they send `invoiceCount`), so every revenue payload said 0 jobs and a
 * $0.00 average ticket beside a real total. And a handler that answers 200
 * with `{ error }` (e.g. "No DB") was read as data: zeros with
 * `bridgeAvailable: true`. Both fixed below.
 *
 * Design contract: a failed bridge read is marked, never passed off as
 * data: every function carries its zero defaults beside
 * `bridgeAvailable` / `bridgeHealth`, which every AI consumer must redact
 * first (lib/ai/tools/bridge-honesty.ts). The /system/errors deck
 * surfaces persistent bridge errors via the logger.warn calls in
 * fetchBridge.
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
 * missing query type, a handler's own error body) so callers can degrade
 * gracefully without shipping zeros that look like real data.
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
    // A handler that could not do its job often still answers 200, with the
    // failure in the body: `{ error: "No DB" }` from every revenue handler.
    // That is a failed read, not a payload of zeros.
    const body = res.data as unknown;
    if (body && typeof body === "object" && (body as { error?: unknown }).error) {
      log.warn("bridge_query_failed", { query, error: String((body as { error: unknown }).error) });
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
  /** What nickstire's revenue_today / revenue_range actually send. */
  invoiceCount?: number;
  /** Legacy name; no live handler sends it. Kept so an older payload still parses. */
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
  // `invoiceCount` is the field the handlers send. Reading only `jobCount`
  // (which none of them send) reported 0 jobs and a $0.00 average ticket
  // beside every real revenue total (fixed 2026-10-08).
  const jobCount =
    typeof data?.invoiceCount === "number"
      ? data.invoiceCount
      : typeof data?.jobCount === "number"
        ? data.jobCount
        : jobs.length;
  // revenue_range also sends `avgTicket` (AVG(totalAmount)); invoices.totalAmount is
  // NOT NULL, so it always equals this, and revenue_today sends none. Derive it once.
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

export async function getCustomerStats() {
  // nickstire `customer_stats` (apps/nickstire/server/services/customerStatsRead.ts):
  // customers on file, and first visits in the current shop month. It sends
  // nothing else on purpose: the old type here also asked for withPhone /
  // returning / a topCustomers list with names and phones, and no consumer
  // ever read them. A database it cannot read answers 500, so a dead shop
  // reads as bridgeAvailable: false, never as an empty one.
  const data = await fetchBridge<{
    total?: number;
    newThisMonth?: number;
    monthStart?: string;
  }>("customer_stats");

  // A payload whose counts are missing or not numbers is not a reading either:
  // absent must never default to a zero that then reports as available.
  const total = data?.total;
  const newThisMonth = data?.newThisMonth;
  const readable =
    typeof total === "number" &&
    Number.isFinite(total) &&
    typeof newThisMonth === "number" &&
    Number.isFinite(newThisMonth);

  return {
    total: readable ? total : 0,
    newThisMonth: readable ? newThisMonth : 0,
    bridgeAvailable: readable,
  };
}

export async function getDashboardSummary() {
  // Note: each sub-query has its own bridge fallback, so the dashboard
  // will degrade per-card rather than failing the whole route.
  const [revenue, customers, reviewStats, todayJobsData] = await Promise.all([
    getRevenueStats("month"),
    getCustomerStats(),
    import("@/lib/integrations/google-reviews").then((m) => m.getReviewStats()),
    // 2026-05-30 · "jobs_today" was a dead bridge query (never in nickstire's
    // registry) → always null → dashboard showed 0 jobs. revenue_today is the
    // live query; its invoiceCount = jobs booked today.
    fetchBridge<{ invoiceCount?: number }>("revenue_today"),
  ]);

  const todayJobs = Number(todayJobsData?.invoiceCount ?? 0);

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
