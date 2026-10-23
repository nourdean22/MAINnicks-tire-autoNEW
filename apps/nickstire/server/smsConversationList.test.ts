/**
 * The Messages inbox must survive a missing sms_response_jobs table (2026-10-23, PR 3256 review).
 *
 * The conversation list puts threads with an open human_pending job first, with a correlated
 * EXISTS on sms_response_jobs. server/services/schemaGuard.ts audits that table without blocking
 * boot, so a database that has not had migration 0092 applied is a supported degraded state. There
 * the EXISTS throws, and without a fallback the WHOLE inbox goes blank instead of only the
 * waiting-first ordering. The helper falls back to the old lastMessageAt order.
 *
 * The missing table is recognised through lib/dbErrors (a drizzle-wrapped driver error carries the
 * code on .cause); never by matching err.message, which on a wrapped error is the SQL and its params.
 * The positive case is drizzle's own DrizzleQueryError carrying errno 1146. The control is a wrapped
 * timeout whose params contain 1146: a text match would degrade silently on it.
 *
 * The fake db is passed in, so no shared module is mocked.
 */
import { describe, expect, it } from "vitest";
import { DrizzleQueryError, type SQL } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { selectConversationsWaitingFirst } from "./lib/smsConversationList";

const ROWS = [{ id: 7, phone: "+12165550100", customerName: "x", lastMessageAt: new Date(0) }];

const missingTable = () =>
  new DrizzleQueryError(
    "select `id` from `sms_conversations` order by EXISTS (select 1 from sms_response_jobs j where j.conversationId = ?) desc",
    [1],
    Object.assign(new Error("Table 'nickstire.sms_response_jobs' doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 }),
  );

/** A wrapped timeout whose BOUND PARAMS contain 1146: only a text match on the wrapper would call this a missing table. */
const timeoutWithPoisonedParams = () =>
  new DrizzleQueryError("select `id` from `sms_conversations` where `id` = ?", [1146], Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }));

function fakeDb(plan: Array<unknown | Error>) {
  const orderByArgs: unknown[][] = [];
  let call = 0;
  const db = {
    select: () => ({
      from: () => ({
        orderBy: (...args: unknown[]) => {
          orderByArgs.push(args);
          const outcome = plan[call++];
          return { limit: async () => { if (outcome instanceof Error) throw outcome; return outcome; } };
        },
      }),
    }),
  };
  return { db, orderByArgs };
}

const dialect = new MySqlDialect();

describe("selectConversationsWaitingFirst", () => {
  it("orders open human_pending threads first, then newest message, in one query", async () => {
    const { db, orderByArgs } = fakeDb([ROWS]);
    const out = await selectConversationsWaitingFirst(db, 100);
    expect(out).toBe(ROWS);
    expect(orderByArgs).toHaveLength(1);
    expect(orderByArgs[0]).toHaveLength(2);
    const waiting = dialect.sqlToQuery(orderByArgs[0][0] as SQL).sql.replace(/\s+/g, " ");
    expect(waiting).toContain("EXISTS (SELECT 1 FROM sms_response_jobs j WHERE j.conversationId =");
    expect(waiting).toContain("j.status = 'human_pending') DESC");
  });

  it("a missing sms_response_jobs table (wrapped errno 1146) falls back to lastMessageAt order and still returns the list", async () => {
    const { db, orderByArgs } = fakeDb([missingTable(), ROWS]);
    const out = await selectConversationsWaitingFirst(db, 100);
    expect(out).toBe(ROWS);
    expect(orderByArgs).toHaveLength(2);
    expect(orderByArgs[1]).toHaveLength(1); // the prior order: lastMessageAt only
  });

  it("a wrapped timeout whose params contain 1146 is NOT a missing table: it is rethrown, no fallback", async () => {
    const { db, orderByArgs } = fakeDb([timeoutWithPoisonedParams(), ROWS]);
    await expect(selectConversationsWaitingFirst(db, 100)).rejects.toBeInstanceOf(DrizzleQueryError);
    expect(orderByArgs).toHaveLength(1);
  });

  it("a plain error is rethrown too (an empty inbox would read as 'no customers')", async () => {
    const { db } = fakeDb([new Error("boom")]);
    await expect(selectConversationsWaitingFirst(db, 100)).rejects.toThrow("boom");
  });
});
