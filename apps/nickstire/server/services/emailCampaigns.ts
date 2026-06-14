/**
 * Email Campaign Engine — Batch email sending for marketing
 * Supports templates, audience filtering, and campaign tracking.
 * Feature flag: email_marketing_campaigns (start DISABLED)
 */

import { createLogger } from "../lib/logger";
import { randomUUID } from "crypto";

const log = createLogger("email-campaigns");

export interface EmailCampaign {
  id: string;
  name: string;
  subject: string;
  body: string; // HTML with {{firstName}}, {{vehicleMake}} tokens
  audience: "all" | "vip" | "loyal" | "at-risk" | "churned" | "new";
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  scheduledFor?: Date;
  sentCount: number;
  openCount: number;
  clickCount: number;
  createdAt: Date;
}

// Template token replacement
export function personalizeEmail(template: string, data: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

// Pre-built campaign templates
export const CAMPAIGN_TEMPLATES: Record<string, { subject: string; body: string }> = {
  "retention-90day": {
    subject: "We miss your {{vehicleMake}} at Nick's!",
    body: `<h2>Hey {{firstName}},</h2><p>It's been a while since we saw your {{vehicleMake}} {{vehicleModel}}. Your vehicle may be due for maintenance.</p><p>Book online at <a href="https://nickstire.org">nickstire.org</a> or call us at (216) 862-0005.</p><p>— The Nick's Tire & Auto Team</p>`,
  },
  "seasonal-winter": {
    subject: "Is your {{vehicleMake}} winter-ready?",
    body: `<h2>Winter is coming, {{firstName}}.</h2><p>Cleveland winters are brutal. Make sure your {{vehicleMake}} is ready:</p><ul><li>Battery test (free)</li><li>Tire tread check</li><li>Coolant level</li><li>Wiper blades</li></ul><p>Book your winter prep at <a href="https://nickstire.org">nickstire.org</a> or call (216) 862-0005.</p>`,
  },
  "review-request": {
    subject: "{{firstName}}, how did we do?",
    body: `<h2>Thanks for choosing Nick's, {{firstName}}!</h2><p>If we earned it, a Google review means the world to us:</p><p><a href="https://nickstire.org/review" style="background:#FDB913;color:#000;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Leave a Review</a></p><p>Your feedback helps other Cleveland drivers find honest repair.</p><p>— Nour & the Nick's Tire team</p>`,
  },
  "special-offer": {
    subject: "Exclusive: {{offerTitle}} at Nick's Tire",
    body: `<h2>{{firstName}}, this one's for you.</h2><p>{{offerDescription}}</p><p>Valid through {{offerExpiry}}. Book at <a href="https://nickstire.org">nickstire.org</a> or call (216) 862-0005.</p>`,
  },
};

/** Create a new campaign draft */
export function createCampaign(params: {
  name: string;
  templateKey?: string;
  subject?: string;
  body?: string;
  audience: EmailCampaign["audience"];
}): EmailCampaign {
  const template = params.templateKey ? CAMPAIGN_TEMPLATES[params.templateKey] : null;
  return {
    id: randomUUID(),
    name: params.name,
    subject: params.subject || template?.subject || "",
    body: params.body || template?.body || "",
    audience: params.audience,
    status: "draft",
    sentCount: 0,
    openCount: 0,
    clickCount: 0,
    createdAt: new Date(),
  };
}

/**
 * Auto-send email campaigns via Resend (or Telegram notification as fallback).
 * Runs daily from scheduler. Picks the right campaign template based on season/segment.
 */
export async function autoSendEmailCampaigns(): Promise<{ recordsProcessed: number; details: string }> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return { recordsProcessed: 0, details: "No DB" };

    // Pick seasonal template based on month
    const month = new Date().getMonth(); // 0-11
    const isWinter = month >= 10 || month <= 2;
    const templateKey = isWinter ? "seasonal-winter" : "retention-90day";
    const template = CAMPAIGN_TEMPLATES[templateKey];
    if (!template) return { recordsProcessed: 0, details: "No template" };

    // Find customers with email who haven't been emailed in 30+ days and are lapsed
    const [rows] = await db.execute(sql`
      SELECT c.id, c.firstName, c.email, c.vehicleMake, c.vehicleModel, c.segment
      FROM customers c
      WHERE c.email IS NOT NULL AND c.email != ''
        AND c.smsOptOut = 0
        AND c.segment IN ('lapsed', 'at-risk')
        AND (c.lastEmailCampaignAt IS NULL OR c.lastEmailCampaignAt < DATE_SUB(NOW(), INTERVAL 30 DAY))
      LIMIT 15
    `);

    const customers = rows as any[];
    if (!customers || customers.length === 0) return { recordsProcessed: 0, details: "No eligible customers" };

    // Try Resend first
    const resendKey = process.env.RESEND_API_KEY;
    let sent = 0;

    if (resendKey) {
      for (const cust of customers) {
        try {
          const subject = personalizeEmail(template.subject, {
            firstName: cust.firstName || "there",
            vehicleMake: cust.vehicleMake || "vehicle",
            vehicleModel: cust.vehicleModel || "",
          });
          const bodyRaw = personalizeEmail(template.body, {
            firstName: cust.firstName || "there",
            vehicleMake: cust.vehicleMake || "vehicle",
            vehicleModel: cust.vehicleModel || "",
          });
          // wave-fix-2026-05-26 (audit #300/#305) · CAN-SPAM Act compliance.
          // Before this, the operator could enable RESEND_API_KEY and the
          // very first campaign tick would blast lapsed-customer email
          // without an unsubscribe link or physical address · FTC fines
          // are $51k+ per violation · the cron is already wired into the
          // scheduler so the day the env var lands, marketing email goes
          // out non-compliant.
          //
          // Append a compliance footer to every email body covering:
          //   1. "Why am I getting this?" identification
          //   2. Physical address (CAN-SPAM §316.5)
          //   3. Unsubscribe mechanism (mailto: is CAN-SPAM acceptable)
          //
          // Also set the List-Unsubscribe header (RFC 8058 + industry best
          // practice) · Gmail/Outlook show a one-click unsubscribe button
          // in their UI when this header is present.
          const unsubscribeMailto = `mailto:unsubscribe@nickstire.org?subject=Unsubscribe&body=Please%20remove%20${encodeURIComponent(cust.email)}%20from%20Nick%27s%20Tire%20%26%20Auto%20email%20campaigns.`;
          const footer = `
<div style="margin-top:32px;padding-top:16px;border-top:1px solid #ddd;color:#666;font-size:12px;font-family:sans-serif;line-height:1.5">
  <p>You're receiving this because you're a Nick's Tire &amp; Auto customer who hasn't visited in 30+ days. We send these reminders occasionally to help you stay on top of your vehicle.</p>
  <p><strong>Nick's Tire &amp; Auto</strong><br>17625 Euclid Ave, Cleveland, OH 44112<br>(216) 862-0005</p>
  <p><a href="${unsubscribeMailto}" style="color:#666">Unsubscribe</a> &middot; reply STOP to this email or call us anytime.</p>
</div>`;
          const body = bodyRaw + footer;

          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { "Authorization": `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: "Nick's Tire & Auto <noreply@nickstire.org>",
              to: cust.email,
              subject,
              html: body,
              // CAN-SPAM + RFC 8058 · one-click unsubscribe in Gmail/Outlook UI
              headers: {
                "List-Unsubscribe": `<${unsubscribeMailto}>`,
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              },
            }),
            signal: AbortSignal.timeout(10000),
          });

          if (res.ok) {
            sent++;
            // Mark as emailed
            try {
              await db.execute(sql`UPDATE customers SET lastEmailCampaignAt = NOW() WHERE id = ${cust.id}`);
            } catch (e) { log.warn("[services/emailCampaigns] operation failed:", e); } // Column might not exist yet
          }

          await new Promise(r => setTimeout(r, 500)); // Rate limit
        } catch (e) {
          log.warn("[services/emailCampaigns] email send failed:", e);
          log.warn(`Email send failed for ${cust.firstName}`);
        }
      }
    } else {
      // No Resend key — send summary to Telegram so Nour knows
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(
        `📧 EMAIL CAMPAIGN READY (no RESEND_API_KEY set)\n\n` +
        `Template: ${templateKey}\n` +
        `Eligible: ${customers.length} lapsed/at-risk customers with email\n` +
        `Top: ${customers.slice(0, 3).map((c: any) => `${c.firstName || "?"} (${c.email})`).join(", ")}\n\n` +
        `Add RESEND_API_KEY to enable automatic sending.`
      );
      return { recordsProcessed: 0, details: `${customers.length} eligible but no RESEND_API_KEY` };
    }

    if (sent > 0) {
      const { sendTelegram } = await import("./telegram");
      await sendTelegram(`📧 EMAIL CAMPAIGN: ${sent}/${customers.length} ${templateKey} emails sent automatically.`);
    }

    return { recordsProcessed: sent, details: `${sent} emails sent (${templateKey})` };
  } catch (err: unknown) {
    // Graceful fail for missing columns
    if ((err as Error).message?.includes("Unknown column") || (err as Error).message?.includes("lastEmailCampaignAt")) {
      return { recordsProcessed: 0, details: "lastEmailCampaignAt column not yet added — skipping" };
    }
    return { recordsProcessed: 0, details: `Failed: ${(err as Error).message}` };
  }
}

log.info("Email campaign engine loaded");
