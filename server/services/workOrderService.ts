/**
 * Work Order Service — Full lifecycle management from estimate to close.
 *
 * Status flow:
 *   draft → approved → parts_needed → parts_ordered → parts_received
 *     → ready_for_bay → assigned → in_progress → qc_review
 *     → ready_for_pickup → customer_notified → picked_up → invoiced → closed
 *
 * Branch states: on_hold, cancelled
 */
import { eq, desc, and, lt, sql, notInArray } from "drizzle-orm";
import { randomUUID } from "crypto";

export type WorkOrderStatus =
  | "draft" | "approved" | "parts_needed" | "parts_ordered" | "parts_partial"
  | "parts_received" | "ready_for_bay" | "assigned" | "in_progress"
  | "qc_review" | "ready_for_pickup" | "customer_notified"
  | "picked_up" | "invoiced" | "closed" | "on_hold" | "cancelled";

export type BlockerType =
  | "waiting_customer" | "waiting_parts" | "waiting_parts_order"
  | "waiting_financing" | "waiting_approval" | "waiting_tech"
  | "waiting_bay" | "waiting_road_test" | "waiting_payment"
  | "waiting_pickup" | "backorder" | "other";

const TERMINAL_STATUSES: WorkOrderStatus[] = ["picked_up", "invoiced", "closed", "cancelled"];
const ACTIVE_STATUSES: WorkOrderStatus[] = [
  "draft", "approved", "parts_needed", "parts_ordered", "parts_partial",
  "parts_received", "ready_for_bay", "assigned", "in_progress",
  "qc_review", "ready_for_pickup", "customer_notified", "on_hold",
];

// ─── Legal state transitions ────────────────────────
// Enforced in updateStatus() to prevent illegal state jumps
const LEGAL_TRANSITIONS: Record<WorkOrderStatus, WorkOrderStatus[]> = {
  draft: ["approved", "cancelled"],
  approved: ["parts_needed", "ready_for_bay", "in_progress", "cancelled", "on_hold"],
  parts_needed: ["parts_ordered", "cancelled", "on_hold"],
  parts_ordered: ["parts_partial", "parts_received", "cancelled", "on_hold"],
  parts_partial: ["parts_received", "parts_ordered", "cancelled", "on_hold"],
  parts_received: ["ready_for_bay", "on_hold", "cancelled"],
  ready_for_bay: ["assigned", "in_progress", "on_hold", "cancelled"],
  assigned: ["in_progress", "ready_for_bay", "on_hold", "cancelled"],
  in_progress: ["qc_review", "on_hold", "parts_needed"],
  qc_review: ["ready_for_pickup", "in_progress"],
  ready_for_pickup: ["customer_notified", "picked_up"],
  customer_notified: ["picked_up"],
  picked_up: ["invoiced", "closed"],
  invoiced: ["closed"],
  closed: [],
  on_hold: ["approved", "parts_needed", "ready_for_bay", "in_progress", "cancelled"],
  cancelled: [],
};

