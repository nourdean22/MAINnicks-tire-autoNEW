/**
 * Email Campaign Engine — Batch email sending for marketing
 * Supports templates, audience filtering, and campaign tracking.
 * Feature flag: email_marketing_campaigns (start DISABLED)
 */

import { createLogger } from "../lib/logger";
import { isUnknownColumnError } from "../lib/dbErrors";
import { randomUUID } from "crypto";

const log = createLogger("email-campaigns");

/** How many recipients one run may email. Unchanged — this was the old SQL LIMIT. */
const BATCH_SIZE = 15;
/**
 * How many candidate rows the query reads so the batch can be taken AFTER
 * suppression. Four times the batch: wide enough that a realistic suppression
 * rate still fills a run, bounded so this stays an indexed lookup rather than
 * turning into a scan. When the window is exhausted the run says so loudly
 * (EMAIL_CAMPAIGNS_WINDOW_EXHAUSTED) instead of quietly under-sending.
 */
const CANDIDATE_WINDOW = BATCH_SIZE * 4;

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

/**
 * Normalize a campaign recipient without guessing at malformed customer data.
 *
 * We only trim outer whitespace and lowercase the domain. Anything requiring
 * repair beyond that is rejected so a bad CRM import can never become a
 * different person's address. The validator is deliberately conservative for
 * a marketing lane: quoted local-parts and address-display syntax are refused.
 */
export function normalizeCampaignRecipientEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim();
  if (!email || email.length > 254 || /[\s<>",():;\[\]\\]/.test(email)) return null;

  const parts = email.split("@");
  if (parts.length !== 2) return null;
  const [local, rawDomain] = parts;
  if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return null;

  const domain = rawDomain.toLowerCase();
  if (!domain || domain.length > 253 || !domain.includes(".")) return null;
  const labels = domain.split(".");
  if (labels.some((label) =>
    !label ||
    label.length > 63 ||
    !/^[a-z0-9-]+$/.test(label) ||
    label.startsWith("-") ||
    label.endsWith("-")
  )) return null;
  if (!/[a-z]/.test(labels.at(-1) ?? "")) return null;

  return `${local}@${domain}`;
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
  // THE FLAG THIS FILE'S OWN HEADER DECLARES WAS NEVER READ.
  //
  // Line 4 says `Feature flag: email_marketing_campaigns (start DISABLED)`.
  // A repo-wide grep found that key in exactly three places: the
  // FLAG_DEFINITIONS entry, that doc-comment, and an audit note. There was no
  // isEnabled() call anywhere — so this sent live marketing email to customers
  // (up to 15 per run, via Resend) with NO kill switch, while the operator's
  // admin panel showed a toggle that did nothing.
  //
  // The sibling job registered a few lines above it in the same scheduler tier
  // does gate correctly — gbpAutoPost.ts:106 `if (!(await
  // isEnabled("gbp_auto_posting")))` — which is what proves the intent rather
  // than assuming it.
  //
  // SAFE TO ADD: the flag is currently ENABLED in production (verified
  // read-only), so this changes nothing today. It gives the operator the
  // off-switch they already believed they had.
  const { isEnabled } = await import("./featureFlags");
  if (!(await isEnabled("email_marketing_campaigns"))) {
    return { recordsProcessed: 0, details: "Skip — email_marketing_campaigns feature flag is disabled" };
  }

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
    //
    // ⚠ `sql.raw` for the LIMIT, deliberately. A plain interpolation compiles
    // to `LIMIT ?` with the value BOUND — verified against the real dialect:
    // sql `LIMIT ?`, params [60]. MySQL and TiDB do accept a placeholder there
    // via prepared statements, but the query that shipped for months used a
    // LITERAL, this is a live customer-facing lane, and a stubbed db in a test
    // cannot tell the two apart (PR #2356's lesson: a stubbed drizzle chain
    // hides the SQL from its own tests). Introducing a new SQL shape on
    // "probably works" is not a trade worth making. The value is a
    // compile-time constant, so there is no injection surface.
    //
    // `c.smsOptOut = 0` stays as a cheap pre-filter, but it is ONE of the four
    // sources the shared index reads — see the suppression block below, which is
    // what actually decides. Keeping it costs nothing and narrows the rows.
    const [rows] = await db.execute(sql`
      SELECT c.id, c.firstName, c.email, c.phone, c.vehicleMake, c.vehicleModel, c.segment
      FROM customers c
      WHERE c.email IS NOT NULL AND c.email != ''
        AND c.smsOptOut = 0
        AND c.segment IN ('lapsed', 'at-risk')
        AND (c.lastEmailCampaignAt IS NULL OR c.lastEmailCampaignAt < DATE_SUB(NOW(), INTERVAL 30 DAY))
      LIMIT ${sql.raw(String(CANDIDATE_WINDOW))}
    `);

    const candidates = rows as any[];
    if (!candidates || candidates.length === 0) return { recordsProcessed: 0, details: "No eligible customers" };

    /**
     * Suppression, from the SAME index the SMS and voice lanes use.
     *
     * BEFORE 2026-09-16 this lane's only gate was `c.smsOptOut = 0` above —
     * one of the FOUR sources `ensureOptOutCache()` reads. It missed
     * `sms_preferences` (what `persistOptOutPreference` writes), the inbound
     * message log (the 2026-07-20 ground truth: 10 numbers had said STOP and
     * only 5 had a preference row) and carrier block notices.
     *
     * Two honest notes on severity, so nobody reads this as the voice bug:
     *   · it was never FAIL-OPEN. The condition sat inside the WHERE clause, so
     *     a query failure yields no rows and sends nothing. The defect was an
     *     INCOMPLETE source, not an unreadable list impersonating a clean one.
     *   · the CAN-SPAM plumbing below (unsubscribe mailto, List-Unsubscribe,
     *     RFC 8058 one-click) was already correct and is untouched.
     *
     * CROSS-CHANNEL CONSENT, decided by the operator on 2026-09-16 ("i need the
     * opt outs to work too email, txt"). Strictly, TCPA STOP governs calls and
     * texts while CAN-SPAM unsubscribe governs email, so suppressing email on
     * an SMS opt-out is OVER-suppression: safe, not required. This lane had
     * already made that choice implicitly by filtering on `smsOptOut`, so the
     * change is the same policy COMPLETELY applied, not a new one.
     *
     * The index is keyed by the last 10 digits of a PHONE, and this query
     * selects by email, so the filter happens here rather than in SQL — a
     * large `NOT IN` list pushed into TiDB is the worse trade.
     *
     * ⚠ STILL MISSING, and it is not this function's job to invent: an email
     * unsubscribe is a `mailto:unsubscribe@nickstire.org` and is recorded
     * NOWHERE machine-readable. Someone who unsubscribed by email but never
     * texted STOP is not in this index at all.
     */
    const { loadSuppressionIndex } = await import("../sms");
    const suppression = await loadSuppressionIndex();
    if (!suppression.ok) {
      log.error("[email-campaigns] suppression index unreadable — sending NOTHING", {
        reason: suppression.reason,
        candidates: candidates.length,
        errorId: "EMAIL_CAMPAIGNS_SUPPRESSION_UNREADABLE",
      });
      throw new Error(`email campaigns aborted — suppression index unreadable: ${suppression.reason}`);
    }
    if (suppression.stale) {
      // `stale` is NOT "5 minutes old" — that is the TTL, i.e. the fresh path.
      log.error("[email-campaigns] suppression index is STALE (refresh failed, age unbounded) — sending NOTHING", {
        suppressed: suppression.phones.size,
        candidates: candidates.length,
        errorId: "EMAIL_CAMPAIGNS_SUPPRESSION_STALE",
      });
      throw new Error(
        "email campaigns aborted — suppression index is STALE: the last refresh failed, so its age is unbounded and an opt-out recorded since is invisible",
      );
    }
    const unsuppressed = candidates.filter((c: { phone?: string | null }) => {
      const p10 = (c.phone ?? "").replace(/\D/g, "").slice(-10);
      // A customer with no phone on file cannot be in a phone-keyed index, so
      // there is nothing to match — the SQL pre-filter is their only gate.
      return p10.length === 10 ? !suppression.phones.has(p10) : true;
    });
    const suppressedCount = candidates.length - unsuppressed.length;

    /**
     * THE LIMIT GOES AFTER SUPPRESSION, NOT BEFORE. Codex P2 on PR #2371, and
     * it was right about something worse than throughput:
     *
     *   The query used to be `LIMIT 15` and the suppression filter ran on those
     *   15. A customer suppressed via sms_preferences or the inbound STOP log
     *   still satisfies `c.smsOptOut = 0`, so they occupy a slot — and because
     *   `lastEmailCampaignAt` is only stamped on a SUCCESSFUL send, they are
     *   never aged out. There is no ORDER BY, so the same suppressed rows come
     *   back every single day and re-occupy the batch: eligible customers
     *   behind them are starved INDEFINITELY, not merely delayed.
     *
     * So the SQL now reads a wider bounded window and the batch is taken from
     * the unsuppressed remainder. Bounded on purpose — a `NOT IN` list of every
     * suppressed phone pushed into TiDB is the worse trade, and an unbounded
     * fetch is how a "small" cron turns into a table scan.
     */
    // Validate BEFORE taking the batch. A malformed address that fails every
    // day must not occupy one of the 15 send slots forever and starve clean
    // customers behind it. Refuse rather than "repair" ambiguous CRM data.
    const validRecipients = unsuppressed.flatMap((cust: any) => {
      const email = normalizeCampaignRecipientEmail(cust.email);
      if (!email) {
        log.warn("[email-campaigns] skipping malformed recipient email", {
          customerId: cust.id,
          errorId: "EMAIL_CAMPAIGNS_INVALID_EMAIL",
        });
        return [];
      }
      return [{ ...cust, email }];
    });
    const invalidEmailCount = unsuppressed.length - validRecipients.length;
    const customers = validRecipients.slice(0, BATCH_SIZE);
    if (suppressedCount > 0) {
      log.info(
        `[email-campaigns] ${suppressedCount} of ${candidates.length} in the candidate window suppressed by the shared opt-out index`,
      );
    }
    if (invalidEmailCount > 0) {
      log.warn(
        `[email-campaigns] ${invalidEmailCount} malformed recipient email(s) refused before transport`,
        { errorId: "EMAIL_CAMPAIGNS_INVALID_EMAIL" },
      );
    }
    // The starvation condition, made VISIBLE rather than silent: if the whole
    // window was consumed and still did not yield a full batch, the window is
    // too small for the current suppression rate and someone should widen it.
    if (candidates.length === CANDIDATE_WINDOW && customers.length < BATCH_SIZE) {
      log.warn(
        `[email-campaigns] the ${CANDIDATE_WINDOW}-row candidate window yielded only ${customers.length}/${BATCH_SIZE} sendable recipients — suppression or invalid email data is consuming it, so eligible customers may be waiting behind unusable rows`,
        { errorId: "EMAIL_CAMPAIGNS_WINDOW_EXHAUSTED" },
      );
    }
    if (customers.length === 0) {
      return { recordsProcessed: 0, details: `No eligible customers (${suppressedCount} suppressed, ${invalidEmailCount} invalid email)` };
    }

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
          log.warn(`Email send failed for customer #${cust.id}`);
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

    return {
      recordsProcessed: sent,
      details: `${sent} emails sent (${templateKey}); ${invalidEmailCount} invalid email skipped`,
    };
  } catch (err: unknown) {
    // 2026-09-01 (audit F-9/F-17): the missing column used to be reported as a
    // permanent silent "skip". It is a deploy-state defect — name the
    // migration and fail loudly so the observer sees it.
    // Asked of the driver error, not the message: drizzle's wrapper message is
    // the SQL itself, which names lastEmailCampaignAt, so a text match called
    // every failure of this query (a timeout, say) "column missing".
    if (isUnknownColumnError(err)) {
      throw new Error(`customers.lastEmailCampaignAt column is missing — apply drizzle/0114_estimates_followupsent_customers_lastemail.sql (${(err as Error).message})`);
    }
    log.error("[emailCampaigns] run failed:", { error: (err as Error).message });
    throw err;
  }
}

log.info("Email campaign engine loaded");
