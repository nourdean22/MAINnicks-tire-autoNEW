/**
 * Cron: Declined Work Recovery
 *
 * Fires 7-day and 30-day SMS follow-ups to customers whose ALG walk-in
 * estimate was NEVER matched to an invoice — declined work = recovery target.
 *
 * Data source: `alg_estimates` table (populated by
 * server/services/shopDriverEstimateSync.ts).
 *
 * Rules:
 *   - Only rows where matchedInvoiceId IS NULL AND estimateDate >= today-60d
 *   - Send 7d SMS when age > 7d AND follow_up_7d_sent = 0
 *   - Send 30d SMS when age > 30d AND follow_up_30d_sent = 0
 *   - Respect customers.smsOptOut (checked by join against customer phone)
 *   - Business hours only (8am-7pm ET)
 *   - Feature-flag gated: env FEATURE_DECLINED_RECOVERY=1 enables actual
 *     sends. Without the flag, the cron runs as a DRY RUN (logs + Telegram
 *     alert with recoverable $ value, but no SMS out).
 *
 * This is a DAILY tier job — not aggressive. The goal is recovery, not
 * harassment. 7 days gives the customer time to get the work done
 * elsewhere (or change their mind). 30 days is a nudge before the
 * estimate goes cold.
 */

import { and, eq, gte, lte, isNull, sql } from "drizzle-orm";
import { BUSINESS } from "@shared/business";
import { createLogger } from "../../lib/logger";

const log = createLogger("cron:declined-recovery");

interface RecoveryResult {
  recordsProcessed: number;
  details: string;
}

function isBusinessHours(): boolean {
  const etHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }),
    10,
  );
  return etHour >= 8 && etHour <= 19;
}

function firstName(full: string | null | undefined): string {
  if (!full) return "there";
  const first = full.trim().split(/\s+/)[0];
  // Handle "LASTNAME, FIRSTNAME" pattern from ALG
  if (full.includes(",")) {
    const parts = full.split(",").map((s) => s.trim());
    return parts[1]?.split(/\s+/)[0] || parts[0] || "there";
  }
  return first || "there";
}

function formatMoney(cents: number): string {
  return `$${Math.round(cents / 100)}`;
}

// Wave-101: exported so the bulk-SMS tRPC endpoint can reuse the
// same templates the cron uses. Keeps message tone consistent.
export function buildSevenDayMessage(params: {
  name: string;
  amountCents: number;
  service: string | null;
}): string {
  const svc = params.service && params.service.length > 0
    ? params.service.slice(0, 60)
    : "the work we quoted";
  return (
    `Hey ${params.name}, Nick's Tire & Auto — we quoted you ${formatMoney(params.amountCents)} for ${svc}. ` +
    `Still on the fence? That number's still good this week. ` +
    `Drop off anytime, we'll work around you. Reply STOP to opt out.`
  );
}

export function buildThirtyDayMessage(params: {
  name: string;
  amountCents: number;
}): string {
  return (
    `Hey ${params.name}, it's been a month since we quoted ${formatMoney(params.amountCents)} at Nick's Tire & Auto. ` +
    `Car issues rarely fix themselves — come in, we'll honor the quote. ` +
    `(216) 862-0005. Reply STOP to opt out.`
  );
}

export { firstName as parseFirstName };

