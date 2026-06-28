/**
 * Cron: Unpaid Invoice Recovery
 *
 * Sends a courteous 7-day and 30-day SMS payment reminder to customers whose
 * issued invoice is still `pending` / `partial`. These customers already had
 * the work done and were charged — this is a gentle nudge, NOT debt
 * collection. Claim-safe copy: no dollar amounts (regulatory exposure), no
 * pressure, STOP footer auto-appended by sendSms().
 *
 * Rules:
 *   - invoices where paymentStatus IN ('pending','partial')
 *   - invoiceDate between 90d and 7d ago (too fresh = skip, too old = give up)
 *   - customerPhone present
 *   - 7d touch  when age >= 7d  AND paymentReminder7dAttemptedAt  IS NULL
 *   - 30d touch when age >= 30d AND paymentReminder30dAttemptedAt IS NULL
 *   - one touch per invoice per run (spread, not blast); 30d prioritized
 *   - feature-flag gated: env FEATURE_UNPAID_INVOICE_RECOVERY=1 enables sends.
 *     Without it the cron is a DRY RUN (logs + Telegram alert, no SMS out).
 *
 * Safety INHERITED from sendSms(): TCPA opt-out check, STOP footer, durable
 * per-phone daily cap, sending-hours queue, gateway-offline hold, kill-switch.
 * Safety ADDED here: feature flag (dry-run default), business-hours early-exit,
 * per-run cap, at-most-once claim (stamp attemptedAt before send), per-row
 * try/catch. Mirrors the proven declinedWorkRecovery design.
 *
 * DAILY tier. Only 2 touches — these people already paid for the work and owe
 * a balance; a 5-touch sequence would be harassment.
 */
import { and, eq, gte, lte, isNull, isNotNull, inArray } from "drizzle-orm";
import { BUSINESS } from "@shared/business";
import { createLogger } from "../../lib/logger";
import { db } from "../../lib/db-helper";
import { invoices } from "../../../drizzle/schema";

const log = createLogger("cron:unpaid-invoice-recovery");

const DAY = 24 * 60 * 60 * 1000;

interface RecoveryResult {
  recordsProcessed: number;
  details: string;
}

interface RunOpts {
  maxSends?: number;
  /** Bypass the FEATURE_UNPAID_INVOICE_RECOVERY dry-run gate (tests / manual "fire now"). */
  skipDryRunGate?: boolean;
}

function isBusinessHours(): boolean {
  const etHour = parseInt(
    new Date().toLocaleString("en-US", { timeZone: BUSINESS.timezone, hour: "numeric", hour12: false }),
    10,
  );
  return etHour >= 8 && etHour <= 19;
}

/** First name for the greeting. Handles ALG's "LASTNAME, FIRSTNAME" form. */
export function firstName(full: string | null | undefined): string {
  if (!full) return "there";
  if (full.includes(",")) {
    const parts = full.split(",").map((s) => s.trim());
    return parts[1]?.split(/\s+/)[0] || parts[0] || "there";
  }
  return full.trim().split(/\s+/)[0] || "there";
}

/**
 * Reminder copy. Deliberately NO dollar amount (avoids debt-collection
 * regulatory exposure), no pressure, shop number + hours. The STOP opt-out
 * footer is appended automatically by sendSms()/withOptOut().
 */
export function buildMessage(touch: "7d" | "30d", name: string): string {
  if (touch === "7d") {
    return `Hey ${name}, Nick’s Tire & Auto here. Just following up on your recent invoice. You can take care of it at the shop or call us at (216) 862-0005 when you get a chance. No pressure — just making sure you're taken care of.`;
  }
  return `Hey ${name}, Nick’s Tire & Auto here. We still have an invoice follow-up open for you. No pressure — just call or stop by when you can (Mon-Sat 8-6, Sun 9-4) and we’ll help get it handled. (216) 862-0005.`;
}

