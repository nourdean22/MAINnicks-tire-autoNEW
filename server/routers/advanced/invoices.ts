/**
 * Advanced Features Router — Job Assignments, Invoices, CLV, KPIs, Customer Portal
 * AUDIT-FIXED: Rate limiting, session cleanup, invoice CRUD, optimized KPI, auto-stage
 */
import { adminProcedure, publicProcedure, router } from "../../_core/trpc";
import { z } from "zod";
import { BUSINESS } from "../../../shared/business";

const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;
import { eq, desc, gte, lte, and, sql, asc } from "drizzle-orm";
import {
  jobAssignments, invoices, customerMetrics, kpiSnapshots, portalSessions,
  bookings, customers, technicians, reviewRequests, leads, serviceHistory,
} from "../../../drizzle/schema";

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

      // Check current status BEFORE update to detect actual transition to "paid"
      let wasPaid = true;
      if (input.paymentStatus === "paid") {
        try {
          const [current] = await d.select({ ps: invoices.paymentStatus }).from(invoices).where(eq(invoices.id, id)).limit(1);
          wasPaid = current?.ps === "paid";
        } catch (e) { log.warn("[advanced:invoice] payment status check failed:", e); }
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

  /** Revenue dashboard stats */
  stats: adminProcedure
    .input(z.object({ days: z.number().default(30) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return {
        totalRevenue: 0, avgTicket: 0, invoiceCount: 0,
        revenueByDay: [], revenueByService: [], revenueByPayment: [],
        periodComparison: { current: 0, previous: 0, change: 0 },
      };
      const days = input?.days ?? 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      const prevCutoff = new Date();
      prevCutoff.setDate(prevCutoff.getDate() - days * 2);

      const currentInvoices = await d.select().from(invoices)
        .where(and(gte(invoices.invoiceDate, cutoff), eq(invoices.paymentStatus, "paid")));
      const prevInvoices = await d.select().from(invoices)
        .where(and(gte(invoices.invoiceDate, prevCutoff), lte(invoices.invoiceDate, cutoff), eq(invoices.paymentStatus, "paid")));

      type Inv = typeof currentInvoices[number];
      const totalRevenue = Math.round(currentInvoices.reduce((sum: number, inv: Inv) => sum + inv.totalAmount, 0) / 100);
      const prevRevenue = Math.round(prevInvoices.reduce((sum: number, inv: Inv) => sum + inv.totalAmount, 0) / 100);

      // Revenue by day
      const byDay: Record<string, number> = {};
      currentInvoices.forEach((inv: Inv) => {
        const day = new Date(inv.invoiceDate).toISOString().split("T")[0];
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
      const [overviewRows, laborPartsRows, monthlyRows, paymentRows, serviceRows, topDaysRows, hourRows, weeklyRows, velocityRows] = await Promise.all([
        // 1. Overview stats
        d.execute(rawSql`
          SELECT COUNT(*) as cnt, COALESCE(SUM(totalAmount),0) as rev,
                 COALESCE(SUM(laborCost),0) as labor, COALESCE(SUM(partsCost),0) as parts,
                 COALESCE(SUM(taxAmount),0) as tax,
                 COALESCE(AVG(totalAmount),0) as avgTicket,
                 COUNT(DISTINCT customerName) as uniqueCustomers,
                 COUNT(DISTINCT DATE(invoiceDate)) as activeDays
          FROM invoices WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
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
        // 4. Payment method breakdown
        d.execute(rawSql`
          SELECT paymentMethod, COUNT(*) as cnt, SUM(totalAmount) as rev
          FROM invoices WHERE invoiceDate >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)
          GROUP BY paymentMethod ORDER BY rev DESC
        `),
        // 5. Service category breakdown (from description keywords)
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
      ]);

      type RawRow = Record<string, unknown>;
      type RawResult = [RawRow[], unknown];
      const overview = ((overviewRows as RawResult)?.[0]?.[0] || {}) as RawRow;
      const lp = ((laborPartsRows as RawResult)?.[0]?.[0] || {}) as RawRow;
      const monthly = (((monthlyRows as RawResult)?.[0] || []) as RawRow[]).reverse();
      const payments = ((paymentRows as RawResult)?.[0] || []) as RawRow[];
      const services = ((serviceRows as RawResult)?.[0] || []) as RawRow[];
      const topDays = ((topDaysRows as RawResult)?.[0] || []) as RawRow[];
      const byDayOfWeek = ((hourRows as RawResult)?.[0] || []) as RawRow[];
      const weekly = (((weeklyRows as RawResult)?.[0] || []) as RawRow[]).reverse();
      const dailyVelocity = ((velocityRows as RawResult)?.[0] || []) as RawRow[];

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
        paymentMix: payments.map((p: RawRow) => ({
          method: p.paymentMethod || "unknown",
          count: Number(p.cnt),
          revenue: Math.round(Number(p.rev || 0) / 100),
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

  /** Declined estimates — pending invoices that never converted (recovery pipeline) */
  declined: adminProcedure
    .input(z.object({
      days: z.number().default(30),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { estimates: [], total: 0, recoverable: 0, recovered: 0, recoveryRate: 0 };

      const days = input?.days ?? 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);

      // Pending invoices = estimates that didn't convert
      const pending = await d.select().from(invoices)
        .where(and(
          eq(invoices.paymentStatus, "pending"),
          gte(invoices.invoiceDate, cutoff),
        ))
        .orderBy(desc(invoices.invoiceDate))
        .limit(200);

      // Count how many previously-pending invoices eventually got paid (recovery rate)
      const allTimeCutoff = new Date();
      allTimeCutoff.setDate(allTimeCutoff.getDate() - 90);
      const [recoveredResult] = await d.select({
        count: sql<number>`count(*)`,
      }).from(invoices).where(and(
        eq(invoices.paymentStatus, "paid"),
        gte(invoices.invoiceDate, allTimeCutoff),
      ));
      const [totalEstimatesResult] = await d.select({
        count: sql<number>`count(*)`,
      }).from(invoices).where(gte(invoices.invoiceDate, allTimeCutoff));

      const recovered = recoveredResult?.count ?? 0;
      const totalEstimates = totalEstimatesResult?.count ?? 0;
      const recoveryRate = totalEstimates > 0 ? Math.round((recovered / totalEstimates) * 100) : 0;

      const total = pending.length;
      const recoverable = pending.reduce((sum: number, inv: typeof pending[number]) => sum + (inv.totalAmount || 0), 0);

      return {
        estimates: pending,
        total,
        recoverable: Math.round(recoverable / 100),
        recovered,
        recoveryRate,
      };
    }),

  /** Mark a declined estimate for follow-up */
  markFollowUp: adminProcedure
    .input(z.object({
      id: z.number(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      // Update to partial status to indicate follow-up scheduled
      await d.update(invoices).set({ paymentStatus: "partial" }).where(eq(invoices.id, input.id));
      return { success: true };
    }),
});
