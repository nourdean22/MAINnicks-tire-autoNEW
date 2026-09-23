/**
 * Owed texts — customer texts that nobody has answered.
 *
 * WHY THIS EXISTS. The first production census (2026-09-23, research doc
 * Part M) found 55 of 104 inbound text episodes ending with the customer's
 * last text unanswered. The Today queue showed bookings, leads, callbacks and
 * work orders; a customer waiting on a text reply appeared nowhere on it, so
 * the only way to find one was to open the SMS inbox and read every thread.
 *
 * THE RULE (one thread, newest message first):
 *   - a FAILED outbound is skipped: the customer never received it, so it did
 *     not answer them;
 *   - the first remaining message decides. Outbound (queued, sent, delivered)
 *     means the shop replied. Inbound means the customer is waiting, unless
 *     the text needs no reply: an opt-out or opt-in keyword, or a bare
 *     acknowledgement ("ok thanks", "👍");
 *   - a text younger than MIN_WAIT_MINUTES is left alone so the automated
 *     reply has its chance first;
 *   - a sender with fewer than 10 digits is a short code (carrier notices,
 *     verification codes), not a customer.
 *
 * Known limit, stated rather than hidden: a reply made by phone call is not
 * seen here, so a customer the crew called back still shows until someone
 * texts or the thread ages out of the window.
 */
import { db } from "../lib/db-helper";
import { pickOwedTexts, type OwedText, type OwedTextRow } from "../lib/owedTextsRule";

/** Older threads are stale for a morning list; the inbox still has them. */
const WINDOW_DAYS = 7;

/**
 * Read the window and pick. THROWS when the database is unreachable: an
 * unreadable inbox is not an empty one, and the bundle reports it as an
 * unavailable slice instead of "All clear".
 */
export async function getOwedTexts(): Promise<OwedText[]> {
  const d = await db();
  if (!d) throw new Error("Database not available");
  const { and, desc, eq, gte, ne, sql } = await import("drizzle-orm");
  const { smsConversations, smsMessages } = await import("../../drizzle/schema");
  const rows = await d
    .select({
      messageId: smsMessages.id,
      conversationId: smsMessages.conversationId,
      phone: smsConversations.phone,
      customerName: smsConversations.customerName,
      direction: smsMessages.direction,
      status: smsMessages.status,
      body: smsMessages.body,
      createdAt: smsMessages.createdAt,
      ageMinutes: sql<number>`TIMESTAMPDIFF(MINUTE, ${smsMessages.createdAt}, NOW())`,
    })
    .from(smsMessages)
    .innerJoin(smsConversations, eq(smsConversations.id, smsMessages.conversationId))
    .where(and(
      gte(smsMessages.createdAt, sql`NOW() - INTERVAL ${WINDOW_DAYS} DAY`),
      ne(smsConversations.status, "archived"),
    ))
    // Newest first, so a cap can only drop OLD messages, never the reply that decides a thread.
    .orderBy(desc(smsMessages.createdAt), desc(smsMessages.id))
    .limit(5000);
  type RawRow = Omit<OwedTextRow, "ageMinutes"> & { ageMinutes: unknown };
  return pickOwedTexts((rows as RawRow[]).map((r) => ({ ...r, ageMinutes: Number(r.ageMinutes) })));
}
