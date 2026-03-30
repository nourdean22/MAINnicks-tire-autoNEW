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
});
