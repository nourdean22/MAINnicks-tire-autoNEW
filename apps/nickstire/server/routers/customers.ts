/**
 * Customers router — admin endpoints for viewing/searching imported customer records.
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, like, or, sql, desc, asc } from "drizzle-orm";
import { customers, customerMetrics, bookings, leads, callbackRequests, callEvents, invoices, workOrders, algEstimates } from "../../drizzle/schema";
import { logAdminAction } from "../services/auditTrail";
import { predictCustomerLTV, generateCrossSellRecommendations, forecastRevenue } from "../services/intelligenceEngines";
import { csvSafe } from "../sanitize";

import { db } from "../lib/db-helper";

import { createLogger } from "../lib/logger";

const log = createLogger("routers:customers");
export const customersRouter = router({
  /** List customers with pagination, search, segment, date range filtering */
  list: adminProcedure
    .input(
      z.object({
        page: z.number().default(1),
        pageSize: z.number().default(25),
        search: z.string().max(200).optional(),
        segment: z.enum(["all", "recent", "lapsed", "new", "unknown"]).default("all"),
        sortBy: z.enum(["name", "visits", "lastVisit", "totalSpent", "firstVisit", "created", "declined", "backlog"]).default("lastVisit"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
        /** Filter by last visit within N days (int, 1..3650 = 10y cap) */
        lastVisitDays: z.number().int().min(1).max(3650).optional(),
        /** Filter by minimum total spent (cents) */
        minSpent: z.number().optional(),
        /** Filter by minimum visit count */
        minVisits: z.number().optional(),
        /** Filter customers with vehicles */
        hasVehicle: z.boolean().optional(),
        /** Filter to only customers with a non-empty email on file */
        hasEmail: z.boolean().optional(),
        /** Filter by customer type (e.g. "commercial" for fleet/business accounts) */
        customerType: z.enum(["individual", "commercial"]).optional(),
        /** Filter to only customers with unmatched ALG estimates (declined work) */
        hasDeclined: z.boolean().optional(),
        /** Filter to only customers with active (non-completed) work orders */
        hasBacklog: z.boolean().optional(),
      }).optional()
    )
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { customers: [], total: 0, page: 1, pageSize: 25 };

      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 25;
      const offset = (page - 1) * pageSize;
      const search = input?.search?.trim();
      const segment = input?.segment ?? "all";
      const sortBy = input?.sortBy ?? "lastVisit";
      const sortDir = input?.sortDir ?? "desc";

      // Build conditions
      const conditions = [];
      if (segment !== "all") {
        conditions.push(eq(customers.segment, segment as "recent" | "lapsed" | "new" | "unknown"));
      }
      if (input?.lastVisitDays && Number.isInteger(input.lastVisitDays) && input.lastVisitDays >= 1) {
        // wave-168: belt + suspenders. Zod already enforces .int().min(1).max(3650)
        // but sql.raw() interpolation deserves a second runtime guard — same
        // pattern as crudAutomation.ts line 66-68.
        conditions.push(sql`${customers.lastVisitDate} >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(input.lastVisitDays))} DAY)`);
      }
      if (input?.minSpent) {
        conditions.push(sql`${customers.totalSpent} >= ${input.minSpent}`);
      }
      if (input?.minVisits) {
        conditions.push(sql`${customers.totalVisits} >= ${input.minVisits}`);
      }
      if (input?.hasVehicle) {
        conditions.push(sql`${customers.vehicleMake} IS NOT NULL AND ${customers.vehicleMake} != ''`);
      }
      if (input?.hasEmail) {
        // Mirrors the `withEmail` stat (non-empty email on file)
        conditions.push(sql`${customers.email} IS NOT NULL AND ${customers.email} != ''`);
      }
      if (input?.customerType) {
        conditions.push(eq(customers.customerType, input.customerType));
      }
      if (input?.hasDeclined) {
        // Wave-100: was EXISTS subquery, now reads materialized column
        conditions.push(sql`EXISTS (
          SELECT 1 FROM customer_metrics m
          WHERE m.customerId = ${customers.id} AND m.declinedValue > 0
        )`);
      }
      if (input?.hasBacklog) {
        conditions.push(sql`EXISTS (
          SELECT 1 FROM customer_metrics m
          WHERE m.customerId = ${customers.id} AND m.backlogValueCents > 0
        )`);
      }
      if (search) {
        // Escape LIKE wildcards to prevent pattern injection (% and _ are SQL LIKE wildcards)
        const escaped = search.replace(/[%_\\]/g, ch => `\\${ch}`);
        conditions.push(
          or(
            like(customers.firstName, `%${escaped}%`),
            like(customers.lastName, `%${escaped}%`),
            like(customers.phone, `%${escaped}%`),
            like(customers.email, `%${escaped}%`),
            like(customers.city, `%${escaped}%`),
            // Vehicle search: match against booking vehicle fields linked by phone
            sql`EXISTS (SELECT 1 FROM bookings WHERE bookings.phone = ${customers.phone} AND (
              bookings.vehicle LIKE ${'%' + escaped + '%'}
              OR bookings.vehicleMake LIKE ${'%' + escaped + '%'}
              OR bookings.vehicleModel LIKE ${'%' + escaped + '%'}
              OR bookings.service LIKE ${'%' + escaped + '%'}
            ))`,
          )
        );
      }

      const whereClause = conditions.length > 0
        ? sql`${conditions.reduce((acc, c, i) => i === 0 ? c : sql`${acc} AND ${c}`)}`
        : undefined;

      // Get total count
      const countQuery = d.select({ count: sql<number>`count(*)` }).from(customers);
      if (whereClause) countQuery.where(whereClause);
      const [countResult] = await countQuery;

      // Get page of results with metrics join
      const sortFn = sortDir === "asc" ? asc : desc;

      const dataQuery = d
        .select({
          id: customers.id,
          firstName: customers.firstName,
          lastName: customers.lastName,
          phone: customers.phone,
          phone2: customers.phone2,
          email: customers.email,
          address: customers.address,
          city: customers.city,
          state: customers.state,
          zip: customers.zip,
          customerType: customers.customerType,
          totalVisits: customers.totalVisits,
          totalSpent: customers.totalSpent,
          lastVisitDate: customers.lastVisitDate,
          firstVisitDate: customers.firstVisitDate,
          balanceDue: customers.balanceDue,
          vehicleYear: customers.vehicleYear,
          vehicleMake: customers.vehicleMake,
          vehicleModel: customers.vehicleModel,
          alsCustomerId: customers.alsCustomerId,
          segment: customers.segment,
          smsCampaignSent: customers.smsCampaignSent,
          smsCampaignDate: customers.smsCampaignDate,
          notes: customers.notes,
          smsOptOut: customers.smsOptOut,
          createdAt: customers.createdAt,
          updatedAt: customers.updatedAt,
          // Metrics fields.
          // NOTE: totalRevenue + avgSpendPerVisit dropped here — both are
          // seeded 0 on INSERT and never written by any refresher, so they
          // were shipped to the UI as a constant 0 (false data). No client
          // reads them off a list row (verified). daysSinceLastVisit is also
          // never written, but the customer card + Customer360 panel still
          // reference c.daysSinceLastVisit with a `?? lastVisitDate` fallback,
          // so it stays until those readers are removed.
          daysSinceLastVisit: customerMetrics.daysSinceLastVisit,
          churnRisk: customerMetrics.churnRisk,
          isVip: customerMetrics.isVip,
          // Wave-100: materialized aggregates from customer_metrics.
          // Replaces 4 correlated subqueries per row (was 100 subqueries
          // per page load) with a single LEFT JOIN. Refreshed by the
          // customerMetricsRefresh service on a cron schedule.
          declinedValue: customerMetrics.declinedValue,
          declinedCount: customerMetrics.declinedCount,
          backlogValueCents: customerMetrics.backlogValueCents,
          backlogCount: customerMetrics.backlogCount,
        })
        .from(customers)
        .leftJoin(customerMetrics, eq(customers.id, customerMetrics.customerId));

      if (whereClause) dataQuery.where(whereClause);

      // Wave-100: sortable by materialized aggregates via direct
      // column reference (was raw SQL alias before).
      const sortColumn = sortBy === "name" ? customers.firstName
        : sortBy === "visits" ? customers.totalVisits
        : sortBy === "totalSpent" ? customers.totalSpent
        : sortBy === "firstVisit" ? customers.firstVisitDate
        : sortBy === "created" ? customers.createdAt
        : sortBy === "declined" ? customerMetrics.declinedValue
        : sortBy === "backlog" ? customerMetrics.backlogValueCents
        : customers.lastVisitDate;
      const results = await dataQuery
        .orderBy(sortFn(sortColumn))
        .limit(pageSize)
        .offset(offset);

      return {
        customers: results,
        total: countResult?.count ?? 0,
        page,
        pageSize,
      };
    }),

  /** Get segment summary stats + revenue overview */
  stats: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { total: 0, recent: 0, lapsed: 0, unknown: 0, withEmail: 0, commercial: 0, totalRevenue: 0, avgSpend: 0, withVisits: 0, vipCount: 0 };

    const [total] = await d.select({ count: sql<number>`count(*)` }).from(customers);
    const [recent] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.segment, "recent"));
    const [lapsed] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.segment, "lapsed"));
    const [unknown] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.segment, "unknown"));
    const [withEmail] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(sql`${customers.email} IS NOT NULL AND ${customers.email} != ''`);
    const [commercial] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.customerType, "commercial"));
    const [revenue] = await d.select({
      totalRevenue: sql<number>`COALESCE(SUM(totalSpent), 0)`,
      avgSpend: sql<number>`COALESCE(AVG(NULLIF(totalSpent, 0)), 0)`,
      withVisits: sql<number>`SUM(CASE WHEN totalVisits > 0 THEN 1 ELSE 0 END)`,
      vipCount: sql<number>`SUM(CASE WHEN totalVisits >= 3 THEN 1 ELSE 0 END)`,
    }).from(customers);

    return {
      total: total?.count ?? 0,
      recent: recent?.count ?? 0,
      lapsed: lapsed?.count ?? 0,
      unknown: unknown?.count ?? 0,
      withEmail: withEmail?.count ?? 0,
      commercial: commercial?.count ?? 0,
      totalRevenue: revenue?.totalRevenue ?? 0,
      avgSpend: revenue?.avgSpend ?? 0,
      withVisits: revenue?.withVisits ?? 0,
      vipCount: revenue?.vipCount ?? 0,
    };
  }),

  /** Advanced stats — revenue by time period, top spenders, service breakdown */
  advancedStats: adminProcedure
    .input(z.object({
      period: z.enum(["7d", "30d", "90d", "6mo", "1yr", "all"]).default("all"),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return null;

      const period = input?.period ?? "all";
      const dateFilter = period === "all" ? sql`1=1`
        : period === "7d" ? sql`i.invoiceDate >= DATE_SUB(NOW(), INTERVAL 7 DAY)`
        : period === "30d" ? sql`i.invoiceDate >= DATE_SUB(NOW(), INTERVAL 30 DAY)`
        : period === "90d" ? sql`i.invoiceDate >= DATE_SUB(NOW(), INTERVAL 90 DAY)`
        : period === "6mo" ? sql`i.invoiceDate >= DATE_SUB(NOW(), INTERVAL 6 MONTH)`
        : sql`i.invoiceDate >= DATE_SUB(NOW(), INTERVAL 1 YEAR)`;

      // Revenue by period.
      // wave-182 (architecture decision #3): "revenue" is canonically PAID-only
      // (collected = the only operationally honest figure). Every revenue query
      // in this panel filters `paymentStatus = 'paid'` so the headline total,
      // top spenders, monthly trend, and breakdowns are mutually consistent and
      // never inflated by pending / partial / refunded invoices.
      const [revenueSummary] = await d.execute(sql`
        SELECT
          COUNT(*) as invoiceCount,
          COALESCE(SUM(i.totalAmount), 0) as totalRevenue,
          COALESCE(AVG(i.totalAmount), 0) as avgTicket,
          COALESCE(SUM(i.laborCost), 0) as totalLabor,
          COALESCE(SUM(i.partsCost), 0) as totalParts,
          COUNT(DISTINCT i.customerPhone) as uniqueCustomers
        FROM invoices i
        WHERE ${dateFilter} AND i.paymentStatus = 'paid'
      `);

      // Top 10 spenders for the period
      const [topSpenders] = await d.execute(sql`
        SELECT
          c.id, c.firstName, c.lastName, c.phone, c.segment,
          c.totalVisits, c.totalSpent,
          c.vehicleYear, c.vehicleMake, c.vehicleModel,
          COUNT(i.id) as periodVisits,
          COALESCE(SUM(i.totalAmount), 0) as periodSpent
        FROM customers c
        INNER JOIN invoices i ON RIGHT(REPLACE(REPLACE(REPLACE(c.phone, '-', ''), '(', ''), ')', ''), 10) =
          RIGHT(REPLACE(REPLACE(REPLACE(i.customerPhone, '-', ''), '(', ''), ')', ''), 10)
        WHERE ${dateFilter} AND i.paymentStatus = 'paid'
        GROUP BY c.id
        ORDER BY periodSpent DESC
        LIMIT 10
      `);

      // Monthly revenue trend (last 12 months)
      const [monthlyTrend] = await d.execute(sql`
        SELECT
          DATE_FORMAT(invoiceDate, '%Y-%m') as month,
          COUNT(*) as invoices,
          COALESCE(SUM(totalAmount), 0) as revenue,
          COUNT(DISTINCT customerPhone) as customers
        FROM invoices
        WHERE invoiceDate >= DATE_SUB(NOW(), INTERVAL 12 MONTH) AND paymentStatus = 'paid'
        GROUP BY DATE_FORMAT(invoiceDate, '%Y-%m')
        ORDER BY month ASC
      `);

      // Service type breakdown
      const [serviceBreakdown] = await d.execute(sql`
        SELECT
          COALESCE(SUBSTRING_INDEX(serviceDescription, ',', 1), 'Unknown') as service,
          COUNT(*) as count,
          COALESCE(SUM(totalAmount), 0) as revenue
        FROM invoices i
        WHERE ${dateFilter} AND i.paymentStatus = 'paid' AND serviceDescription IS NOT NULL AND serviceDescription != ''
        GROUP BY SUBSTRING_INDEX(serviceDescription, ',', 1)
        ORDER BY revenue DESC
        LIMIT 15
      `);

      // Payment method breakdown
      const [paymentBreakdown] = await d.execute(sql`
        SELECT paymentMethod, COUNT(*) as count, COALESCE(SUM(totalAmount), 0) as total
        FROM invoices i
        WHERE ${dateFilter} AND i.paymentStatus = 'paid'
        GROUP BY paymentMethod
        ORDER BY total DESC
      `);

      type RawRow = Record<string, unknown>;
      const summary = ((revenueSummary as RawRow[])?.[0] || {}) as RawRow;
      return {
        period,
        invoiceCount: Number(summary.invoiceCount) || 0,
        totalRevenue: Number(summary.totalRevenue) || 0,
        avgTicket: Number(summary.avgTicket) || 0,
        totalLabor: Number(summary.totalLabor) || 0,
        totalParts: Number(summary.totalParts) || 0,
        uniqueCustomers: Number(summary.uniqueCustomers) || 0,
        topSpenders: (topSpenders as RawRow[]) || [],
        monthlyTrend: (monthlyTrend as RawRow[]) || [],
        serviceBreakdown: (serviceBreakdown as RawRow[]) || [],
        paymentBreakdown: (paymentBreakdown as RawRow[]) || [],
      };
    }),

  /** Customer Intelligence — spend tiers, churn risk, actionable recommendations */
  intelligence: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return null;

    // Spend tiers
    const [tierRows] = await d.execute(sql`
      SELECT
        SUM(CASE WHEN totalSpent >= 200000 THEN 1 ELSE 0 END) as whales,
        SUM(CASE WHEN totalSpent >= 50000 AND totalSpent < 200000 THEN 1 ELSE 0 END) as regulars,
        SUM(CASE WHEN totalSpent > 0 AND totalSpent < 50000 THEN 1 ELSE 0 END) as oneTimers,
        SUM(CASE WHEN totalSpent = 0 THEN 1 ELSE 0 END) as neverPaid,
        COUNT(*) as total,
        SUM(totalSpent) as totalRevenue,
        AVG(CASE WHEN totalSpent > 0 THEN totalSpent ELSE NULL END) as avgSpend
      FROM customers
    `);

    // Churn risk — customers who visited 60-180 days ago but not since
    const [churnRows] = await d.execute(sql`
      SELECT COUNT(*) as atRisk FROM customers
      WHERE lastVisitDate BETWEEN DATE_SUB(NOW(), INTERVAL 180 DAY) AND DATE_SUB(NOW(), INTERVAL 60 DAY)
        AND totalSpent > 0
    `);

    // Win-back targets — 90+ day dormant with spend history
    const [winbackRows] = await d.execute(sql`
      SELECT COUNT(*) as targets,
        SUM(totalSpent) as potentialRevenue,
        AVG(totalSpent) as avgValue
      FROM customers
      WHERE lastVisitDate < DATE_SUB(NOW(), INTERVAL 90 DAY) AND totalSpent > 10000
    `);

    // Top 5 at-risk whales (high-value customers going quiet)
    // wave-115 — added `id` so the admin can open the customer drawer
    // directly (previously the homepage card navigated to the full
    // customers list and made the operator search for the whale by name).
    const [atRiskWhales] = await d.execute(sql`
      SELECT id, firstName, lastName, phone, totalSpent, totalVisits, lastVisitDate,
        DATEDIFF(NOW(), lastVisitDate) as daysSince
      FROM customers
      WHERE lastVisitDate < DATE_SUB(NOW(), INTERVAL 60 DAY)
        AND totalSpent >= 100000
      ORDER BY totalSpent DESC LIMIT 5
    `);

    // Segment counts
    const [segRows] = await d.execute(sql`
      SELECT segment, COUNT(*) as cnt, SUM(totalSpent) as rev
      FROM customers GROUP BY segment
    `);

    // New customers this month
    const [newThisMonth] = await d.execute(sql`
      SELECT COUNT(*) as cnt FROM customers
      WHERE createdAt >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
    `);

    type RawRow = Record<string, unknown>;
    const tiers = ((tierRows as RawRow[])?.[0] || {}) as RawRow;
    const churn = ((churnRows as RawRow[])?.[0] || {}) as RawRow;
    const winback = ((winbackRows as RawRow[])?.[0] || {}) as RawRow;

    // Generate recommendations
    const recommendations: string[] = [];
    if (Number(winback.targets) > 10)
      recommendations.push(`${winback.targets} customers haven't visited in 90+ days — send win-back SMS campaign (~$${Math.round(Number(winback.avgValue) / 100)} avg value each)`);
    if (Number(churn.atRisk) > 5)
      recommendations.push(`${churn.atRisk} customers at churn risk (60-180 days quiet) — proactive outreach before they leave`);
    if ((atRiskWhales as RawRow[])?.length > 0)
      recommendations.push(`${(atRiskWhales as RawRow[]).length} high-value customers going quiet — personal call recommended: ${(atRiskWhales as RawRow[]).map((w: RawRow) => `${w.firstName} ${w.lastName} ($${Math.round(Number(w.totalSpent)/100)})`).join(', ')}`);
    if (Number(tiers.neverPaid) > 500)
      recommendations.push(`${tiers.neverPaid} customers have $0 spend — likely imported contacts without invoice history`);

    return {
      spendTiers: {
        whales: { count: Number(tiers.whales) || 0, label: "Whales ($2K+)", color: "#F5A623" },
        regulars: { count: Number(tiers.regulars) || 0, label: "Regulars ($500-$2K)", color: "#3B82F6" },
        oneTimers: { count: Number(tiers.oneTimers) || 0, label: "One-Timers (<$500)", color: "#10B981" },
        neverPaid: { count: Number(tiers.neverPaid) || 0, label: "No Spend History", color: "#6B7280" },
      },
      churnRisk: {
        atRisk: Number(churn.atRisk) || 0,
        winbackTargets: Number(winback.targets) || 0,
        winbackPotential: Math.round(Number(winback.potentialRevenue || 0) / 100),
      },
      atRiskWhales: (atRiskWhales as RawRow[])?.map((w: RawRow) => ({
        id: Number(w.id),
        name: `${w.firstName} ${w.lastName}`,
        phone: w.phone,
        totalSpent: Math.round(Number(w.totalSpent) / 100),
        visits: w.totalVisits,
        daysSince: w.daysSince,
      })) || [],
      segments: (segRows as RawRow[])?.map((s: RawRow) => ({
        segment: s.segment,
        count: Number(s.cnt),
        revenue: Math.round(Number(s.rev || 0) / 100),
      })) || [],
      newThisMonth: Number((newThisMonth as RawRow[])?.[0]?.cnt) || 0,
      avgCustomerValue: Math.round(Number(tiers.avgSpend || 0) / 100),
      totalRevenue: Math.round(Number(tiers.totalRevenue || 0) / 100),
      recommendations,
    };
  }),

  /** Trigger a full customer data enrichment now */
  enrich: adminProcedure.mutation(async () => {
    const { enrichCustomerData } = await import("../services/dataPipelines");
    const { syncVisitDatesFromInvoices } = await import("../services/dataPipelines");
    const visitResult = await syncVisitDatesFromInvoices();
    const enrichResult = await enrichCustomerData();
    return {
      visits: visitResult,
      enrichment: enrichResult,
    };
  }),

  /** Get a single customer by ID */
  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return null;
      const [customer] = await d
        .select({
          id: customers.id,
          firstName: customers.firstName,
          lastName: customers.lastName,
          phone: customers.phone,
          phone2: customers.phone2,
          email: customers.email,
          address: customers.address,
          city: customers.city,
          state: customers.state,
          zip: customers.zip,
          customerType: customers.customerType,
          totalVisits: customers.totalVisits,
          totalSpent: customers.totalSpent,
          lastVisitDate: customers.lastVisitDate,
          firstVisitDate: customers.firstVisitDate,
          balanceDue: customers.balanceDue,
          vehicleYear: customers.vehicleYear,
          vehicleMake: customers.vehicleMake,
          vehicleModel: customers.vehicleModel,
          alsCustomerId: customers.alsCustomerId,
          segment: customers.segment,
          psychoProfile: customers.psychoProfile,
          psychoProfileScore: customers.psychoProfileScore,
          psychoProfileAt: customers.psychoProfileAt,
          smsCampaignSent: customers.smsCampaignSent,
          smsCampaignDate: customers.smsCampaignDate,
          notes: customers.notes,
          smsOptOut: customers.smsOptOut,
          lastRetentionTier: customers.lastRetentionTier,
          lastRetentionDate: customers.lastRetentionDate,
          createdAt: customers.createdAt,
          updatedAt: customers.updatedAt,
          daysSinceLastVisit: customerMetrics.daysSinceLastVisit,
          churnRisk: customerMetrics.churnRisk,
          isVip: customerMetrics.isVip,
          declinedValue: customerMetrics.declinedValue,
          declinedCount: customerMetrics.declinedCount,
          backlogValueCents: customerMetrics.backlogValueCents,
          backlogCount: customerMetrics.backlogCount,
        })
        .from(customers)
        .leftJoin(customerMetrics, eq(customers.id, customerMetrics.customerId))
        .where(eq(customers.id, input.id));
      return customer ?? null;
    }),

  /** Campaign stats — how many texted vs not */
  campaignStats: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { total: 0, sent: 0, remaining: 0, eligible: 0 };

    const [total] = await d.select({ count: sql<number>`count(*)` }).from(customers);
    const [sent] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(sql`${customers.smsCampaignSent} = 1`);
    const totalCount = total?.count ?? 0;
    const sentCount = sent?.count ?? 0;

    // Eligible = last visit 6-8 days ago AND not yet texted
    const [eligible] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(
      sql`${customers.smsCampaignSent} = 0 AND ${customers.lastVisitDate} IS NOT NULL AND DATEDIFF(CURDATE(), ${customers.lastVisitDate}) BETWEEN 6 AND 8`
    );

    return {
      total: totalCount,
      sent: sentCount,
      remaining: totalCount - sentCount,
      eligible: eligible?.count ?? 0,
    };
  }),

  /** Recent follow-ups — last 50 customers who were texted */
  recentFollowUps: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];

    const results = await d.select({
      id: customers.id,
      firstName: customers.firstName,
      lastName: customers.lastName,
      phone: customers.phone,
      segment: customers.segment,
      lastVisitDate: customers.lastVisitDate,
      smsCampaignDate: customers.smsCampaignDate,
    })
      .from(customers)
      .where(sql`${customers.smsCampaignSent} = 1`)
      .orderBy(desc(customers.smsCampaignDate))
      .limit(50);

    return results;
  }),

  /** Export customers as CSV data */
  exportCsv: adminProcedure
    .input(z.object({
      segment: z.enum(["all", "recent", "lapsed", "new", "unknown"]).default("all"),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { csv: "" };

      const segment = input?.segment ?? "all";
      // wave-165: hard cap to 10000 rows. Before this, segment="all" returned
      // every customer row + PII (phone/email/address) with no LIMIT — at
      // 10k+ customers this would OOM the dyno or time out on Railway.
      // Truncation is surfaced in the response so the UI can flag it.
      const EXPORT_CAP = 10000;
      const query = d.select().from(customers);
      if (segment !== "all") {
        query.where(eq(customers.segment, segment));
      }
      const results = await query.orderBy(desc(customers.lastVisitDate)).limit(EXPORT_CAP + 1);
      const truncated = results.length > EXPORT_CAP;
      if (truncated) results.length = EXPORT_CAP;

      // Build CSV (csvSafe imported from ../sanitize)
      const headers = ["First Name", "Last Name", "Phone", "Email", "City", "State", "Segment", "Total Visits", "Last Visit", "Customer Type"];
      const rows = results.map((c: typeof results[number]) => [
        csvSafe(c.firstName || ""),
        csvSafe(c.lastName || ""),
        csvSafe(c.phone || ""),
        csvSafe(c.email || ""),
        csvSafe(c.city || ""),
        csvSafe(c.state || ""),
        c.segment || "",
        String(c.totalVisits ?? 0),
        c.lastVisitDate ? new Date(c.lastVisitDate).toLocaleDateString() : "",
        c.customerType || "",
      ]);

      const csv = [headers.join(","), ...rows.map((r: string[]) => r.map((v: string) => `"${v.replace(/"/g, '""')}"`).join(","))].join("\n");
      return { csv, count: results.length, truncated };
    }),

  /** Quick send SMS to a customer */
  quickSms: adminProcedure
    .input(z.object({
      customerId: z.number(),
      message: z.string().min(1).max(500),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false, error: "DB not available" };

      const [customer] = await d.select().from(customers).where(eq(customers.id, input.customerId));
      if (!customer) return { success: false, error: "Customer not found" };

      const { sendSms } = await import("../sms");
      // Wave-108: admin → customer messages via shop gateway (Twilio fallback).
      const result = await sendSms(customer.phone, input.message, { via: "shop" });

      // Audit trail — log SMS sends for Nick AI learning
      if (result.success) {
        logAdminAction({
          action: "customer.sms_sent",
          entityType: "customer",
          entityId: input.customerId,
          details: `SMS sent to ${customer.firstName || ""} ${customer.lastName || ""}`.trim(),
          newValue: input.message,
          metadata: { phone: customer.phone },
        }).catch((e) => { log.warn("[routers/customers] fire-and-forget failed:", e); });
      }

      return result;
    }),

  /** Update customer notes */
  updateNotes: adminProcedure
    .input(z.object({
      id: z.number(),
      notes: z.string().max(5000),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };
      await d.update(customers).set({ notes: input.notes }).where(eq(customers.id, input.id));

      // Audit trail — log notes updates for Nick AI learning
      logAdminAction({
        action: "customer.notes_updated",
        entityType: "customer",
        entityId: input.id,
        details: "Customer notes updated",
        newValue: input.notes,
      }).catch((e) => { log.warn("[routers/customers] fire-and-forget failed:", e); });

      return { success: true };
    }),

  /** Bulk retry campaign — send to all untexted customers */
  retryCampaign: adminProcedure
    .input(z.object({
      batchSize: z.number().min(1).max(100).default(50),
    }).optional())
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { sent: 0, failed: 0, remaining: 0 };

      const batchSize = input?.batchSize ?? 50;
      const { sendSms } = await import("../sms");
      const { STORE_NAME, STORE_PHONE } = await import("@shared/const");

      // Short URLs save ~50 chars → drops from 3 segments to 2 (33% cost savings)
      const REVIEW_URL = "nickstire.org/review";
      const REFER_URL = "nickstire.org/refer";

      // Get untexted customers, prioritize recent → lapsed → unknown
      const untexted = await d.select()
        .from(customers)
        .where(sql`${customers.smsCampaignSent} = 0 AND ${customers.smsOptOut} = 0 AND ${customers.phone} IS NOT NULL AND LENGTH(${customers.phone}) >= 10 AND ${customers.phone} LIKE '+1%'`)
        .orderBy(sql`CASE ${customers.segment} WHEN 'recent' THEN 0 WHEN 'lapsed' THEN 1 ELSE 2 END, ${customers.lastVisitDate} DESC`)
        .limit(batchSize);

      let sent = 0;
      let failed = 0;

      for (const c of untexted) {
        const name = c.firstName || "there";
        // Optimized: 2 segments (~252 chars) instead of 3 (~383 chars)
        const msg = c.segment === "lapsed"
          ? `Hi ${name}, this is ${STORE_NAME}. Thank you for trusting us with your vehicle!\n\nA quick Google review means a lot to us:\n${REVIEW_URL}\n\nRefer a friend: ${REFER_URL}\nWe'd love to see you again. — Nick's Team ${STORE_PHONE}`
          : `Hi ${name}, thank you for choosing ${STORE_NAME}! We truly appreciate your business.\n\nGot 30 sec? A Google review helps other Cleveland drivers find honest repair:\n${REVIEW_URL}\n\nRefer a friend: ${REFER_URL}\n— Nick's Team ${STORE_PHONE}`;

        // Wave-108: review-request batch via shop gateway so customer
        // sees the same shop number on the request as on prior visits.
        const result = await sendSms(c.phone, msg, { via: "shop" });
        if (result.success) {
          sent++;
          await d.update(customers)
            .set({ smsCampaignSent: 1, smsCampaignDate: new Date() })
            .where(eq(customers.id, c.id));
        } else {
          failed++;
        }

        // 1 second delay between sends
        await new Promise(r => setTimeout(r, 1000));
      }

      // Get remaining count
      const [rem] = await d.select({ count: sql<number>`count(*)` })
        .from(customers)
        .where(sql`${customers.smsCampaignSent} = 0`);

      return { sent, failed, remaining: rem?.count ?? 0 };
    }),

  /** Update customer segment */
  updateSegment: adminProcedure
    .input(z.object({
      id: z.number(),
      segment: z.enum(["recent", "lapsed", "new", "unknown"]),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) return { success: false };
      await d.update(customers).set({ segment: input.segment }).where(eq(customers.id, input.id));
      return { success: true };
    }),

  /** Customer timeline — aggregated chronological history by phone */
  timeline: adminProcedure
    .input(z.object({ phone: z.string().max(20) }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];

      const phone = input.phone;
      // wave-125 — extended event types to include chat + vapi calls.
      // Operator now sees the FULL journey (chat → lead → booking →
      // invoice) for any customer in one timeline.
      const events: Array<{
        type: "booking" | "lead" | "callback" | "call" | "workOrder" | "invoice" | "chat" | "vapi_call";
        title: string;
        detail: string;
        status: string;
        date: Date;
        amount?: number;
      }> = [];

      try {
        // Bookings
        const bks = await d.select().from(bookings).where(eq(bookings.phone, phone)).orderBy(desc(bookings.createdAt)).limit(100);
        bks.forEach((b: typeof bks[number]) => events.push({
          type: "booking",
          title: `Booking: ${b.service || "General"}`,
          detail: b.vehicle || "",
          status: b.status || "new",
          date: new Date(b.createdAt),
        }));

        // Leads
        const lds = await d.select().from(leads).where(eq(leads.phone, phone)).orderBy(desc(leads.createdAt)).limit(100);
        lds.forEach((l: typeof lds[number]) => events.push({
          type: "lead",
          title: `Lead: ${l.source || "Direct"}`,
          detail: l.problem || l.vehicle || "",
          status: l.status || "new",
          date: new Date(l.createdAt),
        }));

        // Callbacks
        const cbs = await d.select().from(callbackRequests).where(eq(callbackRequests.phone, phone)).orderBy(desc(callbackRequests.createdAt)).limit(50);
        cbs.forEach((c: typeof cbs[number]) => events.push({
          type: "callback",
          title: "Callback Request",
          detail: c.context || "",
          status: c.status || "new",
          date: new Date(c.createdAt),
        }));

        // Call events
        const cls = await d.select().from(callEvents).where(eq(callEvents.phoneNumber, phone)).orderBy(desc(callEvents.createdAt)).limit(50);
        cls.forEach((c: typeof cls[number]) => events.push({
          type: "call",
          title: "Phone Call",
          detail: c.sourcePage || "",
          status: "completed",
          date: new Date(c.createdAt),
        }));

        // Invoices by phone
        const invs = await d.select().from(invoices).where(eq(invoices.customerPhone, phone)).orderBy(desc(invoices.invoiceDate)).limit(100);
        invs.forEach((inv: typeof invs[number]) => events.push({
          type: "invoice",
          title: `Invoice ${inv.invoiceNumber || `#${inv.id}`}`,
          detail: `${inv.serviceDescription || "Service"} · ${inv.vehicleInfo || ""}`.trim(),
          status: inv.paymentStatus || "paid",
          date: new Date(inv.invoiceDate),
          amount: inv.totalAmount, // cents
        }));

        // Work orders — match by customer phone (denormalized) or customer ID.
        const woResults = await d.select().from(workOrders)
          .where(sql`${workOrders.customerId} IN (
            SELECT CAST(id AS CHAR) FROM customers WHERE phone = ${phone}
          )`)
          .orderBy(desc(workOrders.createdAt))
          .limit(20);
        woResults.forEach((wo: typeof woResults[number]) => events.push({
          type: "workOrder",
          title: `WO ${wo.orderNumber}`,
          detail: `${wo.serviceDescription || wo.status?.replace(/_/g, " ") || "Service"}${wo.vehicleMake ? ` · ${wo.vehicleMake} ${wo.vehicleModel || ""}` : ""}`.trim(),
          status: wo.status || "draft",
          amount: wo.total ? Math.round(Number(wo.total) * 100) : undefined, // convert dollars to cents for consistency
          date: new Date(wo.createdAt),
        }));

        // wave-125 — chat sessions linked to this customer's leads.
        // Find leads with this phone, then sessions that converted to
        // those leads. Surfaces the full intake journey: chat → lead.
        try {
          const { chatSessions } = await import("../../drizzle/schema");
          const leadIds = lds.map((l: typeof lds[number]) => l.id);
          if (leadIds.length > 0) {
            const sessions = await d.select().from(chatSessions)
              .where(sql`${chatSessions.leadId} IN (${sql.join(leadIds.map((id: number) => sql`${id}`), sql`, `)})`)
              .limit(50);
            sessions.forEach((s: typeof sessions[number]) => events.push({
              type: "chat",
              title: "AI Chat Session",
              detail: s.problemSummary?.slice(0, 100) || s.vehicleInfo || "(no summary)",
              status: s.converted ? "converted" : "no-conversion",
              date: new Date(s.createdAt),
            }));
          }
        } catch (chatErr) {
          // Not fatal — table may not exist or no sessions; just skip
          log.warn("[Customers] chat session timeline query failed:", chatErr instanceof Error ? chatErr.message : chatErr);
        }

        // wave-125 — VAPI call logs by phone (post-migration). Surfaces
        // every inbound voice call even when no callback/lead was created.
        try {
          const { vapiCallLogs } = await import("../../drizzle/schema");
          const calls = await d.select().from(vapiCallLogs)
            .where(eq(vapiCallLogs.phoneNumber, phone))
            .orderBy(desc(vapiCallLogs.createdAt))
            .limit(50);
          calls.forEach((c: typeof calls[number]) => events.push({
            type: "vapi_call",
            title: `AI Call · ${c.serviceMention || "no service mention"}`,
            detail: c.aiSummary?.slice(0, 120) || `${c.durationSeconds}s · ${c.endedReason || ""}`,
            status: c.convertedToLead ? "converted" : "info",
            date: new Date(c.createdAt),
          }));
        } catch (vapiErr) {
          // Pre-migration the table doesn't exist; skip silently
          log.warn("[Customers] vapi_call_logs timeline query failed (table may not exist yet):", vapiErr instanceof Error ? vapiErr.message : vapiErr);
        }
      } catch (err) {
        // Some tables may not exist yet
        log.warn("[Customers] Activity timeline query failed:", err instanceof Error ? err.message : err);
      }

      // Sort chronologically, newest first
      events.sort((a, b) => b.date.getTime() - a.date.getTime());
      return events;
    }),

  /** Lightweight VIP lookup by phone numbers — returns VIP/revenue info for priority queue */
  vipLookup: adminProcedure
    .input(z.object({ phones: z.array(z.string()).max(50) }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d || input.phones.length === 0) return { lookup: {} };

      const results = await d
        .select({
          phone: customers.phone,
          totalVisits: customers.totalVisits,
          totalRevenue: customers.totalSpent,
          isVip: customerMetrics.isVip,
          churnRisk: customerMetrics.churnRisk,
        })
        .from(customers)
        .leftJoin(customerMetrics, eq(customers.id, customerMetrics.customerId))
        .where(sql`${customers.phone} IN (${sql.join(input.phones.map(p => sql`${p}`), sql`, `)})`);

      const lookup: Record<string, { totalVisits: number; totalRevenue: number; isVip: boolean; churnRisk: string }> = {};
      for (const r of results) {
        lookup[r.phone] = {
          totalVisits: r.totalVisits,
          totalRevenue: r.totalRevenue ?? 0,
          isVip: !!(r.isVip || r.totalVisits >= 3),
          churnRisk: r.churnRisk ?? "low",
        };
      }
      return { lookup };
    }),

  /** LTV Intelligence — predictive customer scoring from intelligence engine */
  ltvIntelligence: adminProcedure.query(async () => {
    try {
      const result = await predictCustomerLTV();
      return {
        topCustomers: result.topCustomers,
        atRiskHighValue: result.atRiskHighValue,
        segments: result.segments,
      };
    } catch (e) {
      log.error("[Customers] LTV intelligence failed:", e instanceof Error ? e.message : e);
      return { topCustomers: [], atRiskHighValue: [], segments: { whales: 0, regulars: 0, occasional: 0, oneTimers: 0 } };
    }
  }),

  /** Cross-sell recommendations — "customers who got X also needed Y" patterns */
  crossSellRecommendations: adminProcedure.query(async () => {
    try {
      const result = await generateCrossSellRecommendations();
      return {
        patterns: result.patterns,
        recommendations: result.recommendations,
      };
    } catch (e) {
      log.error("[Customers] Cross-sell engine failed:", e instanceof Error ? e.message : e);
      return { patterns: [], recommendations: [] };
    }
  }),

  /**
   * Wave-100: manual metrics refresh trigger.
   * Login auto-fires this — but operator can force a fresh recompute
   * from the admin UI if they suspect data went stale (e.g. after a
   * manual ALG sync). Pure-local DB joins, no ALG fetch, ~500ms.
   */
  refreshMetrics: adminProcedure.mutation(async () => {
    try {
      const { refreshCustomerMetrics } = await import("../services/customerMetricsRefresh");
      const result = await refreshCustomerMetrics();
      return {
        success: true,
        customersUpdated: result.customersUpdated,
        durationMs: result.durationMs,
      };
    } catch (err) {
      log.error("[Customers] Metrics refresh failed:", err instanceof Error ? err.message : err);
      return { success: false, customersUpdated: 0, durationMs: 0 };
    }
  }),

  /**
   * wave-181.27 · expose `customer_metrics` freshness so the admin UI
   * can show a "last computed Xm ago" badge next to the Recompute
   * button. Operator sees at a glance whether the materialized
   * aggregates are minutes-old (trust them) or hours-old (recompute).
   *
   * Reads max(computedAt) across the table — single-row scalar query,
   * indexed by primary key. Returns null if the table is empty or DB
   * is offline (UI renders "—" in that case).
   */
  metricsFreshness: adminProcedure.query(async () => {
    try {
      const d = await db();
      if (!d) return { lastComputedAt: null, rowCount: 0 };
      const [maxRow] = await d
        .select({ maxComputed: sql<Date | null>`MAX(${customerMetrics.computedAt})`, count: sql<number>`COUNT(*)` })
        .from(customerMetrics);
      return {
        lastComputedAt: maxRow?.maxComputed instanceof Date
          ? maxRow.maxComputed.toISOString()
          : maxRow?.maxComputed
            ? String(maxRow.maxComputed)
            : null,
        rowCount: Number(maxRow?.count ?? 0),
      };
    } catch (err) {
      log.error("[Customers] Metrics freshness query failed:", err instanceof Error ? err.message : err);
      return { lastComputedAt: null, rowCount: 0 };
    }
  }),

  /** Customer forecast — revenue projections relevant to customer behavior */
  customerForecast: adminProcedure.query(async () => {
    try {
      const result = await forecastRevenue();
      return {
        today: result.today,
        month: result.month,
        trend: result.trend,
        weeklyTrend: result.weeklyTrend,
      };
    } catch (e) {
      log.error("[Customers] Forecast engine failed:", e instanceof Error ? e.message : e);
      return { today: null, month: null, trend: "flat", weeklyTrend: [] };
    }
  }),

  /**
   * Customer 360 — service history by phone (lazy loaded on expand).
   *
   * Returns three categories:
   *  - invoices         · paid jobs (revenue captured)
   *  - declinedEstimates · ALG walk-in estimates that never converted
   *                        (matched_invoice_id IS NULL = lost sales,
   *                         recovery candidates)
   *  - openWorkOrders   · active work orders not yet completed/picked-up
   *                        (current backlog for this customer)
   */
  history: adminProcedure
    .input(z.object({ phone: z.string().max(20), customerId: z.number().optional() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { invoices: [], declinedEstimates: [], openWorkOrders: [] };

      const invoiceResults = await d
        .select({
          id: invoices.id,
          invoiceNumber: invoices.invoiceNumber,
          serviceDescription: invoices.serviceDescription,
          vehicleInfo: invoices.vehicleInfo,
          totalAmount: invoices.totalAmount,
          partsCost: invoices.partsCost,
          laborCost: invoices.laborCost,
          paymentStatus: invoices.paymentStatus,
          paymentMethod: invoices.paymentMethod,
          invoiceDate: invoices.invoiceDate,
          estimateAmount: algEstimates.estimatedAmount,
          estimateExternalId: algEstimates.externalId,
        })
        .from(invoices)
        .leftJoin(algEstimates, eq(invoices.id, algEstimates.matchedInvoiceId))
        .where(eq(invoices.customerPhone, input.phone))
        .orderBy(desc(invoices.invoiceDate))
        .limit(10);

      // ALG estimates by phone — only unmatched (declined work)
      let declinedEstimates: Array<{
        id: number;
        externalId: string;
        serviceDescription: string | null;
        vehicleInfo: string | null;
        estimatedAmount: number;
        estimateDate: Date;
        followUp7dSent: number;
        followUp30dSent: number;
      }> = [];
      try {
        declinedEstimates = await d
          .select({
            id: algEstimates.id,
            externalId: algEstimates.externalId,
            serviceDescription: algEstimates.serviceDescription,
            vehicleInfo: algEstimates.vehicleInfo,
            estimatedAmount: algEstimates.estimatedAmount,
            estimateDate: algEstimates.estimateDate,
            followUp7dSent: algEstimates.followUp7dSent,
            followUp30dSent: algEstimates.followUp30dSent,
          })
          .from(algEstimates)
          .where(
            sql`${algEstimates.customerPhone} = ${input.phone} AND ${algEstimates.matchedInvoiceId} IS NULL`
          )
          .orderBy(desc(algEstimates.estimateDate))
          .limit(10);
      } catch (err) {
        log.warn("[Customers] ALG estimates lookup failed:", err instanceof Error ? err.message : err);
      }

      // Open work orders — match by customerId via varchar cast (same pattern as activityTimeline)
      let openWorkOrders: Array<{
        id: string;
        orderNumber: string;
        status: string;
        serviceDescription: string | null;
        vehicleMake: string | null;
        vehicleModel: string | null;
        total: string | null;
        promisedAt: Date | null;
        createdAt: Date;
      }> = [];
      try {
        openWorkOrders = await d
          .select({
            id: workOrders.id,
            orderNumber: workOrders.orderNumber,
            status: workOrders.status,
            serviceDescription: workOrders.serviceDescription,
            vehicleMake: workOrders.vehicleMake,
            vehicleModel: workOrders.vehicleModel,
            total: workOrders.total,
            promisedAt: workOrders.promisedAt,
            createdAt: workOrders.createdAt,
          })
          .from(workOrders)
          .where(sql`${workOrders.customerId} IN (
            SELECT CAST(id AS CHAR) FROM customers WHERE phone = ${input.phone}
          ) AND ${workOrders.status} NOT IN ('completed', 'picked_up', 'closed', 'cancelled')`)
          .orderBy(desc(workOrders.createdAt))
          .limit(10);
      } catch (err) {
        log.warn("[Customers] Open WO lookup failed:", err instanceof Error ? err.message : err);
      }

      return {
        invoices: invoiceResults,
        declinedEstimates,
        openWorkOrders,
      };
    }),
});
