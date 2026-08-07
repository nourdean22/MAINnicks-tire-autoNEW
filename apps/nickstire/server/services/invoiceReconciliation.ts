/**
 * Invoice Reconciliation Service — Line-item margin analysis and variance tracking.
 *
 * Checks each work order's quoted vs actual amounts,
 * flags variance > threshold, and produces daily revenue truth.
 */
import { eq, and, gte, sql, desc, between } from "drizzle-orm";

import { createLogger } from "../lib/logger";

const log = createLogger("services:invoiceReconciliation");
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
    if (wo.customerId != null) {
      const [cust] = await db.select().from(customers).where(eq(customers.id, wo.customerId));
      if (cust) customerName = `${cust.firstName} ${cust.lastName || ""}`.trim();
    }
  } catch (err) {
    log.warn("[InvoiceRecon] Customer name lookup failed:", err instanceof Error ? err.message : err);
  }

  const lineItems: LineItemMargin[] = items
    .filter((i: any) => !i.declined)
    .map((item: any) => {
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
// SOURCE-OF-TRUTH shift 2026-04-24: this function used to query the
// `work_orders` table, but work_orders is our internal state and is not
// reliably marked `completedAt` — most invoices flow through ALG without
// touching the WO workflow. Result: daily-revenue-truth reported $0
// while ALG invoices showed $87k MTD. Fixed by querying the `invoices`
// table (ALG mirror), which IS the revenue source-of-truth per the
// 'ALG rules all' directive.
export async function getDailyRevenueTruth(date?: string) {
  const { getDb } = await import("../db");
  const { invoices } = await import("../../drizzle/schema");
  const d = await getDb();
  if (!d) {
    // No DB is an UNKNOWN, not a zero-margin day — margin fields stay null so
    // a failed read can never be mistaken for a measured result.
    return {
      date: (date ? new Date(date) : new Date()).toISOString().split("T")[0],
      completedJobs: 0, totalRevenue: 0, partsCost: 0, laborRevenue: 0,
      grossMargin: null, grossMarginPercent: null,
      marginBasisInvoices: 0, marginBasisRevenue: 0, avgTicket: 0,
    };
  }

  const targetDate = date ? new Date(date) : new Date();
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  // invoices.totalAmount/partsCost/laborCost/taxAmount are stored in CENTS
  // (see drizzle/schema.ts line 1086+). Convert to dollars at the end.
  const [stats] = await d.select({
    completed: sql<number>`count(*)`,
    totalRevenueCents: sql<number>`coalesce(sum(${invoices.totalAmount}), 0)`,
    totalPartsCents: sql<number>`coalesce(sum(${invoices.partsCost}), 0)`,
    totalLaborCents: sql<number>`coalesce(sum(${invoices.laborCost}), 0)`,
    avgTicketCents: sql<number>`coalesce(avg(${invoices.totalAmount}), 0)`,
    // FILL GUARD inputs — same class of defect the parts-percent scan already
    // guards against in services/engines/operations.ts. See below.
    costDetailCount: sql<number>`coalesce(sum(case when ${invoices.partsCost} > 0 or ${invoices.laborCost} > 0 then 1 else 0 end), 0)`,
    coveredRevenueCents: sql<number>`coalesce(sum(case when ${invoices.partsCost} > 0 or ${invoices.laborCost} > 0 then ${invoices.totalAmount} else 0 end), 0)`,
    coveredPartsCents: sql<number>`coalesce(sum(case when ${invoices.partsCost} > 0 or ${invoices.laborCost} > 0 then ${invoices.partsCost} else 0 end), 0)`,
  }).from(invoices)
    .where(and(
      gte(invoices.invoiceDate, startOfDay),
      sql`${invoices.invoiceDate} <= ${endOfDay}`,
      sql`${invoices.paymentStatus} = 'paid'`,
    ));

  const revenue = (Number(stats?.totalRevenueCents) || 0) / 100;
  const parts = (Number(stats?.totalPartsCents) || 0) / 100;
  const labor = (Number(stats?.totalLaborCents) || 0) / 100;

  /**
   * FILL GUARD (2026-08-08). The ALG mirror stopped carrying the parts/labour
   * split on 2026-04-09 — probed live: 1,886 of 2,899 lifetime paid invoices
   * carry partsCost, but 0 of the last 30 do. With partsCost pinned at 0,
   * `revenue - parts` equals revenue, so this function was returning
   * grossMarginPercent = 100.0 EVERY DAY for the last 10 days straight. An
   * absent measurement rendered as a perfect result — the same defect the
   * parts-percent scan in services/engines/operations.ts already guards.
   *
   * Margin is therefore computed over ONLY the invoices that carry cost
   * detail, and is null (never 0, never 100) when none do. Dividing covered
   * parts by TOTAL revenue would inflate margin in exact proportion to how
   * much data is missing, which is how 100% got published in the first place.
   *
   * `partsCost` / `laborRevenue` keep reporting the true period sums — they
   * are sums, not ratios, so 0 is an honest answer for them.
   */
  const costDetailCount = Number(stats?.costDetailCount) || 0;
  const coveredRevenue = (Number(stats?.coveredRevenueCents) || 0) / 100;
  const coveredParts = (Number(stats?.coveredPartsCents) || 0) / 100;
  const marginComputable = costDetailCount > 0 && coveredRevenue > 0;
  const grossMargin = marginComputable ? coveredRevenue - coveredParts : null;

  return {
    date: targetDate.toISOString().split("T")[0],
    completedJobs: Number(stats?.completed) || 0,
    totalRevenue: Math.round(revenue * 100) / 100,
    partsCost: Math.round(parts * 100) / 100,
    laborRevenue: Math.round(labor * 100) / 100,
    grossMargin: grossMargin === null ? null : Math.round(grossMargin * 100) / 100,
    grossMarginPercent: marginComputable
      ? Math.round(((coveredRevenue - coveredParts) / coveredRevenue) * 1000) / 10
      : null,
    /** How many invoices the margin is actually based on — 0 means it is unknown, not zero. */
    marginBasisInvoices: costDetailCount,
    marginBasisRevenue: Math.round(coveredRevenue * 100) / 100,
    avgTicket: Math.round((Number(stats?.avgTicketCents) || 0) / 100 * 100) / 100,
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
