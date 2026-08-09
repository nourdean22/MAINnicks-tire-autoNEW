import { sql } from "drizzle-orm";
import { customers } from "../../drizzle/schema";

/**
 * Canonical "campaign-eligible phone" predicate for outbound SMS.
 *
 * A customer is eligible when they have a usable phone (>= 10 digits) and have
 * not opted out. It deliberately does NOT require a `+1` prefix: phones are
 * stored in mixed formats (bare 10-digit and `+1…`) and `sendSms` normalizes at
 * send time.
 *
 * Root cause it fixes: `customers.retryCampaign` carried an extra
 * `phone LIKE '+1%'` clause that the segment filter (`campaigns.getSegmentCustomers`)
 * never had — so every bare-10-digit customer was silently excluded from the
 * retry path while included everywhere else (targeting drift / lost reach).
 * Sharing one predicate makes the two paths provably identical and keeps them
 * from drifting again.
 *
 * Autopilot Wave 5 (2026-07-29) — ALL THREE opt-out sources, not one.
 * sendSms's fail-closed index unions customers.smsOptOut + sms_preferences +
 * inbound-STOP keywords in sms_messages; this predicate only ever checked the
 * first, so a lead/VAPI caller who texted STOP (recorded in sms_preferences /
 * the message log, customer row untouched) still counted as campaign
 * "eligible" — the send-time gate refused each send, but batch counts and
 * "eligible" tiles overstated reach, and every such row burned a slot in
 * capped batches. The two NOT-EXISTS legs below mirror the index's other two
 * sources on last-10 phone identity (TiDB-safe REPLACE normalization — no
 * REGEXP_REPLACE dependency). STOP-keyword list matches sms.ts's SQL source.
 *
 * 2026-08-09 · the STOP-log leg now normalizes BOTH sides. It compared a raw
 * `sc.phone` against a normalized customer phone, which is safe only while
 * every writer of sms_conversations normalizes first. All three do today
 * (db.ts getOrCreateConversation, sms.ts, services/smsInstrumentation.ts — each
 * `.replace(/\D/g,"").slice(-10)`), so this was not a live defect. It was an
 * UNGUARDED INVARIANT: one un-normalized insert, or one legacy row predating
 * that convention, and a customer who texted STOP silently re-enters campaign
 * audiences. sms.ts's own carrier-block query already hedges with
 * `RIGHT(sc.phone, 10)`, i.e. the codebase does not fully trust the invariant
 * either. Symmetric normalization costs nothing here — the subquery reaches
 * sms_conversations by `sc.id` through the JOIN, so the phone comparison is a
 * filter, never an index lookup. Suppression is the one place to prefer the
 * belt over the argument that braces suffice.
 */
const last10 = (col: unknown) =>
  sql`RIGHT(REPLACE(REPLACE(REPLACE(REPLACE(${col}, '-', ''), ' ', ''), '(', ''), ')', ''), 10)`;

export const campaignEligiblePhoneSql = sql`${customers.phone} IS NOT NULL AND LENGTH(${customers.phone}) >= 10 AND ${customers.smsOptOut} = 0
  AND NOT EXISTS (
    SELECT 1 FROM sms_preferences sp
    WHERE sp.opted_out = 1
      AND ${last10(sql`sp.phone`)} = ${last10(customers.phone)}
  )
  AND NOT EXISTS (
    SELECT 1 FROM sms_messages sm
    JOIN sms_conversations sc ON sc.id = sm.conversationId
    WHERE sm.direction = 'inbound'
      AND UPPER(TRIM(sm.body)) IN ('STOP','STOPALL','STOP ALL','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT','OPT OUT')
      AND ${last10(sql`sc.phone`)} = ${last10(customers.phone)}
  )`;
