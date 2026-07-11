/**
 * Automated 7-Day Post-Invoice Follow-Up
 *
 * Runs daily via setInterval. Checks for customers whose last visit
 * was exactly 7 days ago (±1 day window) and sends them the same
 * thank you + review request + referral text used in the campaign.
 *
 * Prevents duplicates by checking smsCampaignSent > 0.
 * Tracks all sends in the database.
 *
 * OPTIMIZED: Uses short nickstire.org URLs instead of full Google URLs
 * to keep messages at 2 SMS segments (~252 chars) instead of 3 (~383 chars).
 * Saves 33% on per-message cost ($0.0158 vs $0.0237).
 */

import { customers } from "../drizzle/schema";
import { sql, and, eq, gte, lte } from "drizzle-orm";

async function getDatabase() {
  const { getDb } = await import("./db");
  return getDb();
}
import { sendSms } from "./sms";
import { STORE_NAME, STORE_PHONE } from "@shared/const";

import { createLogger } from "./lib/logger";

const log = createLogger("postInvoiceFollowUp");
// ─── SHORT URLs (saves ~50 chars → 2 segments instead of 3) ─────
const REVIEW_URL = "nickstire.org/review";
const REFER_URL = "nickstire.org/refer";

// ─── MESSAGE TEMPLATES (optimized for 2 SMS segments) ────────────

function recentMessage(firstName: string): string {
  return `Hi ${firstName}, thank you for choosing ${STORE_NAME}! We truly appreciate your business.\n\nGot 30 sec? A Google review helps other Cleveland drivers find honest repair:\n${REVIEW_URL}\n\nRefer a friend: ${REFER_URL}\n— Nick's Team ${STORE_PHONE}`;
}

function lapsedMessage(firstName: string): string {
  return `Hi ${firstName}, this is ${STORE_NAME}. Thank you for trusting us with your vehicle!\n\nA quick Google review means a lot to us:\n${REVIEW_URL}\n\nRefer a friend: ${REFER_URL}\nWe'd love to see you again. — Nick's Team ${STORE_PHONE}`;
}

// ─── PROCESSOR ──────────────────────────────────────────

export interface FollowUpResult {
  processed: number;
  sent: number;
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
  const result: FollowUpResult = { processed: 0, sent: 0, failed: 0, skipped: 0 };

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
          sql`${customers.phone} IS NOT NULL AND ${customers.phone} != '' AND ${customers.phone} REGEXP '^[0-9]{10}$'`
        )
      )
      .limit(20); // Max 20 per run to stay within rate limits

    if (eligibleCustomers.length === 0) {
      return result;
    }

    result.processed = eligibleCustomers.length;

    for (const customer of eligibleCustomers) {
      const firstName = customer.firstName || "Valued Customer";

      // Choose message based on segment (same logic as campaign)
      const message =
        customer.segment === "lapsed"
          ? lapsedMessage(firstName)
          : recentMessage(firstName);

      try {
        // Gate SMS behind feature flag
        const { isEnabled } = await import("./services/featureFlags");
        if (!(await isEnabled("sms_review_requests"))) {
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

        if (smsResult.success) {
          result.sent++;
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
