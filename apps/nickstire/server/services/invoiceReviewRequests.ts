/**
 * Review requests from the shop's REAL completion signal: paid ALG/ShopDriver invoices.
 *
 * WHY (2026-10-02 admin truth pass). review_requests held one row ever: the only creator was
 * an admin marking a website booking `completed`, and walk-in work — nearly all of the shop's
 * volume — arrives as ALG invoices with no booking. This creates ONE pending review_requests
 * row per recent paid invoice; the existing `review-requests` cron then sends it under every
 * gate it already has (settings.enabled, sms_review_requests flag, gateway, 9-19 Cleveland,
 * daily cap, claim-before-send, opt-out, holdouts). Nothing here sends.
 *
 * Exactly-once: UNIQUE(review_requests.invoiceId) from migration 0139, plus the per-phone
 * cooldown (isPhoneOnReviewCooldown) shared with booking-sourced rows. The older
 * `post-invoice-followup` lane also texts a review ask (once per customer, keyed on
 * customers.smsCampaignSent); candidates it already reached inside the cooldown are skipped
 * here, and it skips phones this lane already scheduled (postInvoiceFollowUp.ts), so a
 * customer is asked at most once per cooldown across both lanes.
 *
 * Deploy order: inert until 0139 is applied — checked in information_schema before any write
 * (invoiceId is not in drizzle/schema.ts yet, so every invoiceId reference here is raw SQL).
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, getReviewSettings, isPhoneOnReviewCooldown } from "../db";
import { isDuplicateKeyError } from "../lib/dbErrors";
import { createLogger } from "../lib/logger";

const log = createLogger("services:invoiceReviewRequests");

/** Only invoices this recent: arming the lane must never reach back over months of customers. */
const LOOKBACK_DAYS = 3;
const MAX_PER_RUN = 50;

const rowsOf = (result: unknown): Array<Record<string, unknown>> => {
  const r = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(r) ? (r as Array<Record<string, unknown>>) : [];
};

export async function createInvoiceReviewRequests(): Promise<{
  created: number;
  onCooldown: number;
  duplicate: number;
  candidates: number;
  reason?: string;
}> {
  const empty = { created: 0, onCooldown: 0, duplicate: 0, candidates: 0 };
  const db = await getDb();
  if (!db) throw new Error("database unavailable");

  const [ready] = rowsOf(await db.execute(sql`
    SELECT
      SUM(COLUMN_NAME = 'invoiceId') AS hasInvoiceId,
      SUM(COLUMN_NAME = 'bookingId' AND IS_NULLABLE = 'YES') AS bookingNullable
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'review_requests'
  `));
  if (Number(ready?.hasInvoiceId) !== 1 || Number(ready?.bookingNullable) !== 1) {
    return { ...empty, reason: "migration 0139_review_requests_invoice_source not applied — no invoice-sourced rows created" };
  }

  const settings = await getReviewSettings();
  if (!settings.enabled) return { ...empty, reason: "review requests are disabled in settings" };

  const phoneKey = sql.raw(`RIGHT(REGEXP_REPLACE(i.customerPhone, '[^0-9]', ''), 10)`);
  const candidates = rowsOf(await db.execute(sql`
    SELECT i.id AS id, i.customerName AS name, ${phoneKey} AS phone,
           LEFT(COALESCE(NULLIF(i.serviceDescription, ''), 'service'), 100) AS service
    FROM invoices i
    WHERE i.source = 'shopdriver' AND i.paymentStatus = 'paid'
      AND i.invoiceDate >= NOW() - INTERVAL ${LOOKBACK_DAYS} DAY
      AND i.customerPhone IS NOT NULL
      AND LENGTH(${phoneKey}) = 10
      AND NOT EXISTS (SELECT 1 FROM review_requests r WHERE r.invoiceId = i.id)
      AND NOT EXISTS (
        SELECT 1 FROM customers c WHERE c.phone = ${phoneKey}
          AND (c.smsOptOut = 1 OR c.smsCampaignDate >= NOW() - INTERVAL ${settings.cooldownDays} DAY)
      )
    ORDER BY i.invoiceDate DESC
    LIMIT ${MAX_PER_RUN}
  `));

  let created = 0;
  let onCooldown = 0;
  let duplicate = 0;
  for (const c of candidates) {
    const phone = String(c.phone);
    // Also catches a second invoice for the same phone in this batch: the first insert
    // below is a non-failed row inside the window.
    if (await isPhoneOnReviewCooldown(phone, settings.cooldownDays)) {
      onCooldown++;
      continue;
    }
    try {
      await db.execute(sql`
        INSERT INTO review_requests
          (bookingId, invoiceId, customerName, phone, service, status, scheduledAt, trackingToken)
        VALUES
          (NULL, ${Number(c.id)}, ${String(c.name || "Customer").slice(0, 255)}, ${phone},
           ${String(c.service)}, 'pending', NOW() + INTERVAL ${settings.delayMinutes} MINUTE,
           ${crypto.randomBytes(24).toString("hex")})
      `);
      created++;
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        duplicate++; // another run scheduled this invoice first — the unique key did its job
        continue;
      }
      throw err;
    }
  }
  if (created > 0) log.info("invoice-sourced review requests scheduled", { created, onCooldown, duplicate });
  return { created, onCooldown, duplicate, candidates: candidates.length };
}
