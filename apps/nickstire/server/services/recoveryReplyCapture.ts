/**
 * Recovery reply capture — the SMS auto-classification wire (Recovery 2.0).
 *
 * PASSIVE OBSERVER on the inbound-SMS path. When a customer texts back
 * and their most recent outbound (7d) was a declined-recovery message,
 * classify their own words (classifyDeclineReply — pure, inflection-
 * tested) and stamp alg_estimates.stated_concern with source
 * "sms_reply". That's ALL it does. Explicitly:
 *
 *   - NO sends, NO reply generation, NO routing changes. The reply
 *     engine (smsResponseJobs → orchestrator) is untouched; this runs
 *     as a parallel fire-and-forget block alongside recordSmsReply.
 *   - STRONG ATTRIBUTION GATE: the capture only fires when the last
 *     outbound to this phone within 7 days carries a declined_*
 *     variantKey. A general question from a customer we never texted
 *     about a quote can NOT be misread as a decline reason.
 *   - OPERATOR WINS / FIRST SIGNAL WINS: the UPDATE is guarded by
 *     stated_concern IS NULL — an operator-captured concern (or an
 *     earlier reply's) is never overwritten. The Decision Inbox chips
 *     remain the correction path.
 *   - FAIL-OPEN: every error is swallowed to a log line. The webhook's
 *     200-ack and the response obligation can never be affected.
 *   - UNKNOWN STAYS UNKNOWN: a reply that classifies to null writes
 *     nothing (doctrine: never pretend to know the objection).
 *
 * STOP/opt-out interplay: bare "STOP" is consumed by the TCPA rails
 * upstream and never reaches classification meaningfully — and
 * classifyDeclineReply deliberately does not treat "stop" as a signal.
 */
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { classifyDeclineReply } from "./declinedRecoverySequence";

const log = createLogger("recovery-reply-capture");

const ATTRIBUTION_LOOKBACK_DAYS = 7;
const ESTIMATE_WINDOW_DAYS = 60;

/** Pure attribution predicate — exported for tests. */
export function isRecoveryVariant(variantKey: string | null | undefined): boolean {
  return typeof variantKey === "string" && /^declined_/.test(variantKey);
}

export interface CaptureResult {
  captured: boolean;
  reason:
    | "no_signal"
    | "no_conversation"
    | "no_recent_outbound"
    | "not_recovery_outbound"
    | "no_open_estimate"
    | "captured"
    | "db_unavailable"
    | "error";
  signal?: string;
}

export async function captureStatedConcernFromReply(
  phone: string,
  body: string,
): Promise<CaptureResult> {
  try {
    // 1. Classify FIRST — pure and free. Most replies ("ok", "thanks",
    //    a question) carry no decline signal and stop here with zero
    //    DB work on the webhook path.
    const signal = classifyDeclineReply(body);
    if (!signal) return { captured: false, reason: "no_signal" };

    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const { smsMessages, smsConversations } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return { captured: false, reason: "db_unavailable" };

    // 2. Attribution gate: the most recent outbound to this phone within
    //    7d must be a declined-recovery variant. Same indexed
    //    conversation-lookup shape as smsInstrumentation.recordSmsReply
    //    (matches both stored phone forms until 0064 normalization).
    const phone10 = phone.replace(/\D/g, "").slice(-10);
    const e164 = phone10.length === 10 ? `+1${phone10}` : phone;
    const [conv] = await db
      .select({ id: smsConversations.id })
      .from(smsConversations)
      .where(inArray(smsConversations.phone, [phone10, e164, phone]))
      .limit(1);
    if (!conv) return { captured: false, reason: "no_conversation" };

    const lookbackStart = new Date(Date.now() - ATTRIBUTION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const [lastOutbound] = await db
      .select({ id: smsMessages.id, variantKey: smsMessages.variantKey })
      .from(smsMessages)
      .where(and(
        eq(smsMessages.conversationId, conv.id),
        eq(smsMessages.direction, "outbound"),
        gte(smsMessages.createdAt, lookbackStart),
      ))
      .orderBy(desc(smsMessages.createdAt))
      .limit(1);
    if (!lastOutbound) return { captured: false, reason: "no_recent_outbound" };
    if (!isRecoveryVariant(lastOutbound.variantKey)) {
      return { captured: false, reason: "not_recovery_outbound" };
    }

    // 3. Stamp the most recent open estimate for this phone — ONE atomic
    //    statement (MySQL/TiDB single-table UPDATE supports ORDER BY +
    //    LIMIT). stated_concern IS NULL in the WHERE = operator capture
    //    and earlier replies are never overwritten.
    const result = await db.execute(sql`
      UPDATE alg_estimates
      SET stated_concern = ${signal},
          stated_concern_source = 'sms_reply',
          stated_concern_at = NOW()
      WHERE RIGHT(REGEXP_REPLACE(COALESCE(customer_phone, ''), '[^0-9]', ''), 10) = ${phone10}
        AND matched_invoice_id IS NULL
        AND stated_concern IS NULL
        AND estimate_date >= DATE_SUB(NOW(), INTERVAL ${ESTIMATE_WINDOW_DAYS} DAY)
      ORDER BY estimate_date DESC
      LIMIT 1
    `);
    const raw = (Array.isArray(result) && result[0] && typeof result[0] === "object"
      ? result[0]
      : result) as { affectedRows?: number };
    if ((raw.affectedRows ?? 0) === 0) {
      return { captured: false, reason: "no_open_estimate", signal };
    }

    log.info("[recovery-reply-capture] stated concern captured from SMS reply", {
      phone: phone10.slice(-4),
      signal,
    });
    return { captured: true, reason: "captured", signal };
  } catch (err) {
    // Fail-open by contract — the webhook path must never feel this.
    log.warn("[recovery-reply-capture] capture failed (fail-open)", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { captured: false, reason: "error" };
  }
}
