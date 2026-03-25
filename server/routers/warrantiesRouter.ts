/**
 * Warranties Router — Track and manage service warranties
 */
import { z } from "zod";
import { eq, lte, and } from "drizzle-orm";
import { router, adminProcedure, publicProcedure } from "../_core/trpc";
import { randomUUID } from "crypto";

export const warrantiesRouter = router({
  getByCustomer: adminProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { warranties } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) return [];
      return db.select().from(warranties).where(eq(warranties.customerId, input.customerId));
    }),

  getExpiringSoon: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { warranties } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return [];
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return db.select().from(warranties)
      .where(and(eq(warranties.status, "active"), lte(warranties.expiresAt, thirtyDaysFromNow.toISOString().split("T")[0])));
  }),

  create: adminProcedure
    .input(z.object({
      workOrderId: z.string(), customerId: z.string(), vehicleId: z.string().optional(),
      serviceDescription: z.string(), warrantyMonths: z.number(), warrantyMiles: z.number().optional(),
      mileageAtService: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { warranties } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const id = randomUUID();
      const startsAt = new Date().toISOString().split("T")[0];
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + input.warrantyMonths);
      await db.insert(warranties).values({
        id, ...input, startsAt, expiresAt: expiresAt.toISOString().split("T")[0],
      });
      return { id };
    }),

  check: publicProcedure
    .input(z.object({ warrantyId: z.string() }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { warranties } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) return null;
      const [w] = await db.select().from(warranties).where(eq(warranties.id, input.warrantyId)).limit(1);
      if (!w) return null;
      const isExpired = new Date(w.expiresAt) < new Date();
      return { ...w, isExpired, isActive: !isExpired && w.status === "active" };
    }),
});
