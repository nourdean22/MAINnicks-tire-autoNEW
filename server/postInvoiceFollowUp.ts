/**
 * Automated 7-Day Post-Invoice Follow-Up
 *
 * Runs daily via setInterval. Checks for customers whose last visit
 * was exactly 7 days ago (±1 day window) and sends them the same
 * thank you + review request + referral text used in the campaign.
 *
 * Prevents duplicates by checking smsCampaignSent > 0.
 * Tracks all sends in the database.
 */

import { customers } from "../drizzle/schema";
import { sql, and, eq, gte, lte } from "drizzle-orm";

async function getDatabase() {
  const { getDb } = await import("./db");
  return getDb();
}
import { sendSms } from "./sms";
import { STORE_NAME, STORE_PHONE, GBP_REVIEW_URL } from "@shared/const";

// ─── MESSAGE TEMPLATES ─────────────────────────────────
// Exact same messages used in the mass campaign

const REFERRAL_URL = "https://nickstire.org/refer";

function recentMessage(firstName: string): string {
  return `Hi ${firstName}, thank you for choosing ${STORE_NAME}! We truly appreciate your business.\n\nIf you have 30 seconds, a Google review helps other Cleveland drivers find honest repair:\n${GBP_REVIEW_URL}\n\nKnow someone who needs reliable auto service? Refer them to us: ${REFERRAL_URL}\n\nThank you! — Nick's Team\n${STORE_PHONE}`;
}

function lapsedMessage(firstName: string): string {
  return `Hi ${firstName}, this is ${STORE_NAME}. Thank you for trusting us with your vehicle. We hope it's running great!\n\nIf you had a good experience, a quick Google review means a lot:\n${GBP_REVIEW_URL}\n\nRefer a friend or family member: ${REFERRAL_URL}\n\nWe'd love to see you again. — Nick's Team\n${STORE_PHONE}`;
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
 */
export async function processPostInvoiceFollowUps(): Promise<FollowUpResult> {
  const result: FollowUpResult = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  try {
    // Calculate the 7-day window: customers who visited 6-8 days ago
    // This gives a ±1 day buffer so we don't miss anyone
    const now = new Date();
    const sixDaysAgo = new Date(now);
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 8);
    const eightDaysAgo = new Date(now);
    eightDaysAgo.setDate(eightDaysAgo.getDate() - 6);

    // Query customers:
    // - lastVisitDate between 6 and 8 days ago
    // - smsCampaignSent = 0 (not already texted)
    // - has a phone number
    const db = await getDatabase();
    if (!db) {
      console.error("[PostInvoiceFollowUp] Database not available");
      return result;
    }
    const eligibleCustomers = await db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.smsCampaignSent, 0),
          gte(customers.lastVisitDate, sixDaysAgo),
          lte(customers.lastVisitDate, eightDaysAgo),
          sql`${customers.phone} IS NOT NULL AND ${customers.phone} != ''`
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
        const smsResult = await sendSms(customer.phone, message);

        if (smsResult.success) {
          // Mark as sent in database
          await db
            .update(customers)
            .set({
              smsCampaignSent: sql`${customers.smsCampaignSent} + 1`,
              smsCampaignDate: new Date(),
            })
            .where(eq(customers.id, customer.id));

          result.sent++;
        } else {
          result.failed++;
        }
      } catch {
        result.failed++;
      }

      // Rate limit: 1 second between messages
      await new Promise((resolve) => setTimeout(resolve, 1100));
    }
  } catch (err) {
    console.error("[PostInvoiceFollowUp] Processing error:", err);
  }

  return result;
}
