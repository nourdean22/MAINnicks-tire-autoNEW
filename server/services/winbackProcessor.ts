/**
 * Winback Campaign Auto-Processor
 * Extracts the processPending logic from the admin router
 * so it runs automatically via cron instead of requiring a button click.
 */

import { createLogger } from "../lib/logger";

const log = createLogger("winback-processor");

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
    } catch {
      return { recordsProcessed: 0, details: "winback tables not set up" };
    }

    // Get pending sends that are due and belong to active campaigns
    const [rows] = await db.execute(sql`
      SELECT ws.id, ws.phone, ws.personalizedBody, ws.campaignId
      FROM winback_sends ws
      INNER JOIN winback_campaigns wc ON ws.campaignId = wc.id
      WHERE ws.status = 'pending'
        AND ws.scheduledAt <= NOW()
        AND wc.status = 'active'
      LIMIT 50
    `);

    const pendingSends = rows as any[];
    if (!pendingSends || pendingSends.length === 0) {
      return { recordsProcessed: 0, details: "No pending winback sends" };
    }

    const { sendSms } = await import("../sms");
    let sent = 0;
    let failed = 0;

    // Gate SMS behind feature flag
    const { isEnabled } = await import("./featureFlags");
    const winbackSmsEnabled = await isEnabled("sms_retention_sequences");

    for (const send of pendingSends) {
      if (!winbackSmsEnabled) {
        // Skip SMS sends but don't mark as failed
        continue;
      }
      const result = await sendSms(send.phone, send.personalizedBody);

      if (result.success) {
        await db.execute(sql`
          UPDATE winback_sends SET status = 'sent', sentAt = NOW(), twilioSid = ${result.sid || null}
          WHERE id = ${send.id}
        `);
        await db.execute(sql`UPDATE winback_campaigns SET sentCount = sentCount + 1 WHERE id = ${send.campaignId}`);
        sent++;
      } else {
        await db.execute(sql`
          UPDATE winback_sends SET status = 'failed', errorMessage = ${result.error || "unknown"}
          WHERE id = ${send.id}
        `);
        failed++;
      }

      await new Promise(r => setTimeout(r, 1500)); // Rate limit
    }

    if (sent > 0) {
      try {
        const { sendTelegram } = await import("./telegram");
        await sendTelegram(`📬 WINBACK AUTO: ${sent} messages sent, ${failed} failed`);
      } catch (err: any) {
        log.warn(`Winback Telegram notification failed: ${err.message}`);
      }
    }

    return { recordsProcessed: sent, details: `${sent} sent, ${failed} failed out of ${pendingSends.length}` };
  } catch (err: any) {
    return { recordsProcessed: 0, details: `Failed: ${err.message}` };
  }
}
