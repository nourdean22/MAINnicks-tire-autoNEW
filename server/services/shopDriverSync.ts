/**
 * ShopDriver (Auto Labor Guide) Bidirectional Sync
 *
 * Pushes online orders, invoices, and customers TO ShopDriver.
 * Pulls invoice/ticket status FROM ShopDriver.
 *
 * ShopDriver doesn't have a public API — we use their web session.
 * Fallback: If API fails, formats data as Telegram notification
 * for manual entry by the in-store team.
 *
 * This is the bridge between nickstire.org and the physical shop.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("shopdriver-sync");

const SHOPDRIVER_BASE = "https://secure.autolaborexperts.com";

/** Get authenticated session cookie */
async function getSession(): Promise<string | null> {
  const username = process.env.AUTO_LABOR_USERNAME || process.env.ALG_USERNAME;
  const password = process.env.AUTO_LABOR_PASSWORD || process.env.ALG_PASSWORD;
  if (!username || !password) return null;

  try {
    const res = await fetch(`${SHOPDRIVER_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
      body: JSON.stringify({ username, password }),
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });
    const cookies = res.headers.getSetCookie?.() || [];
    const cookie = cookies.map(c => c.split(";")[0]).join("; ");
    return cookie || null;
  } catch {
    return null;
  }
}

// ─── PUSH: Online order → ShopDriver ──────────────────

export async function pushTireOrder(order: {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  vehicleInfo?: string | null;
  tireBrand: string;
  tireModel: string;
  tireSize: string;
  quantity: number;
  totalAmount: number;
  installPreference: string;
}): Promise<{ success: boolean; method: "api" | "telegram"; error?: string }> {
  // Try API first
  const session = await getSession();
  if (session) {
    try {
      // Attempt to create work order via ShopDriver API
      const res = await fetch(`${SHOPDRIVER_BASE}/api/workorders`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": session,
          "User-Agent": "Mozilla/5.0",
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          vehicleInfo: order.vehicleInfo || "",
          description: `ONLINE TIRE ORDER ${order.orderNumber}\n${order.quantity}x ${order.tireBrand} ${order.tireModel} (${order.tireSize})\nInstall: ${order.installPreference}\nTotal: $${order.totalAmount.toFixed(2)}`,
          status: "pending",
          source: "online",
        }),
      });

      if (res.ok) {
        log.info(`Pushed tire order ${order.orderNumber} to ShopDriver via API`);
        recordPush();
        return { success: true, method: "api" };
      }
    } catch (err) {
      log.warn("ShopDriver API push failed, falling back to Telegram", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Fallback: Send via Telegram for manual entry
  try {
    const { sendTelegram } = await import("./telegram");
    await sendTelegram(
      `🔧 ONLINE ORDER → SYNCED TO ADMIN\n\n` +
      `Order: ${order.orderNumber}\n` +
      `Customer: ${order.customerName}\n` +
      `Phone: ${order.customerPhone}\n` +
      `Vehicle: ${order.vehicleInfo || "N/A"}\n` +
      `Tires: ${order.quantity}x ${order.tireBrand} ${order.tireModel} (${order.tireSize})\n` +
      `Install: ${order.installPreference}\n` +
      `Total: $${order.totalAmount.toFixed(2)}\n\n` +
      `⚡ Create work order in ShopDriver NOW\n` +
      `Status: PENDING — waiting for customer`
    );
    return { success: true, method: "telegram" };
  } catch (err) {
    log.error("Both API and Telegram push failed", { error: err instanceof Error ? err.message : String(err) });
    return { success: false, method: "telegram", error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── PUSH: Invoice → ShopDriver ───────────────────────

export async function pushInvoice(invoice: {
  invoiceNumber: string;
  customerName: string;
  customerPhone: string;
  vehicleInfo?: string | null;
  serviceDescription?: string | null;
  laborCost: number;
  partsCost: number;
  taxAmount: number;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
}): Promise<{ success: boolean; method: "api" | "telegram" }> {
  const session = await getSession();
  if (session) {
    try {
      const res = await fetch(`${SHOPDRIVER_BASE}/api/invoices`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cookie": session,
          "User-Agent": "Mozilla/5.0",
        },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName,
          customerPhone: invoice.customerPhone,
          vehicleInfo: invoice.vehicleInfo || "",
          serviceDescription: invoice.serviceDescription || "",
          laborCost: invoice.laborCost,
          partsCost: invoice.partsCost,
          taxAmount: invoice.taxAmount,
          totalAmount: invoice.totalAmount,
          paymentStatus: invoice.paymentStatus,
          paymentMethod: invoice.paymentMethod,
        }),
      });
      if (res.ok) {
        log.info(`Pushed invoice ${invoice.invoiceNumber} to ShopDriver via API`);
        recordPush();
        return { success: true, method: "api" };
      }
    } catch (err) {
      log.warn("ShopDriver API invoice push failed, falling back to Telegram", { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // Fallback: Telegram
  try {
    const { sendTelegram } = await import("./telegram");
    await sendTelegram(
      `🧾 INVOICE → SYNCED TO ADMIN\n\n` +
      `Invoice: ${invoice.invoiceNumber}\n` +
      `Customer: ${invoice.customerName} | ${invoice.customerPhone}\n` +
      `Vehicle: ${invoice.vehicleInfo || "N/A"}\n` +
      `Service: ${invoice.serviceDescription || "N/A"}\n` +
      `Labor: $${invoice.laborCost.toFixed(2)} | Parts: $${invoice.partsCost.toFixed(2)} | Tax: $${invoice.taxAmount.toFixed(2)}\n` +
      `Total: $${invoice.totalAmount.toFixed(2)}\n` +
      `Payment: ${invoice.paymentStatus} (${invoice.paymentMethod})\n\n` +
      `⚡ Create in ShopDriver NOW`
    );
    return { success: true, method: "telegram" };
  } catch {
    return { success: false, method: "telegram" };
  }
}

// ─── PUSH: Estimate → ShopDriver ──────────────────────

export async function pushEstimate(estimate: {
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  vehicle: string;
  repairTitle: string;
  lineItems: Array<{ description: string; laborHours: number; partsLow: number; partsHigh: number }>;
  grandTotalLow: number;
  grandTotalHigh: number;
}): Promise<{ success: boolean; method: "api" | "telegram" }> {
  // Always Telegram for estimates — they need human review
  try {
    const { sendTelegram } = await import("./telegram");
    const lines = estimate.lineItems.map(li =>
      `  • ${li.description}: ${li.laborHours}h labor, $${li.partsLow}-$${li.partsHigh} parts`
    ).join("\n");

    await sendTelegram(
      `📋 ESTIMATE → SYNCED TO ADMIN\n\n` +
      `Customer: ${estimate.customerName}\n` +
      `Phone: ${estimate.customerPhone}\n` +
      `Email: ${estimate.customerEmail || "N/A"}\n` +
      `Vehicle: ${estimate.vehicle}\n` +
      `Repair: ${estimate.repairTitle}\n\n` +
      `Line Items:\n${lines}\n\n` +
      `Range: $${estimate.grandTotalLow} — $${estimate.grandTotalHigh}\n\n` +
      `⚡ Create estimate in ShopDriver + email to customer`
    );
    return { success: true, method: "telegram" };
  } catch {
    return { success: false, method: "telegram" };
  }
}

// ─── PULL: Get recent tickets from ShopDriver ─────────

export async function pullRecentTickets(): Promise<Array<{
  id: string;
  customerName: string;
  status: string;
  totalAmount: number;
  date: string;
}>> {
  const session = await getSession();
  if (!session) return [];

  try {
    const res = await fetch(`${SHOPDRIVER_BASE}/api/tickets?limit=20&sort=date_desc`, {
      headers: { "Cookie": session, "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const tickets = Array.isArray(data) ? data.map((t: any) => ({
      id: String(t.id || t.ticketId || ""),
      customerName: t.customerName || t.customer?.name || "",
      status: t.status || "unknown",
      totalAmount: Number(t.totalAmount || t.total || 0),
      date: t.date || t.createdAt || "",
    })) : [];
    if (tickets.length > 0) recordPull();
    return tickets;
  } catch {
    return [];
  }
}

// ─── SYNC STATUS ──────────────────────────────────────

// In-memory sync timestamps (persisted to DB when available)
let _lastPushAt: Date | null = null;
let _lastPullAt: Date | null = null;

/** Record a successful push */
export function recordPush(): void {
  _lastPushAt = new Date();
  persistSyncTimestamp("lastPushAt", _lastPushAt).catch(() => {});
}

/** Record a successful pull */
export function recordPull(): void {
  _lastPullAt = new Date();
  persistSyncTimestamp("lastPullAt", _lastPullAt).catch(() => {});
}

async function persistSyncTimestamp(key: string, value: Date): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;
    await db.execute(sql`
      INSERT INTO shop_settings (\`key\`, value, updatedAt)
      VALUES (${`shopdriver_${key}`}, ${value.toISOString()}, NOW())
      ON DUPLICATE KEY UPDATE value = ${value.toISOString()}, updatedAt = NOW()
    `);
  } catch {} // Best-effort — table might not have right schema
}

async function loadSyncTimestamps(): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;
    const [rows] = await db.execute(sql`
      SELECT \`key\`, value FROM shop_settings WHERE \`key\` IN ('shopdriver_lastPushAt', 'shopdriver_lastPullAt')
    `);
    for (const row of (rows as any[]) || []) {
      if (row.key === "shopdriver_lastPushAt") _lastPushAt = new Date(row.value);
      if (row.key === "shopdriver_lastPullAt") _lastPullAt = new Date(row.value);
    }
  } catch {} // Best-effort
}

// Load on module init
loadSyncTimestamps().catch(() => {});

export async function getSyncStatus(): Promise<{
  shopDriverConnected: boolean;
  lastPushAt: string | null;
  lastPullAt: string | null;
  method: "api" | "telegram" | "none";
}> {
  const session = await getSession();
  return {
    shopDriverConnected: !!session,
    lastPushAt: _lastPushAt?.toISOString() || null,
    lastPullAt: _lastPullAt?.toISOString() || null,
    method: session ? "api" : "telegram",
  };
}