export async function runUnpaidInvoiceRecovery(opts?: RunOpts): Promise<RecoveryResult> {
  const d = await db();
  if (!d) return { recordsProcessed: 0, details: "DB unavailable" };

  // Business-hours early-exit (sendSms also queues out-of-window sends, but
  // skip the whole run cleanly outside hours). Bypassed in tests / manual fire.
  if (!opts?.skipDryRunGate && !isBusinessHours()) {
    return { recordsProcessed: 0, details: "Outside business hours — skipped" };
  }

  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * DAY);
  const ninetyDaysAgo = new Date(now - 90 * DAY);

  // Candidates: unpaid (pending/partial), aged 7-90d, has a phone.
  const eligible = await d
    .select({
      id: invoices.id,
      customerName: invoices.customerName,
      customerPhone: invoices.customerPhone,
      invoiceDate: invoices.invoiceDate,
      reminder7d: invoices.paymentReminder7dAttemptedAt,
      reminder30d: invoices.paymentReminder30dAttemptedAt,
    })
    .from(invoices)
    .where(
      and(
        inArray(invoices.paymentStatus, ["pending", "partial"]),
        gte(invoices.invoiceDate, ninetyDaysAgo),
        lte(invoices.invoiceDate, sevenDaysAgo),
        isNotNull(invoices.customerPhone),
      ),
    )
    .limit(500);

  if (eligible.length === 0) {
    return { recordsProcessed: 0, details: "No unpaid invoices eligible for a reminder" };
  }

  const featureEnabled =
    process.env.FEATURE_UNPAID_INVOICE_RECOVERY === "1" || opts?.skipDryRunGate === true;

  // DRY RUN — report but don't send.
  if (!featureEnabled) {
    log.info(
      `DRY RUN: ${eligible.length} unpaid invoices eligible for a payment reminder. ` +
        `Set FEATURE_UNPAID_INVOICE_RECOVERY=1 to enable sends.`,
    );
    try {
      const { sendTelegramMessage } = await import("../../services/telegram");
      await sendTelegramMessage(
        `🟡 <b>${eligible.length} unpaid invoices eligible for a payment reminder — cron is DRY-RUN</b>\n\n` +
          `<b>1 click on Railway to enable:</b>\n<code>FEATURE_UNPAID_INVOICE_RECOVERY=1</code>\n\n` +
          `Sends a courteous 7d + 30d SMS (no $ amounts, STOP footer auto-appended). ` +
          `Safety: at-most-once claim · TCPA opt-out · durable per-phone daily cap.`,
        "critical",
      );
    } catch (e) {
      log.warn("[unpaid-invoice-recovery] telegram notify failed:", e);
    }
    return {
      recordsProcessed: eligible.length,
      details: `DRY RUN: ${eligible.length} eligible — flip FEATURE_UNPAID_INVOICE_RECOVERY=1`,
    };
  }

  // LIVE send path.
  const { sendSms } = await import("../../sms");
  const MAX = Math.min(opts?.maxSends ?? 30, 500);
  let sent7d = 0;
  let sent30d = 0;
  let skippedNoTouch = 0;
  let perRowErrors = 0;

  for (const inv of eligible) {
    if (sent7d + sent30d >= MAX) break;
    if (!inv.customerPhone) continue;
    try {
      const ageDays = Math.floor((now - new Date(inv.invoiceDate).getTime()) / DAY);
      // One touch per invoice per run — 30d takes priority over 7d.
      let touch: "7d" | "30d" | null = null;
      if (ageDays >= 30 && !inv.reminder30d) touch = "30d";
      else if (ageDays >= 7 && !inv.reminder7d) touch = "7d";
      if (!touch) {
        skippedNoTouch++;
        continue;
      }

      // At-most-once claim — stamp attemptedAt with a conditional IS NULL
      // UPDATE BEFORE sending. If 0 rows change, a peer/prior run claimed it.
      const claimRes =
        touch === "30d"
          ? await d
              .update(invoices)
              .set({ paymentReminder30dAttemptedAt: new Date() })
              .where(and(eq(invoices.id, inv.id), isNull(invoices.paymentReminder30dAttemptedAt)))
          : await d
              .update(invoices)
              .set({ paymentReminder7dAttemptedAt: new Date() })
              .where(and(eq(invoices.id, inv.id), isNull(invoices.paymentReminder7dAttemptedAt)));
      const claimRaw = (Array.isArray(claimRes) && claimRes[0] && typeof claimRes[0] === "object"
        ? claimRes[0]
        : claimRes) as { affectedRows?: number; rowsAffected?: number };
      const claimed = claimRaw.affectedRows ?? claimRaw.rowsAffected ?? 0;
      if (claimed === 0) continue;

      const body = buildMessage(touch, firstName(inv.customerName));
      const res = await sendSms(inv.customerPhone, body, { via: "shop" });

      if (res.success) {
        if (touch === "30d") {
          await d.update(invoices).set({ paymentReminder30dSentAt: new Date() }).where(eq(invoices.id, inv.id));
          sent30d++;
        } else {
          await d.update(invoices).set({ paymentReminder7dSentAt: new Date() }).where(eq(invoices.id, inv.id));
          sent7d++;
        }
        log.info(`${touch} payment reminder sent for invoice ${inv.id}`);
      } else {
        log.error(`[unpaid-invoice-recovery] ${touch} send failed after claim for invoice ${inv.id}`, {
          error: res.error ?? "unknown",
        });
      }
    } catch (rowErr) {
      perRowErrors++;
      log.warn(`[unpaid-invoice-recovery] invoice ${inv.id} failed`, {
        error: rowErr instanceof Error ? rowErr.message : String(rowErr),
      });
      // continue — one bad row never kills the batch
    }
  }

  const total = sent7d + sent30d;
  if (total > 0) {
    try {
      const { sendTelegram } = await import("../../services/telegram");
      await sendTelegram(
        `📬 UNPAID INVOICE RECOVERY: ${total} reminders sent (${sent7d} 7d · ${sent30d} 30d) ` +
          `from ${eligible.length} eligible.` +
          (perRowErrors > 0 ? ` ⚠️ ${perRowErrors} row errors — see server logs.` : ""),
      );
    } catch (e) {
      log.warn("[unpaid-invoice-recovery] telegram notify failed:", e);
    }
  }

  return {
    recordsProcessed: total,
    details: `Sent ${sent7d}/7d + ${sent30d}/30d | ${skippedNoTouch} no eligible touch | ${eligible.length} eligible`,
  };
}
