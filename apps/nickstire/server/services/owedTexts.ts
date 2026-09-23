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
import { isOptOutBody, SMS_OPT_IN_KEYWORDS } from "@shared/smsOptOutKeywords";
import { db } from "../lib/db-helper";

/** Let the automated reply answer first. */
export const MIN_WAIT_MINUTES = 15;
/** Older threads are stale for a morning list; the inbox still has them. */
export const WINDOW_DAYS = 7;
/** A worklist, not an inbox: the oldest waits are what matter. */
const MAX_ITEMS = 50;

export interface OwedTextRow {
  messageId: number;
  conversationId: number;
  phone: string;
  customerName: string | null;
  direction: "inbound" | "outbound";
  status: string;
  body: string;
  createdAt: Date | string;
  /** Computed in SQL: driver-parsed TiDB timestamps come back shifted on an ET host. */
  ageMinutes: number;
}

export interface OwedText {
  conversationId: number;
  messageId: number;
  phone: string;
  customerName: string | null;
  preview: string;
  lastInboundAt: Date | string;
  waitingMinutes: number;
}

/** The same acknowledgement vocabulary the census uses (scripts/lib/customerCorpus.ts). */
const ACKNOWLEDGEMENT =
  /^\s*(?:(?:ok(?:ay)?|k|thanks?|thank you|thx|ty|great|cool|perfect|got it|sounds good|will do|appreciate it|👍|🙏|❤️)[\s,.!]*)+$/iu;

/** A text the customer does not expect an answer to. */
export function needsNoReply(body: string): boolean {
  // "Stop." and "opt-out" are opt-outs too; the shared matcher wants the bare word.
  const bare = String(body ?? "").replace(/[\s.!]+$/, "").replace(/-/g, " ");
  if (isOptOutBody(bare)) return true;
  if ((SMS_OPT_IN_KEYWORDS as readonly string[]).includes(bare.trim().toUpperCase())) return true;
  return ACKNOWLEDGEMENT.test(body ?? "");
}

/** Pure: pick the threads whose customer is waiting on the shop. Oldest wait first. */
export function pickOwedTexts(rows: ReadonlyArray<OwedTextRow>, minWaitMinutes = MIN_WAIT_MINUTES): OwedText[] {
  const byThread = new Map<number, OwedTextRow[]>();
  for (const r of rows) {
    const list = byThread.get(r.conversationId);
    if (list) list.push(r);
    else byThread.set(r.conversationId, [r]);
  }

  const owed: OwedText[] = [];
  for (const thread of Array.from(byThread.values())) {
    // Newest first. ageMinutes is the trustworthy clock; id breaks same-minute ties.
    thread.sort((a, b) => a.ageMinutes - b.ageMinutes || b.messageId - a.messageId);
    const decider = thread.find((m) => !(m.direction === "outbound" && m.status === "failed"));
    if (!decider || decider.direction !== "inbound") continue;
    if (decider.ageMinutes < minWaitMinutes) continue;
    if (needsNoReply(decider.body)) continue;
    if (decider.phone.replace(/\D/g, "").length < 10) continue;
    owed.push({
      conversationId: decider.conversationId,
      messageId: decider.messageId,
      phone: decider.phone,
      customerName: decider.customerName,
      preview: decider.body.replace(/\s+/g, " ").trim().slice(0, 120),
      lastInboundAt: decider.createdAt,
      waitingMinutes: decider.ageMinutes,
    });
  }
  return owed.sort((a, b) => b.waitingMinutes - a.waitingMinutes).slice(0, MAX_ITEMS);
}

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
