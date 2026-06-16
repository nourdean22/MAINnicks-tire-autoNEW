import { cronHandler } from "@/lib/utils/http";
import { prisma } from "@/lib/prisma";
import { brainMemory } from "@/lib/brain/memory-manager";
import { listMessages, getMessage, type GmailMessage } from "@/lib/services/gmail-api";
import { listConfiguredAccounts } from "@/lib/services/google-oauth";
import { logger as rootLogger } from "@/lib/logger";
import { sendTelegram } from "@/lib/services/telegram";
import { classifyEmail, type EmailClassification } from "@/lib/ai/email-classifier";
import { BRAIN_CATEGORIES } from "@/lib/brain/categories";

const log = rootLogger.withSurface("cron/ingest-gmail");

export const maxDuration = 300;

/**
 * GET /api/cron/ingest-gmail · 2026-05-27 redesign · v2.
 *
 * Pre-2026-05-27 the cron was single-account · twice-a-day · ZERO
 * AI enrichment · silent on the dead-token case (118 consecutive
 * refresh failures sat unnoticed because the cron just kept returning
 * `0 outgoing + 0 inbound`).
 *
 * Post-redesign:
 *   1. MULTI-ACCOUNT · iterates over all configured google_oauth* rows
 *      via listConfiguredAccounts() · per-account isolation so one
 *      bad token doesn't poison the other.
 *   2. AI CLASSIFICATION · each captured INBOUND email runs through
 *      classifyEmail() · {category, summary, urgency, needsReply,
 *      mentions[]} land in brainMemory metadata. Outbound mail
 *      skips classification (no triage value) but still gets
 *      captured raw.
 *   3. TELEGRAM NUDGE · high-urgency + needsReply emails fire
 *      sendTelegram with sender + subject + AI summary · idempotent
 *      per messageId via BrainMemory(category=proactive_push_sent).
 *   4. CADENCE · bumped to every 30 min during work hours (8-22 UTC)
 *      in config/crons.ts.
 *   5. HEALTH SURFACING · per-account success/failure rolled into the
 *      audit event so /system/diagnostics can spot dead tokens fast.
 *
 * Idempotency · brainMemory.remember keys by `gmail_${messageId}` so
 * re-runs reinforce (not duplicate). Telegram dedup keys by
 * `email_nudge_${messageId}` in proactive_push_sent so the same
 * urgent message doesn't ping twice across two cron firings.
 *
 * Skip path · returns `skipped: true, configuredAccounts: 0` when no
 * google_oauth* rows exist. The cron is still scheduled · operator
 * just hasn't completed the consent flow yet (or all tokens are
 * expired).
 */
