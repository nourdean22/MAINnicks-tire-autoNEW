/**
 * Winback Campaign Auto-Processor
 * Extracts the processPending logic from the admin router
 * so it runs automatically via cron instead of requiring a button click.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("winback-processor");

/**
 * Every outbound message carries its own way out.
 *
 * This codebase already treats a STOP notice as mandatory everywhere else:
 * declinedRecoverySequence and crossSellOutreach put it in every variant they
 * send. (A third citation here named aiContentGenerator, which stated it as a
 * FORMAT RULE for sms-blast — that module was deleted as dead code, having had
 * zero importers; the rule it documented lives on in the two senders above.)
 *
 * The four winback message bodies did not have it and nothing appended one — so
 * the single sequence aimed at people who have NOT been in for three to six
 * months, the coldest audience the shop texts, was the one that went out without
 * a stated opt-out. That is the codebase's own standard applied everywhere except
 * the place it mattered most.
 *
 * Appended HERE rather than fixed in the four rows, so a message written next
 * month cannot forget it. Idempotent: a body that already says STOP is left
 * exactly as written, so an author who includes it does not get it twice.
 */
export function withOptOutNotice(body: string): string {
  const text = String(body ?? "").trim();
  if (!text) return text;
  if (/\bSTOP\b/i.test(text)) return text;
  return `${text} Reply STOP to opt out.`;
}

export async function processWinbackPending(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    const { sql } = await import("drizzle-orm");

    // Check if winback tables exist
    let hasTable = false;
    try {
      await db.execute(sql`SELECT 1 FROM winback_sends LIMIT 0`);
      hasTable = true;
    } catch (e) {
      log.warn("[services/winbackProcessor] operation failed:", e);
      return { recordsProcessed: 0, details: "winback tables not set up" };
    }

    // Wave BH · 2026-05-29 · gateway-offline gate. If the F25e cloud is
    // down, hold the whole drain — claim nothing. Pending winback rows
    // stay pending and deliver once when it's back, instead of being
    // claimed 'sent' then marked 'failed' (lost) per send.
    const { isShopGatewayReachable } = await import("../sms");
    if (!(await isShopGatewayReachable())) {
      return { recordsProcessed: 0, details: "gateway offline — held pending" };
    }

    // Get pending sends that are due and belong to active campaigns
    const [rows] = await db.execute(sql`
      SELECT ws.id, ws.phone, ws.personalizedBody, ws.campaignId, ws.customerId
      FROM winback_sends ws
      INNER JOIN winback_campaigns wc ON ws.campaignId = wc.id
      WHERE ws.status = 'pending'
        AND ws.scheduledAt <= NOW()
        AND wc.status = 'active'
      LIMIT 50
    `);

    const pendingSends = rows as unknown as Array<Record<string, unknown>>;
    if (!pendingSends || pendingSends.length === 0) {
      return { recordsProcessed: 0, details: "No pending winback sends" };
    }

    const { sendSms } = await import("../sms");
    let sent = 0;
    let queued = 0; // parked for the 8 AM window (audit F-3)
    let heldOut = 0;
    let failed = 0;
    let skipped = 0;

    // Gate SMS behind feature flag
    const { isEnabled } = await import("./featureFlags");
    const winbackSmsEnabled = await isEnabled("sms_retention_sequences");

    for (const send of pendingSends) {
      if (!winbackSmsEnabled) {
        // Skip SMS sends but don't mark as failed
        continue;
      }

      // Opt-out guard — winback_sends carries customerId, so resolve
      // opt-out by exact id (no fuzzy phone match). Opted-out rows are
      // marked 'failed' so they leave the 'pending' pool permanently.
      const [optRows] = await db.execute(sql`
        SELECT smsOptOut FROM customers WHERE id = ${send.customerId} LIMIT 1
      `);
      const optedOut = !!((optRows as unknown as Array<{ smsOptOut?: number }>)[0]?.smsOptOut);
      if (optedOut) {
        await db.execute(sql`
          UPDATE winback_sends SET status = 'failed', errorMessage = 'customer opted out of SMS'
          WHERE id = ${send.id} AND status = 'pending'
        `);
        skipped++;
        continue;
      }

      // At-most-once claim — flip pending -> sent BEFORE sendSms. If the
      // run crashes/times out after the SMS goes out but before we'd
      // record it, the row is already out of the 'pending' pool, so the
      // next run will NOT re-text the customer. A claimed row whose send
      // then crashed shows 'sent' but may not have delivered — an
      // acceptable miss, never a duplicate. The status enum is only
      // ('pending','sent','failed'), so the claim reuses 'sent' rather
      // than needing a schema migration for a 'sending' state.
      const [claimRes] = await db.execute(sql`
        UPDATE winback_sends SET status = 'sent', sentAt = NOW()
        WHERE id = ${send.id} AND status = 'pending'
      `);
      if (((claimRes as unknown as { affectedRows?: number }).affectedRows ?? 0) === 0) {
        continue; // already claimed by an overlapping run — never re-send
      }

      const result = await sendSms(String(send.phone), withOptOutNotice(String(send.personalizedBody)), {
        via: "shop",
        variantKey: "winback",
      });

      // 2026-09-01 (audit F-3): a queued text keeps its claim and counts in the
      // campaign total (it will go out), but the run receipt says queued.
      const { smsOutcome } = await import("../lib/smsOutcome");
      const outcome = smsOutcome(result);
      if (outcome === "sent" || outcome === "queued") {
        await db.execute(sql`
          UPDATE winback_sends SET twilioSid = ${result.sid || null} WHERE id = ${send.id}
        `);
        await db.execute(sql`UPDATE winback_campaigns SET sentCount = sentCount + 1 WHERE id = ${send.campaignId}`);
        if (outcome === "sent") sent++; else queued++;
      } else if (outcome === "heldout") {
        await db.execute(sql`
          UPDATE winback_sends
          SET status = 'heldout', sentAt = NULL, twilioSid = NULL,
              errorMessage = ${result.experimentId ? `experiment_control:${result.experimentId}` : "experiment_control"}
          WHERE id = ${send.id}
        `);
        heldOut++;
      } else {
        await db.execute(sql`
          UPDATE winback_sends SET status = 'failed', errorMessage = ${result.error || "unknown"}
          WHERE id = ${send.id}
        `);
        failed++;
      }

      if (!result.heldOut) await new Promise(r => setTimeout(r, 1500)); // provider rate limit
    }

    if (sent + queued + heldOut > 0) {
      try {
        const { sendTelegram } = await import("./telegram");
        await sendTelegram(`📬 WINBACK AUTO: ${sent} messages sent, ${queued} queued for 8 AM, ${heldOut} holdout controls, ${failed} failed`);
      } catch (err: unknown) {
        log.warn(`Winback Telegram notification failed: ${(err as Error).message}`);
      }
    }

    return { recordsProcessed: sent, details: `${sent} sent, ${queued} queued, ${heldOut} holdout controls, ${failed} failed, ${skipped} skipped out of ${pendingSends.length}` };
  } catch (err: unknown) {
    // 2026-09-01 (audit F-9): rethrow — a swallowed error was recorded as `completed`.
    log.error("[winbackProcessor] run failed:", { error: (err as Error).message });
    throw err;
  }
}
