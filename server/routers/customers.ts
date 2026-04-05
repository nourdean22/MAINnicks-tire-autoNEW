/**
 * Customers router — admin endpoints for viewing/searching imported customer records.
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, like, or, sql, desc, asc } from "drizzle-orm";
import { customers, customerMetrics, bookings, leads, callbackRequests, callEvents } from "../../drizzle/schema";

async function db() {
  const { getDb } = await import("../db");
  return getDb();
}

export const customersRouter = router({
  /** List customers with pagination, search, and segment filtering */
  list: adminProcedure
    .input(
      z.object({
        page: z.number().default(1),
        pageSize: z.number().default(25),
        search: z.string().max(200).optional(),
        segment: z.enum(["all", "recent", "lapsed", "unknown"]).default("all"),
        sortBy: z.enum(["name", "visits", "lastVisit", "totalSpent"]).default("lastVisit"),
        sortDir: z.enum(["asc", "desc"]).default("desc"),
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
        conditions.push(eq(customers.segment, segment));
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
          lastVisitDate: customers.lastVisitDate,
          balanceDue: customers.balanceDue,
          alsCustomerId: customers.alsCustomerId,
          segment: customers.segment,
          smsCampaignSent: customers.smsCampaignSent,
          smsCampaignDate: customers.smsCampaignDate,
          notes: customers.notes,
          smsOptOut: customers.smsOptOut,
          createdAt: customers.createdAt,
          updatedAt: customers.updatedAt,
          // Metrics fields
          totalRevenue: customerMetrics.totalRevenue,
          avgSpendPerVisit: customerMetrics.avgSpendPerVisit,
          daysSinceLastVisit: customerMetrics.daysSinceLastVisit,
          churnRisk: customerMetrics.churnRisk,
          isVip: customerMetrics.isVip,
        })
        .from(customers)
        .leftJoin(customerMetrics, eq(customers.id, customerMetrics.customerId));

      if (whereClause) dataQuery.where(whereClause);

      const sortColumn = sortBy === "name" ? customers.firstName
        : sortBy === "visits" ? customers.totalVisits
        : sortBy === "totalSpent" ? customerMetrics.totalRevenue
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

  /** Get segment summary stats */
  stats: adminProcedure.query(async () => {
    const d = await db();
    if (!d) return { total: 0, recent: 0, lapsed: 0, unknown: 0, withEmail: 0, commercial: 0 };

    const [total] = await d.select({ count: sql<number>`count(*)` }).from(customers);
    const [recent] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.segment, "recent"));
    const [lapsed] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.segment, "lapsed"));
    const [unknown] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.segment, "unknown"));
    const [withEmail] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(sql`${customers.email} IS NOT NULL AND ${customers.email} != ''`);
    const [commercial] = await d.select({ count: sql<number>`count(*)` }).from(customers).where(eq(customers.customerType, "commercial"));

    return {
      total: total?.count ?? 0,
      recent: recent?.count ?? 0,
      lapsed: lapsed?.count ?? 0,
      unknown: unknown?.count ?? 0,
      withEmail: withEmail?.count ?? 0,
      commercial: commercial?.count ?? 0,
    };
  }),

  /** Get a single customer by ID */
  getById: adminProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return null;
      const [customer] = await d.select().from(customers).where(eq(customers.id, input.id));
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
      segment: z.enum(["all", "recent", "lapsed", "unknown"]).default("all"),
    }).optional())
    .query(async ({ input }) => {
      const d = await db();
      if (!d) return { csv: "" };

      const segment = input?.segment ?? "all";
      const query = d.select().from(customers);
      if (segment !== "all") {
        query.where(eq(customers.segment, segment));
      }
      const results = await query.orderBy(desc(customers.lastVisitDate));

      // Sanitize CSV cell value to prevent formula injection (=, +, -, @, tab, CR)
      const csvSafe = (val: string) => /^[=+\-@\t\r]/.test(val) ? `'${val}` : val;

      // Build CSV
      const headers = ["First Name", "Last Name", "Phone", "Email", "City", "State", "Segment", "Total Visits", "Last Visit", "Customer Type"];
      const rows = results.map(c => [
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

      const csv = [headers.join(","), ...rows.map(r => r.map(v => `"${v.replace(/"/g, '""')}"`).join(","))].join("\n");
      return { csv, count: results.length };
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
      const result = await sendSms(customer.phone, input.message);
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

        const result = await sendSms(c.phone, msg);
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
      const events: Array<{
        type: "booking" | "lead" | "callback" | "call";
        title: string;
        detail: string;
        status: string;
        date: Date;
      }> = [];

      try {
        // Bookings
        const bks = await d.select().from(bookings).where(eq(bookings.phone, phone)).orderBy(desc(bookings.createdAt));
        bks.forEach(b => events.push({
          type: "booking",
          title: `Booking: ${b.service || "General"}`,
          detail: b.vehicle || "",
          status: b.status || "new",
          date: new Date(b.createdAt),
        }));

        // Leads
        const lds = await d.select().from(leads).where(eq(leads.phone, phone)).orderBy(desc(leads.createdAt));
        lds.forEach(l => events.push({
          type: "lead",
          title: `Lead: ${l.source || "Direct"}`,
          detail: l.problem || l.vehicle || "",
          status: l.status || "new",
          date: new Date(l.createdAt),
        }));

        // Callbacks
        const cbs = await d.select().from(callbackRequests).where(eq(callbackRequests.phone, phone)).orderBy(desc(callbackRequests.createdAt));
        cbs.forEach(c => events.push({
          type: "callback",
          title: "Callback Request",
          detail: (c as any).context || (c as any).reason || "",
          status: (c as any).status || "new",
          date: new Date(c.createdAt),
        }));

        // Call events
        const cls = await d.select().from(callEvents).where(eq(callEvents.phoneNumber, phone)).orderBy(desc(callEvents.createdAt));
        cls.forEach(c => events.push({
          type: "call",
          title: "Phone Call",
          detail: c.sourcePage || "",
          status: "completed",
          date: new Date(c.createdAt),
        }));
      } catch (err) {
        // Some tables may not exist yet
        console.warn("[Customers] Activity timeline query failed:", err instanceof Error ? err.message : err);
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
          totalRevenue: customerMetrics.totalRevenue,
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
});
