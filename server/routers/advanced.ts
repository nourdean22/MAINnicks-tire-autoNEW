/**
 * Advanced Features Router — Job Assignments, Invoices, CLV, KPIs, Customer Portal
 * AUDIT-FIXED: Rate limiting, session cleanup, invoice CRUD, optimized KPI, auto-stage
 */
import { adminProcedure, publicProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { BUSINESS } from "../../shared/business";

const MONTHLY_TARGET = BUSINESS.revenueTarget.monthly;
import { eq, desc, gte, lte, and, sql, asc } from "drizzle-orm";
import {
  jobAssignments, invoices, customerMetrics, kpiSnapshots, portalSessions,
  bookings, customers, technicians, reviewRequests, leads, serviceHistory,
} from "../../drizzle/schema";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

// ─── JOB ASSIGNMENTS ────────────────────────────────────
export const jobAssignmentsRouter = router({
  /** Assign a technician to a booking — also auto-updates stage to inspecting */
  assign: adminProcedure
    .input(z.object({
      bookingId: z.number(),
      technicianId: z.number(),
      estimatedHours: z.string().max(20).optional(),
      notes: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      // Check if already assigned
      const existing = await d.select().from(jobAssignments)
        .where(and(eq(jobAssignments.bookingId, input.bookingId), eq(jobAssignments.technicianId, input.technicianId)))
        .limit(1);
      if (existing.length > 0) {
        await d.update(jobAssignments).set({
          estimatedHours: input.estimatedHours || null,
          notes: input.notes || null,
        }).where(eq(jobAssignments.id, existing[0].id));
        return { success: true, id: existing[0].id };
      }
      const result = await d.insert(jobAssignments).values({
        bookingId: input.bookingId,
        technicianId: input.technicianId,
        estimatedHours: input.estimatedHours || null,
        notes: input.notes || null,
      });

      // Auto-update booking stage to "inspecting" if still "received"
      const [booking] = await d.select().from(bookings).where(eq(bookings.id, input.bookingId)).limit(1);
      if (booking && booking.stage === "received") {
        await d.update(bookings).set({
          stage: "inspecting",
          stageUpdatedAt: new Date(),
        }).where(eq(bookings.id, input.bookingId));
      }

      return { success: true, id: Number(result[0].insertId) };
    }),

  /** Unassign a technician */
  unassign: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      await d.delete(jobAssignments).where(eq(jobAssignments.id, input.id));
      return { success: true };
    }),

  /** Start timer for a job — also auto-updates stage to in-progress */
  startTimer: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const now = new Date();
      await d.update(jobAssignments).set({ startedAt: now }).where(eq(jobAssignments.id, input.id));

      // Auto-update booking stage to "in-progress"
      const [assignment] = await d.select().from(jobAssignments).where(eq(jobAssignments.id, input.id)).limit(1);
      if (assignment) {
        await d.update(bookings).set({
          stage: "in-progress",
          stageUpdatedAt: now,
        }).where(eq(bookings.id, assignment.bookingId));
      }

      return { success: true };
    }),

  /** Stop timer for a job — also auto-updates stage to quality-check */
  stopTimer: adminProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const now = new Date();
      await d.update(jobAssignments).set({ completedAt: now }).where(eq(jobAssignments.id, input.id));

      // Auto-update booking stage to "quality-check"
      const [assignment] = await d.select().from(jobAssignments).where(eq(jobAssignments.id, input.id)).limit(1);
      if (assignment) {
        await d.update(bookings).set({
          stage: "quality-check",
          stageUpdatedAt: now,
        }).where(eq(bookings.id, assignment.bookingId));
      }

      return { success: true };
    }),

  /** Get all assignments for a booking */
  byBooking: adminProcedure
    .input(z.object({ bookingId: z.number() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      const assignments = await d.select().from(jobAssignments)
        .where(eq(jobAssignments.bookingId, input.bookingId))
        .orderBy(desc(jobAssignments.createdAt));
      // Enrich with technician names
      const techIds = Array.from(new Set(assignments.map((a: typeof assignments[number]) => a.technicianId)));
      const techs = techIds.length > 0
        ? await d.select().from(technicians).where(sql`${technicians.id} IN (${sql.join(techIds.map(id => sql`${id}`), sql`, `)})`)
        : [];
      const techMap = new Map(techs.map((t: typeof techs[number]) => [t.id, t]));
      return assignments.map((a: typeof assignments[number]) => ({
        ...a,
        technician: techMap.get(a.technicianId) || null,
      }));
    }),

  /** Get all active assignments (for workload view) */
  active: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    const assignments = await d.select().from(jobAssignments)
      .where(sql`${jobAssignments.completedAt} IS NULL`)
      .orderBy(desc(jobAssignments.createdAt));
    return assignments;
  }),

  /** Technician workload summary */
  workload: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return [];
    const techs = await d.select().from(technicians).where(eq(technicians.isActive, 1));
    const activeJobs = await d.select().from(jobAssignments)
      .where(sql`${jobAssignments.completedAt} IS NULL`);
    return techs.map((t: typeof techs[number]) => ({
      id: t.id,
      name: t.name,
      title: t.title,
      photoUrl: t.photoUrl,
      activeJobs: activeJobs.filter((j: typeof activeJobs[number]) => j.technicianId === t.id).length,
      assignments: activeJobs.filter((j: typeof activeJobs[number]) => j.technicianId === t.id),
    }));
  }),
});

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
      import("../services/eventBus").then(({ emit }) =>
        emit.invoiceCreated({
          invoiceNumber: invNum,
          customerName: input.customerName,
          totalAmount: (input.totalAmount || 0) / 100,
          source: input.source,
        })
      ).catch((e) => { console.warn("[advanced] fire-and-forget failed:", e); });

      // Push to Auto Labor Guide (tries API first, falls back to Telegram)
      if (input.source !== "shopdriver") {
        import("../services/shopDriverSync").then(({ pushInvoice }) =>
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
        ).catch((e) => { console.warn("[advanced] fire-and-forget failed:", e); });
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
        } catch (e) { console.warn("[advanced:invoice] payment status check failed:", e); }
      }

      await d.update(invoices).set(cleanUpdates).where(eq(invoices.id, id));

      // Fire invoice_paid only on actual transition (not if already paid)
      if (input.paymentStatus === "paid" && !wasPaid) {
        import("../services/eventBus").then(({ emit }) =>
          emit.invoicePaid({
            invoiceNumber: String(input.id),
            customerName: input.customerName || "Unknown",
            totalAmount: (input.totalAmount || 0) / 100,
            method: input.paymentMethod || "unknown",
          })
        ).catch((e) => { console.warn("[advanced] fire-and-forget failed:", e); });
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
        d.execute(rawSql`
          SELECT
            SUM(CASE WHEN laborCost > 0 AND partsCost = 0 THEN 1 ELSE 0 END) as laborOnly,
            SUM(CASE WHEN laborCost = 0 AND partsCost > 0 THEN 1 ELSE 0 END) as partsOnly,
            SUM(CASE WHEN laborCost > 0 AND partsCost > 0 THEN 1 ELSE 0 END) as both,
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
          bothJobs: Number(lp.both || 0),
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
          } catch (e) { console.warn("[advanced:recommendations] analysis failed:", e); }
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

// ─── KPI COMMAND CENTER ─────────────────────────────────
export const kpiRouter = router({
  /** Get current KPIs (computed live) — OPTIMIZED: uses SQL aggregation */
  current: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return null;
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // This week's bookings
    const weekBookings = await d.select().from(bookings).where(gte(bookings.createdAt, weekAgo));
    const monthBookings = await d.select().from(bookings).where(gte(bookings.createdAt, monthAgo));
    const weekLeads = await d.select().from(leads).where(gte(leads.createdAt, weekAgo));
    const monthLeads = await d.select().from(leads).where(gte(leads.createdAt, monthAgo));

    // Revenue this month
    const monthInvoices = await d.select().from(invoices)
      .where(and(gte(invoices.invoiceDate, monthAgo), eq(invoices.paymentStatus, "paid")));
    const monthRevenue = Math.round(monthInvoices.reduce((sum: number, inv: typeof monthInvoices[number]) => sum + inv.totalAmount, 0) / 100);

    // Review stats
    const monthReviews = await d.select().from(reviewRequests).where(gte(reviewRequests.createdAt, monthAgo));
    const reviewsSent = monthReviews.filter((r: typeof monthReviews[number]) => r.status === "sent" || r.status === "clicked").length;
    const reviewsClicked = monthReviews.filter((r: typeof monthReviews[number]) => r.status === "clicked").length;

    // Conversion rate
    const totalLeads = monthLeads.length;
    const convertedLeads = monthLeads.filter((l: typeof monthLeads[number]) => l.status === "booked").length;
    const conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;

    // Customer counts
    const [customerCount] = await d.select({ count: sql<number>`count(*)` }).from(customers);
    const [newCustomerCount] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(gte(customers.createdAt, monthAgo));

    // Booking by day of week (OPTIMIZED: SQL aggregation instead of fetching all rows)
    // NOTE: Use raw SQL to avoid TiDB mismatch between SELECT/GROUP BY column qualification
    const dayOfWeekRaw = await d.execute(
      sql`SELECT DAYOFWEEK(createdAt) as dow, count(*) as cnt FROM bookings GROUP BY dow`
    );

    type RawRow2 = Record<string, unknown>;
    const dayOfWeekCounts = [0, 0, 0, 0, 0, 0, 0]; // Sun-Sat
    for (const r of (dayOfWeekRaw as [RawRow2[], unknown])[0]) {
      const idx = Number(r.dow) - 1;
      if (idx >= 0 && idx < 7) dayOfWeekCounts[idx] = Number(r.cnt);
    }

    // Booking by hour (OPTIMIZED: SQL aggregation)
    const hourRaw = await d.execute(
      sql`SELECT HOUR(createdAt) as hr, count(*) as cnt FROM bookings GROUP BY hr`
    );

    const hourCounts = new Array(24).fill(0);
    for (const r of (hourRaw as [RawRow2[], unknown])[0]) {
      if (Number(r.hr) >= 0 && Number(r.hr) < 24) hourCounts[Number(r.hr)] = Number(r.cnt);
    }

    return {
      weekBookings: weekBookings.length,
      monthBookings: monthBookings.length,
      weekLeads: weekLeads.length,
      monthLeads: monthLeads.length,
      monthRevenue,
      avgTicket: monthInvoices.length > 0 ? Math.round(monthRevenue / monthInvoices.length) : 0,
      conversionRate,
      reviewsSent,
      reviewsClicked,
      totalCustomers: customerCount?.count ?? 0,
      newCustomersThisMonth: newCustomerCount?.count ?? 0,
      dayOfWeekCounts,
      hourCounts,
      completedThisWeek: weekBookings.filter((b: typeof weekBookings[number]) => b.status === "completed").length,
      completedThisMonth: monthBookings.filter((b: typeof monthBookings[number]) => b.status === "completed").length,
      emergencyThisWeek: weekBookings.filter((b: typeof weekBookings[number]) => b.urgency === "emergency").length,
    };
  }),

  /** Get historical KPI snapshots for trend charts */
  history: adminProcedure
    .input(z.object({ weeks: z.number().default(12) }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return [];
      return d.select().from(kpiSnapshots)
        .orderBy(desc(kpiSnapshots.weekStart))
        .limit(input?.weeks ?? 12);
    }),
});

// ─── CUSTOMER PORTAL ────────────────────────────────────
export const portalRouter = router({
  /** Request a verification code (public) — with rate limiting */
  requestCode: publicProcedure
    .input(z.object({ phone: z.string().min(10).max(20) }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const normalized = input.phone.replace(/\D/g, "").slice(-10);

      // Rate limiting: max 3 codes per phone per hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const recentCodes = await d.select({ count: sql<number>`count(*)` })
        .from(portalSessions)
        .where(and(
          eq(portalSessions.phone, normalized),
          gte(portalSessions.createdAt, oneHourAgo),
        ));
      if ((recentCodes[0]?.count ?? 0) >= 3) {
        throw new Error("Too many code requests. Please wait and try again.");
      }

      // Generate 6-digit code
      const { randomInt } = await import("crypto");
      const code = String(randomInt(100000, 999999));
      const codeExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

      // Find customer
      const [customer] = await d.select().from(customers)
        .where(sql`REPLACE(REPLACE(REPLACE(REPLACE(${customers.phone}, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ${'%' + normalized}`)
        .limit(1);

      await d.insert(portalSessions).values({
        phone: normalized,
        customerId: customer?.id || null,
        verificationCode: code,
        codeExpiresAt,
      });

      // Send verification code via SMS
      try {
        const { sendSms } = await import("../sms");
        const result = await sendSms(normalized, `Your Nick's Tire & Auto verification code is: ${code}. Valid for 10 minutes.`);
        if (!result.success) {
          console.warn(`[Portal] SMS failed for ${normalized}:`, result);
        }
      } catch (err) {
        if (process.env.NODE_ENV !== "production") {
          // Only log last 4 digits of phone in dev — never leak OTPs
          console.warn(`[Portal] Verification code sent to ...${normalized.slice(-4)}`);
        }
      }

      return { success: true, message: "Verification code sent" };
    }),

  /** Verify code and create session (public) — cleans up expired sessions */
  verifyCode: publicProcedure
    .input(z.object({ phone: z.string().max(20), code: z.string().max(6) }))
    .mutation(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const normalized = input.phone.replace(/\D/g, "").slice(-10);
      const now = new Date();

      // Brute force protection — block after 5 failed attempts (1 hour cooldown)
      const { checkBruteForce, recordFailedAttempt, clearAttempts } = await import("../middleware/bruteForce");
      const bruteCheck = checkBruteForce(normalized);
      if (!bruteCheck.allowed) {
        throw new Error(`Too many attempts. Try again in ${Math.ceil((bruteCheck.retryAfter || 3600) / 60)} minutes.`);
      }

      // Clean up expired sessions (older than 24 hours)
      const cleanupCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await d.delete(portalSessions).where(lte(portalSessions.createdAt, cleanupCutoff));

      const [session] = await d.select().from(portalSessions)
        .where(and(
          eq(portalSessions.phone, normalized),
          eq(portalSessions.verificationCode, input.code),
          eq(portalSessions.verified, 0),
          gte(portalSessions.codeExpiresAt, now),
        ))
        .orderBy(desc(portalSessions.createdAt))
        .limit(1);

      if (!session) {
        recordFailedAttempt(normalized);
        throw new Error("Invalid or expired code");
      }

      // Valid code — clear brute force counter
      clearAttempts(normalized);

      // Generate session token
      const { randomInt } = await import("crypto");
      const token = Array.from({ length: 64 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[randomInt(36)]).join("");
      const sessionExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      await d.update(portalSessions).set({
        verified: 1,
        sessionToken: token,
        sessionExpiresAt,
      }).where(eq(portalSessions.id, session.id));

      return { success: true, token, customerId: session.customerId };
    }),

  /** Get customer data by portal session token (public) */
  myData: publicProcedure
    .input(z.object({ token: z.string().max(500) }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) throw new Error("Database not available");
      const now = new Date();

      const [session] = await d.select().from(portalSessions)
        .where(and(
          eq(portalSessions.sessionToken, input.token),
          eq(portalSessions.verified, 1),
          gte(portalSessions.sessionExpiresAt, now),
        ))
        .limit(1);

      if (!session) throw new Error("Session expired or invalid");

      // Get customer info
      let customer = null;
      if (session.customerId) {
        const [c] = await d.select().from(customers).where(eq(customers.id, session.customerId)).limit(1);
        customer = c || null;
      }

      // Get bookings by phone
      const customerBookings = await d.select().from(bookings)
        .where(sql`REPLACE(REPLACE(REPLACE(REPLACE(${bookings.phone}, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ${'%' + session.phone}`)
        .orderBy(desc(bookings.createdAt))
        .limit(20);

      // Get invoices by phone
      const customerInvoices = await d.select().from(invoices)
        .where(sql`REPLACE(REPLACE(REPLACE(REPLACE(${invoices.customerPhone}, '-', ''), '(', ''), ')', ''), ' ', '') LIKE ${'%' + session.phone}`)
        .orderBy(desc(invoices.invoiceDate))
        .limit(20);

      // Get service history if customer exists
      const history = session.customerId
        ? await d.select().from(serviceHistory)
            .where(eq(serviceHistory.userId, session.customerId))
            .orderBy(desc(serviceHistory.completedAt))
            .limit(20)
        : [];

      return {
        customer,
        bookings: customerBookings,
        invoices: customerInvoices,
        serviceHistory: history,
        phone: session.phone,
      };
    }),
});
