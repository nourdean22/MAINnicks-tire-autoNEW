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
      if (input.category) {
        return db.select().from(inventory).where(eq(inventory.category, input.category)).limit(input.limit);
      }
      return db.select().from(inventory).limit(input.limit);
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

  /** Update inventory item details */
  update: adminProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().optional(),
      category: z.string().optional(),
      brand: z.string().optional(),
      size: z.string().optional(),
      cost: z.number().optional(),
      retailPrice: z.number().optional(),
      reorderThreshold: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { inventory } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const updates: Record<string, unknown> = {};
      if (input.name !== undefined) updates.name = input.name;
      if (input.category !== undefined) updates.category = input.category;
      if (input.brand !== undefined) updates.brand = input.brand;
      if (input.size !== undefined) updates.size = input.size;
      if (input.cost !== undefined) updates.cost = String(input.cost);
      if (input.retailPrice !== undefined) updates.retailPrice = String(input.retailPrice);
      if (input.reorderThreshold !== undefined) updates.reorderThreshold = input.reorderThreshold;
      if (Object.keys(updates).length > 0) {
        await db.update(inventory).set(updates).where(eq(inventory.id, input.id));
      }
      return { success: true };
    }),

  /** Delete inventory item */
  delete: adminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { inventory } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.delete(inventory).where(eq(inventory.id, input.id));
      return { success: true };
    }),

  /** Demand forecast — which vehicle makes we service most (predicts parts to stock) */
  demandForecast: adminProcedure.query(async () => {
    try {
      const { analyzeFleet } = await import("../services/intelligenceEngines");
      const result = await analyzeFleet();
      return {
        totalVehicles: result.totalVehicles,
        topMakes: result.topMakes,
        topByRevenue: result.topByRevenue,
      };
    } catch (e) {
      console.error("[Inventory] Demand forecast failed:", e instanceof Error ? e.message : e);
      return { totalVehicles: 0, topMakes: [], topByRevenue: [] };
    }
  }),

  /** Declined work parts — which services (and parts) customers decline most */
  declinedWorkParts: adminProcedure.query(async () => {
    try {
      const { analyzeDeclinedWork } = await import("../services/intelligenceEngines");
      const result = await analyzeDeclinedWork();
      return {
        totalWithDeclined: result.totalWithDeclined,
        totalDeclinedValue: result.totalDeclinedValue,
        topDeclinedServices: result.topDeclinedServices,
        recoveryOpportunity: result.recoveryOpportunity,
      };
    } catch (e) {
      console.error("[Inventory] Declined work analysis failed:", e instanceof Error ? e.message : e);
      return { totalWithDeclined: 0, totalDeclinedValue: 0, topDeclinedServices: [], recoveryOpportunity: 0 };
    }
  }),
});
