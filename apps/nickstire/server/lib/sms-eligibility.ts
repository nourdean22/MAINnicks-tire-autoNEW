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
 */
export const campaignEligiblePhoneSql = sql`${customers.phone} IS NOT NULL AND LENGTH(${customers.phone}) >= 10 AND ${customers.smsOptOut} = 0`;
