/**
 * Invoice Reconciliation Service — Line-item margin analysis and variance tracking.
 *
 * Checks each work order's quoted vs actual amounts,
 * flags variance > threshold, and produces daily revenue truth.
 */
import { eq, and, gte, sql, desc, between } from "drizzle-orm";

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const schema = await import("../../drizzle/schema");
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return { db: d, ...schema };
}

export interface LineItemMargin {
  itemId: string;
  description: string;
  type: string;
  cost: number;
  price: number;
  margin: number;
  marginPercent: number;
  flagged: boolean;
  flagReason?: string;
}

export interface WorkOrderReconciliation {
  workOrderId: string;
  orderNumber: string;
  customerName?: string;
  vehicle: string;
  quotedTotal: number;
  actualTotal: number;
  variance: number;
  variancePercent: number;
  partsCost: number;
  laborCost: number;
  grossMargin: number;
  grossMarginPercent: number;
  lineItems: LineItemMargin[];
  flagged: boolean;
  flagReasons: string[];
  completedAt: string | null;
}

// ─── Reconcile a single work order ──────────────────
export async function reconcileWorkOrder(workOrderId: string): Promise<WorkOrderReconciliation | null> {
  const { db, workOrders, workOrderItems, customers } = await getDbAndSchema();

  const [wo] = await db.select().from(workOrders).where(eq(workOrders.id, workOrderId));
  if (!wo) return null;

  const items = await db.select().from(workOrderItems).where(eq(workOrderItems.workOrderId, workOrderId));

  let customerName = "";
  try {
    const custId = parseInt(wo.customerId, 10);
    if (!isNaN(custId)) {
      const [cust] = await db.select().from(customers).where(eq(customers.id, custId));
      if (cust) customerName = `${cust.firstName} ${cust.lastName || ""}`.trim();
    }
  } catch (err) {
    console.warn("[InvoiceRecon] Customer name lookup failed:", err instanceof Error ? err.message : err);
  }

  const lineItems: LineItemMargin[] = items
    .filter(i => !i.declined)
    .map(item => {
      const cost = Number(item.unitCost) * Number(item.quantity || 1);
      const price = Number(item.unitPrice) * Number(item.quantity || 1);
      const margin = price - cost;
      const marginPercent = price > 0 ? (margin / price) * 100 : 0;

      let flagged = false;
      let flagReason: string | undefined;

      // Flag low-margin parts (< 25%)
      if (item.type === "part" && marginPercent < 25 && price > 20) {
        flagged = true;
        flagReason = `Low part margin: ${marginPercent.toFixed(1)}%`;
      }

      // Flag zero-cost items with a price (potential data entry issue)
      if (cost === 0 && price > 50 && item.type === "part") {
        flagged = true;
        flagReason = "Part has no cost entered";
      }

      // Flag negative margin
      if (margin < 0) {
        flagged = true;
        flagReason = `Negative margin: -$${Math.abs(margin).toFixed(2)}`;
      }

      return {
        itemId: item.id,
        description: item.description,
        type: item.type,
        cost,
        price,
        margin,
        marginPercent: Math.round(marginPercent * 10) / 10,
        flagged,
        flagReason,
      };
    });

  const quotedTotal = Number(wo.quotedTotal) || 0;
  const actualTotal = Number(wo.total) || 0;
  const partsCost = Number(wo.partsCost) || 0;
  const laborCost = Number(wo.laborCost) || 0;
  const variance = actualTotal - quotedTotal;
  const variancePercent = quotedTotal > 0 ? (variance / quotedTotal) * 100 : 0;
  const grossMargin = actualTotal - partsCost;
  const grossMarginPercent = actualTotal > 0 ? (grossMargin / actualTotal) * 100 : 0;

  const flagReasons: string[] = [];
  if (Math.abs(variancePercent) > 15) flagReasons.push(`Quote variance: ${variancePercent.toFixed(1)}%`);
  if (grossMarginPercent < 40) flagReasons.push(`Low gross margin: ${grossMarginPercent.toFixed(1)}%`);
  if (lineItems.some(i => i.flagged)) flagReasons.push(`${lineItems.filter(i => i.flagged).length} flagged line item(s)`);

  const vehicle = [wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ");

  return {
    workOrderId: wo.id,
    orderNumber: wo.orderNumber,
    customerName,
    vehicle,
    quotedTotal,
    actualTotal,
    variance,
    variancePercent: Math.round(variancePercent * 10) / 10,
    partsCost,
    laborCost,
    grossMargin,
    grossMarginPercent: Math.round(grossMarginPercent * 10) / 10,
    lineItems,
    flagged: flagReasons.length > 0,
    flagReasons,
    completedAt: wo.completedAt?.toISOString() || null,
  };
}

// ─── Daily revenue truth ────────────────────────────
export async function getDailyRevenueTruth(date?: string) {
  const { db, workOrders } = await getDbAndSchema();

  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const [stats] = await db.select({
    completed: sql<number>`count(*)`,
    totalRevenue: sql<number>`coalesce(sum(cast(${workOrders.total} as decimal(10,2))), 0)`,
    totalParts: sql<number>`coalesce(sum(cast(${workOrders.partsCost} as decimal(10,2))), 0)`,
    totalLabor: sql<number>`coalesce(sum(cast(${workOrders.laborCost} as decimal(10,2))), 0)`,
    avgTicket: sql<number>`coalesce(avg(cast(${workOrders.total} as decimal(10,2))), 0)`,
  }).from(workOrders)
    .where(and(
      gte(workOrders.completedAt, startOfDay),
      sql`${workOrders.completedAt} <= ${endOfDay}`,
    ));

  const revenue = Number(stats?.totalRevenue) || 0;
  const parts = Number(stats?.totalParts) || 0;
  const labor = Number(stats?.totalLabor) || 0;
  const grossMargin = revenue - parts;

  return {
    date: targetDate.toISOString().split("T")[0],
    completedJobs: stats?.completed || 0,
    totalRevenue: revenue,
    partsCost: parts,
    laborRevenue: labor,
    grossMargin,
    grossMarginPercent: revenue > 0 ? Math.round((grossMargin / revenue) * 1000) / 10 : 0,
    avgTicket: Math.round((Number(stats?.avgTicket) || 0) * 100) / 100,
  };
}

// ─── Recent reconciliations (flagged first) ─────────
export async function getRecentReconciliations(limit = 20) {
  const { db, workOrders } = await getDbAndSchema();

  const recentCompleted = await db.select({ id: workOrders.id }).from(workOrders)
    .where(sql`${workOrders.completedAt} is not null`)
    .orderBy(desc(workOrders.completedAt))
    .limit(limit);

  const results: WorkOrderReconciliation[] = [];
  for (const { id } of recentCompleted) {
    const rec = await reconcileWorkOrder(id);
    if (rec) results.push(rec);
  }

  // Flagged first, then by completion date
  return results.sort((a, b) => {
    if (a.flagged && !b.flagged) return -1;
    if (!a.flagged && b.flagged) return 1;
    return 0;
  });
}
