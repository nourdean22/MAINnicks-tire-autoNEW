import { sql, type AnyColumn } from "drizzle-orm";

/**
 * One gap rule for the two post-visit drips (Nour 2026-11-07): the 7-day post-visit text (postInvoiceFollowUp,
 * visit 6-8 days ago) and the retention texts (D7 at 5-9 days) landed on the same customer the same week. Each
 * lane's eligibility query now excludes a customer the OTHER lane texted in the last 10 days:
 *   - post-visit text: customers.lastRetentionDate (written only by the retention claim);
 *   - retention: an outbound sms_messages row tagged POST_VISIT_VARIANT_KEY. customers.smsCampaignDate is not
 *     used, because the work-order review request and the VIP text stamp it too and would block most D7s.
 * Each lane's own spacing (D7 -> D14, the 3-day any-text gap) is unchanged.
 */
const POST_VISIT_DRIP_GAP_DAYS = 10;

/** sms_messages.variantKey of the 7-day post-visit text; the retention side of the gap reads it. */
export const POST_VISIT_VARIANT_KEY = "post_visit_d7";

/** Post-visit lane: clear when retention has not texted this customer in the gap. lastRetentionDate is TIMESTAMP. */
export function clearOfRetentionText(lastRetentionDate: AnyColumn) {
  return sql`(${lastRetentionDate} IS NULL OR ${lastRetentionDate} < NOW() - INTERVAL ${POST_VISIT_DRIP_GAP_DAYS} DAY)`;
}

/** Retention lane: clear when the post-visit text has not gone to this phone in the gap (bare 10-digit join). */
export function clearOfPostVisitText(phone: AnyColumn) {
  return sql`NOT EXISTS (SELECT 1 FROM sms_messages m JOIN sms_conversations c ON m.conversationId = c.id WHERE c.phone = ${phone} AND m.direction = 'outbound' AND m.status <> 'failed' AND m.variantKey = ${POST_VISIT_VARIANT_KEY} AND m.createdAt >= NOW() - INTERVAL ${POST_VISIT_DRIP_GAP_DAYS} DAY)`;
}
