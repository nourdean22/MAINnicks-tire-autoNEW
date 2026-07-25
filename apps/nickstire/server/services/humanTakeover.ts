/**
 * Human takeover detection (NCSOS layer 7).
 *
 * THE HARM THIS PREVENTS
 * A customer who texts while an operator is mid-conversation could get an AI
 * auto-reply sent OVER the live human — two voices answering one customer. The
 * blueprint: "when an employee opens or responds to a conversation, the AI should
 * stop sending unless the employee releases it."
 *
 * THE SIGNAL
 * Every operator manual reply writes an audit row
 * (action='customer.sms_manual_send', entity_type='sms_conversation',
 * entity_id=<conversationId>) from smsConversations.send. A recent such row means
 * a human is actively handling this thread. This is path-independent and precise
 * — it does not try to guess human-vs-AI from outbound message rows.
 *
 * FAIL-OPEN: if the check cannot run (no DB / query error) it returns false, so
 * the AI reverts to its normal behavior rather than silently muting every thread
 * during a DB blip. The downside of a rare talk-over is smaller than mass
 * customer silence; the durable response-job spine still records the inbound.
 *
 * Re-examined 2026-07-25 (external report argued "unknown ownership must not
 * become permission to send"): KEPT fail-open deliberately. Fail-closed turns a
 * DB blip into guaranteed customer silence on every thread; a talk-over needs
 * the narrow coincidence of operator-mid-conversation + DB error + low-risk
 * auto-sendable reply. For a walk-in shop, answering wins. Do not flip this
 * without weighing the silence side.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("human-takeover");

/** How long after an operator's last manual reply the thread is treated as human-held. */
export const TAKEOVER_WINDOW_MINUTES = 60;

/**
 * True when an operator manually replied to this conversation within
 * `windowMinutes`. Callers use it to downgrade an AI auto-send to a draft the
 * operator can approve — never to drop the message.
 */
export async function isConversationHumanHeld(
  conversationId: number,
  windowMinutes: number = TAKEOVER_WINDOW_MINUTES,
): Promise<boolean> {
  try {
    const { getDb } = await import("../db");
    const { sql } = await import("drizzle-orm");
    const db = await getDb();
    if (!db) return false; // fail-open — can't check, don't mute
    const cutoff = new Date(Date.now() - windowMinutes * 60_000);
    const [rows] = await db.execute(sql`
      SELECT 1 FROM audit_log
      WHERE action = 'customer.sms_manual_send'
        AND entity_type = 'sms_conversation'
        AND entity_id = ${String(conversationId)}
        AND created_at >= ${cutoff}
      LIMIT 1
    `);
    return Array.isArray(rows) && rows.length > 0;
  } catch (err) {
    log.warn("human-held check failed; treating as not-held (fail-open)", {
      conversationId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
