/**
 * Google Ads Offline Conversion Tracking
 *
 * When a customer with a gclid pays an invoice, this service sends
 * the conversion data back to Google Ads so you can see which ad
 * clicks turned into real revenue.
 *
 * Flow:
 * 1. Customer clicks Google Ad → lands on nickstire.org with ?gclid=xyz
 * 2. gclid is captured by UTM utility → stored on booking/lead
 * 3. Customer pays invoice → event bus fires invoice_paid
 * 4. This service sends conversion to Google Ads API
 *
 * Env vars needed:
 * - GOOGLE_ADS_CUSTOMER_ID: Your Google Ads account ID (10 digits, no dashes)
 * - GOOGLE_ADS_CONVERSION_ACTION_ID: The conversion action resource name
 * - GOOGLE_ADS_DEVELOPER_TOKEN: Developer token for API access
 *
 * Google Ads API docs: https://developers.google.com/google-ads/api/docs/conversions/upload-clicks
 */

import { createLogger } from "../lib/logger";

const log = createLogger("google-ads");

interface ConversionData {
  gclid: string;
  conversionDateTime: string; // ISO 8601 format
  conversionValue: number; // Revenue in dollars
  currencyCode?: string;
  orderId?: string;
}

/**
 * Upload an offline conversion to Google Ads.
 * Uses the Google Ads REST API (v18).
 */
export async function uploadConversion(data: ConversionData): Promise<{ success: boolean; error?: string }> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const conversionActionId = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const accessToken = process.env.GOOGLE_ADS_ACCESS_TOKEN; // OAuth2 token

  if (!customerId || !conversionActionId || !developerToken || !accessToken) {
    return { success: false, error: "Google Ads API not configured" };
  }

  try {
    const url = `https://googleads.googleapis.com/v18/customers/${customerId}:uploadClickConversions`;

    const body = {
      conversions: [{
        gclid: data.gclid,
        conversionAction: `customers/${customerId}/conversionActions/${conversionActionId}`,
        conversionDateTime: data.conversionDateTime,
        conversionValue: data.conversionValue,
        currencyCode: data.currencyCode || "USD",
        orderId: data.orderId,
      }],
      partialFailure: true,
    };

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`,
        "developer-token": developerToken,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      log.warn("Google Ads conversion upload failed:", { status: res.status, body: errText.slice(0, 200) });
      return { success: false, error: `HTTP ${res.status}: ${errText.slice(0, 100)}` };
    }

    log.info("Google Ads conversion uploaded:", { gclid: data.gclid.slice(-8), value: data.conversionValue });
    return { success: true };
  } catch (err: unknown) {
    log.warn("Google Ads conversion upload error:", { error: (err as Error).message });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Called from the event bus when an invoice is paid.
 * Looks up the gclid from the associated booking/lead.
 */
export async function trackInvoiceConversion(invoiceData: {
  totalAmount: number; // cents
  customerPhone?: string;
  invoiceNumber?: string;
}): Promise<void> {
  if (!process.env.GOOGLE_ADS_CUSTOMER_ID) return; // Not configured, skip silently

  try {
    const { getDb } = await import("../db");
    const { bookings, leads } = await import("../../drizzle/schema");
    const { eq, isNotNull, desc } = await import("drizzle-orm");
    const db = await getDb();
    if (!db || !invoiceData.customerPhone) return;

    // Find gclid from the most recent booking or lead with this phone
    let gclid: string | null = null;

    const recentBooking = await db.select({ gclid: bookings.gclid })
      .from(bookings)
      .where(eq(bookings.phone, invoiceData.customerPhone))
      .orderBy(desc(bookings.createdAt))
      .limit(1);

    if (recentBooking[0]?.gclid) {
      gclid = recentBooking[0].gclid;
    } else {
      const recentLead = await db.select({ gclid: leads.gclid })
        .from(leads)
        .where(eq(leads.phone, invoiceData.customerPhone))
        .orderBy(desc(leads.createdAt))
        .limit(1);
      if (recentLead[0]?.gclid) gclid = recentLead[0].gclid;
    }

    if (!gclid) return; // No gclid found — this customer didn't come from Google Ads

    await uploadConversion({
      gclid,
      conversionDateTime: new Date().toISOString().replace("T", " ").replace("Z", "+00:00"),
      conversionValue: invoiceData.totalAmount / 100, // cents → dollars
      orderId: invoiceData.invoiceNumber,
    });
  } catch (err: unknown) {
    log.warn("trackInvoiceConversion failed:", { error: (err as Error).message });
  }
}
