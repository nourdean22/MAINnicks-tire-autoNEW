/**
 * Post-call text cooldown (2026-11-07 audit: 63 phones got the forwarded-call follow-up
 * 2+ times in 30 days). The orchestrator's own phone cooldown is 24 h (sibling-owned
 * smsOrchestrator.ts), so both senders check this first: one follow-up per phone per
 * 14 days, and none while the customer's own text is still waiting on us.
 *
 * A conditional read of sms_messages, not a cache: the row a past send wrote is the proof.
 */
import type { SQL } from "drizzle-orm";

const FOLLOWUP_COOLDOWN_MS = 14 * 86_400_000;

export type FollowupHold = "cooldown_14d" | "awaiting_reply" | "hold_read_failed";

function forwardedFollowupHold(input: {
  lastSendAt: Date | null;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  conversationOpen: boolean;
  now: Date;
}): FollowupHold | null {
  if (input.lastSendAt && input.now.getTime() - input.lastSendAt.getTime() <= FOLLOWUP_COOLDOWN_MS) return "cooldown_14d";
  if (input.conversationOpen && input.lastInboundAt && (!input.lastOutboundAt || input.lastInboundAt > input.lastOutboundAt)) return "awaiting_reply";
  return null;
}

const toDate = (v: unknown): Date | null => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Hold reason for this phone, or null to send. A failed read holds (fails closed):
 * a missed follow-up costs less than a fourth copy of the same text.
 */
export async function loadForwardedFollowupHold(d: { execute: (q: SQL) => Promise<unknown> } | null, phone: string, now: Date = new Date()): Promise<FollowupHold | null> {
  const phone10 = phone.replace(/\D/g, "").slice(-10);
  if (phone10.length !== 10) return null;
  try {
    if (!d) return "hold_read_failed";
    const { sql } = await import("drizzle-orm");
    // Conversation phones are stored in more than one shape; match all three and keep the unique index usable.
    const result = await d.execute(sql`
      SELECT
        MAX(c.status = 'active') AS anyOpen,
        MAX(CASE WHEN m.direction = 'outbound' AND m.status <> 'failed'
                  AND (m.variantKey LIKE 'vapi\\_forwarded\\_call\\_followup%' OR m.variantKey = 'missed_call_recovery')
                 THEN m.createdAt END) AS lastSendAt,
        MAX(CASE WHEN m.direction = 'inbound' THEN m.createdAt END) AS lastInboundAt,
        MAX(CASE WHEN m.direction = 'outbound' AND m.status <> 'failed' THEN m.createdAt END) AS lastOutboundAt
      FROM sms_conversations c
      LEFT JOIN sms_messages m ON m.conversationId = c.id
      WHERE c.phone IN (${phone10}, ${`+1${phone10}`}, ${`1${phone10}`})
    `);
    const rows = (Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result) as Array<Record<string, unknown>>;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return null;
    return forwardedFollowupHold({
      lastSendAt: toDate(row.lastSendAt),
      lastInboundAt: toDate(row.lastInboundAt),
      lastOutboundAt: toDate(row.lastOutboundAt),
      conversationOpen: Number(row.anyOpen) === 1,
      now,
    });
  } catch {
    return "hold_read_failed";
  }
}