// Status display config
export const STATUS_CONFIG: Record<string, { label: string; color: string; bgColor: string }> = {
  draft: { label: "Draft", color: "text-foreground/50", bgColor: "bg-foreground/5" },
  approved: { label: "Approved", color: "text-blue-400", bgColor: "bg-blue-500/10" },
  parts_needed: { label: "Parts Needed", color: "text-amber-400", bgColor: "bg-amber-500/10" },
  parts_ordered: { label: "Parts Ordered", color: "text-amber-400", bgColor: "bg-amber-500/10" },
  parts_partial: { label: "Parts Partial", color: "text-amber-400", bgColor: "bg-amber-500/10" },
  parts_received: { label: "Parts Ready", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  ready_for_bay: { label: "Ready for Bay", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  assigned: { label: "Assigned", color: "text-blue-400", bgColor: "bg-blue-500/10" },
  in_progress: { label: "In Progress", color: "text-primary", bgColor: "bg-primary/10" },
  qc_review: { label: "QC Review", color: "text-purple-400", bgColor: "bg-purple-500/10" },
  ready_for_pickup: { label: "Ready for Pickup", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  customer_notified: { label: "Customer Notified", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  picked_up: { label: "Picked Up", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  invoiced: { label: "Invoiced", color: "text-emerald-400", bgColor: "bg-emerald-500/10" },
  closed: { label: "Closed", color: "text-foreground/40", bgColor: "bg-foreground/5" },
  on_hold: { label: "On Hold", color: "text-amber-400", bgColor: "bg-amber-500/10" },
  cancelled: { label: "Cancelled", color: "text-red-400", bgColor: "bg-red-500/10" },
};

// ─── Helper to get DB ────────────────────────────────
async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const schema = await import("../../drizzle/schema");
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return { db: d, ...schema };
}

// ─── Generate order number ───────────────────────────
export function generateWorkOrderNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const seq = Date.now().toString().slice(-6);
  return `WO-${y}-${seq}`;
}

// ─── Log a status transition ─────────────────────────
export async function logTransition(
  workOrderId: string,
  fromStatus: string | null,
  toStatus: string,
  changedBy: string,
  note?: string
): Promise<void> {
  const { db, workOrderTransitions } = await getDbAndSchema();
  await db.insert(workOrderTransitions).values({
    workOrderId,
    fromStatus,
    toStatus,
    changedBy,
    note: note || null,
  });
}

// ─── Create work order ──────────────────────────────
export async function createWorkOrder(params: {
  customerId: string;
  vehicleInfo?: string;
  vehicleYear?: number;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleVin?: string;
  vehicleMileage?: number;
  serviceDescription?: string;
  customerComplaint?: string;
  priority?: string;
  source?: string;
  bookingId?: number;
  estimateId?: number;
  inspectionId?: number;
  promisedAt?: Date;
  quotedTotal?: number;
}): Promise<{ id: string; orderNumber: string }> {
  const { db, workOrders } = await getDbAndSchema();
  const id = randomUUID();
  const orderNumber = generateWorkOrderNumber();

  await db.insert(workOrders).values({
    id,
    orderNumber,
    customerId: params.customerId,
    status: "approved",
    priority: params.priority || "normal",
    vehicleYear: params.vehicleYear,
    vehicleMake: params.vehicleMake,
    vehicleModel: params.vehicleModel,
    vehicleVin: params.vehicleVin,
    vehicleMileage: params.vehicleMileage,
    serviceDescription: params.serviceDescription,
    customerComplaint: params.customerComplaint,
    source: params.source || "manual",
    bookingId: params.bookingId,
    estimateId: params.estimateId,
    inspectionId: params.inspectionId,
    promisedAt: params.promisedAt,
    quotedTotal: params.quotedTotal ? String(params.quotedTotal) : "0",
  } as any);

  await logTransition(id, null, "approved", "system", "Work order created");
  return { id, orderNumber };
}

// ─── Add line item ───────────────────────────────────
export async function addLineItem(params: {
  workOrderId: string;
  type: string;
  description: string;
  quantity?: number;
  unitPrice?: number;
  unitCost?: number;
  laborHours?: number;
  laborRate?: number;
  laborSource?: string;
  partNumber?: string;
  partStatus?: string;
  partSource?: string;
  urgency?: string;
  approved?: boolean;
}): Promise<string> {
  const { db, workOrderItems } = await getDbAndSchema();
  const id = randomUUID();
  const qty = params.quantity || 1;
  const price = params.unitPrice || 0;

  await db.insert(workOrderItems).values({
    id,
    workOrderId: params.workOrderId,
    type: params.type,
    description: params.description,
    quantity: String(qty),
    unitPrice: String(price),
    unitCost: params.unitCost ? String(params.unitCost) : "0",
    total: String(qty * price),
    laborHours: params.laborHours ? String(params.laborHours) : null,
    laborRate: params.laborRate ? String(params.laborRate) : null,
    laborSource: params.laborSource,
    partNumber: params.partNumber,
    partStatus: params.partStatus || "not_needed",
    partSource: params.partSource,
    urgency: params.urgency,
    approved: params.approved !== false,
  } as any);

  return id;
}

// ─── Update work order status ────────────────────────
export async function updateStatus(
  workOrderId: string,
  newStatus: WorkOrderStatus,
  changedBy: string,
  opts?: {
    note?: string;
    blockerType?: BlockerType;
    blockerNote?: string;
  }
): Promise<void> {
  const { db, workOrders } = await getDbAndSchema();

  // Get current status
  const [current] = await db.select({ status: workOrders.status, blockerType: workOrders.blockerType })
    .from(workOrders).where(eq(workOrders.id, workOrderId)).limit(1);
  if (!current) throw new Error("Work order not found");

  // ─── Transition guard ─────────────────────────────────
  const currentStatus = current.status as WorkOrderStatus;
  const allowed = LEGAL_TRANSITIONS[currentStatus] || [];
  if (allowed.length > 0 && !allowed.includes(newStatus)) {
    throw new Error(
      `Invalid transition: ${currentStatus} → ${newStatus}. Allowed: ${allowed.join(", ")}`
    );
  }
  if (allowed.length === 0 && currentStatus !== newStatus) {
    throw new Error(`Work order is in terminal state "${currentStatus}" and cannot be changed`);
  }

  // ─── Blocker enforcement ──────────────────────────────
  // Cannot advance past certain statuses while a blocker is active (unless clearing it)
  if (current.blockerType && !opts?.blockerType && newStatus !== "on_hold" && newStatus !== "cancelled") {
    const advanceStatuses: WorkOrderStatus[] = ["in_progress", "qc_review", "ready_for_pickup"];
    if (advanceStatuses.includes(newStatus)) {
      throw new Error(
        `Cannot advance to "${newStatus}" while blocker "${current.blockerType}" is active. Clear the blocker first or move to on_hold.`
      );
    }
  }

  const updates: Record<string, any> = {
    status: newStatus,
    updatedAt: new Date(),
  };

  // Blocker management
  if (opts?.blockerType) {
    updates.blockerType = opts.blockerType;
    updates.blockerNote = opts.blockerNote || null;
    updates.blockerSince = new Date();
  } else {
    updates.blockerType = null;
    updates.blockerNote = null;
    updates.blockerSince = null;
  }

  // Lifecycle timestamps
  if (newStatus === "in_progress" && current.status !== "in_progress") {
    updates.startedAt = new Date();
  }
  if (newStatus === "qc_review" || newStatus === "ready_for_pickup") {
    updates.completedAt = new Date();
    updates.actualCompletion = new Date();
  }
  if (newStatus === "picked_up") {
    updates.pickedUpAt = new Date();
  }

  await db.update(workOrders).set(updates).where(eq(workOrders.id, workOrderId));
  await logTransition(workOrderId, current.status, newStatus, changedBy, opts?.note);

  // Auto-rules
  await executeAutoRules(workOrderId, newStatus);
}

// ─── Auto-advance rules ─────────────────────────────
async function executeAutoRules(workOrderId: string, newStatus: WorkOrderStatus): Promise<void> {
  // ready_for_pickup → auto-send SMS
  if (newStatus === "ready_for_pickup") {
    try {
      const { db, workOrders, customers } = await getDbAndSchema();
      const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId)).limit(1);
      if (wo?.customerId) {
        const [cust] = await db.select().from(customers).where(eq(customers.id, parseInt(wo.customerId, 10))).limit(1);
        if (cust?.phone) {
          const { sendSms } = await import("../sms");
          const name = cust.firstName || "there";
          await sendSms(cust.phone, `Hi ${name}, your vehicle is ready for pickup at Nick's Tire & Auto! We're open until 6pm. Call (216) 862-0005 with any questions.`);
          await updateStatus(workOrderId, "customer_notified", "system", { note: "Pickup SMS sent" });
        }
      }
    } catch (e) {
      console.error("[WO] Auto-notify failed:", e);
    }
  }

  // Auto review request on close
  if (newStatus === "closed") {
    try {
      const { db, workOrders, customers } = await getDbAndSchema();
      const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId)).limit(1);
      if (wo?.customerId) {
        const [cust] = await db.select().from(customers).where(eq(customers.id, parseInt(wo.customerId, 10))).limit(1);
        if (cust?.phone) {
          const { createReviewRequest } = await import("../db");
          const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours later
          await createReviewRequest({
            customerName: cust.firstName || "Customer",
            customerPhone: cust.phone,
            customerEmail: cust.email || null,
            service: wo.serviceDescription || "Auto Service",
            scheduledAt,
            status: "pending",
          } as any);
        }
      }
    } catch (e) {
      console.error("[WO] Auto review request failed:", e);
    }
  }

  // Dispatch to NOUR OS bridge
  try {
    const { onWorkOrderStatusChange, dispatchShopFloorSnapshot } = await import("../nour-os-bridge");
    const { db, workOrders } = await getDbAndSchema();
    const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId)).limit(1);
    if (wo) {
      await onWorkOrderStatusChange({
        workOrderId,
        orderNumber: wo.orderNumber,
        fromStatus: wo.status,
        toStatus: newStatus,
        service: wo.serviceDescription || undefined,
      });
    }
    // Refresh shop floor snapshot on significant transitions
    dispatchShopFloorSnapshot().catch(() => {});
  } catch (err) {
    console.error("[WO] NOUR OS bridge dispatch failed:", err instanceof Error ? err.message : err);
  }
}

