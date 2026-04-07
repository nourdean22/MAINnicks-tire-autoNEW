/**
 * Waitlist Router — Overflow booking when shop is full
 */
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import { randomUUID } from "crypto";
import { sanitizeName, sanitizePhone, sanitizeText } from "../sanitize";

export const waitlistRouter = router({
  join: publicProcedure
    .input(z.object({
      customerName: z.string().min(1).max(200),
      customerPhone: z.string().min(10).max(20),
      customerEmail: z.string().email().optional(),
      serviceType: z.string().max(200).optional(),
      preferredDate: z.string().max(30).optional(),
      notes: z.string().max(1000).optional(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { waitlist } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const id = randomUUID();
      await db.insert(waitlist).values({
        id,
        customerName: sanitizeName(input.customerName),
        customerPhone: sanitizePhone(input.customerPhone),
        customerEmail: input.customerEmail,
        serviceType: input.serviceType ? sanitizeText(input.serviceType) : undefined,
        preferredDate: input.preferredDate ? new Date(input.preferredDate) : null,
        notes: input.notes ? sanitizeText(input.notes) : undefined,
      });
      return { id, position: "You'll be notified when a slot opens." };
    }),

  getAll: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { waitlist } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return [];
    return db.select().from(waitlist).where(eq(waitlist.status, "waiting")).orderBy(desc(waitlist.createdAt));
  }),

  notify: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { waitlist } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(waitlist).set({ status: "notified", notifiedAt: new Date() }).where(eq(waitlist.id, input.id));
      return { success: true };
    }),

  /** Smart queue — waitlist sorted by VIP status (high-value customers first) */
  smartQueue: adminProcedure.query(async () => {
    try {
      const { getDb } = await import("../db");
      const { waitlist, customers, customerMetrics } = await import("../../drizzle/schema");
      const { eq: eqOp, sql: sqlFn } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return [];

      const entries = await db
        .select({
          id: waitlist.id,
          customerName: waitlist.customerName,
          customerPhone: waitlist.customerPhone,
          customerEmail: waitlist.customerEmail,
          serviceType: waitlist.serviceType,
          preferredDate: waitlist.preferredDate,
          notes: waitlist.notes,
          status: waitlist.status,
          createdAt: waitlist.createdAt,
          // Customer match fields
          customerId: customers.id,
          totalSpent: customers.totalSpent,
          totalVisits: customers.totalVisits,
          isVip: customerMetrics.isVip,
        })
        .from(waitlist)
        .leftJoin(customers, sqlFn`RIGHT(REPLACE(REPLACE(REPLACE(${customers.phone}, '-', ''), '(', ''), ')', ''), 10) = RIGHT(REPLACE(REPLACE(REPLACE(${waitlist.customerPhone}, '-', ''), '(', ''), ')', ''), 10)`)
        .leftJoin(customerMetrics, eqOp(customers.id, customerMetrics.customerId))
        .where(eqOp(waitlist.status, "waiting"))
        .orderBy(sqlFn`${customerMetrics.isVip} DESC, ${waitlist.createdAt} ASC`);

      return entries.map((e: any) => ({
        id: e.id,
        customerName: e.customerName,
        customerPhone: e.customerPhone,
        customerEmail: e.customerEmail,
        serviceType: e.serviceType,
        preferredDate: e.preferredDate,
        notes: e.notes,
        status: e.status,
        createdAt: e.createdAt,
        isExistingCustomer: !!e.customerId,
        isVip: !!(e.isVip),
        totalSpent: e.totalSpent ? (e.totalSpent as number) / 100 : 0,
        priority: e.isVip ? "vip" : e.customerId ? "returning" : "new",
      }));
    } catch (e) {
      console.error("[Waitlist] Smart queue failed:", e instanceof Error ? e.message : e);
      return [];
    }
  }),
});
