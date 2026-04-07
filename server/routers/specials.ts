/**
 * Specials/Promotions Router — CRUD for active deals
 */
import { z } from "zod";
import { eq } from "drizzle-orm";
import { router, publicProcedure, adminProcedure } from "../_core/trpc";
import { randomUUID } from "crypto";

export const specialsRouter = router({
  getActive: publicProcedure.query(async () => {
    try {
      const { cached } = await import("../lib/cache");
      return cached("specials:active", 300, async () => {
        const { getDb } = await import("../db");
        const { specials } = await import("../../drizzle/schema");
        const db = await getDb();
        if (!db) return [];
        const now = new Date();
        const results = await db.select().from(specials)
          .where(eq(specials.isActive, true))
          .limit(20);
        return results.filter((s: any) => !s.expiresAt || new Date(s.expiresAt) > now);
      });
    } catch (err) {
      console.error("[Specials] Failed to fetch specials:", err instanceof Error ? err.message : err);
      return [];
    }
  }),

  create: adminProcedure
    .input(z.object({
      title: z.string().min(1).max(200),
      description: z.string().optional(),
      discountType: z.enum(["percent", "fixed", "free_service", "bundle"]),
      discountValue: z.number().optional(),
      serviceCategory: z.string().optional(),
      couponCode: z.string().optional(),
      startsAt: z.string(),
      expiresAt: z.string().optional(),
      maxUses: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { specials } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const id = randomUUID();
      await db.insert(specials).values({
        id,
        title: input.title,
        description: input.description,
        discountType: input.discountType,
        discountValue: input.discountValue ? String(input.discountValue) : undefined,
        serviceCategory: input.serviceCategory,
        couponCode: input.couponCode,
        startsAt: new Date(input.startsAt),
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
        maxUses: input.maxUses,
      });
      return { id, success: true };
    }),

  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { specials } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(specials).where(eq(specials.id, input.id));
      return { success: true };
    }),
});
