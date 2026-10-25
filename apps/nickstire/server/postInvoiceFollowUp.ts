/**
 * Automated 7-Day Post-Invoice Follow-Up
 *
 * Runs daily via setInterval. Checks for customers whose last visit
 * was exactly 7 days ago (±1 day window) and sends them the post-visit
 * text (shared/postVisitText.ts: thank-you, "text us here", then the review ask).
 *
 * Prevents duplicates by checking smsCampaignSent > 0.
 * Tracks all sends in the database.
 *
 * OPTIMIZED: Uses the short nickstire.org/review URL instead of the full Google URL
 * to keep the message at 2 SMS segments.
 */

import { customers } from "../drizzle/schema";
import { sql, and, eq, gte, lte } from "drizzle-orm";

async function getDatabase() {
  const { getDb } = await import("./db");
  return getDb();
}
import { sendSms } from "./sms";
import { postVisitText } from "@shared/postVisitText";
import { greetingName } from "./services/invoiceReviewRequests";

import { createLogger } from "./lib/logger";

const log = createLogger("postInvoiceFollowUp");

// Nour, 2026-10-25: the post-visit text goes out even after a review request, but never within
// this many days of any other shop text. It is a thank-you, so the 30-day review cooldown is not its gate.
const POST_VISIT_TEXT_GAP_DAYS = 3;

// ─── SHORT URL (saves ~50 chars → 2 segments instead of 3) ─────
const REVIEW_URL = "nickstire.org/review";

// ─── PROCESSOR ──────────────────────────────────────────

export interface FollowUpResult {
  processed: number;
  /** Delivered now. */
  sent: number;
  /** Parked for the 8 AM window — will go out, not sent yet (audit F-3). */
  queued: number;
  failed: number;
  skipped: number;
}

/**
 * Process 7-day post-invoice follow-ups.
 * Finds customers whose lastVisitDate was 7 days ago (±1 day window)
 * who haven't been sent a campaign text yet.
 *
 * Sends max 20 per run to stay within rate limits.
 * Only sends to valid E.164 phone numbers to avoid wasted attempts.
 */
export async function processPostInvoiceFollowUps(): Promise<FollowUpResult> {
  const result: FollowUpResult = { processed: 0, sent: 0, queued: 0, failed: 0, skipped: 0 };

  try {
    // Calculate the 7-day window: customers who visited 6-8 days ago
    // This gives a ±1 day buffer so we don't miss anyone
    const now = new Date();
    const sixDaysAgo = new Date(now);
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
    const eightDaysAgo = new Date(now);
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);

    // Query customers:
    // - lastVisitDate between 6 and 8 days ago
    // - smsCampaignSent = 0 (not already texted)
    // - has a usable 10-digit phone (the canonical stored format —
    //   sendSms normalizes it). 2026-07-11: this filter previously
    //   required `LIKE '+1%'`, but customers.phone is stored bare
    //   10-digit (1941/1945 rows), so it matched ZERO customers — one of
    //   two bugs that made this whole cron a permanent silent no-op.
    const db = await getDatabase();
    if (!db) {
      log.error("[PostInvoiceFollowUp] Database not available");
      return result;
    }
    const { hasOutboundTextWithinDays } = await import("./db");
    const eligibleCustomers = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.smsCampaignSent, 0),
          // wave-122 (HIGH/TCPA S9) — was missing the smsOptOut filter
          // that every other outbound SMS job applies (declinedWorkRecovery,
          // crossSellOutreach, retentionSequences). Without it, any
          // opted-out customer with a 6-8d visit window received a
          // marketing SMS — TCPA violation with real legal exposure.
          eq(customers.smsOptOut, 0),
          // 2026-07-11: bounds were inverted (gte sixDaysAgo + lte
          // eightDaysAgo → empty set, since eightDaysAgo < sixDaysAgo),
          // the second bug that guaranteed 0 matches every run.
          gte(customers.lastVisitDate, eightDaysAgo),
          lte(customers.lastVisitDate, sixDaysAgo),
          sql`${customers.phone} IS NOT NULL AND ${customers.phone} != '' AND ${customers.phone} REGEXP '^[0-9]{10}$'`,
          // 2026-10-25: phones the shop texted inside the gap are excluded HERE. The per-customer
          // check below never marks a skipped customer, so without this they would refill this
          // .limit(20) every run and crowd out the customers who are still due. Both phone columns
          // are bare 10 digits (probe 2026-10-25: 100% of rows), so the equality join is exact.
          sql`NOT EXISTS (SELECT 1 FROM sms_messages m JOIN sms_conversations c ON m.conversationId = c.id WHERE c.phone = ${customers.phone} AND m.direction = 'outbound' AND m.status <> 'failed' AND m.createdAt >= NOW() - INTERVAL ${POST_VISIT_TEXT_GAP_DAYS} DAY)`
        )
      )
      .limit(20); // Max 20 per run to stay within rate limits

    if (eligibleCustomers.length === 0) {
      return result;
    }

    result.processed = eligibleCustomers.length;

    for (const customer of eligibleCustomers) {
      // Title-cased first word, "there" for blanks and placeholders: same rule as the other post-visit senders.
      const firstName = greetingName(customer.firstName).split(" ")[0];

      // Both segments were visited 6-8 days ago (the query above), so one post-visit text serves them.
      const message = postVisitText(firstName, REVIEW_URL);

      try {
        // Gate SMS behind feature flag
        const { isEnabled } = await import("./services/featureFlags");
        if (!(await isEnabled("sms_review_requests"))) {
          result.skipped++;
          continue;
        }

        // Belt-and-braces for a text that landed between the query above and this send.
        if (await hasOutboundTextWithinDays(customer.phone, POST_VISIT_TEXT_GAP_DAYS)) {
          result.skipped++;
          continue;
        }

        // At-most-once claim — bump smsCampaignSent BEFORE the send. If the
        // run crashes after the text goes out, the customer is already
        // marked, so the next daily run won't re-text. The conditional
        // WHERE (smsCampaignSent = 0) makes two overlapping runs safe.
        const claimRes = await db
          .update(customers)
          .set({
            smsCampaignSent: sql`${customers.smsCampaignSent} + 1`,
            smsCampaignDate: new Date(),
          })
          .where(and(eq(customers.id, customer.id), eq(customers.smsCampaignSent, 0)));
        if (((claimRes as unknown as Array<{ affectedRows?: number }>)[0]?.affectedRows ?? 0) === 0) {
          result.skipped++;
          continue; // already claimed by an overlapping run
        }

        // Wave-108: post-invoice review request via shop gateway so the
        // customer recognizes the sender (same line they paid through).
        const smsResult = await sendSms(customer.phone, message, { via: "shop" });

        // 2026-09-01 (audit F-3): success:true covers a text parked for the
        // 8 AM window; count it as queued, never as sent. The claim above is
        // correct either way (queued texts do go out).
        const { smsOutcome } = await import("./lib/smsOutcome");
        const outcome = smsOutcome(smsResult);
        if (outcome === "sent") {
          result.sent++;
        } else if (outcome === "queued") {
          result.queued++;
        } else {
          result.failed++;
        }
      } catch (err) {
        log.error("[PostInvoiceFollowUp] Follow-up send failed:", err instanceof Error ? err.message : err);
        result.failed++;
      }

      // Rate limit: 1 second between messages
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  } catch (err) {
    log.error("[PostInvoiceFollowUp] Processing error:", err);
  }

  return result;
}
