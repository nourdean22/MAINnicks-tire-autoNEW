import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { listMessages, getMessage, type GmailMessage } from "@/lib/services/gmail-api";
import { isGoogleOauthConfigured } from "@/lib/services/google-oauth";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("cron/ingest-gmail");

export const maxDuration = 300;

/**
 * GET /api/cron/ingest-gmail
 *
 * Headless Gmail ingest. Runs twice a day (8am + 8pm per vercel.json
 * schedule). Pulls:
 *
 *   1. Nour's outgoing mail from the last 7 days (excluding the
 *      auto-generated Instagram post drafts) — stored as
 *      gmail_outgoing memories. These capture his decisions +
 *      commitments + tone in real communication.
 *
 *   2. Important inbound mail from the last 3 days — stored as
 *      gmail_thread memories. Filters boilerplate: no-reply senders,
 *      shipping/delivery, 2FA codes, promotional.
 *
 * Each memory uses the Gmail message ID as its key so re-runs are
 * idempotent (reinforce, not duplicate).
 *
 * Exits gracefully with "not_configured" if the one-time OAuth
 * consent flow hasn't been completed yet — visit
 * /api/oauth/google-data/start to set up.
 */
export const GET = cronHandler(async () => {
  const configured = await isGoogleOauthConfigured();
  if (!configured) {
    return {
      skipped: true,
      reason: "google_oauth_not_configured",
      hint: "Visit /api/oauth/google-data/start to grant Gmail read access",
    };
  }

  const t0 = Date.now();
  let outgoingStored = 0;
  let inboundStored = 0;
  let skipped = 0;
  const errors: string[] = [];

  // ─── Outgoing (Nour's sent mail) ───
  try {
    const sentQuery =
      'in:sent newer_than:7d -subject:"Post Ready" -subject:"Post Live" -subject:"Instagram"';
    const sentIds = await listMessages(sentQuery, 30);

    for (const m of sentIds) {
      try {
        const full = await getMessage(m.id);
        if (!shouldIngest(full, "sent")) {
          skipped++;
          continue;
        }
        await storeMessage(full, "gmail_outgoing");
        outgoingStored++;
      } catch (err) {
        errors.push(`sent ${m.id}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`sent listing: ${(err as Error).message}`);
  }

  // ─── Inbound (important inbox mail) ───
  try {
    const inboxQuery =
      "is:important newer_than:3d -from:noreply -from:no-reply -category:promotions -category:social";
    const inboxIds = await listMessages(inboxQuery, 20);

    for (const m of inboxIds) {
      try {
        const full = await getMessage(m.id);
        if (!shouldIngest(full, "inbox")) {
          skipped++;
          continue;
        }
        await storeMessage(full, "gmail_thread");
        inboundStored++;
      } catch (err) {
        errors.push(`inbox ${m.id}: ${(err as Error).message}`);
      }
    }
  } catch (err) {
    errors.push(`inbox listing: ${(err as Error).message}`);
  }

  const durationMs = Date.now() - t0;

  // v10.0.45 — surface audit-write failures instead of silent
  // `.catch(() => {})`. Ingest itself succeeded but if the audit
  // write fails (DB overloaded, schema drift) the operator had no
  // record. Now `auditWriteFailed: true` shows in the cron return
  // payload + a console.warn surfaces in /system/errors.
  let auditWriteFailed = false;
  await prisma.auditEvent
    .create({
      data: {
        actor: "gmail_ingest_cron",
        eventType: "gmail_messages_ingested",
        detail: `Ingested ${outgoingStored} outgoing + ${inboundStored} inbound Gmail messages`,
        payload: { outgoingStored, inboundStored, skipped, errors, durationMs },
      },
    })
    .catch((err) => {
      auditWriteFailed = true;
      log.warn("audit_event_create_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    });

  return {
    outgoingStored,
    inboundStored,
    skipped,
    errorCount: errors.length,
    durationMs,
    ...(auditWriteFailed ? { auditWriteFailed: true } : {}),
  };
});

function shouldIngest(m: GmailMessage, kind: "sent" | "inbox"): boolean {
  const body = (m.body || m.snippet || "").trim();
  if (body.length < 120) return false;

  const from = (m.from || "").toLowerCase();
  const subject = (m.subject || "").toLowerCase();
  const combined = `${from} ${subject}`;

  // Automated / no-reply senders (even for sent, skip auto-generated posts)
  if (/no.?reply|noreply|do.?not.?reply|notifications?@|alerts?@|updates?@/.test(from)) return false;
  if (/automated|account security|verification|password reset|2fa|code is|confirm your/.test(combined)) return false;
  if (/shipping|tracking|delivery|package|order (confirmation|shipped|delivered)/.test(subject)) return false;
  if (/newsletter|unsubscribe|promotional|discount|deals?|%.*off/.test(combined)) return false;
  if (/invitation|calendar invite|rsvp|declined|accepted/.test(subject)) return false;

  // For sent mail, skip the auto-generated Instagram post drafts
  if (kind === "sent" && /post ready|post live|instagram|canva|chrome.*unavailable/.test(subject)) {
    return false;
  }

  return true;
}

async function storeMessage(m: GmailMessage, category: string): Promise<void> {
  const parts: string[] = [];
  if (m.subject) parts.push(`Subject: ${m.subject}`);
  if (m.from) parts.push(`From: ${m.from.slice(0, 80)}`);
  if (m.to) parts.push(`To: ${m.to.slice(0, 80)}`);
  if (m.date) parts.push(`Date: ${new Date(m.date).toISOString().slice(0, 10)}`);
  parts.push("");
  const body = (m.body || m.snippet || "").replace(/\n{3,}/g, "\n\n").trim();
  parts.push(body.length > 1600 ? body.slice(0, 1600) + "..." : body);

  await brainMemory.remember(category, `gmail_${m.id}`, parts.join("\n"), "gmail_cron", {
    messageId: m.id,
    threadId: m.threadId,
    from: m.from,
    subject: m.subject,
  });
}
