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
 * Deploy order: inert until 0139 is applied — checked in information_schema before any write.
 * 0139 was applied and recorded in production on 2026-10-02 and `invoiceId` is now declared in
 * drizzle/schema.ts; the check stays as the guard for any database restored from before 0139
 * (one cheap information_schema read per run).
 */
import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb, getReviewSettings, isPhoneOnReviewCooldown } from "../db";
import { isDuplicateKeyError } from "../lib/dbErrors";
import { createLogger } from "../lib/logger";
import { readRows } from "../lib/dbResult";

const log = createLogger("services:invoiceReviewRequests");

/** Only invoices this recent: arming the lane must never reach back over months of customers. */
const LOOKBACK_DAYS = 3;
const MAX_PER_RUN = 50;

/**
 * The name the review SMS greets ("Hi {first word}, …" — routers/reviewRequests.ts
 * buildReviewMessage). ALG writes "Last, First" ("Aiken, David") and imports are often ALL
 * CAPS, so the raw invoice name would greet David as "Hi Aiken," / "Hi AIKEN,". Normalised to
 * "First Last", title-cased. Greets "there" instead when there is no plausible first name:
 * a placeholder ("Unknown", "Cash"), an empty first part ("Smith,"), or a business — ALG
 * also writes fleet/company accounts, and "ACME AUTO, LLC" would otherwise greet "Hi Llc,".
 */
const BUSINESS_TOKEN =
  /^(llc|inc|corp|corporation|co|company|ltd|lp|llp|pllc|auto|automotive|motors?|tires?|service|services|group|enterprises?|trucking|transport|logistics|fleet|rentals?|towing|church|school|city|county|dept|department|dealership|sales|repair)\.?$/i;
function greetingName(raw: unknown): string {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  const hasComma = text.includes(",");
  const [last, first] = hasComma ? text.split(",", 2).map((p) => p.trim()) : ["", text];
  const ordered = (hasComma ? `${first} ${last}` : first).trim();
  const words = ordered.split(" ").filter(Boolean);
  const firstWord = (hasComma ? first.split(" ")[0] : words[0]) ?? "";
  if (
    !/^[A-Za-z][A-Za-z'-]{1,}$/.test(firstWord) ||
    /^(unknown|customer|cash|n\/?a|test)$/i.test(firstWord) ||
    words.some((w) => BUSINESS_TOKEN.test(w))
  ) {
    return "there";
  }
  const title = (w: string) => w.toLowerCase().replace(/(^|[-'])([a-z])/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
  return words.map(title).join(" ").slice(0, 255);
}


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

  const [ready] = readRows(await db.execute(sql`
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

  // Matching notes for the candidate read below:
  //  · customers.phone is stored in mixed formats; customers.phone10 is the generated
  //    last-10-digits column (uniq_customer_phone10) made for exactly this match.
  //  · Phones already asked inside the cooldown are excluded IN SQL, not skipped per row,
  //    so those invoices never fill this run's LIMIT and starve newer ones.
  const phoneKey = sql.raw(`RIGHT(REGEXP_REPLACE(i.customerPhone, '[^0-9]', ''), 10)`);
  const candidates = readRows(await db.execute(sql`
    SELECT i.id AS id, i.customerName AS name, ${phoneKey} AS phone
    FROM invoices i
    WHERE i.source = 'shopdriver' AND i.paymentStatus = 'paid'
      AND i.invoiceDate >= NOW() - INTERVAL ${LOOKBACK_DAYS} DAY
      AND i.customerPhone IS NOT NULL
      AND LENGTH(${phoneKey}) = 10
      AND NOT EXISTS (SELECT 1 FROM review_requests r WHERE r.invoiceId = i.id)
      AND NOT EXISTS (
        SELECT 1 FROM customers c WHERE c.phone10 = ${phoneKey}
          AND (c.smsOptOut = 1 OR c.smsCampaignDate >= NOW() - INTERVAL ${settings.cooldownDays} DAY)
      )
      AND NOT EXISTS (
        SELECT 1 FROM review_requests rr WHERE rr.phone = ${phoneKey} AND rr.status <> 'failed'
          AND (rr.createdAt >= NOW() - INTERVAL ${settings.cooldownDays} DAY
               OR rr.sentAt >= NOW() - INTERVAL ${settings.cooldownDays} DAY)
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
      // service NULL -> the SMS says "your service". ALG's description field can be a raw
      // ticket summary or even the VEHICLE ("thanks for trusting us with your 2014 honda
      // civic!"); it is never customer copy.
      await db.execute(sql`
        INSERT INTO review_requests
          (bookingId, invoiceId, customerName, phone, service, status, scheduledAt, trackingToken)
        VALUES
          (NULL, ${Number(c.id)}, ${greetingName(c.name)}, ${phone},
           NULL, 'pending', NOW() + INTERVAL ${settings.delayMinutes} MINUTE,
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