// ─── Parts pipeline ──────────────────────────────────
export async function updatePartStatus(
  lineId: string,
  status: string,
  opts?: { supplierName?: string; supplierOrderRef?: string; eta?: Date }
): Promise<void> {
  const { db, workOrderItems } = await getDbAndSchema();

  const updates: Record<string, any> = { partStatus: status };
  if (status === "ordered") {
    updates.partOrderedAt = new Date();
    if (opts?.supplierName) updates.supplierName = opts.supplierName;
    if (opts?.supplierOrderRef) updates.supplierOrderRef = opts.supplierOrderRef;
    if (opts?.eta) updates.partEta = opts.eta;
  }
  if (status === "received") {
    updates.partReceivedAt = new Date();
  }

  await db.update(workOrderItems).set(updates).where(eq(workOrderItems.id, lineId));

  // Check if all parts received for this work order
  const [item] = await db.select({ workOrderId: workOrderItems.workOrderId })
    .from(workOrderItems).where(eq(workOrderItems.id, lineId)).limit(1);
  if (item) {
    await checkAllPartsReceived(item.workOrderId);
  }
}

async function checkAllPartsReceived(workOrderId: string): Promise<void> {
  const { db, workOrderItems, workOrders } = await getDbAndSchema();

  const lines = await db.select({
    partStatus: workOrderItems.partStatus,
  }).from(workOrderItems).where(eq(workOrderItems.workOrderId, workOrderId));

  const partsLines = lines.filter(l => l.partStatus !== "not_needed");
  if (partsLines.length === 0) return;

  const pendingParts = partsLines.filter(l =>
    l.partStatus !== "received" && l.partStatus !== "installed"
  );

  const [wo] = await db.select({ status: workOrders.status })
    .from(workOrders).where(eq(workOrders.id, workOrderId)).limit(1);
  if (!wo) return;

  if (pendingParts.length === 0) {
    // All parts received
    if (["parts_needed", "parts_ordered", "parts_partial"].includes(wo.status)) {
      await updateStatus(workOrderId, "parts_received", "system", { note: "All parts received" });
      await updateStatus(workOrderId, "ready_for_bay", "system", { note: "Auto-advanced: all parts in" });
    }
  } else if (partsLines.some(l => l.partStatus === "received")) {
    if (wo.status === "parts_ordered") {
      await updateStatus(workOrderId, "parts_partial", "system", {
        note: `${pendingParts.length} parts still pending`,
      });
    }
  }
}

