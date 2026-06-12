/**
 * Advanced Features Router — Job Assignments, Invoices, CLV, KPIs, Customer Portal
 * AUDIT-FIXED: Rate limiting, session cleanup, invoice CRUD, optimized KPI, auto-stage
 */
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import { z } from "zod";
import { BUSINESS } from "../../../shared/business";

const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;
import { eq, desc, gte, lte, and, sql, asc, inArray } from "drizzle-orm";
import {
  jobAssignments, invoices, customerMetrics, kpiSnapshots, portalSessions,
  bookings, customers, technicians, reviewRequests, leads, serviceHistory,
  algEstimates, shopSettings,
} from "../../../drizzle/schema";

// wave-115b — dismissed-estimates list lives in shop_settings as a JSON
// array. Pattern matches vapi.saveTransferPreset (no migration required;
// shop_settings is the canonical "operator-tunable JSON" bucket).
const DISMISSED_KEY = "dismissed_alg_estimate_ids";

async function readDismissedIds(d: NonNullable<Awaited<ReturnType<typeof db>>>): Promise<Set<number>> {
  const [row] = await d.select().from(shopSettings).where(eq(shopSettings.key, DISMISSED_KEY)).limit(1);
  if (!row?.value) return new Set();
  try {
    const parsed = JSON.parse(row.value) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((n): n is number => typeof n === "number"));
  } catch {
    return new Set();
  }
}

async function writeDismissedIds(d: NonNullable<Awaited<ReturnType<typeof db>>>, ids: Set<number>): Promise<void> {
  const json = JSON.stringify([...ids]);
  const [row] = await d.select().from(shopSettings).where(eq(shopSettings.key, DISMISSED_KEY)).limit(1);
  if (row) {
    await d.update(shopSettings)
      .set({ value: json, updatedBy: "admin" })
      .where(eq(shopSettings.id, row.id));
  } else {
    await d.insert(shopSettings).values({
      key: DISMISSED_KEY,
      value: json,
      label: "Permanently dismissed ALG declined estimates",
      category: "general",
      updatedBy: "admin",
    });
  }
}

import { db } from "../../lib/db-helper";

import { createLogger } from "../../lib/logger";

const log = createLogger("routers:advanced");
// ─── JOB ASSIGNMENTS ────────────────────────────────────

