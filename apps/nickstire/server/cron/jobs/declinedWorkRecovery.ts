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
// wave-181.46 brand-voice tightening per .claude/brand-voice-guidelines.md:
//   - Repair Haiku ("you don't pay until you say yes") added as the closer
//     on BOTH tiers. This is the EXACT moment the customer's resistance
//     is highest (they declined the quote once — what makes them say yes
//     this time?) so the relief mechanism lands hardest here.
//   - "Still on the fence" softened to customer-language phrasing
//   - Quote-honoring made the explicit hook (sunk-cost recovery)
export function buildSevenDayMessage(params: {
  name: string;
  amountCents: number;
  service: string | null;
}): string {
  const svc = params.service && params.service.length > 0
    ? params.service.slice(0, 60)
    : "the work we quoted";
  return (
    `Hey ${params.name} — Nick's Tire & Auto. That ${formatMoney(params.amountCents)} ${svc} quote? ` +
    `Still good this week. Free re-check, no charge, you don't pay until you say yes. ` +
    `Drop off anytime. Reply STOP to opt out.`
  );
}

export function buildThirtyDayMessage(params: {
  name: string;
  amountCents: number;
}): string {
  return (
    `Hey ${params.name} — it's been a month since we quoted ${formatMoney(params.amountCents)}. ` +
    `Car stuff doesn't fix itself. We'll honor that quote, free re-check first — you don't pay until you say yes. ` +
    `(216) 862-0005. Reply STOP to opt out.`
  );
}

export { firstName as parseFirstName };

/**
 * wave-181.73 (architect-review · highest-leverage one-shot)
 *
 * Two consumers · daily cron (calls with no opts · uses safe default
 * cap of 20) AND the operator-driven one-shot script at
 * scripts/fire-declined-recovery.ts (passes a higher maxSends for a
 * bulk-clear of the backlog). Same code path, same safety guards —
 * just different volume budgets.
 *
 * Opts:
 *   maxSends  · override the per-run cap (default 20 · max 500)
 *   bypassBusinessHoursCheck · script-only · operator runs at 9 PM
 *     etc, but still respects the per-message sending-hours guard
 *     in sms.ts which queues out-of-hours messages for the morning
 *   skipDryRunGate · script-only · trust the operator's intent
 */
export interface RecoveryOptions {
  maxSends?: number;
  bypassBusinessHoursCheck?: boolean;
  skipDryRunGate?: boolean;
}