// ─── Query helpers ───────────────────────────────────
export async function getActiveWorkOrders(): Promise<any[]> {
  const { db, workOrders } = await getDbAndSchema();
  return db.select().from(workOrders)
    .where(notInArray(workOrders.status, TERMINAL_STATUSES))
    .orderBy(desc(workOrders.createdAt));
}

export async function getBlockedWorkOrders(): Promise<any[]> {
  const { db, workOrders } = await getDbAndSchema();
  return db.select().from(workOrders)
    .where(and(
      sql`${workOrders.blockerType} IS NOT NULL`,
      notInArray(workOrders.status, TERMINAL_STATUSES),
    ))
    .orderBy(desc(workOrders.blockerSince));
}

export async function getOverdueWorkOrders(): Promise<any[]> {
  const { db, workOrders } = await getDbAndSchema();
  return db.select().from(workOrders)
    .where(and(
      lt(workOrders.promisedAt, new Date()),
      notInArray(workOrders.status, TERMINAL_STATUSES),
    ))
    .orderBy(workOrders.promisedAt);
}

export async function getReadyForPickup(): Promise<any[]> {
  const { db, workOrders } = await getDbAndSchema();
  return db.select().from(workOrders)
    .where(sql`${workOrders.status} IN ('ready_for_pickup', 'customer_notified')`)
    .orderBy(workOrders.completedAt);
}