export const GET = cronHandler(async () => {
  const accounts = await listConfiguredAccounts();
  if (accounts.length === 0) {
    return {
      skipped: true,
      configuredAccounts: 0,
      hint: "Visit /api/oauth/google-data/start to grant Gmail read access. Add ?account=<key> for additional Gmail accounts.",
    };
  }

  const t0 = Date.now();
  const perAccount: Array<{
    accountKey: string;
    email: string | null;
    outgoingStored: number;
    inboundStored: number;
    classified: number;
    nudgesFired: number;
    skipped: number;
    errors: string[];
  }> = [];

  for (const acct of accounts) {
    const result = {
      accountKey: acct.accountKey,
      email: acct.email,
      outgoingStored: 0,
      inboundStored: 0,
      classified: 0,
      nudgesFired: 0,
      skipped: 0,
      errors: [] as string[],
    };

    // ─── Outgoing (operator's sent mail · NO classification) ───
    try {
      const sentQuery =
        'in:sent newer_than:7d -subject:"Post Ready" -subject:"Post Live" -subject:"Instagram"';
      const sentIds = await listMessages(sentQuery, 30, acct.accountKey);

      for (const m of sentIds) {
        try {
          const full = await getMessage(m.id, acct.accountKey);
          if (!shouldIngest(full, "sent")) {
            result.skipped++;
            continue;
          }
          await storeMessage(full, BRAIN_CATEGORIES.GMAIL_OUTGOING, {
            accountKey: acct.accountKey,
            accountEmail: acct.email,
          });
          result.outgoingStored++;
        } catch (err) {
          result.errors.push(`sent ${m.id}: ${(err as Error).message.slice(0, 120)}`);
        }
      }
    } catch (err) {
      result.errors.push(`sent listing: ${(err as Error).message.slice(0, 120)}`);
    }

    // ─── Inbound (important inbox mail · AI classify · Telegram nudge) ───
    try {
      const inboxQuery =
        "is:important newer_than:3d -from:noreply -from:no-reply -category:promotions -category:social";
      const inboxIds = await listMessages(inboxQuery, 20, acct.accountKey);

      for (const m of inboxIds) {
        try {
          const full = await getMessage(m.id, acct.accountKey);
          if (!shouldIngest(full, "inbox")) {
            result.skipped++;
            continue;
          }

          // Classify · single tracedAiChat per inbound. Returns
          // neutral fallback on failure so the capture still lands.
          const classification = await classifyEmail({
            from: full.from ?? "",
            to: full.to ?? acct.email ?? "",
            subject: full.subject ?? "",
            date: full.date,
            body: full.body ?? full.snippet ?? "",
            accountEmail: acct.email ?? undefined,
          });
          result.classified++;

          await storeMessage(full, BRAIN_CATEGORIES.GMAIL_THREAD, {
            accountKey: acct.accountKey,
            accountEmail: acct.email,
            classification,
          });
          result.inboundStored++;

          // Telegram nudge on high-urgency + needsReply only ·
          // idempotent per messageId so re-runs don't double-ping.
          if (classification.urgency === "high" && classification.needsReply) {
            const fired = await maybeFireTelegram({
              messageId: full.id,
              from: full.from ?? "",
              subject: full.subject ?? "",
              classification,
              accountEmail: acct.email,
            });
            if (fired) result.nudgesFired++;
          }
        } catch (err) {
          result.errors.push(`inbox ${m.id}: ${(err as Error).message.slice(0, 120)}`);
        }
      }
    } catch (err) {
      result.errors.push(`inbox listing: ${(err as Error).message.slice(0, 120)}`);
    }

    // ─── Notes (Apple Notes synced to Gmail folder 'Notes') ───
    try {
      const notesQuery = "label:notes newer_than:14d";
      const noteIds = await listMessages(notesQuery, 50, acct.accountKey);

      for (const m of noteIds) {
        try {
          const full = await getMessage(m.id, acct.accountKey);
          const body = (full.body || full.snippet || "").trim();
          if (body.length === 0) continue;

          await storeMessage(full, BRAIN_CATEGORIES.PERSONAL_DEVELOPMENT, {
            accountKey: acct.accountKey,
            accountEmail: acct.email,
          });
          result.inboundStored++;
        } catch (err) {
          result.errors.push(`note ${m.id}: ${(err as Error).message.slice(0, 120)}`);
        }
      }
    } catch (err) {
      // label:notes may not exist if notes syncing is not active on this account
      log.info(`No notes label found or error scanning notes for account ${acct.email}: ${(err as Error).message.slice(0, 120)}`);
    }

    perAccount.push(result);
  }

  const durationMs = Date.now() - t0;
  const totals = perAccount.reduce(
    (acc, r) => ({
      outgoingStored: acc.outgoingStored + r.outgoingStored,
      inboundStored: acc.inboundStored + r.inboundStored,
      classified: acc.classified + r.classified,
      nudgesFired: acc.nudgesFired + r.nudgesFired,
      skipped: acc.skipped + r.skipped,
      errorCount: acc.errorCount + r.errors.length,
    }),
    { outgoingStored: 0, inboundStored: 0, classified: 0, nudgesFired: 0, skipped: 0, errorCount: 0 },
  );

  // Surface audit event · failures inside the audit write itself
  // get logged but don't fail the cron.
  let auditWriteFailed = false;
  await prisma.auditEvent
    .create({
      data: {
        actor: "gmail_ingest_cron",
        eventType: "gmail_messages_ingested",
        detail: `Ingested ${totals.outgoingStored} outgoing + ${totals.inboundStored} inbound · ${totals.classified} classified · ${totals.nudgesFired} nudges fired across ${accounts.length} account(s)`,
        payload: { perAccount, totals, durationMs } as never,
      },
    })
    .catch((err) => {
      auditWriteFailed = true;
      log.warn("audit_event_create_failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    });

  return {
    accounts: accounts.length,
    ...totals,
    durationMs,
    perAccount,
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

async function storeMessage(
  m: GmailMessage,
  category: string,
  extra: { accountKey: string; accountEmail: string | null; classification?: EmailClassification },
): Promise<void> {
  const parts: string[] = [];
  if (m.subject) parts.push(`Subject: ${m.subject}`);
  if (m.from) parts.push(`From: ${m.from.slice(0, 80)}`);
  if (m.to) parts.push(`To: ${m.to.slice(0, 80)}`);
  if (m.date) parts.push(`Date: ${new Date(m.date).toISOString().slice(0, 10)}`);
  if (extra.classification) {
    parts.push(
      `Category: ${extra.classification.category} · Urgency: ${extra.classification.urgency}${extra.classification.needsReply ? " · Needs reply" : ""}`,
    );
    if (extra.classification.summary) parts.push(`Summary: ${extra.classification.summary}`);
  }
  parts.push("");
  const body = (m.body || m.snippet || "").replace(/\n{3,}/g, "\n\n").trim();
  parts.push(body.length > 1600 ? body.slice(0, 1600) + "..." : body);

  await brainMemory.remember(category, `gmail_${m.id}`, parts.join("\n"), "gmail_cron", {
    messageId: m.id,
    threadId: m.threadId,
    from: m.from,
    subject: m.subject,
    accountKey: extra.accountKey,
    accountEmail: extra.accountEmail,
    classification: extra.classification,
  });
}

/**
 * Fire a Telegram nudge for a high-urgency needs-reply email.
 * Idempotent · returns false if already nudged this messageId.
 */
async function maybeFireTelegram(args: {
  messageId: string;
  from: string;
  subject: string;
  classification: EmailClassification;
  accountEmail: string | null;
}): Promise<boolean> {
  const dedupKey = `email_nudge_${args.messageId}`;

  // Check the proactive_push_sent dedup marker · 14d TTL is the
  // existing pattern for this category.
  const existing = await prisma.brainMemory
    .findFirst({
      where: { category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT, key: dedupKey },
      select: { id: true },
    })
    .catch(() => null);
  if (existing) return false;

  // Clean sender · "Mike Henderson <mike@shop.com>" → "Mike Henderson"
  const senderName = args.from.replace(/<[^>]+>/, "").replace(/["']/g, "").trim() || args.from;
  const subjectTrim = args.subject.length > 80 ? args.subject.slice(0, 77) + "..." : args.subject;
  const summaryTrim = (args.classification.summary || "")
    .replace(/\n/g, " ")
    .slice(0, 240);

  const escapedSender = escapeHtml(senderName);
  const escapedSubject = escapeHtml(subjectTrim);
  const escapedSummary = escapeHtml(summaryTrim);
  const acctSuffix = args.accountEmail ? ` · <i>${escapeHtml(args.accountEmail)}</i>` : "";

  const text = [
    `📩 <b>Reply needed</b>${acctSuffix}`,
    ``,
    `<b>${escapedSender}</b>`,
    `"${escapedSubject}"`,
    ``,
    escapedSummary,
    ``,
    `→ open in Gmail (search Subject)`,
  ].join("\n");

  let sent = false;
  try {
    sent = await sendTelegram(text, undefined, "HTML");
  } catch (err) {
    log.warn("telegram_send_error", {
      err: err instanceof Error ? err.message : String(err),
      messageId: args.messageId,
    });
  }

  // Mark dedup regardless of telegram result · prevents replay storms
  // when TELEGRAM_BOT_TOKEN is unset (we still want "I tried" recorded).
  await prisma.brainMemory
    .create({
      data: {
        category: BRAIN_CATEGORIES.PROACTIVE_PUSH_SENT,
        key: dedupKey,
        content: `Nudge${sent ? " sent" : " attempted (telegram unconfigured?)"} for "${subjectTrim}" from ${senderName}`,
        confidence: 0.9,
        source: "cron:ingest-gmail",
        metadata: { messageId: args.messageId, sent, urgency: args.classification.urgency } as never,
        // 14d TTL · same as other proactive_push_sent rows
        expiresAt: new Date(Date.now() + 14 * 86_400_000),
      },
    })
    .catch(() => undefined);

  return sent;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
