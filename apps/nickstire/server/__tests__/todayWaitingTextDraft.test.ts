/**
 * Today's waiting-text row carries the STORED draft (job 2026-11-07-fast-replies).
 *
 * The drafter answers an inbound text in seconds and parks the reply on the
 * job's sms_orchestrations row (status drafted, requires_human_approval = 1);
 * Today only offered "Open thread", where SmsSection drafted AGAIN. The row now
 * carries that draft so one tap can send it through
 * smsOrchestrator.actionHumanReview({ id: draftId, action: "send" }).
 *
 * Only the NEWEST open text's draft rides the row: an older draft answers a
 * question the customer has moved past. A draft older than
 * STALE_DRAFT_MAX_AGE_DAYS is null, the same age actionHumanReview refuses to
 * send verbatim. A draft the SQL aggregate cut short is null, never shown cut.
 */
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, queries: [] as unknown[] }));
vi.mock("../db", () => ({
  getDb: async () => ({
    execute: async (q: unknown) => {
      h.queries.push(q);
      return [h.rows];
    },
  }),
}));

import { listWaitingConversations, waitingConversations, type HumanPendingRow } from "../services/smsResponseJobs";
import { STALE_DRAFT_MAX_AGE_DAYS } from "../cron/jobs/orchestrationStatusReconcile";

const DRAFT = "We're open until 6 today. Come by any time before then and we'll take a look.";

const row = (over: Partial<HumanPendingRow> = {}): HumanPendingRow => ({
  jobId: 1,
  conversationId: 41,
  phone: "+12164041041",
  customerName: "Dana",
  body: "what time do you close",
  waitingMinutes: 12,
  overdue: false,
  ...over,
});

/** What the reader's grouped SQL returns for one conversation. */
const sqlRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  jobId: 1,
  conversationId: 41,
  phone: "+12164041041",
  customerName: "Dana",
  body: "what time do you close",
  allBodies: "what time do you close",
  texts: 1,
  waitingMinutes: 12,
  newestMinutes: 12,
  overdue: 0,
  draftId: 9001,
  draftText: DRAFT,
  draftLength: DRAFT.length,
  ...over,
});

describe("waitingConversations carries the newest text's stored draft", () => {
  it("a row with a stored draft carries its text and id", () => {
    const [item] = waitingConversations([row({ draftId: 9001, draftText: DRAFT })]);
    expect(item).toMatchObject({ conversationId: 41, draftId: 9001, draftText: DRAFT });
  });

  it("a row without a stored draft carries null for both", () => {
    const [item] = waitingConversations([row()]);
    expect(item.draftId).toBeNull();
    expect(item.draftText).toBeNull();
  });

  it("two texts in one thread: the draft follows the NEWEST text, never an older one", () => {
    const items = waitingConversations([
      row({ jobId: 1, body: "what time do you close", waitingMinutes: 90, newestMinutes: 90, draftId: 9001, draftText: DRAFT }),
      row({ jobId: 2, body: "also do you do alignments", waitingMinutes: 5, newestMinutes: 5 }),
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ preview: "also do you do alignments", draftId: null, draftText: null });
  });
});

describe("listWaitingConversations reads the draft in the same grouped query", () => {
  beforeEach(() => {
    h.rows = [];
    h.queries = [];
  });

  it("POSITIVE CONTROL: a live draft on the newest job reaches the row", async () => {
    h.rows = [sqlRow()];
    const [item] = await listWaitingConversations();
    expect(item).toMatchObject({ conversationId: 41, draftId: 9001, draftText: DRAFT });
  });

  it("no live draft (the LEFT JOIN found none, aggregated as 0 / '') is null, not an empty draft", async () => {
    h.rows = [sqlRow({ draftId: "0", draftText: "", draftLength: "0" })];
    const [item] = await listWaitingConversations();
    expect(item.draftId).toBeNull();
    expect(item.draftText).toBeNull();
  });

  it("a draft the aggregate cut short (length disagrees) is null, never shown cut", async () => {
    h.rows = [sqlRow({ draftText: DRAFT.slice(0, 30), draftLength: DRAFT.length })];
    const [item] = await listWaitingConversations();
    expect(item.draftId).toBeNull();
    expect(item.draftText).toBeNull();
  });

  it("an older reader shape with no draft columns still lists the customer, draft null", async () => {
    const { draftId: _a, draftText: _b, draftLength: _c, ...legacy } = sqlRow();
    h.rows = [legacy];
    const items = await listWaitingConversations();
    expect(items).toHaveLength(1);
    expect(items[0].draftText).toBeNull();
  });

  it("the SQL joins only an actionable, operator-review draft younger than the stale cutoff, on the job's own orchestration", async () => {
    h.rows = [sqlRow()];
    await listWaitingConversations();
    const { sql: text, params } = new MySqlDialect().sqlToQuery(h.queries[0] as never);
    expect(text).toMatch(/LEFT JOIN sms_orchestrations o ON o\.id = j\.orchestrationId/);
    expect(text).toMatch(/o\.status IN \('drafted', 'received'\)/);
    expect(text).toMatch(/o\.requires_human_approval = 1/);
    expect(text).toMatch(/o\.createdAt >= NOW\(\) - INTERVAL \? DAY/);
    expect(params).toContain(STALE_DRAFT_MAX_AGE_DAYS);
    // Still one row per conversation and uncapped (todayWaitingTexts.test.ts pins the same).
    expect(text).toMatch(/GROUP BY j\.conversationId/);
    expect(text).not.toMatch(/\bLIMIT\b/);
  });
});
