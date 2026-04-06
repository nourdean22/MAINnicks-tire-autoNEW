/**
 * Work Orders Router — Full lifecycle from estimate → close.
 * Powered by workOrderService for all business logic.
 */
import { z } from "zod";
import { router, adminProcedure } from "../_core/trpc";

export const workOrdersRouter = router({
  /** Create work order (from estimate or standalone) */
  create: adminProcedure
    .input(z.object({
      customerId: z.string(),
      vehicleYear: z.number().optional(),
      vehicleMake: z.string().optional(),
      vehicleModel: z.string().optional(),
      vehicleVin: z.string().optional(),
      vehicleMileage: z.number().optional(),
      serviceDescription: z.string().optional(),
      customerComplaint: z.string().optional(),
      priority: z.string().default("normal"),
      source: z.string().default("manual"),
      bookingId: z.number().optional(),
      estimateId: z.number().optional(),
      inspectionId: z.number().optional(),
      promisedAt: z.string().optional(),
      quotedTotal: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { createWorkOrder } = await import("../services/workOrderService");
      const result = await createWorkOrder({
        ...input,
        promisedAt: input.promisedAt ? new Date(input.promisedAt) : undefined,
      });

      // Work order = revenue commitment — make it visible to the whole system
      import("../services/eventBus").then(({ dispatch }) =>
        dispatch("booking_created", {
          id: result.id,
          name: input.customerId,
          phone: "",
          service: input.serviceDescription || "Work Order",
          vehicle: [input.vehicleMake, input.vehicleModel].filter(Boolean).join(" "),
          source: input.source,
        }, { priority: "high", source: "work_order" })
      ).catch(() => {});

      return result;
    }),

  /** List work orders with optional filters */
  list: adminProcedure
    .input(z.object({
      status: z.string().optional(),
      priority: z.string().optional(),
      customerId: z.string().optional(),
      assignedTech: z.string().optional(),
      includeTerminal: z.boolean().default(false),
      limit: z.number().default(50),
    }).optional())
    .query(async ({ input }) => {
      const { getDb } = await import("../db");
      const { workOrders } = await import("../../drizzle/schema");
      const { eq, desc, and, notInArray } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) return [];

      const conditions: any[] = [];
      if (input?.status) conditions.push(eq(workOrders.status, input.status));
      if (input?.priority) conditions.push(eq(workOrders.priority, input.priority));
      if (input?.customerId) conditions.push(eq(workOrders.customerId, input.customerId));
      if (input?.assignedTech) conditions.push(eq(workOrders.assignedTech, input.assignedTech));
      if (!input?.includeTerminal) {
        conditions.push(notInArray(workOrders.status, ["picked_up", "invoiced", "closed", "cancelled"]));
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      return db.select().from(workOrders)
        .where(where)
        .orderBy(desc(workOrders.createdAt))
        .limit(input?.limit ?? 50);
    }),

  /** Get work order by ID with items + transitions */
  getById: adminProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input }) => {
      const { getWorkOrderWithItems } = await import("../services/workOrderService");
      return getWorkOrderWithItems(input.id);
    }),

  /** Advance work order status */
  advanceStatus: adminProcedure
    .input(z.object({
      id: z.string(),
      status: z.string(),
      changedBy: z.string().default("admin"),
      note: z.string().optional(),
      blockerType: z.string().optional(),
      blockerNote: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { updateStatus } = await import("../services/workOrderService");
      await updateStatus(input.id, input.status as any, input.changedBy, {
        note: input.note,
        blockerType: input.blockerType as any,
        blockerNote: input.blockerNote,
      });

      // Status changes = shop floor progress — dispatch to event bus
      import("../services/eventBus").then(({ dispatch }) =>
        dispatch("stage_changed", {
          workOrderId: input.id,
          newStatus: input.status,
          changedBy: input.changedBy,
          note: input.note,
        }, { priority: "normal", source: "work_order" })
      ).catch(() => {});

      // Completed work orders = revenue realized
      if (["completed", "invoiced", "picked_up"].includes(input.status)) {
        import("../services/eventBus").then(({ dispatch }) =>
          dispatch("booking_completed", {
            id: input.id,
            name: input.changedBy,
            service: input.note || "Work Order Completed",
          }, { priority: "high", source: "work_order" })
        ).catch(() => {});
      }

      return { success: true };
    }),

  /** Update fields (tech, bay, notes, promise time, etc.) */
  updateFields: adminProcedure
    .input(z.object({
      id: z.string(),
      assignedTech: z.string().optional(),
      assignedBay: z.string().optional(),
      assignedAdvisor: z.string().optional(),
      techNotes: z.string().optional(),
      promisedAt: z.string().optional(),
      priority: z.string().optional(),
      serviceDescription: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { getDb } = await import("../db");
      const { workOrders } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const { id, ...fields } = input;
      const updates: Record<string, any> = { updatedAt: new Date() };
      if (fields.assignedTech !== undefined) updates.assignedTech = fields.assignedTech;
      if (fields.assignedBay !== undefined) updates.assignedBay = fields.assignedBay;
      if (fields.assignedAdvisor !== undefined) updates.assignedAdvisor = fields.assignedAdvisor;
      if (fields.techNotes !== undefined) updates.techNotes = fields.techNotes;
      if (fields.promisedAt !== undefined) updates.promisedAt = new Date(fields.promisedAt);
      if (fields.priority !== undefined) updates.priority = fields.priority;
      if (fields.serviceDescription !== undefined) updates.serviceDescription = fields.serviceDescription;

      await db.update(workOrders).set(updates).where(eq(workOrders.id, id));
      return { success: true };
    }),

  /** Add a line item to a work order */
  addLineItem: adminProcedure
    .input(z.object({
      workOrderId: z.string(),
      type: z.string(),
      description: z.string(),
      quantity: z.number().default(1),
      unitPrice: z.number().default(0),
      unitCost: z.number().default(0),
      laborHours: z.number().optional(),
      laborRate: z.number().optional(),
      laborSource: z.string().optional(),
      partNumber: z.string().optional(),
      partStatus: z.string().default("not_needed"),
      partSource: z.string().optional(),
      urgency: z.string().optional(),
      approved: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      const { addLineItem } = await import("../services/workOrderService");
      const id = await addLineItem(input);
      return { id };
    }),

  /** Update part status on a line item */
  updatePartStatus: adminProcedure
    .input(z.object({
      lineId: z.string(),
      status: z.string(),
      supplierName: z.string().optional(),
      supplierOrderRef: z.string().optional(),
      eta: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { updatePartStatus } = await import("../services/workOrderService");
      await updatePartStatus(input.lineId, input.status, {
        supplierName: input.supplierName,
        supplierOrderRef: input.supplierOrderRef,
        eta: input.eta ? new Date(input.eta) : undefined,
      });
      return { success: true };
    }),

  /** Get blocked work orders */
  blocked: adminProcedure.query(async () => {
    const { getBlockedWorkOrders } = await import("../services/workOrderService");
    return getBlockedWorkOrders();
  }),

  /** Get overdue work orders */
  overdue: adminProcedure.query(async () => {
    const { getOverdueWorkOrders } = await import("../services/workOrderService");
    return getOverdueWorkOrders();
  }),

  /** Get work order stats for dashboard */
  stats: adminProcedure.query(async () => {
    const { getWorkOrderStats } = await import("../services/workOrderService");
    return getWorkOrderStats();
  }),

  /** Get pending parts across all work orders */
  pendingParts: adminProcedure.query(async () => {
    const { getPendingParts } = await import("../services/workOrderService");
    return getPendingParts();
  }),

  /** Get pickup queue */
  pickupQueue: adminProcedure.query(async () => {
    const { getReadyForPickup } = await import("../services/workOrderService");
    return getReadyForPickup();
  }),

  /** Get declined work history for a customer */
  declinedWork: adminProcedure
    .input(z.object({ customerId: z.string() }))
    .query(async ({ input }) => {
      const { getDeclinedWorkHistory } = await import("../services/workOrderService");
      return getDeclinedWorkHistory(input.customerId);
    }),

  /** Conversion funnel: WO creation → invoiced → paid */
  conversionFunnel: adminProcedure
    .input(z.object({ days: z.number().min(7).max(365).default(90) }).optional())
    .query(async ({ input }) => {
      const { getConversionFunnel } = await import("../services/workOrderService");
      return getConversionFunnel(input?.days ?? 90);
    }),

  /** Get status config for UI rendering */
  statusConfig: adminProcedure.query(async () => {
    const { STATUS_CONFIG } = await import("../services/workOrderService");
    return STATUS_CONFIG;
  }),
});