export async function getWorkOrderWithItems(id: string): Promise<any> {
  const { db, workOrders, workOrderItems, workOrderTransitions } = await getDbAndSchema();

  const [order] = await db.select().from(workOrders).where(eq(workOrders.id, id)).limit(1);
  if (!order) return null;

  const items = await db.select().from(workOrderItems)
    .where(eq(workOrderItems.workOrderId, id));

  const transitions = await db.select().from(workOrderTransitions)
    .where(eq(workOrderTransitions.workOrderId, id))
    .orderBy(desc(workOrderTransitions.createdAt))
    .limit(50);

  return { ...order, items, transitions };
}

export async function getWorkOrderStats(): Promise<{
  active: number;
  blocked: number;
  overdue: number;
  readyForPickup: number;
  inProgress: number;
  totalValueInProgress: number;
  byStatus: Record<string, number>;
}> {
  const { db, workOrders } = await getDbAndSchema();

  const rows = await db.select({
    status: workOrders.status,
    count: sql<number>`count(*)`,
    totalValue: sql<number>`COALESCE(sum(CAST(${workOrders.total} AS DECIMAL(10,2))), 0)`,
  }).from(workOrders).groupBy(workOrders.status);

  const byStatus: Record<string, number> = {};
  let active = 0, inProgress = 0, totalValueInProgress = 0;

  for (const row of rows) {
    byStatus[row.status] = Number(row.count);
    if (ACTIVE_STATUSES.includes(row.status as any)) {
      active += Number(row.count);
    }
    if (row.status === "in_progress") {
      inProgress = Number(row.count);
      totalValueInProgress = Number(row.totalValue);
    }
  }

  // Count blocked
  const [blockedResult] = await db.select({ count: sql<number>`count(*)` })
    .from(workOrders)
    .where(and(
      sql`${workOrders.blockerType} IS NOT NULL`,
      notInArray(workOrders.status, TERMINAL_STATUSES),
    ));

  // Count overdue
  const [overdueResult] = await db.select({ count: sql<number>`count(*)` })
    .from(workOrders)
    .where(and(
      lt(workOrders.promisedAt, new Date()),
      notInArray(workOrders.status, TERMINAL_STATUSES),
    ));

  // Count ready for pickup
  const readyForPickup = (byStatus["ready_for_pickup"] || 0) + (byStatus["customer_notified"] || 0);

  return {
    active,
    blocked: Number(blockedResult?.count || 0),
    overdue: Number(overdueResult?.count || 0),
    readyForPickup,
    inProgress,
    totalValueInProgress,
    byStatus,
  };
}

