/**
 * Work Orders Router — Service order CRUD and lifecycle management
 */
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { router, adminProcedure } from "../_core/trpc";
import { randomUUID } from "crypto";

export const workOrdersRouter = router({
  create: adminProcedure
    .input(z.object({
      customerId: z.string(),
      vehicleId: z.string().optional(),
      status: z.string().default("pending"),
      priority: z.string().default("normal"),
      customerComplaint: z.string().optional(),
      source: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { workOrders } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const id = randomUUID();
      const orderNumber = `WO-${new Date().getFullYear()}-${Date.now().toString().slice(-6)}`;
      await db.insert(workOrders).values({ id, orderNumber, ...input });
      return { id, orderNumber };
    }),

  getById: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { workOrders, workOrderItems } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) return null;
      const [order] = await db.select().from(workOrders).where(eq(workOrders.id, input.id)).limit(1);
      if (!order) return null;
      const items = await db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, input.id));
      return { ...order, items };
    }),

  updateStatus: adminProcedure
    .input(z.object({ id: z.string(), status: z.string() }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { workOrders } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(workOrders).set({ status: input.status }).where(eq(workOrders.id, input.id));
      return { success: true };
    }),

  addLineItem: adminProcedure
    .input(z.object({
      workOrderId: z.string(),
      type: z.string(),
      description: z.string(),
      quantity: z.number().default(1),
      unitPrice: z.number().default(0),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { workOrderItems } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const id = randomUUID();
      const total = input.quantity * input.unitPrice;
      await db.insert(workOrderItems).values({
        id,
        workOrderId: input.workOrderId,
        type: input.type,
        description: input.description,
        quantity: String(input.quantity),
        unitPrice: String(input.unitPrice),
        total: String(total),
      });
      return { id, total };
    }),

  getRecent: adminProcedure
    .input(z.object({ limit: z.number().default(20) }))
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { workOrders } = await import("../../drizzle/schema");
      const db = await getDb();
      if (!db) return [];
      return db.select().from(workOrders).orderBy(desc(workOrders.createdAt)).limit(input.limit);
    }),
});
