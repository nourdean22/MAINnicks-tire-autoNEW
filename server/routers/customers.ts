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