// ─── Conversion funnel: WO → Revenue ─────────────────
export async function getConversionFunnel(days: number = 90): Promise<{
  /** Total WOs created in period */
  totalCreated: number;
  /** WOs that entered in_progress */
  started: number;
  /** WOs that reached invoiced/closed/picked_up (completed) */
  completed: number;
  /** WOs cancelled */
  cancelled: number;
  /** WOs still active */
  stillActive: number;
  /** Conversion rate: completed / (total - still drafts) */
  conversionRate: number;
  /** Average hours from creation → in_progress */
  avgHoursToStart: number | null;
  /** Average hours from creation → completion */
  avgHoursToCycle: number | null;
  /** Revenue from completed WOs in period (dollars) */
  revenueCompleted: number;
  /** Revenue from cancelled WOs (lost, dollars) */
  revenueLost: number;
  /** Revenue in active pipeline (dollars) */
  revenuePipeline: number;
  /** Per-stage counts for funnel visualization */
  stages: { name: string; count: number; value: number }[];
}> {
  const { db, workOrders } = await getDbAndSchema();
  const cutoff = new Date(Date.now() - days * 86400000);

  // All WOs created in period
  const rows = await db.select({
    status: workOrders.status,
    total: workOrders.total,
    createdAt: workOrders.createdAt,
    startedAt: workOrders.startedAt,
    completedAt: workOrders.completedAt,
    pickedUpAt: workOrders.pickedUpAt,
  })
    .from(workOrders)
    .where(sql`${workOrders.createdAt} >= ${cutoff}`);

  const totalCreated = rows.length;
  let started = 0, completed = 0, cancelled = 0, stillActive = 0;
  let revenueCompleted = 0, revenueLost = 0, revenuePipeline = 0;
  let totalStartHours = 0, startCount = 0;
  let totalCycleHours = 0, cycleCount = 0;

  // Stage accumulators
  const stageCounts: Record<string, { count: number; value: number }> = {
    created: { count: 0, value: 0 },
    in_progress: { count: 0, value: 0 },
    completed: { count: 0, value: 0 },
    invoiced: { count: 0, value: 0 },
    picked_up: { count: 0, value: 0 },
    cancelled: { count: 0, value: 0 },
  };

  for (const row of rows) {
    const val = Number(row.total) || 0;
    stageCounts.created.count++;
    stageCounts.created.value += val;

    const s = row.status;
    const isTerminalComplete = ["invoiced", "closed", "picked_up"].includes(s);
    const hasStarted = row.startedAt != null;
    const hasCompleted = row.completedAt != null || isTerminalComplete;

    if (hasStarted || ["in_progress", "qc_review", "ready_for_pickup", "customer_notified", "picked_up", "invoiced", "closed"].includes(s)) {
      started++;
      stageCounts.in_progress.count++;
      stageCounts.in_progress.value += val;
    }

    if (hasCompleted) {
      stageCounts.completed.count++;
      stageCounts.completed.value += val;
    }

    if (isTerminalComplete) {
      completed++;
      revenueCompleted += val;
      if (s === "invoiced" || s === "closed") {
        stageCounts.invoiced.count++;
        stageCounts.invoiced.value += val;
      }
      if (s === "picked_up" || s === "closed") {
        stageCounts.picked_up.count++;
        stageCounts.picked_up.value += val;
      }
    } else if (s === "cancelled") {
      cancelled++;
      revenueLost += val;
      stageCounts.cancelled.count++;
      stageCounts.cancelled.value += val;
    } else {
      stillActive++;
      revenuePipeline += val;
    }

    // Timing: creation → start
    if (row.startedAt && row.createdAt) {
      const hours = (new Date(row.startedAt).getTime() - new Date(row.createdAt).getTime()) / 3600000;
      if (hours >= 0 && hours < 720) { // cap at 30 days to avoid outliers
        totalStartHours += hours;
        startCount++;
      }
    }

    // Timing: creation → completion
    const completionTime = row.completedAt || (isTerminalComplete ? row.pickedUpAt : null);
    if (completionTime && row.createdAt) {
      const hours = (new Date(completionTime).getTime() - new Date(row.createdAt).getTime()) / 3600000;
      if (hours >= 0 && hours < 720) {
        totalCycleHours += hours;
        cycleCount++;
      }
    }
  }

  const nonDraft = totalCreated - (rows.filter((r: any) => r.status === "draft").length);
  const conversionRate = nonDraft > 0 ? Math.round((completed / nonDraft) * 100) : 0;

  return {
    totalCreated,
    started,
    completed,
    cancelled,
    stillActive,
    conversionRate,
    avgHoursToStart: startCount > 0 ? Math.round(totalStartHours / startCount * 10) / 10 : null,
    avgHoursToCycle: cycleCount > 0 ? Math.round(totalCycleHours / cycleCount * 10) / 10 : null,
    revenueCompleted: Math.round(revenueCompleted * 100) / 100,
    revenueLost: Math.round(revenueLost * 100) / 100,
    revenuePipeline: Math.round(revenuePipeline * 100) / 100,
    stages: [
      { name: "Created", count: stageCounts.created.count, value: stageCounts.created.value },
      { name: "In Progress", count: stageCounts.in_progress.count, value: stageCounts.in_progress.value },
      { name: "Completed", count: stageCounts.completed.count, value: stageCounts.completed.value },
      { name: "Invoiced", count: stageCounts.invoiced.count, value: stageCounts.invoiced.value },
      { name: "Picked Up", count: stageCounts.picked_up.count, value: stageCounts.picked_up.value },
    ],
  };
}

