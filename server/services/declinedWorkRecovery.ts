/**
 * Declined Work Recovery Engine
 *
 * Tracks declined work items across all work orders.
 * Enables follow-up campaigns for safety items and high-value repairs.
 * Recovery methods: callback, SMS follow-up, financing offer, next-visit reminder.
 */
import { eq, desc, sql, and, gte, isNotNull } from "drizzle-orm";

async function getDbAndSchema() {
  const { getDb } = await import("../db");
  const schema = await import("../../drizzle/schema");
  const d = getDb();
  if (!d) throw new Error("Database not available");
  return { db: d, ...schema };
}

interface DeclinedItem {
  id: string;
  description: string;
  type: string;
  unitPrice: string;
  total: string;
  declineReason: string | null;
  safetyRelated: boolean;
  recovered: boolean;
  recoveryMethod: string | null;
  recoveryNotes: string | null;
}

interface DeclinedWorkEntry {
  workOrderId: string;
  orderNumber: string;
  customerId: string;
  customerName?: string;
  phone?: string;
  vehicle: string;
  completedAt: string | null;
  declinedItems: DeclinedItem[];
  totalDeclinedValue: number;
  hasSafetyItems: boolean;
}

// Safety-related keywords
const SAFETY_KEYWORDS = [
  "brake", "rotor", "caliper", "steering", "tie rod", "ball joint",
  "control arm", "wheel bearing", "cv joint", "axle", "strut",
  "shock", "sway bar", "exhaust leak", "tire", "abs", "airbag",
  "seatbelt", "windshield", "wiper",
];

function isSafetyRelated(description: string): boolean {
  const lower = description.toLowerCase();
  return SAFETY_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Get declined work ledger ───────────────────────
export async function getDeclinedWorkLedger(limit = 50): Promise<DeclinedWorkEntry[]> {
  const { db, workOrders, workOrderItems, customers } = await getDbAndSchema();

  // Get work orders with declined items
  const wos = await db.select().from(workOrders)
    .where(eq(workOrders.hasDeclinedWork, true))
    .orderBy(desc(workOrders.updatedAt))
    .limit(limit);

  const results: DeclinedWorkEntry[] = [];

  for (const wo of wos) {
    // Get declined line items
    const items = await db.select().from(workOrderItems)
      .where(and(
        eq(workOrderItems.workOrderId, wo.id),
        eq(workOrderItems.declined, true),
      ));

    if (items.length === 0) continue;

    // Get customer info
    let customerName = "";
    let phone = "";
    try {
      const custId = parseInt(wo.customerId);
      if (!isNaN(custId)) {
        const [cust] = await db.select().from(customers).where(eq(customers.id, custId));
        if (cust) {
          customerName = `${cust.firstName} ${cust.lastName || ""}`.trim();
          phone = cust.phone;
        }
      }
    } catch (_) {}

    const declinedItems: DeclinedItem[] = items.map(item => ({
      id: item.id,
      description: item.description,
      type: item.type,
      unitPrice: item.unitPrice || "0",
      total: item.total || "0",
      declineReason: item.declineReason || null,
      safetyRelated: isSafetyRelated(item.description),
      recovered: false, // TODO: track in DB
      recoveryMethod: null,
      recoveryNotes: null,
    }));

    const vehicle = [wo.vehicleYear, wo.vehicleMake, wo.vehicleModel].filter(Boolean).join(" ");

    results.push({
      workOrderId: wo.id,
      orderNumber: wo.orderNumber,
      customerId: wo.customerId,
      customerName,
      phone,
      vehicle,
      completedAt: wo.completedAt?.toISOString() || null,
      declinedItems,
      totalDeclinedValue: declinedItems.reduce((sum, i) => sum + parseFloat(i.total), 0),
      hasSafetyItems: declinedItems.some(i => i.safetyRelated),
    });
  }

  return results;
}

// ─── Mark item as recovered ─────────────────────────
export async function markItemRecovered(params: {
  workOrderId: string;
  itemId: string;
  method: string; // callback | sms_followup | financing | next_visit | booked
  notes?: string;
}): Promise<void> {
  const { db, workOrderItems } = await getDbAndSchema();

  // Update the declined item — mark as approved (recovered)
  await db.update(workOrderItems).set({
    declined: false,
    approved: true,
    notes: `Recovered via ${params.method}${params.notes ? `: ${params.notes}` : ""}`,
  }).where(eq(workOrderItems.id, params.itemId));
}

// ─── Declined work stats ────────────────────────────
export async function getDeclinedWorkStats() {
  const { db, workOrders, workOrderItems } = await getDbAndSchema();

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // Count work orders with declined work in last 30 days
  const [woCounts] = await db.select({
    total: sql<number>`count(distinct ${workOrders.id})`,
  }).from(workOrders)
    .where(and(
      eq(workOrders.hasDeclinedWork, true),
      gte(workOrders.updatedAt, thirtyDaysAgo),
    ));

  // Sum declined value
  const [itemStats] = await db.select({
    totalItems: sql<number>`count(*)`,
    totalValue: sql<number>`coalesce(sum(cast(${workOrderItems.total} as decimal(10,2))), 0)`,
  }).from(workOrderItems)
    .innerJoin(workOrders, eq(workOrderItems.workOrderId, workOrders.id))
    .where(and(
      eq(workOrderItems.declined, true),
      gte(workOrders.updatedAt, thirtyDaysAgo),
    ));

  return {
    workOrdersWithDeclined: woCounts?.total || 0,
    totalDeclinedItems: itemStats?.totalItems || 0,
    totalDeclinedValue: itemStats?.totalValue || 0,
    period: "30d",
  };
}