export async function runDeclinedWorkRecovery(opts?: RecoveryOptions): Promise<RecoveryResult> {
  if (!opts?.bypassBusinessHoursCheck && !isBusinessHours()) {
    return { recordsProcessed: 0, details: "skipped (outside business hours)" };
  }

  const { getDb } = await import("../../db");
  const d = await getDb();
  if (!d) return { recordsProcessed: 0, details: "No DB" };

  const { algEstimates, customers } = await import("../../../drizzle/schema");

  const now = new Date();
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  // All unmatched estimates in the recovery window.
  //
  // wave-181.76 (self-audit) · query .limit() now scales with the per-run
  // cap. Pre-fix the query was hardcoded at .limit(100) while the script
  // advertised --max=500 — operator running fire-declined-recovery
  // --max=500 would see only 100 estimates considered. Now: pull cap+50
  // (small headroom for opt-outs / no-phone skips that filter the loop)
  // up to a hard 500 ceiling matching the script's documented max.
  const fetchLimit = Math.min((opts?.maxSends ?? 20) + 50, 500);
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
    .limit(fetchLimit);

  if (unmatched.length === 0) {
    return { recordsProcessed: 0, details: "No declined estimates eligible for follow-up" };
  }

  // Total recoverable exposure for the report
  const totalRecoverableCents = unmatched.reduce(
    (sum: number, e: { estimatedAmount: number | null }) => sum + (e.estimatedAmount || 0),
    0,
  );

  const featureEnabled = process.env.FEATURE_DECLINED_RECOVERY === "1" || opts?.skipDryRunGate === true;

  // DRY RUN path — report but don't send
  if (!featureEnabled) {
    log.info(
      `DRY RUN: ${unmatched.length} declined estimates eligible (${formatMoney(totalRecoverableCents)} recoverable). ` +
        `Set FEATURE_DECLINED_RECOVERY=1 to enable sends.`,
    );
    try {
      // wave-181.72 (highest-leverage move) · LOUD Telegram alert with
      // the actual dollar amount + explicit Railway instruction. The
      // prior message was generic and easy to dismiss · this version
      // hits with money-on-the-table framing so the operator sees the
      // pipeline value at a glance from their phone.
      const { sendTelegramMessage } = await import("../../services/telegram");
      await sendTelegramMessage(
        `🔴 <b>${formatMoney(totalRecoverableCents)} IDLE — recovery cron is DRY-RUN</b>\n\n` +
          `${unmatched.length} walked-away estimates have NEVER received a follow-up.\n\n` +
          `<b>1 click on Railway to unleash:</b>\n` +
          `<code>FEATURE_DECLINED_RECOVERY=1</code>\n\n` +
          `Once set: 7d + 30d SMS auto-fires daily at 20/run cap.\n` +
          `Safety: at-most-once claim (wave-181.59) · TCPA opt-out (wave-181.60) · durable rate-limit (wave-181.68).`,
        "critical",
      );
    } catch (e) {
      log.warn("[declined-recovery] telegram notify failed:", e);
    }
    return {
      recordsProcessed: unmatched.length,
      details: `DRY RUN: ${unmatched.length} eligible, ${formatMoney(totalRecoverableCents)} recoverable — flip FEATURE_DECLINED_RECOVERY=1`,
    };
  }

  // LIVE send path — feature-flagged on
  const { sendSms } = await import("../../sms");
  let sent7d = 0;
  let sent30d = 0;
  let skippedOptOut = 0;
  let skippedNoPhone = 0;
  let perRowErrors = 0;

  // wave-117 · per-run cap. Even with .limit(100) on the query above,
  // an unbounded send loop is a cost-runaway + reputation risk if the
  // filter ever widens (e.g. a date math bug). 20 is the safe daily
  // default for cron. wave-181.73 made it overridable via opts so a
  // one-shot operator script can clear a backlog in a single run
  // (capped at 500 hard ceiling to keep us under the F25e Verizon
  // daily-throughput safe zone for an SMS Gateway phone number).
  const MAX_SMS_PER_RUN = Math.min(opts?.maxSends ?? 20, 500);

  // wave-121 — bulk-load opt-out phones BEFORE the loop. Was: a SELECT
  // against customers per estimate (up to 100 round-trips per run), with
  // a `RIGHT(REPLACE(...))` string transform that defeated the
  // uniq_customer_phone index → full table scan EACH iteration.
  // Now: one query that pulls all opt-outs with last-10-digits computed
  // server-side once, then in-memory check during the loop.
  const optOutSet = new Set<string>();
  try {
    const optOutRows = await d
      .select({ phone: customers.phone })
      .from(customers)
      .where(eq(customers.smsOptOut, 1));
    for (const row of optOutRows) {
      if (row.phone) optOutSet.add(row.phone.replace(/\D/g, "").slice(-10));
    }
    log.info(`[declined-recovery] preloaded ${optOutSet.size} opt-out phones`);
  } catch (e) {
    log.warn("[declined-recovery] opt-out preload failed; defaulting to empty set", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  for (const est of unmatched) {
    if (sent7d + sent30d >= MAX_SMS_PER_RUN) {
      log.info(`[declined-recovery] hit per-run cap of ${MAX_SMS_PER_RUN} sends, stopping early`);
      break;
    }

    // wave-117 — per-row try/catch. Was: any single bad row (DB error
    // on the followUp30dSent UPDATE, e.g. a missing column on a fresh
    // deploy) threw and unwound the entire loop, leaving subsequent
    // estimates unprocessed with no log per skipped row. Now contained:
    // log + continue.
    try {
      if (!est.customerPhone) {
        skippedNoPhone++;
        continue;
      }

      // wave-121 — was a per-row SELECT against customers; now in-memory
      // Set lookup against the preloaded opt-out phones.
      const normalized = est.customerPhone.replace(/\D/g, "").slice(-10);
      if (optOutSet.has(normalized)) {
        skippedOptOut++;
        continue;
      }

      const ageMs = now.getTime() - est.estimateDate.getTime();
      const name = firstName(est.customerName);
      const amount = est.estimatedAmount || 0;

      // wave-181.51 — persist outbound sends to sms_messages so the
      // /admin SMS Performance tile can read reply + conversion rates.
      // Pre-181.51 these sends were invisible because sendSms() only
      // persists delayed/queued messages — immediate sends bypassed
      // the table entirely.
      const { logOutboundSms } = await import("../../services/smsInstrumentation");

      // 30-day follow-up takes precedence (more urgent)
      if (ageMs >= 30 * 24 * 60 * 60 * 1000 && !est.followUp30dSent) {
        // wave-181.59 · at-most-once claim. Stamp AttemptedAt BEFORE
        // sending — if this UPDATE wins (affectedRows=1) we own the
        // attempt; a crash mid-send leaves AttemptedAt set so the next
        // cron run will not re-send. affectedRows=0 means a peer
        // process (multi-instance) or a prior crashed attempt already
        // claimed the row; either way we skip. Pattern mirrors
        // routers/campaigns.ts send() draft→active claim.
        const claimResult = await d
          .update(algEstimates)
          .set({ followUp30dAttemptedAt: new Date() })
          .where(and(eq(algEstimates.id, est.id), isNull(algEstimates.followUp30dAttemptedAt)));
        // wave-181.64 (bug-hunter) · check BOTH `affectedRows` (mysql2)
        // and `rowsAffected` (planetscale/d1/serverless) so a future
        // driver swap doesn't silently turn every claim into a no-op.
        // Mirror the pattern used in server/sms.ts rehydrate.
        const claimRaw = (Array.isArray(claimResult) && claimResult[0] && typeof claimResult[0] === "object"
          ? claimResult[0]
          : claimResult) as { affectedRows?: number; rowsAffected?: number };
        const claimed = claimRaw.affectedRows ?? claimRaw.rowsAffected ?? 0;
        if (claimed === 0) {
          log.info(`[declined-recovery] 30d claim lost for estimate ${est.id} (peer or prior attempt)`);
          continue;
        }

        const body = buildThirtyDayMessage({ name, amountCents: amount });
        // wave-181.46 · route through F25e gateway (Twilio dead per operator)
        const res = await sendSms(est.customerPhone, body, { via: "shop" });
        // Log to sms_messages regardless of success — failed sends matter
        // for failure-rate analysis. variantKey is "declined_d30" so the
        // admin tile can break out tier-level stats.
        await logOutboundSms(est.customerPhone, body, res.sid, "declined_d30");
        if (res.success) {
          await d
            .update(algEstimates)
            .set({ followUp30dSent: 1, followUp30dSentAt: new Date() })
            .where(eq(algEstimates.id, est.id));
          sent30d++;
          log.info(`30d follow-up sent to ${name} (${formatMoney(amount)} quote)`);
        } else {
          log.error(`[declined-recovery] 30d send failed after claim for estimate ${est.id}`, {
            error: res.error ?? "unknown",
          });
          // AttemptedAt is set; row will not re-send. Manual review:
          //   SELECT id, customer_phone, follow_up_30d_attempted_at
          //   FROM alg_estimates
          //   WHERE follow_up_30d_attempted_at IS NOT NULL AND follow_up_30d_sent = 0;
        }
        continue;
      }

      // 7-day follow-up
      if (ageMs >= 7 * 24 * 60 * 60 * 1000 && !est.followUp7dSent) {
        // wave-181.59 · at-most-once claim (see 30d branch above)
        const claimResult = await d
          .update(algEstimates)
          .set({ followUp7dAttemptedAt: new Date() })
          .where(and(eq(algEstimates.id, est.id), isNull(algEstimates.followUp7dAttemptedAt)));
        // wave-181.64 (bug-hunter) · check BOTH `affectedRows` (mysql2)
        // and `rowsAffected` (planetscale/d1/serverless) so a future
        // driver swap doesn't silently turn every claim into a no-op.
        // Mirror the pattern used in server/sms.ts rehydrate.
        const claimRaw = (Array.isArray(claimResult) && claimResult[0] && typeof claimResult[0] === "object"
          ? claimResult[0]
          : claimResult) as { affectedRows?: number; rowsAffected?: number };
        const claimed = claimRaw.affectedRows ?? claimRaw.rowsAffected ?? 0;
        if (claimed === 0) {
          log.info(`[declined-recovery] 7d claim lost for estimate ${est.id} (peer or prior attempt)`);
          continue;
        }

        const body = buildSevenDayMessage({
          name,
          amountCents: amount,
          service: est.serviceDescription,
        });
        // wave-181.46 · route through F25e gateway (Twilio dead per operator)
        const res = await sendSms(est.customerPhone, body, { via: "shop" });
        await logOutboundSms(est.customerPhone, body, res.sid, "declined_d7");
        if (res.success) {
          await d
            .update(algEstimates)
            .set({ followUp7dSent: 1, followUp7dSentAt: new Date() })
            .where(eq(algEstimates.id, est.id));
          sent7d++;
          log.info(`7d follow-up sent to ${name} (${formatMoney(amount)} quote)`);
        } else {
          log.error(`[declined-recovery] 7d send failed after claim for estimate ${est.id}`, {
            error: res.error ?? "unknown",
          });
          // AttemptedAt is set; row will not re-send. Manual review:
          //   SELECT id, customer_phone, follow_up_7d_attempted_at
          //   FROM alg_estimates
          //   WHERE follow_up_7d_attempted_at IS NOT NULL AND follow_up_7d_sent = 0;
        }
      }
    } catch (rowErr) {
      perRowErrors++;
      log.warn(`[declined-recovery] estimate ${est.id} failed`, {
        error: rowErr instanceof Error ? rowErr.message : String(rowErr),
      });
      // continue — don't kill the whole batch on one bad row
    }
  }

  const total = sent7d + sent30d;
  if (total > 0) {
    try {
      const { sendTelegram } = await import("../../services/telegram");
      await sendTelegram(
        `📬 DECLINED WORK RECOVERY: ${total} SMS sent (${sent7d} 7-day + ${sent30d} 30-day). ` +
          `Potential pool: ${formatMoney(totalRecoverableCents)} from ${unmatched.length} quotes.` +
          (perRowErrors > 0 ? ` ⚠️ ${perRowErrors} row errors — see server logs.` : ""),
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