// ─── INVOICES / REVENUE ─────────────────────────────────
export const invoicesRouter = router({
  /** List invoices with optional date range */
  list: adminProcedure
    .input(z.object({
      limit: z.number().default(100),
      offset: z.number().default(0),
      startDate: z.string().max(30).optional(),
      endDate: z.string().max(30).optional(),
      search: z.string().max(200).optional(),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { items: [], total: 0 };
      const conditions = [];
      if (input?.startDate) conditions.push(gte(invoices.invoiceDate, new Date(input.startDate)));
      if (input?.endDate) conditions.push(lte(invoices.invoiceDate, new Date(input.endDate)));
      if (input?.search) {
        // Escape LIKE wildcards to prevent pattern injection
        const escaped = input.search.replace(/[%_\\]/g, ch => `\\${ch}`);
        conditions.push(sql`(${invoices.customerName} LIKE ${'%' + escaped + '%'} OR ${invoices.invoiceNumber} LIKE ${'%' + escaped + '%'} OR ${invoices.serviceDescription} LIKE ${'%' + escaped + '%'})`);
      }
      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const items = await d.select().from(invoices)
        .where(where)
        .orderBy(desc(invoices.invoiceDate))
        .limit(input?.limit ?? 100)
        .offset(input?.offset ?? 0);
      const [countResult] = await d.select({ count: sql<number>`count(*)` }).from(invoices).where(where);
      return { items, total: countResult?.count ?? 0 };
    }),

  /** Create an invoice */
  create: adminProcedure
    .input(z.object({
      customerName: z.string().min(1, "Customer name is required").max(200),
      customerPhone: z.string().max(20).optional(),
      customerId: z.number().optional(),
      bookingId: z.number().optional(),
      invoiceNumber: z.string().max(50).optional(),
      totalAmount: z.number().min(0),
      partsCost: z.number().default(0),
      laborCost: z.number().default(0),
      taxAmount: z.number().default(0),
      serviceDescription: z.string().max(2000).optional(),
      vehicleInfo: z.string().max(200).optional(),
      paymentMethod: z.enum(["cash", "card", "check", "financing", "other"]).default("card"),
      paymentStatus: z.enum(["paid", "pending", "partial", "refunded"]).default("paid"),
      invoiceDate: z.string().optional(),
      source: z.enum(["shopdriver", "manual", "stripe"]).default("manual"),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const result = await d.insert(invoices).values({
        ...input,
        invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : new Date(),
      });
      const invoiceId = Number(result[0].insertId);

      const invNum = input.invoiceNumber || `INV-${invoiceId}`;

      // Unified event bus (→ NOUR OS + ShopDriver + Telegram + learning)
      import("../../services/eventBus").then(({ emit }) =>
        emit.invoiceCreated({
          invoiceNumber: invNum,
          customerName: input.customerName,
          totalAmount: (input.totalAmount || 0) / 100,
          source: input.source,
        })
      ).catch((e) => { log.warn("[advanced] fire-and-forget failed:", e); });

      // Push to Auto Labor Guide (tries API first, falls back to Telegram)
      if (input.source !== "shopdriver") {
        import("../../services/shopDriverSync").then(({ pushInvoice }) =>
          pushInvoice({
            invoiceNumber: invNum,
            customerName: input.customerName,
            customerPhone: input.customerPhone || "",
            vehicleInfo: input.vehicleInfo || null,
            serviceDescription: input.serviceDescription || null,
            laborCost: (input.laborCost || 0) / 100,
            partsCost: (input.partsCost || 0) / 100,
            taxAmount: (input.taxAmount || 0) / 100,
            totalAmount: (input.totalAmount || 0) / 100,
            paymentStatus: input.paymentStatus,
            paymentMethod: input.paymentMethod,
          })
        ).catch((e) => { log.warn("[advanced] fire-and-forget failed:", e); });
      }

      return { success: true, id: invoiceId };
    }),

  /** Update an invoice */
  update: adminProcedure
    .input(z.object({
      id: z.number(),
      customerName: z.string().max(200).optional(),
      customerPhone: z.string().max(20).optional(),
      totalAmount: z.number().optional(),
      partsCost: z.number().optional(),
      laborCost: z.number().optional(),
      taxAmount: z.number().optional(),
      serviceDescription: z.string().max(2000).optional(),
      vehicleInfo: z.string().max(200).optional(),
      paymentMethod: z.enum(["cash", "card", "check", "financing", "other"]).optional(),
      paymentStatus: z.enum(["paid", "pending", "partial", "refunded"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const { id, ...updates } = input;
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([_, v]) => v !== undefined)
      );
      if (Object.keys(cleanUpdates).length === 0) return { success: true };

      // Check current status BEFORE update to detect an actual transition to
      // "paid". Default wasPaid=false so a transient read failure errs toward
      // FIRING invoice_paid — a missed real payment (no Telegram/NOUR OS
      // notification, no downstream learning) is worse than a rare duplicate
      // on an already-paid invoice.
      let wasPaid = false;
      if (input.paymentStatus === "paid") {
        try {
          const [current] = await d.select({ ps: invoices.paymentStatus }).from(invoices).where(eq(invoices.id, id)).limit(1);
          wasPaid = current?.ps === "paid";
        } catch (e) { log.warn("[advanced:invoice] payment status check failed; firing invoice_paid to be safe:", e); }
      }

      await d.update(invoices).set(cleanUpdates).where(eq(invoices.id, id));

      // Fire invoice_paid only on actual transition (not if already paid)
      if (input.paymentStatus === "paid" && !wasPaid) {
        import("../../services/eventBus").then(({ emit }) =>
          emit.invoicePaid({
            invoiceNumber: String(input.id),
            customerName: input.customerName || "Unknown",
            totalAmount: (input.totalAmount || 0) / 100,
            method: input.paymentMethod || "unknown",
          })
        ).catch((e) => { log.warn("[advanced] fire-and-forget failed:", e); });
      }

      return { success: true };
    }),

  /** Delete an invoice */
  delete: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      await d.delete(invoices).where(eq(invoices.id, input.id));
      return { success: true };
    }),

  /**
   * Tire Sales Report — surfaces tire-specific revenue from
   * serviceDescription text matching. ALG doesn't expose per-line-item
   * data via REST API, so this is the next-best granular view: filter
   * invoices where serviceDescription mentions tires, then aggregate.
   *
   * Wave-99. Tested live: 193 historical tire jobs · $91,231 total
   * revenue · 191 unique customers · top job "REPLACE TIRES (4 WHEELS)".
   */
  tireSalesReport: adminProcedure
    // wave-157 — tightened: int+bounded so sql.raw stays safe.
    .input(z.object({ months: z.number().int().min(1).max(120).default(12) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return {
        totals: { jobs: 0, revenue: 0, avgTicket: 0, uniqueCustomers: 0 },
        byMonth: [],
        topJobs: [],
        topCustomers: [],
      };
      const months = input?.months ?? 12;

      // Aggregate totals
      const [totalsRow] = await d.execute(sql`
        SELECT
          COUNT(*) AS jobs,
          ROUND(SUM(totalAmount)/100, 0) AS revenue,
          ROUND(AVG(totalAmount)/100, 0) AS avg_ticket,
          COUNT(DISTINCT customerName) AS unique_customers
        FROM invoices
        WHERE source='shopdriver' AND paymentStatus='paid'
          AND invoiceDate >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(months))} MONTH)
          AND (serviceDescription LIKE '%tire%' OR serviceDescription LIKE '%TIRE%')
      `) as [Array<{ jobs: number; revenue: number | null; avg_ticket: number | null; unique_customers: number }>];
      const totals = totalsRow[0] || { jobs: 0, revenue: 0, avg_ticket: 0, unique_customers: 0 };

      // By month
      const [byMonthRows] = await d.execute(sql`
        SELECT DATE_FORMAT(invoiceDate, '%Y-%m') AS month,
               COUNT(*) AS jobs,
               ROUND(SUM(totalAmount)/100, 0) AS revenue
        FROM invoices
        WHERE source='shopdriver' AND paymentStatus='paid'
          AND invoiceDate >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(months))} MONTH)
          AND (serviceDescription LIKE '%tire%' OR serviceDescription LIKE '%TIRE%')
        GROUP BY month ORDER BY month ASC
      `) as [Array<{ month: string; jobs: number; revenue: number | null }>];

      // Top job descriptions
      const [topJobsRows] = await d.execute(sql`
        SELECT serviceDescription, COUNT(*) AS jobs,
               ROUND(SUM(totalAmount)/100, 0) AS revenue
        FROM invoices
        WHERE source='shopdriver' AND paymentStatus='paid'
          AND invoiceDate >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(months))} MONTH)
          AND (serviceDescription LIKE '%tire%' OR serviceDescription LIKE '%TIRE%')
        GROUP BY serviceDescription ORDER BY jobs DESC LIMIT 10
      `) as [Array<{ serviceDescription: string; jobs: number; revenue: number | null }>];

      // Top customers by tire-job spend
      const [topCustomersRows] = await d.execute(sql`
        SELECT customerName, customerPhone, COUNT(*) AS jobs,
               ROUND(SUM(totalAmount)/100, 0) AS spent
        FROM invoices
        WHERE source='shopdriver' AND paymentStatus='paid'
          AND invoiceDate >= DATE_SUB(NOW(), INTERVAL ${sql.raw(String(months))} MONTH)
          AND (serviceDescription LIKE '%tire%' OR serviceDescription LIKE '%TIRE%')
        GROUP BY customerName, customerPhone ORDER BY spent DESC LIMIT 10
      `) as [Array<{ customerName: string; customerPhone: string | null; jobs: number; spent: number | null }>];

      return {
        totals: {
          jobs: Number(totals.jobs) || 0,
          revenue: Number(totals.revenue) || 0,
          avgTicket: Number(totals.avg_ticket) || 0,
          uniqueCustomers: Number(totals.unique_customers) || 0,
        },
        byMonth: byMonthRows.map((r) => ({
          month: r.month,
          jobs: Number(r.jobs) || 0,
          revenue: Number(r.revenue) || 0,
        })),
        topJobs: topJobsRows.map((r) => ({
          description: r.serviceDescription,
          jobs: Number(r.jobs) || 0,
          revenue: Number(r.revenue) || 0,
        })),
        topCustomers: topCustomersRows.map((r) => ({
          customerName: r.customerName,
          customerPhone: r.customerPhone,
          jobs: Number(r.jobs) || 0,
          spent: Number(r.spent) || 0,
        })),
      };
    }),

  /** Revenue dashboard stats */
  stats: adminProcedure
    // wave-157 — tightened: int+bounded so sql.raw stays safe.
    .input(z.object({ days: z.number().int().min(1).max(3650).default(30) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return {
        totalRevenue: 0, avgTicket: 0, invoiceCount: 0,
        revenueByDay: [], revenueByService: [], revenueByPayment: [],
        periodComparison: { current: 0, previous: 0, change: 0 },
      };
      const days = input?.days ?? 30;
      // wave-181.x Money · R2 fix · was JS `cutoff.setDate(-days)` — a
      // rolling, tz-naive boundary anchored at the current time-of-day.
      // `intelligence` uses `DATE_SUB(CURDATE(), INTERVAL n DAY)` (server-
      // local MIDNIGHT), so the two windows captured different invoice
      // sets and reported two different "Total Revenue" for the same 30d.
      // Adopt the SAME midnight boundary here so both totals reconcile.
      // Current window = [CURDATE()-days, now]; previous = [CURDATE()-2d,
      // CURDATE()-days) — half-open so the midnight boundary isn't double-
      // counted. `days` is zod int-bounded (1..3650), safe to interpolate.
      const currentInvoices = await d.select().from(invoices)
        .where(and(
          sql`${invoices.invoiceDate} >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`,
          eq(invoices.paymentStatus, "paid"),
        ));
      const prevInvoices = await d.select().from(invoices)
        .where(and(
          sql`${invoices.invoiceDate} >= DATE_SUB(CURDATE(), INTERVAL ${days * 2} DAY)`,
          sql`${invoices.invoiceDate} < DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`,
          eq(invoices.paymentStatus, "paid"),
        ));

      type Inv = typeof currentInvoices[number];
      const totalRevenue = Math.round(currentInvoices.reduce((sum: number, inv: Inv) => sum + inv.totalAmount, 0) / 100);
      const prevRevenue = Math.round(prevInvoices.reduce((sum: number, inv: Inv) => sum + inv.totalAmount, 0) / 100);

      // Revenue by day · R2 fix · was `toISOString().split` which buckets
      // by UTC calendar day · that disagreed with the server-local window
      // boundary (and with intelligence's `DATE(invoiceDate)`), so late-
      // evening invoices fell into the wrong day. Bucket by LOCAL Y-M-D.
      const localDayKey = (date: Date): string => {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, "0");
        const dd = String(date.getDate()).padStart(2, "0");
        return `${y}-${m}-${dd}`;
      };
      const byDay: Record<string, number> = {};
      currentInvoices.forEach((inv: Inv) => {
        const day = localDayKey(new Date(inv.invoiceDate));
        byDay[day] = (byDay[day] || 0) + Math.round(inv.totalAmount / 100);
      });

      // Revenue by payment method
      const byPayment: Record<string, number> = {};
      currentInvoices.forEach((inv: Inv) => {
        byPayment[inv.paymentMethod] = (byPayment[inv.paymentMethod] || 0) + Math.round(inv.totalAmount / 100);
      });

      return {
        totalRevenue,
        avgTicket: currentInvoices.length > 0 ? Math.round(totalRevenue / currentInvoices.length) : 0,
        invoiceCount: currentInvoices.length,
        revenueByDay: Object.entries(byDay).map(([date, amount]) => ({ date, amount })).sort((a, b) => a.date.localeCompare(b.date)),
        revenueByPayment: Object.entries(byPayment).map(([method, amount]) => ({ method, amount })),
        periodComparison: {
          current: totalRevenue,
          previous: prevRevenue,
          change: prevRevenue > 0 ? Math.round(((totalRevenue - prevRevenue) / prevRevenue) * 100) : 0,
        },
      };
    }),

  /** Top customers by revenue */
  topCustomers: adminProcedure
    .input(z.object({ limit: z.number().default(10) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      const all = await d.select().from(invoices)
        .where(eq(invoices.paymentStatus, "paid"));
      // Aggregate by customer name
      const byCustomer: Record<string, { name: string; phone: string | null; total: number; count: number; lastVisit: Date }> = {};
      all.forEach((inv: typeof all[number]) => {
        const key = inv.customerPhone || inv.customerName;
        if (!byCustomer[key]) {
          byCustomer[key] = { name: inv.customerName, phone: inv.customerPhone, total: 0, count: 0, lastVisit: new Date(inv.invoiceDate) };
        }
        byCustomer[key].total += inv.totalAmount;
        byCustomer[key].count += 1;
        if (new Date(inv.invoiceDate) > byCustomer[key].lastVisit) {
          byCustomer[key].lastVisit = new Date(inv.invoiceDate);
        }
      });
      return Object.values(byCustomer)
        .sort((a, b) => b.total - a.total)
        .slice(0, input?.limit ?? 10);
    }),

  /** Deep revenue intelligence — labor/parts split, service breakdown, tech performance, monthly trends, payment mix, projections */
  intelligence: adminProcedure
    .input(z.object({
      period: z.enum(["7d", "30d", "90d", "6mo", "1yr", "all"]).default("30d"),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return null;
      const { sql: rawSql } = await import("drizzle-orm");

      const periodMap: Record<string, number> = { "7d": 7, "30d": 30, "90d": 90, "6mo": 180, "1yr": 365, "all": 9999 };
      const days = periodMap[input?.period ?? "30d"];

      // All queries in parallel for speed
      const [overviewRows, laborPartsRows, monthlyRows, serviceRows, topDaysRows, hourRows, weeklyRows, velocityRows, mtdRows] = await Promise.all([
        // 1. Overview stats
        // wave-181.x Money · R2 fix · `stats` (the source of the top KPI)
        // sums only paymentStatus='paid' invoices, but this overview summed
        // ALL invoices (paid + pending + partial + refunded) — so the two
        // "Total Revenue" figures for the same period never reconciled.
        // Scope the overview revenue/realized aggregates to paid so they
        // match the KPI (paid = honest realized revenue). The labor/parts
        // split (query 2) and service breakdown (query 4) are SEPARATE
        // queries and intentionally LEFT all-invoices — see note below.
        d.execute(rawSql`
          SELECT COUNT(*) as cnt, COALESCE(SUM(totalAmount),0) as rev,
                 COALESCE(SUM(laborCost),0) as labor, COALESCE(SUM(partsCost),0) as parts,
                 COALESCE(SUM(taxAmount),0) as tax,
                 COALESCE(AVG(totalAmount),0) as avgTicket,
                 COUNT(DISTINCT customerName) as uniqueCustomers,
                 COUNT(DISTINCT DATE(invoiceDate)) as activeDays
          FROM invoices WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
            AND paymentStatus = 'paid'
        `),
        // 2. Labor vs Parts ratio
        // NOTE: `both` is a reserved word in TiDB/MySQL — use `bothJobs`.
        d.execute(rawSql`
          SELECT
            SUM(CASE WHEN laborCost > 0 AND partsCost = 0 THEN 1 ELSE 0 END) as laborOnly,
            SUM(CASE WHEN laborCost = 0 AND partsCost > 0 THEN 1 ELSE 0 END) as partsOnly,
            SUM(CASE WHEN laborCost > 0 AND partsCost > 0 THEN 1 ELSE 0 END) as bothJobs,
            COALESCE(SUM(laborCost),0) as totalLabor,
            COALESCE(SUM(partsCost),0) as totalParts
          FROM invoices WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
        `),
        // 3. Monthly trend (last 12 months regardless of period)
        d.execute(rawSql`
          SELECT DATE_FORMAT(invoiceDate, '%Y-%m') as month,
                 COUNT(*) as cnt, SUM(totalAmount) as rev,
                 SUM(laborCost) as labor, SUM(partsCost) as parts,
                 AVG(totalAmount) as avgTicket
          FROM invoices
          GROUP BY DATE_FORMAT(invoiceDate, '%Y-%m')
          ORDER BY month DESC LIMIT 24
        `),
        // wave-187 — payment-method breakdown query REMOVED. Its only consumer
        // was the dead `intelligence.paymentMix` return field; the payment pie
        // on DashboardView reads `stats.revenueByPayment` instead. This GROUP BY
        // ran every intel call for nothing.
        // Service category breakdown (from description keywords)
        d.execute(rawSql`
          SELECT
            CASE
              WHEN serviceDescription REGEXP 'brake|pad|rotor|caliper' THEN 'Brakes'
              WHEN serviceDescription REGEXP 'tire|mount|balance|tpms' THEN 'Tires'
              WHEN serviceDescription REGEXP 'align' THEN 'Alignment'
              WHEN serviceDescription REGEXP 'oil|lube|filter' THEN 'Oil Change'
              WHEN serviceDescription REGEXP 'strut|shock|control|tie.rod|bearing|hub|sway|spring' THEN 'Suspension'
              WHEN serviceDescription REGEXP 'tune|spark|oxygen|alternator|starter|exhaust|muffler|weld|belt' THEN 'Engine/Exhaust'
              WHEN serviceDescription REGEXP 'radiator|coolant|thermostat|water.pump|flush' THEN 'Cooling'
              WHEN serviceDescription REGEXP 'battery|wiper|window|sensor|light' THEN 'Electrical'
              WHEN serviceDescription REGEXP 'steering|power.steering' THEN 'Steering'
              WHEN serviceDescription REGEXP 'transmission|cv.axle|axle' THEN 'Transmission'
              ELSE 'Other'
            END as category,
            COUNT(*) as cnt, SUM(totalAmount) as rev, AVG(totalAmount) as avgTicket
          FROM invoices WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
            AND serviceDescription IS NOT NULL AND serviceDescription != ''
          GROUP BY category ORDER BY rev DESC
        `),
        // 6. Best/worst revenue days
        d.execute(rawSql`
          SELECT DATE(invoiceDate) as day, COUNT(*) as jobs, SUM(totalAmount) as rev
          FROM invoices WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
          GROUP BY DATE(invoiceDate) ORDER BY rev DESC LIMIT 10
        `),
        // 7. Revenue by day of week
        d.execute(rawSql`
          SELECT DAYNAME(invoiceDate) as dayName, DAYOFWEEK(invoiceDate) as dayNum,
                 COUNT(*) as cnt, SUM(totalAmount) as rev, AVG(totalAmount) as avgTicket
          FROM invoices WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
          GROUP BY dayName, dayNum ORDER BY dayNum
        `),
        // 8. Weekly revenue trend (for week-over-week growth)
        d.execute(rawSql`
          SELECT YEARWEEK(invoiceDate, 1) as yw,
                 MIN(DATE(invoiceDate)) as weekStart,
                 COUNT(*) as cnt, SUM(totalAmount) as rev,
                 SUM(laborCost) as labor, SUM(partsCost) as parts,
                 AVG(totalAmount) as avgTicket
          FROM invoices
          WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL LEAST(${days}, 365) DAY)
          GROUP BY YEARWEEK(invoiceDate, 1)
          ORDER BY yw DESC LIMIT 52
        `),
        // 9. Revenue velocity — jobs per day and avg revenue per job trending
        d.execute(rawSql`
          SELECT DATE(invoiceDate) as day,
                 COUNT(*) as jobs,
                 SUM(totalAmount) as rev,
                 AVG(totalAmount) as avgTicket,
                 SUM(laborCost) as labor,
                 SUM(partsCost) as parts
          FROM invoices
          WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
          GROUP BY DATE(invoiceDate)
          ORDER BY day
        `),
        // 10. TRUE month-to-date revenue — paid invoices since the 1st of the
        // current month. Independent of the `period` selector so the MONTHLY
        // PACE bar reflects THIS month's realized revenue (not the trailing
        // 3-month average that `projections.monthlyAvg` carries). paid-only to
        // match the headline KPI (honest realized revenue).
        d.execute(rawSql`
          SELECT COALESCE(SUM(totalAmount),0) as rev
          FROM invoices
          WHERE paymentStatus = 'paid'
            AND invoiceDate >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
        `),
      ]);

      type RawRow = Record<string, unknown>;
      type RawResult = [RawRow[], unknown];
      const overview = ((overviewRows as RawResult)?.[0]?.[0] || {}) as RawRow;
      const lp = ((laborPartsRows as RawResult)?.[0]?.[0] || {}) as RawRow;
      const monthly = (((monthlyRows as RawResult)?.[0] || []) as RawRow[]).reverse();
      const services = ((serviceRows as RawResult)?.[0] || []) as RawRow[];
      const topDays = ((topDaysRows as RawResult)?.[0] || []) as RawRow[];
      const byDayOfWeek = ((hourRows as RawResult)?.[0] || []) as RawRow[];
      const weekly = (((weeklyRows as RawResult)?.[0] || []) as RawRow[]).reverse();
      const dailyVelocity = ((velocityRows as RawResult)?.[0] || []) as RawRow[];
      const mtd = ((mtdRows as RawResult)?.[0]?.[0] || {}) as RawRow;

      // Projections
      const recentMonths = monthly.slice(-3);
      const recentAvg = recentMonths.length > 0
        ? recentMonths.reduce((s: number, m: RawRow) => s + Number(m.rev || 0), 0) / recentMonths.length
        : 0;

      return {
        overview: {
          invoiceCount: Number(overview.cnt || 0),
          totalRevenue: Math.round(Number(overview.rev || 0) / 100),
          totalLabor: Math.round(Number(overview.labor || 0) / 100),
          totalParts: Math.round(Number(overview.parts || 0) / 100),
          totalTax: Math.round(Number(overview.tax || 0) / 100),
          avgTicket: Math.round(Number(overview.avgTicket || 0) / 100),
          uniqueCustomers: Number(overview.uniqueCustomers || 0),
          activeDays: Number(overview.activeDays || 0),
          avgDailyRevenue: Number(overview.activeDays) > 0 ? Math.round(Number(overview.rev || 0) / Number(overview.activeDays) / 100) : 0,
          // TRUE month-to-date (paid, since the 1st) — period-independent so
          // the MONTHLY PACE bar shows this month's progress, not the 3-mo avg.
          monthToDateRevenue: Math.round(Number(mtd.rev || 0) / 100),
        },
        laborVsParts: {
          laborTotal: Math.round(Number(lp.totalLabor || 0) / 100),
          partsTotal: Math.round(Number(lp.totalParts || 0) / 100),
          laborPct: Number(overview.rev) > 0 ? Math.round(Number(lp.totalLabor || 0) / Number(overview.rev) * 100) : 0,
          partsPct: Number(overview.rev) > 0 ? Math.round(Number(lp.totalParts || 0) / Number(overview.rev) * 100) : 0,
          laborOnlyJobs: Number(lp.laborOnly || 0),
          partsOnlyJobs: Number(lp.partsOnly || 0),
          bothJobs: Number(lp.bothJobs || 0),
        },
        monthlyTrend: monthly.map((m: RawRow) => ({
          month: m.month,
          invoices: Number(m.cnt),
          revenue: Math.round(Number(m.rev || 0) / 100),
          labor: Math.round(Number(m.labor || 0) / 100),
          parts: Math.round(Number(m.parts || 0) / 100),
          avgTicket: Math.round(Number(m.avgTicket || 0) / 100),
        })),
        serviceBreakdown: services.map((s: RawRow) => ({
          category: s.category,
          count: Number(s.cnt),
          revenue: Math.round(Number(s.rev || 0) / 100),
          avgTicket: Math.round(Number(s.avgTicket || 0) / 100),
        })),
        topDays: topDays.map((d: RawRow) => ({
          day: d.day,
          jobs: Number(d.jobs),
          revenue: Math.round(Number(d.rev || 0) / 100),
        })),
        dayOfWeek: byDayOfWeek.map((d: RawRow) => ({
          day: d.dayName,
          count: Number(d.cnt),
          revenue: Math.round(Number(d.rev || 0) / 100),
          avgTicket: Math.round(Number(d.avgTicket || 0) / 100),
        })),
        weeklyTrend: weekly.map((w: RawRow) => ({
          week: w.weekStart,
          invoices: Number(w.cnt),
          revenue: Math.round(Number(w.rev || 0) / 100),
          labor: Math.round(Number(w.labor || 0) / 100),
          parts: Math.round(Number(w.parts || 0) / 100),
          avgTicket: Math.round(Number(w.avgTicket || 0) / 100),
        })),
        dailyVelocity: dailyVelocity.map((d: RawRow) => ({
          day: d.day,
          jobs: Number(d.jobs),
          revenue: Math.round(Number(d.rev || 0) / 100),
          avgTicket: Math.round(Number(d.avgTicket || 0) / 100),
          labor: Math.round(Number(d.labor || 0) / 100),
          parts: Math.round(Number(d.parts || 0) / 100),
        })),
        weekOverWeek: (() => {
          if (weekly.length < 2) return { growth: 0, prevWeek: 0, thisWeek: 0 };
          const thisW = Number(weekly[weekly.length - 1]?.rev || 0);
          const lastW = Number(weekly[weekly.length - 2]?.rev || 0);
          return {
            thisWeek: Math.round(thisW / 100),
            prevWeek: Math.round(lastW / 100),
            growth: lastW > 0 ? Math.round((thisW - lastW) / lastW * 100) : 0,
          };
        })(),
        projections: {
          monthlyAvg: Math.round(recentAvg / 100),
          annualProjection: Math.round(recentAvg * 12 / 100),
          dailyTarget: Math.round(MONTHLY_TARGET / 26), // target / 26 working days
          monthlyTarget: MONTHLY_TARGET,
        },
        // Smart recommendations based on data
        recommendations: await (async () => {
          const recs: { text: string; type: "revenue" | "risk" | "growth"; priority: "high" | "medium" | "low" }[] = [];
          try {
            // Check for stale estimates
            const [staleEst] = await d.execute(rawSql`
              SELECT COUNT(*) as cnt, COALESCE(SUM(totalAmount), 0) as potential
              FROM invoices WHERE paymentStatus = 'pending'
              AND invoiceDate < DATE_SUB(NOW(), INTERVAL 3 DAY)
            `);
            const se = (staleEst as RawRow[])?.[0];
            if (Number(se?.cnt) > 0) {
              recs.push({ text: `Follow up on ${se?.cnt} stale estimates — ~$${Math.round(Number(se?.potential ?? 0)/100)} potential revenue`, type: "revenue", priority: "high" });
            }
            // Check dormant high-value customers
            const [dormant] = await d.execute(rawSql`
              SELECT COUNT(*) as cnt FROM customers
              WHERE lastVisitDate < DATE_SUB(NOW(), INTERVAL 90 DAY) AND totalSpent > ${MONTHLY_TARGET}
            `);
            const dormantRow = (dormant as RawRow[])?.[0];
            if (Number(dormantRow?.cnt) > 5) {
              recs.push({ text: `${dormantRow?.cnt} high-value customers haven't visited in 90+ days — win-back campaign opportunity`, type: "growth", priority: "high" });
            }
            // Revenue pacing
            const avg = Math.round(recentAvg / 100);
            if (avg < MONTHLY_TARGET * 0.8) {
              recs.push({ text: `Revenue trending $${(MONTHLY_TARGET - avg).toLocaleString()} below ${BUSINESS.revenueTarget.display} target — need ${Math.round((MONTHLY_TARGET - avg) / 26)}/day more`, type: "risk", priority: "high" });
            }
            // Slow days
            const slowDays = byDayOfWeek.filter((d: RawRow) => Number(d.cnt) < 2);
            if (slowDays.length > 0) {
              recs.push({ text: `${slowDays.map((d: RawRow) => d.dayName).join(', ')} are slow days — consider promotions or appointments-only`, type: "growth", priority: "medium" });
            }
          } catch (e) { log.warn("[advanced:recommendations] analysis failed:", e); }
          return recs;
        })(),
      };
    }),

  /**
   * Declined estimates — REAL ALG estimates that never converted to a
   * paid invoice. Backed by `alg_estimates` table (matched_invoice_id
   * IS NULL = customer walked).
   *
   * Wave-97 fix: previously this read from `invoices WHERE
   * paymentStatus = 'pending'` which conflated three different things:
   *  (a) real declined estimates,
   *  (b) unpaid real invoices for completed work,
   *  (c) HTML-scraped Estimate# rows that leaked into the wrong table.
   *
   * Now sources from the canonical declined-work table. Output shape
   * preserved for the existing UI (DeclinedEstimatesSection).
   */
  declined: adminProcedure
    .input(z.object({
      // wave-157 — tightened: int+bounded so sql.raw stays safe.
      days: z.number().int().min(1).max(3650).default(30),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { estimates: [], total: 0, recoverable: 0, recovered: 0, recoveryRate: 0 };

      const days = input?.days ?? 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      // wave-115b — fetch the operator's "permanently dismissed" set.
      // These are estimates the operator has explicitly closed out (customer
      // said no, vehicle sold, etc.). Filtered out of the listing below.
      const dismissedIds = await readDismissedIds(d);

      // Unmatched ALG estimates within the window — declined work
      const declined = await d
        .select({
          id: algEstimates.id,
          externalId: algEstimates.externalId,
          customerName: algEstimates.customerName,
          customerPhone: algEstimates.customerPhone,
          vehicleInfo: algEstimates.vehicleInfo,
          serviceDescription: algEstimates.serviceDescription,
          totalAmount: algEstimates.estimatedAmount, // alias to keep UI shape
          invoiceDate: algEstimates.estimateDate,    // alias to keep UI shape
          followUp7dSent: algEstimates.followUp7dSent,
          followUp30dSent: algEstimates.followUp30dSent,
          recoveryNote: algEstimates.recoveryNote,
        })
        .from(algEstimates)
        .where(and(
          gte(algEstimates.estimateDate, cutoff),
          sql`${algEstimates.matchedInvoiceId} IS NULL`,
        ))
        .orderBy(desc(algEstimates.estimateDate))
        .limit(200 + dismissedIds.size); // bump limit to absorb dismissed

      // Recovery rate = matched / total ALG estimates over last 90d
      const allTimeCutoff = new Date();
      allTimeCutoff.setDate(allTimeCutoff.getDate() - 90);
      const [matchedResult] = await d.select({
        count: sql<number>`count(*)`,
      }).from(algEstimates).where(and(
        gte(algEstimates.estimateDate, allTimeCutoff),
        sql`${algEstimates.matchedInvoiceId} IS NOT NULL`,
      ));
      const [totalEstResult] = await d.select({
        count: sql<number>`count(*)`,
      }).from(algEstimates).where(gte(algEstimates.estimateDate, allTimeCutoff));

      const recovered = matchedResult?.count ?? 0;
      const totalEstimates90d = totalEstResult?.count ?? 0;
      const recoveryRate = totalEstimates90d > 0 ? Math.round((recovered / totalEstimates90d) * 100) : 0;

      // wave-115b — drop dismissed estimates before shaping. Done in JS
      // (not SQL) because the dismissed set lives in shop_settings JSON,
      // not in algEstimates itself, so a JOIN would mean another query.
      const filtered = dismissedIds.size > 0
        ? declined.filter((e: typeof declined[number]) => !dismissedIds.has(e.id)).slice(0, 200)
        : declined.slice(0, 200);

      // Map status field for UI compatibility — derive from follow-up flags
      const estimatesShaped = filtered.map((e: typeof filtered[number]) => ({
        ...e,
        // UI uses paymentStatus to color-code: "partial" = follow-up scheduled
        paymentStatus: e.followUp30dSent ? "30d-sent" : e.followUp7dSent ? "partial" : "pending",
      }));

      const total = estimatesShaped.length;
      const recoverable = estimatesShaped.reduce(
        (sum: number, e: typeof estimatesShaped[number]) => sum + (e.totalAmount || 0),
        0
      );

      return {
        estimates: estimatesShaped,
        total,
        recoverable: Math.round(recoverable / 100),
        recovered,
        recoveryRate,
      };
    }),

  /**
   * Mark a declined ALG estimate as "followed up" — bumps the 7d flag.
   * Wave-97: now updates the correct table (alg_estimates instead of invoices).
   */
  markFollowUp: adminProcedure
    .input(z.object({
      id: z.number(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      await d.update(algEstimates)
        .set({ followUp7dSent: 1, followUp7dSentAt: new Date() })
        .where(eq(algEstimates.id, input.id));
      return { success: true };
    }),

  /**
   * wave-115b — Permanently dismiss a declined estimate so it stops
   * appearing in the recovery queue. Use when:
   *   · Customer said "no, never" definitively
   *   · Vehicle was sold / totaled
   *   · Estimate is a duplicate or data error
   *
   * Stored in shop_settings as a JSON array of dismissed ids — no
   * schema migration required. Reversible via undismissEstimate.
   */
  dismissEstimate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const ids = await readDismissedIds(d);
      ids.add(input.id);
      await writeDismissedIds(d, ids);
      log.info("Estimate dismissed", { id: input.id, totalDismissed: ids.size });
      return { ok: true as const, id: input.id };
    }),

  /**
   * wave-115b — Restore a previously-dismissed estimate to the queue.
   */
  undismissEstimate: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const ids = await readDismissedIds(d);
      ids.delete(input.id);
      await writeDismissedIds(d, ids);
      return { ok: true as const, id: input.id };
    }),

  /**
   * Wave-101: bulk follow-up SMS to N declined ALG estimates.
   *
   * Operator picks targets in the UI (multi-select or "top N by score")
   * and this endpoint loops through them with a 250ms gap, sending the
   * 7d follow-up template, marking each as followUp7dSent on success.
   *
   * Respects:
   *   - SMS_KILL_SWITCH env var (returns degraded:true if set)
   *   - sendSms internal cooldown (5 min between sends to same phone)
   *   - sendSms daily limit (max 8 SMS/phone/24h)
   *   - customers.smsOptOut TCPA flag (sendSms checks this)
   *
   * Returns per-id outcome so the UI can show which sent / which failed.
   */
  bulkFollowUp: adminProcedure
    .input(z.object({
      ids: z.array(z.number()).min(1).max(50),
      tier: z.enum(["7d", "30d"]).default("7d"),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");

      // SMS kill-switch awareness — short-circuit cleanly if disabled
      const killSwitchOn = process.env.SMS_KILL_SWITCH === "true";

      // Fetch all targets in one query
      const rows = await d
        .select({
          id: algEstimates.id,
          customerName: algEstimates.customerName,
          customerPhone: algEstimates.customerPhone,
          estimatedAmount: algEstimates.estimatedAmount,
          serviceDescription: algEstimates.serviceDescription,
          followUp7dSent: algEstimates.followUp7dSent,
          followUp30dSent: algEstimates.followUp30dSent,
          recoveryProfile: algEstimates.recoveryProfile,
        })
        .from(algEstimates)
        .where(sql`${algEstimates.id} IN (${sql.join(input.ids.map(id => sql`${id}`), sql`, `)})`);

      const { sendSms } = await import("../../sms");
      const { buildSevenDayMessage, buildThirtyDayMessage, parseFirstName } =
        await import("../../cron/jobs/declinedWorkRecovery");

      const results: Array<{
        id: number;
        sent: boolean;
        reason?: string;
      }> = [];

      // wave-121 — collect IDs that succeed for a single batch UPDATE
      // after the loop (was: per-row UPDATE inside the loop = N round-
      // trips). The 250ms inter-send delay is intentional for Twilio
      // rate-limiting; we keep it but defer the DB write.
      const succeededIds: number[] = [];

      for (const row of rows) {
        if (!row.customerPhone) {
          results.push({ id: row.id, sent: false, reason: "no_phone" });
          continue;
        }
        if (killSwitchOn) {
          results.push({ id: row.id, sent: false, reason: "kill_switch" });
          continue;
        }
        // Already sent this tier? Skip.
        const alreadySent = input.tier === "7d" ? row.followUp7dSent : row.followUp30dSent;
        if (alreadySent) {
          results.push({ id: row.id, sent: false, reason: "already_sent" });
          continue;
        }

        const name = parseFirstName(row.customerName);
        const body = input.tier === "7d"
          ? buildSevenDayMessage({ name, amountCents: row.estimatedAmount, service: row.serviceDescription, profile: row.recoveryProfile })
          : buildThirtyDayMessage({ name, amountCents: row.estimatedAmount, profile: row.recoveryProfile });

        try {
          const smsResult = await sendSms(row.customerPhone, body, { via: "shop", transactional: false });
          if (smsResult.success) {
            succeededIds.push(row.id);
            results.push({ id: row.id, sent: true });
          } else {
            results.push({ id: row.id, sent: false, reason: smsResult.error || "send_failed" });
          }
        } catch (err) {
          results.push({ id: row.id, sent: false, reason: err instanceof Error ? err.message : "unknown_error" });
        }

        // Small gap between sends — Twilio handles bursts but be polite
        await new Promise((rs) => setTimeout(rs, 250));
      }

      // wave-121 — single batch UPDATE for all succeeded IDs (was N
      // separate UPDATEs in-loop). For a 50-row bulk, this is 1 DB
      // round-trip instead of up to 50.
      if (succeededIds.length > 0) {
        const updateField = input.tier === "7d"
          ? { followUp7dSent: 1, followUp7dSentAt: new Date() }
          : { followUp30dSent: 1, followUp30dSentAt: new Date() };
        await d.update(algEstimates).set(updateField).where(inArray(algEstimates.id, succeededIds));
      }

      const sentCount = results.filter(r => r.sent).length;
      const failedCount = results.length - sentCount;

      return {
        sentCount,
        failedCount,
        killSwitchOn,
        results,
      };
    }),

  /**
   * wave-181.79 (highest-leverage operator UX) · fire the full cron
   * recovery flow on whatever's eligible RIGHT NOW · no selection
   * needed. Reuses runDeclinedWorkRecovery() with the same opts the
   * scripts/fire-declined-recovery.ts CLI passes:
   *   maxSends · per-run cap (clamped 1-200 here · the cron's own
   *     500 hard ceiling still applies inside)
   *   bypassBusinessHoursCheck · operator-driven · sms.ts per-message
   *     window guard still queues out-of-hours sends for next 8AM ET
   *   skipDryRunGate · operator's explicit click IS consent ·
   *     FEATURE_DECLINED_RECOVERY env stays in effect for unattended
   *     daily cron runs
   *
   * Pre-flight · refuses to fire if SMS_KILL_SWITCH=true so accidental
   * clicks during a Twilio outage don't burn through the eligibility
   * pool with no actual sends. Returns the cron's RecoveryResult so
   * the admin UI can show sent/skipped counts.
   */
  runDeclinedRecoveryNow: adminProcedure
    .input(z.object({
      maxSends: z.number().int().min(1).max(200).default(100),
    }).optional())
    .mutation(async ({ input }) => {
      if (process.env.SMS_KILL_SWITCH === "true") {
        return {
          recordsProcessed: 0,
          details: "SMS_KILL_SWITCH=true — aborted before any sends. Flip the kill switch off on Railway to enable this trigger.",
          killSwitchOn: true,
        };
      }
      const { runDeclinedWorkRecovery } = await import("../../cron/jobs/declinedWorkRecovery");
      const result = await runDeclinedWorkRecovery({
        maxSends: input?.maxSends ?? 100,
        bypassBusinessHoursCheck: true,
        skipDryRunGate: true,
      });
      return { ...result, killSwitchOn: false };
    }),
});
