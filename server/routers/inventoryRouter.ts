/**
 * Inventory Router — Parts and tire stock management
 */
import { z } from "zod";
import { eq, lte } from "drizzle-orm";
import { router, adminProcedure } from "../_core/trpc";
import { randomUUID } from "crypto";

export const inventoryRouter = router({
  getAll: adminProcedure
    .input(z.object({ category: z.string().optional(), limit: z.number().default(100) }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { inventory } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) return [];
      let query = db.select().from(inventory).limit(input.limit);
      if (input.category) {
        query = db.select().from(inventory).where(eq(inventory.category, input.category)).limit(input.limit);
      }
      return query;
    }),

  getLowStock: adminProcedure.query(async () => {
    const { getDb } = await import("../db");
    const { inventory } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return [];
    return db.select().from(inventory).where(lte(inventory.quantityOnHand, inventory.reorderThreshold));
  }),

  adjustStock: adminProcedure
    .input(z.object({ id: z.string(), adjustment: z.number(), reason: z.string().optional() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { inventory } = await import("../../drizzle/schema");
      const { sql } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(inventory)
        .set({ quantityOnHand: sql`${inventory.quantityOnHand} + ${input.adjustment}` })
        .where(eq(inventory.id, input.id));
      return { success: true };
    }),

  create: adminProcedure
    .input(z.object({
      name: z.string(), category: z.string(), brand: z.string().optional(),
      size: z.string().optional(), cost: z.number().optional(), retailPrice: z.number().optional(),
      quantityOnHand: z.number().default(0), reorderThreshold: z.number().default(2),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { inventory } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const id = randomUUID();
      await db.insert(inventory).values({
        id, name: input.name, category: input.category, brand: input.brand,
        size: input.size, cost: input.cost ? String(input.cost) : undefined,
        retailPrice: input.retailPrice ? String(input.retailPrice) : undefined,
        quantityOnHand: input.quantityOnHand, reorderThreshold: input.reorderThreshold,
      });
      return { id };
    }),
});
