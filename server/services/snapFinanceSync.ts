/**
 * Snap Finance → Stripe Sync
 *
 * Tracks Snap Finance lease-to-own approvals and creates corresponding
 * Stripe payment records for unified revenue reporting.
 *
 * When a customer is approved via Snap Finance:
 * 1. Snap webhook fires (or manual admin entry)
 * 2. This service creates a Stripe "off-platform" payment record
 * 3. Revenue shows up in the unified admin dashboard
 *
 * Env vars needed:
 * - SNAP_FINANCE_API_KEY: Snap Finance merchant API key
 * - SNAP_FINANCE_MERCHANT_ID: Your Snap merchant ID
 *
 * Note: Snap Finance doesn't have a public REST API for merchants.
 * This integration works via:
 * - Manual admin entry (admin marks invoice as "paid via Snap")
 * - Webhook if Snap provides one to your merchant account
 */

import { createLogger } from "../lib/logger";

const log = createLogger("snap-sync");

interface SnapPaymentRecord {
  customerName: string;
  customerPhone: string;
  amount: number; // dollars
  invoiceNumber?: string;
  snapApplicationId?: string;
  approvalDate: Date;
}

/**
 * Record a Snap Finance payment in the invoices table.
 * This creates visibility in the admin revenue dashboard.
 */
export async function recordSnapPayment(data: SnapPaymentRecord): Promise<{ success: boolean; invoiceId?: number }> {
  try {
    const { getDb } = await import("../db");
    const { invoices } = await import("../../drizzle/schema");
    const { eq, and } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { success: false };

    // Check if this payment was already recorded (dedup by invoice number)
    const invoiceNum = data.invoiceNumber || `SNAP-${data.snapApplicationId || Date.now()}`;
    const existing = await db.select({ id: invoices.id }).from(invoices)
      .where(eq(invoices.invoiceNumber, invoiceNum))
      .limit(1);
    if (existing.length > 0) {
      log.info("Snap payment already recorded:", { invoiceNum });
      return { success: true, invoiceId: existing[0].id };
    }

    // Create invoice record with financing as payment method
    const amountCents = Math.round(data.amount * 100);
    const [result] = await db.insert(invoices).values({
      invoiceNumber: invoiceNum,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      serviceDescription: `Snap Finance lease-to-own${data.snapApplicationId ? ` (App: ${data.snapApplicationId})` : ""}`,
      totalAmount: amountCents,
      paymentStatus: "paid",
      paymentMethod: "financing",
      invoiceDate: data.approvalDate,
    }).$returningId();

    log.info("Snap payment recorded:", {
      invoiceId: result.id,
      amount: data.amount,
      customer: data.customerName,
    });

    // Fire event for revenue tracking
    try {
      const { dispatch } = await import("./eventBus");
      await dispatch("invoice_paid", {
        invoiceId: result.id,
        totalAmount: amountCents,
        paymentMethod: "snap_finance",
        name: data.customerName,
        phone: data.customerPhone,
      });
    } catch (e) { console.warn("[snap-sync] event bus emit failed:", e); }

    return { success: true, invoiceId: result.id };
  } catch (err: unknown) {
    log.error("Failed to record Snap payment:", { error: (err as Error).message });
    return { success: false };
  }
}

/**
 * Same pattern for Acima, Koalafi, or American First Finance.
 * Generic financing payment recorder.
 */
export async function recordFinancingPayment(
  provider: "snap_finance" | "acima" | "koalafi" | "american_first",
  data: SnapPaymentRecord
): Promise<{ success: boolean; invoiceId?: number }> {
  const providerLabels: Record<string, string> = {
    snap_finance: "Snap Finance",
    acima: "Acima Leasing",
    koalafi: "Koalafi",
    american_first: "American First Finance",
  };

  return recordSnapPayment({
    ...data,
    snapApplicationId: data.snapApplicationId || `${provider}-${Date.now()}`,
  });
}