// ─── Pending parts across all work orders ────────────
export async function getPendingParts(): Promise<any[]> {
  const { db, workOrderItems, workOrders } = await getDbAndSchema();

  return db.select({
    lineId: workOrderItems.id,
    workOrderId: workOrderItems.workOrderId,
    description: workOrderItems.description,
    partNumber: workOrderItems.partNumber,
    partStatus: workOrderItems.partStatus,
    partEta: workOrderItems.partEta,
    supplierName: workOrderItems.supplierName,
    supplierOrderRef: workOrderItems.supplierOrderRef,
    orderNumber: workOrders.orderNumber,
    woStatus: workOrders.status,
  })
    .from(workOrderItems)
    .innerJoin(workOrders, eq(workOrderItems.workOrderId, workOrders.id))
    .where(sql`${workOrderItems.partStatus} IN ('needed', 'ordered')`)
    .orderBy(workOrderItems.partEta);
}

// ─── Declined work history for a customer ────────────
export async function getDeclinedWorkHistory(customerId: string): Promise<any[]> {
  const { db, workOrders } = await getDbAndSchema();

  const pastOrders = await db.select({
    id: workOrders.id,
    orderNumber: workOrders.orderNumber,
    declinedWorkJson: workOrders.declinedWorkJson,
    createdAt: workOrders.createdAt,
  })
    .from(workOrders)
    .where(and(
      eq(workOrders.customerId, customerId),
      eq(workOrders.hasDeclinedWork, true),
    ))
    .orderBy(desc(workOrders.createdAt))
    .limit(5);

  return pastOrders.flatMap(wo => {
    const items = (wo.declinedWorkJson as any[] || []);
    return items.map((item: any) => ({
      ...item,
      declinedDate: wo.createdAt,
      workOrderId: wo.id,
      workOrderNumber: wo.orderNumber,
    }));
  });
}
