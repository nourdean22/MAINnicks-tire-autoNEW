/**
 * The conversation list query behind smsConversations.list.
 *
 * A customer waiting on a human is ALWAYS inside the cap: humanPendingSummary counts them from
 * sms_response_jobs, and a thread outside the newest `limit` conversations could not be acted on.
 * So threads with an open human_pending job come first, then the newest message.
 *
 * That needs sms_response_jobs. server/services/schemaGuard.ts audits it without blocking boot, so
 * a database without migration 0092 is a supported degraded state, and there the EXISTS throws.
 * Without a fallback the whole Messages inbox would go blank; it falls back to the old
 * lastMessageAt order instead. The missing table is recognised by lib/dbErrors (a drizzle-wrapped
 * driver error carries its code on .cause), never by matching err.message.
 *
 * `db` is the caller's handle, so a test can pass a fake and mock no shared module.
 */
import { desc, sql } from "drizzle-orm";
import { smsConversations, type SmsConversation } from "../../drizzle/schema";
import { isMissingTableError } from "./dbErrors";
import { createLogger } from "./logger";

const log = createLogger("sms-conversation-list");
let warnedMissing = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- getDb() is typed any for its 200+ legacy callers.
export async function selectConversationsWaitingFirst(db: any, limit: number): Promise<SmsConversation[]> {
  try {
    return await db
      .select()
      .from(smsConversations)
      .orderBy(
        sql`EXISTS (SELECT 1 FROM sms_response_jobs j WHERE j.conversationId = ${smsConversations.id} AND j.status = 'human_pending') DESC`,
        desc(smsConversations.lastMessageAt),
      )
      .limit(limit);
  } catch (err) {
    if (!isMissingTableError(err)) throw err;
    if (!warnedMissing) {
      warnedMissing = true;
      log.warn("[sms-conversation-list] sms_response_jobs is missing (migration 0092 not applied): the inbox is ordered by lastMessageAt only, waiting threads are not pinned first");
    }
    return await db.select().from(smsConversations).orderBy(desc(smsConversations.lastMessageAt)).limit(limit);
  }
}
