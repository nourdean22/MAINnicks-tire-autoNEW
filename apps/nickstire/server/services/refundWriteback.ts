import { createLogger } from "../lib/logger";
import { db } from "../lib/db-helper";
import { invoices } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { getSession } from "./shopDriverMirror";
import { logAdminAction } from "./auditTrail";

const log = createLogger("services:refundWriteback");

/**
 * Processes a Stripe refund event.
 * Updates the invoice status to refunded and pushes the refunded state back to ShopDriver.
 */
export async function processStripeRefundEvent(event: any): Promise<{ success: boolean; error?: string }> {
  // Parse Stripe event
  const charge = event.data?.object || event;
  if (!charge) {
    return { success: false, error: "No charge/refund object found in event" };
  }

  const invoiceNumber = charge.metadata?.invoiceNumber;
  const amountRefundedCents = charge.amount_refunded || charge.amount || 0;
  const chargeId = charge.id;

  log.info(`Processing refund writeback for charge ${chargeId}, amount: ${amountRefundedCents} cents`);

  if (!invoiceNumber) {
    log.info(`Stripe charge ${chargeId} has no invoiceNumber in metadata. Skipping writeback.`);
    return { success: true };
  }

  const d = await db();
  if (!d) {
    return { success: false, error: "Database unavailable" };
  }

  // 1. Lookup the corresponding invoice
  const [invoice] = await d.select()
    .from(invoices)
    .where(eq(invoices.invoiceNumber, invoiceNumber))
    .limit(1);

  if (!invoice) {
    log.error(`Invoice ${invoiceNumber} not found in database for refund writeback.`);
    return { success: false, error: `Invoice ${invoiceNumber} not found` };
  }

  // Update paymentStatus to refunded (atomically check if not already refunded to prevent duplicate processing)
  const [claim] = await d.execute(sql`
    UPDATE invoices
    SET paymentStatus = 'refunded',
        updatedAt = NOW()
    WHERE invoiceNumber = ${invoiceNumber} AND paymentStatus <> 'refunded'
  `);

  const affected = ((claim as unknown as { affectedRows?: number }).affectedRows ?? 0);
  if (affected === 0 && invoice.paymentStatus === "refunded") {
    log.info(`Invoice ${invoiceNumber} is already marked refunded. Skipping ShopDriver writeback.`);
    return { success: true };
  }

  log.info(`Updated invoice ${invoiceNumber} status to refunded`);

  // 2. Locate the linked ShopDriver estimate/ticket via algTicketId
  const ticketId = invoice.algTicketId;
  const actorEmail = charge.metadata?.actor || "stripe-webhook";
  
  if (!ticketId) {
    log.info(`Invoice ${invoiceNumber} has no algTicketId. Skipping ShopDriver writeback.`);
    
    // Log admin action about the refund in the database
    await logAdminAction({
      action: "invoice.refunded" as any,
      entityType: "invoices",
      entityId: invoice.id,
      details: `Refunded $${(amountRefundedCents / 100).toFixed(2)} for invoice ${invoiceNumber}. No ShopDriver ticket linked.`,
      actor: actorEmail,
      previousValue: "paid",
      newValue: "refunded",
      metadata: {
        stripeChargeId: chargeId,
        amountCents: amountRefundedCents,
      }
    });
    return { success: true };
  }

  // 3. Call the ShopDriver API
  try {
    const token = await getSession();
    if (!token) {
      throw new Error("Failed to authenticate with ShopDriver API");
    }

    const SHOPDRIVER_API = "https://8DD0FCE9-80F9-4A9E-B0C3-CF76825AD9B7.autolaborexperts.com";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Referer": "https://secure.autolaborexperts.com/",
    };
    if (token.startsWith("cookie:")) {
      headers["Cookie"] = token.slice(7);
    } else {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(`${SHOPDRIVER_API}/api/v1/tickets/${ticketId}/refund`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        amountCents: amountRefundedCents,
        reason: charge.metadata?.refundReason || "Stripe Refund",
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      log.error(`ShopDriver refund call failed for ticket ${ticketId}: HTTP ${res.status}`, { body });
      throw new Error(`ShopDriver API returned HTTP ${res.status}`);
    }

    log.info(`Successfully pushed refund to ShopDriver for ticket ${ticketId}`);

    // Log admin action
    await logAdminAction({
      action: "invoice.refunded" as any,
      entityType: "invoices",
      entityId: invoice.id,
      details: `Refunded $${(amountRefundedCents / 100).toFixed(2)} for invoice ${invoiceNumber}. Synced to ShopDriver ticket ${ticketId}.`,
      actor: actorEmail,
      previousValue: "paid",
      newValue: "refunded",
      metadata: {
        stripeChargeId: chargeId,
        amountCents: amountRefundedCents,
        algTicketId: ticketId,
      }
    });

    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    log.error(`Failed to sync refund to ShopDriver for invoice ${invoiceNumber}: ${errorMsg}`);

    await logAdminAction({
      action: "invoice.refund_failed" as any,
      entityType: "invoices",
      entityId: invoice.id,
      details: `Refund writeback failed for invoice ${invoiceNumber}. Error: ${errorMsg}`,
      actor: actorEmail,
      previousValue: "paid",
      newValue: "paid",
      metadata: {
        stripeChargeId: chargeId,
        amountCents: amountRefundedCents,
        error: errorMsg,
      }
    });

    return { success: false, error: errorMsg };
  }
}
