/**
 * wave-181.51 · SMS instrumentation — reply + conversion attribution.
 *
 * Three writers, one reader:
 *
 *   recordSmsReply(phone, body)         ← /api/webhooks/sms-gateway on inbound
 *   recordSmsConversion(phone, id)      ← eventBus subscriber on booking/lead
 *   selectVariant(customerId, variants) ← cron writers picking which copy to send
 *
 * Every writer is wrapped in try/catch with log-only on error so an
 * unapplied 0039 migration (or any DB hiccup) cannot break an SMS
 * send or a webhook. The /admin SMS Performance tile reads these
 * columns directly via a tRPC query.
 *
 * Phone matching: we normalize to last-10-digits and join via
 * sms_conversations.phone. That column already carries normalized
 * phones from logRetentionSms() and friends — no extra normalization
 * needed downstream.
 *
 * Window choices (per spec):
 *   reply lookback     = 7 days   (attribute inbound to most recent outbound)
 *   conversion lookback = 14 days (attribute booking/lead to most recent outbound)
 */
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { createLogger } from "../lib/logger";
import { isOptOutBody } from "@shared/smsOptOutKeywords";

const log = createLogger("sms-instrumentation");

const REPLY_LOOKBACK_DAYS = 7;
const CONVERSION_LOOKBACK_DAYS = 14;

function normalizePhone(p: string | null | undefined): string {
  if (!p) return "";
  return p.replace(/\D/g, "").slice(-10);
}

// isOptOutBody now comes from @shared/smsOptOutKeywords — this file carried a
// third five-word copy of the vocabulary, so its opt-out ATTRIBUTION under-counted
// exactly the words the index query already suppressed on.

/**
 * Record an inbound SMS reply against the most recent outbound to the
 * same phone within REPLY_LOOKBACK_DAYS. Bumps replyCount, sets
 * firstReplyAt on first reply, sets optOutAt if the body matches a
 * TCPA stop keyword.
 *
 * Idempotent: calling twice for the same inbound just double-counts
 * replyCount, which is correct behavior — two replies IS two replies.
 * The caller is responsible for not invoking this for retries of the
 * same webhook delivery (Capevace doesn't retry "received" events).
 */