export async function runDeclinedWorkRecovery(): Promise<RecoveryResult> {
  if (!isBusinessHours()) {
    return { recordsProcessed: 0, details: "skipped (outside business hours)" };
  }

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  const { algEstimates, customers } = await import("../../../drizzle/schema");

  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // All unmatched estimates in the recovery window
  const unmatched = await d
    .select({
      id: algEstimates.id,
      customerName: algEstimates.customerName,
      customerPhone: algEstimates.customerPhone,
      serviceDescription: algEstimates.serviceDescription,
      estimatedAmount: algEstimates.estimatedAmount,
      estimateDate: algEstimates.estimateDate,
      followUp7dSent: algEstimates.followUp7dSent,
      followUp30dSent: algEstimates.followUp30dSent,
    })
    .from(algEstimates)
    .where(
      and(
        isNull(algEstimates.matchedInvoiceId),
        gte(algEstimates.estimateDate, sixtyDaysAgo),
        lte(algEstimates.estimateDate, sevenDaysAgo),
      ),
    )
    .limit(100);

  if (unmatched.length === 0) {
    return { recordsProcessed: 0, details: "No declined estimates eligible for follow-up" };
  }

  // Total recoverable exposure for the report
  const totalRecoverableCents = unmatched.reduce(
    (sum: number, e: { estimatedAmount: number | null }) => sum + (e.estimatedAmount || 0),
    0,
  );

  const featureEnabled = process.env.FEATURE_DECLINED_RECOVERY === "1";

  // DRY RUN path — report but don't send
  if (!featureEnabled) {
    log.info(
      `DRY RUN: ${unmatched.length} declined estimates eligible (${formatMoney(totalRecoverableCents)} recoverable). ` +
        `Set FEATURE_DECLINED_RECOVERY=1 to enable sends.`,
    );
    try {
      const { sendTelegram } = await import("../../services/telegram");
      await sendTelegram(
        `💰 DECLINED WORK (DRY RUN)\n\n` +
          `${unmatched.length} ALG estimates with no matching invoice, ${formatMoney(totalRecoverableCents)} recoverable.\n` +
          `Set FEATURE_DECLINED_RECOVERY=1 to start 7d/30d SMS follow-ups.`,
      );
    } catch (e) {
      log.warn("[declined-recovery] telegram notify failed:", e);
    }
    return {
      recordsProcessed: unmatched.length,
      details: `DRY RUN: ${unmatched.length} eligible, ${formatMoney(totalRecoverableCents)} recoverable`,
    };
  }

  // LIVE send path — feature-flagged on
  const { sendSms } = await import("../../sms");
  let sent7d = 0;
  let sent30d = 0;
  let skippedOptOut = 0;
  let skippedNoPhone = 0;

  for (const est of unmatched) {
    if (!est.customerPhone) {
      skippedNoPhone++;
      continue;
    }

    // Check SMS opt-out via customers table lookup by last-10 digits
    const normalized = est.customerPhone.replace(/\D/g, "").slice(-10);
    const [cust] = await d
      .select({ smsOptOut: customers.smsOptOut })
      .from(customers)
      .where(sql`RIGHT(REPLACE(REPLACE(REPLACE(${customers.phone}, '-', ''), '(', ''), ')', ''), 10) = ${normalized}`)
      .limit(1);
    if (cust?.smsOptOut) {
      skippedOptOut++;
      continue;
    }

    const ageMs = now.getTime() - est.estimateDate.getTime();
    const name = firstName(est.customerName);
    const amount = est.estimatedAmount || 0;

    // 30-day follow-up takes precedence (more urgent)
    if (ageMs >= 30 * 24 * 60 * 60 * 1000 && !est.followUp30dSent) {
      const body = buildThirtyDayMessage({ name, amountCents: amount });
      const res = await sendSms(est.customerPhone, body);
      if (res.success) {
        await d
          .update(algEstimates)
          .set({ followUp30dSent: 1, followUp30dSentAt: new Date() })
          .where(eq(algEstimates.id, est.id));
        sent30d++;
        log.info(`30d follow-up sent to ${name} (${formatMoney(amount)} quote)`);
      }
      continue;
    }

    // 7-day follow-up
    if (ageMs >= 7 * 24 * 60 * 60 * 1000 && !est.followUp7dSent) {
      const body = buildSevenDayMessage({
        name,
        amountCents: amount,
        service: est.serviceDescription,
      });
      const res = await sendSms(est.customerPhone, body);
      if (res.success) {
        await d
          .update(algEstimates)
          .set({ followUp7dSent: 1, followUp7dSentAt: new Date() })
          .where(eq(algEstimates.id, est.id));
        sent7d++;
        log.info(`7d follow-up sent to ${name} (${formatMoney(amount)} quote)`);
      }
    }
  }

  const total = sent7d + sent30d;
  if (total > 0) {
    try {
      const { sendTelegram } = await import("../../services/telegram");
      await sendTelegram(
        `📬 DECLINED WORK RECOVERY: ${total} SMS sent (${sent7d} 7-day + ${sent30d} 30-day). ` +
          `Potential pool: ${formatMoney(totalRecoverableCents)} from ${unmatched.length} quotes.`,
      );
    } catch (e) {
      log.warn("[declined-recovery] telegram notify failed:", e);
    }
  }

  return {
    recordsProcessed: total,
    details: `Sent ${sent7d} 7-day + ${sent30d} 30-day | skipped: ${skippedOptOut} opt-out, ${skippedNoPhone} no phone | pool: ${formatMoney(totalRecoverableCents)}`,
  };
}
