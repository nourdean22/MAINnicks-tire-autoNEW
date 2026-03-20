/**
 * Customers router — admin endpoints for viewing/searching imported customer records.
 */
import { adminProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { eq, like, or, sql, desc, asc } from "drizzle-orm";
import { customers } from "../../drizzle/schema";

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
        search: z.string().optional(),
        segment: z.enum(["all", "recent", "lapsed", "unknown"]).default("all"),
        sortBy: z.enum(["name", "visits", "lastVisit"]).default("lastVisit"),
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
        conditions.push(
          or(
            like(customers.firstName, `%${search}%`),
            like(customers.lastName, `%${search}%`),
            like(customers.phone, `%${search}%`),
            like(customers.email, `%${search}%`),
            like(customers.city, `%${search}%`),
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

      // Get page of results
      const sortColumn = sortBy === "name" ? customers.firstName
        : sortBy === "visits" ? customers.totalVisits
        : customers.lastVisitDate;
      const sortFn = sortDir === "asc" ? asc : desc;

      const dataQuery = d.select().from(customers);
      if (whereClause) dataQuery.where(whereClause);
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

      // Build CSV
      const headers = ["First Name", "Last Name", "Phone", "Email", "City", "State", "Segment", "Total Visits", "Last Visit", "Customer Type"];
      const rows = results.map(c => [
        c.firstName || "",
        c.lastName || "",
        c.phone || "",
        c.email || "",
        c.city || "",
        c.state || "",
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
      const { STORE_NAME, STORE_PHONE, GBP_REVIEW_URL } = await import("@shared/const");

      // Get untexted customers
      const untexted = await d.select()
        .from(customers)
        .where(sql`${customers.smsCampaignSent} = 0 AND ${customers.phone} IS NOT NULL AND LENGTH(${customers.phone}) >= 10`)
        .limit(batchSize);

      let sent = 0;
      let failed = 0;

      for (const c of untexted) {
        const name = c.firstName || "there";
        const msg = `Hi ${name}, thank you for choosing ${STORE_NAME}! We truly appreciate your business.\n\nIf you have 30 seconds, a Google review helps other Cleveland drivers find honest repair:\n${GBP_REVIEW_URL}\n\nKnow someone who needs reliable auto service? Refer them to us: nickstire.org/refer\n\nThank you! — Nick's Team\n${STORE_PHONE}`;

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
});