export async function recordSmsReply(phone: string, body: string): Promise<void> {
  try {
    const normalized = normalizePhone(phone);
    if (!normalized) return;

    const { getDb } = await import("../db");
    const { smsMessages, smsConversations } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return;

    // Find conversation by phone. BUG FIX (2026-06): the old
    // RIGHT(REPLACE(phone),10) compared a 10-digit result to the E.164
    // `normalized` ("+1…") and so NEVER matched — reply/conversion
    // attribution was silently dead. Match the INDEXED phone column
    // directly against both stored forms (10-digit OR E.164): exact,
    // index-hit, no full scan, and covers the mixed data until 0064
    // normalizes it (after which the E.164 branch simply matches nothing).
    const phone10 = normalized.replace(/\D/g, "").slice(-10);
    const [conv] = await db
      .select({ id: smsConversations.id })
      .from(smsConversations)
      .where(inArray(smsConversations.phone, [phone10, normalized]))
      .limit(1);
    if (!conv) return;

    const lookbackStart = new Date(Date.now() - REPLY_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const [target] = await db
      .select({
        id: smsMessages.id,
        firstReplyAt: smsMessages.firstReplyAt,
      })
      .from(smsMessages)
      .where(and(
        eq(smsMessages.conversationId, conv.id),
        eq(smsMessages.direction, "outbound"),
        gte(smsMessages.createdAt, lookbackStart),
      ))
      .orderBy(desc(smsMessages.createdAt))
      .limit(1);

    if (!target) return;

    const now = new Date();
    const updates: Record<string, unknown> = {
      replyCount: sql`${smsMessages.replyCount} + 1`,
    };
    if (!target.firstReplyAt) updates.firstReplyAt = now;
    if (isOptOutBody(body)) updates.optOutAt = now;

    await db.update(smsMessages).set(updates).where(eq(smsMessages.id, target.id));
  } catch (err) {
    log.warn("recordSmsReply failed", {
      phoneSuffix: normalizePhone(phone).slice(-4),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Record a conversion (booking, lead, callback) against the most recent
 * outbound SMS to the same phone within CONVERSION_LOOKBACK_DAYS.
 *
 * Bumps convertedCount, and on FIRST attribution sets
 * attributedBookingId + attributedAt. Subsequent conversions in the
 * same window still bump convertedCount (one SMS can drive multiple
 * touches), but don't overwrite the first credit.
 */
export async function recordSmsConversion(
  phone: string,
  bookingId: number | null,
): Promise<void> {
  try {
    const normalized = normalizePhone(phone);
    if (!normalized) return;

    const { getDb } = await import("../db");
    const { smsMessages, smsConversations } = await import("../../drizzle/schema");
    const db = await getDb();
    if (!db) return;

    // Same BUG FIX as recordSmsReply: indexed match on both stored forms
    // (the old RIGHT(REPLACE(phone),10) = E.164 `normalized` never matched).
    const phone10 = normalized.replace(/\D/g, "").slice(-10);
    const [conv] = await db
      .select({ id: smsConversations.id })
      .from(smsConversations)
      .where(inArray(smsConversations.phone, [phone10, normalized]))
      .limit(1);
    if (!conv) return;

    const lookbackStart = new Date(Date.now() - CONVERSION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

    const [target] = await db
      .select({
        id: smsMessages.id,
        attributedAt: smsMessages.attributedAt,
      })
      .from(smsMessages)
      .where(and(
        eq(smsMessages.conversationId, conv.id),
        eq(smsMessages.direction, "outbound"),
        gte(smsMessages.createdAt, lookbackStart),
      ))
      .orderBy(desc(smsMessages.createdAt))
      .limit(1);

    if (!target) return;

    const now = new Date();
    const updates: Record<string, unknown> = {
      convertedCount: sql`${smsMessages.convertedCount} + 1`,
    };
    if (!target.attributedAt) {
      updates.attributedAt = now;
      if (bookingId !== null) updates.attributedBookingId = bookingId;
    }

    await db.update(smsMessages).set(updates).where(eq(smsMessages.id, target.id));
  } catch (err) {
    log.warn("recordSmsConversion failed", {
      phoneSuffix: normalizePhone(phone).slice(-4),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Pick an A/B variant for a customer using a stable hash of their id.
 * Same customer always gets the same bucket across runs — critical for
 * not contaminating the test with mid-experiment reassignment.
 *
 * Variants are passed as a non-empty array; the function picks one
 * by `customerId mod variants.length`. Operator-controlled rollout: the
 * caller chooses what variants to expose, so disabling a variant is as
 * simple as dropping it from the array.
 *
 * For sends with no customer id (cold inbound number), pass any stable
 * integer derived from the phone — e.g. parseInt(normalized.slice(-4)).
 */
export interface SmsVariant<T = unknown> {
  key: string;
  payload: T;
}

export function selectVariant<T>(
  customerId: number,
  variants: SmsVariant<T>[],
): SmsVariant<T> {
  if (variants.length === 0) {
    throw new Error("selectVariant: variants array must be non-empty");
  }
  const idx = Math.abs(customerId) % variants.length;
  return variants[idx];
}

/**
 * Persist an outbound SMS to sms_messages (creating the smsConversation
 * row on first contact). Pre-wave-181.51 this logic was duplicated
 * across retentionSequences.ts (and missing from declinedWorkRecovery
 * + crossSellOutreach, which meant their sends were invisible to the
 * admin tile). One helper now feeds all three.
 *
 * Pass `variantKey` for A/B test attribution; it's NULL for callers
 * not running a test, which is fine — the admin tile groups NULL into
 * an "untagged" bucket.
 *
 * Like every writer in this module, errors are swallowed with a warn
 * log so a DB hiccup cannot break a send pipeline.
 */
export async function logOutboundSms(
  phone: string,
  body: string,
  // wave-2026-06 — was just `sid`, which forced `status = sid ? sent : failed`
  // and mislabeled every queued / no-SID send as "failed" (data profile: 84%
  // of rows showed "failed", almost all of them mislabels). Take the full send
  // result so the row gets an HONEST status: queued / sent / sending / failed.
  result: { success?: boolean; sid?: string | null; queued?: boolean } | null | undefined,
  variantKey?: string,
): Promise<void> {
  try {
    const { getDb } = await import("../db");
    const { smsMessages, smsConversations } = await import("../../drizzle/schema");
    const { eq } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return;

    // wave-181.60-followup (audit · 2026-05-18 PM) · normalize the
    // phone before lookup/insert so both ends of the attribution lookup
    // agree. Pre-fix, callers passing "+12168620005" would create a
    // distinct conversation row from callers passing "2168620005",
    // breaking attribution and double-counting replies.
    //
    // wave-181.64 (bug-hunter) · skip the row entirely on normalization
    // failure instead of falling back to the raw phone. The fallback was
    // defeating the fix — un-normalized inputs (rare in practice since
    // callers come through sendSms which validates) would still create
    // distinct rows. Better to drop the instrumentation than poison the
    // attribution data.
    const normalized = normalizePhone(phone);
    if (!normalized) {
      log.warn("logOutboundSms · refusing to instrument un-normalizable phone", {
        errorId: "SMS_INSTRUMENTATION_BAD_PHONE",
        phoneSuffix: phone.slice(-4),
      });
      return;
    }
    // wave-2026-06 — key conversations on the 10-digit form (matches
    // getOrCreateConversation), NOT E.164. The split was: logOutboundSms +
    // queueForLater stored "+1..." while getOrCreateConversation + the inbound
    // webhook stored "2168620005" -> the same customer got TWO threads (the 31
    // dup conversations + 70 "+1..." rows the data profile surfaced).
    const lookupPhone = normalized.replace(/\D/g, "").slice(-10);

    let [conv] = await db
      .select({ id: smsConversations.id })
      .from(smsConversations)
      .where(eq(smsConversations.phone, lookupPhone))
      .limit(1);

    if (!conv) {
      const [inserted] = await db
        .insert(smsConversations)
        .values({ phone: lookupPhone })
        .$returningId();
      conv = { id: inserted.id };
    }

    const sid = result?.sid ?? null;
    const status: "queued" | "sent" | "sending" | "failed" =
      result?.queued ? "queued"
      : (result?.success && sid) ? "sent"
      : result?.success ? "sending" // success but no SID = ambiguous (timeout)
      : "failed";
    await db.insert(smsMessages).values({
      conversationId: conv.id,
      direction: "outbound",
      body,
      twilioSid: sid,
      status,
      variantKey: variantKey ?? null,
    });
  } catch (err) {
    log.warn("logOutboundSms failed", {
      phoneSuffix: normalizePhone(phone).slice(-4),
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
