/**
 * proposals.decisionSummary -- the Approvals tab's "last 30 days" card, read from the audit log.
 *
 * The client used to count a second `proposals.list` page (limit 500) by `reviewedAt`. That is wrong
 * three ways: `casTransition` rewrites `reviewedAt` on every transition that names a reviewer (a retry
 * or "It never happened" moves an old approval into the window), the list is capped and ordered by
 * creation, and it ships payload and context rows (customer names, phones) to the browser to count
 * four fields. `proposal.approved` / `proposal.rejected` audit rows are the immutable decision record.
 *
 * Real drizzle over a fake mysql2 client: the fake evaluates the bound parameters (entity type, action
 * list, window days) against an in-memory audit table, so the window and the action filter are exercised
 * for real; separate arms pin the rendered SQL. Column order of the fake rows mirrors the select lists in
 * getDecisionSummary (see the comments in the fake).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/mysql2";
import { PROPOSAL_REASON_CHIPS } from "../../shared/proposalReasons";

interface AuditRow {
  entityId: string;
  action: string;
  daysAgo: number;
  note?: string | null;
  /** undefined = the admin_proposals row is missing (LEFT JOIN yields NULL) */
  actionType?: string;
}

const NOW = new Date("2026-10-27T12:00:00.000Z");
const DAY = 86_400_000;

const state: {
  rows: AuditRow[];
  queries: Array<{ sql: string; values: unknown[] }>;
  failWith: Error | null;
  noDb: boolean;
} = { rows: [], queries: [], failWith: null, noDb: false };

const utcText = (daysAgo: number) =>
  new Date(NOW.getTime() - daysAgo * DAY).toISOString().slice(0, 19).replace("T", " ");

const fake = {
  // mysql2's query(options, params): drizzle passes the bound parameters as the second argument
  query: async (q: { sql: string }, params: unknown[] = []) => {
    state.queries.push({ sql: q.sql, values: params });
    if (state.failWith) throw state.failWith;
    const values = params;
    const actions = values.filter((v): v is string => typeof v === "string" && v.startsWith("proposal."));
    const windowed = /interval/i.test(q.sql);
    const days = values.find((v): v is number => typeof v === "number" && windowed);
    const keep = state.rows.filter(
      (r) => actions.includes(r.action) && (days === undefined || r.daysAgo <= days),
    );
    if (windowed) {
      // select list: entity_id, action, created_at, note, action_type -- oldest first
      const rows = [...keep].sort((a, b) => b.daysAgo - a.daysAgo);
      return [rows.map((r) => [r.entityId, r.action, utcText(r.daysAgo), r.note ?? null, r.actionType ?? null]), []];
    }
    // select list: action, created_at, action_type -- newest first, limit 1
    const newest = [...keep].sort((a, b) => a.daysAgo - b.daysAgo).slice(0, 1);
    return [newest.map((r) => [r.action, utcText(r.daysAgo), r.actionType ?? null]), []];
  },
};

vi.mock("../lib/db-helper", () => ({
  db: vi.fn(async () => (state.noDb ? null : drizzle(fake as never))),
}));
vi.mock("../lib/logger", () => ({
  createLogger: () => ({ info: () => {}, debug: () => {}, warn: () => {}, error: () => {} }),
}));

import { getDecisionSummary } from "./proposalDecisionSummary";

const BOOKING = "create_booking_request";
const CALLBACK = "create_callback";

function fixture(): AuditRow[] {
  return [
    // 3 booking approvals
    { entityId: "b1", action: "proposal.approved", daysAgo: 1, actionType: BOOKING },
    { entityId: "b2", action: "proposal.approved", daysAgo: 2, actionType: BOOKING },
    { entityId: "b3", action: "proposal.approved", daysAgo: 3, actionType: BOOKING },
    // 5 booking rejections: two chip, one chip + typed text, one empty, one other chip
    { entityId: "b4", action: "proposal.rejected", daysAgo: 4, note: "Walk-in, no booking needed", actionType: BOOKING },
    { entityId: "b5", action: "proposal.rejected", daysAgo: 5, note: "Walk-in, no booking needed", actionType: BOOKING },
    { entityId: "b6", action: "proposal.rejected", daysAgo: 6, note: "Walk-in, no booking needed · came in anyway", actionType: BOOKING },
    { entityId: "b7", action: "proposal.rejected", daysAgo: 7, note: null, actionType: BOOKING },
    { entityId: "b8", action: "proposal.rejected", daysAgo: 8, note: "Duplicate", actionType: BOOKING },
    // 1 callback rejection
    { entityId: "c1", action: "proposal.rejected", daysAgo: 9, note: "Not a real request", actionType: CALLBACK },
    // approved 40 days ago, executed today: the approve is outside 30 days, the executed event is no decision
    { entityId: "o1", action: "proposal.approved", daysAgo: 40, actionType: BOOKING },
    { entityId: "o1", action: "proposal.executed", daysAgo: 0, actionType: BOOKING },
    // a decision event whose proposal row is gone
    { entityId: "m1", action: "proposal.approved", daysAgo: 2, actionType: undefined },
    // latest decision per proposal: rejected then approved -> approved; approved then rejected -> rejected
    { entityId: "d1", action: "proposal.rejected", daysAgo: 20, note: "Other", actionType: CALLBACK },
    { entityId: "d1", action: "proposal.approved", daysAgo: 5, actionType: CALLBACK },
    { entityId: "d2", action: "proposal.approved", daysAgo: 20, actionType: CALLBACK },
    { entityId: "d2", action: "proposal.rejected", daysAgo: 2, note: "Other", actionType: CALLBACK },
  ];
}

async function ok(days = 30) {
  const out = await getDecisionSummary({ days });
  if (!out.available) throw new Error(`expected available:true, got ${out.reason}: ${out.message}`);
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.rows = fixture();
  state.queries = [];
  state.failWith = null;
  state.noDb = false;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("getDecisionSummary -- counts", () => {
  it("counts approved and turned-down per action type, each proposal once by its latest decision in the window", async () => {
    const out = await ok();
    expect(out.byType).toEqual([
      { actionType: BOOKING, approved: 3, turnedDown: 5 },
      { actionType: CALLBACK, approved: 1, turnedDown: 2 },
      { actionType: "unknown", approved: 1, turnedDown: 0 },
    ]);
  });

  it("a proposal approved 40 days ago whose execution event is today is not in a 30-day window, and executed is never a decision", async () => {
    const out = await ok();
    // o1 would add one approved to booking if either the window or the action filter were wrong
    expect(out.byType.find((t) => t.actionType === BOOKING)?.approved).toBe(3);
    // the same proposal with a 90-day window IS counted: the window is what excluded it
    const wide = await ok(90);
    expect(wide.byType.find((t) => t.actionType === BOOKING)?.approved).toBe(4);
  });

  it("a decision event whose proposal row is missing still counts, under unknown", async () => {
    const out = await ok();
    expect(out.byType.find((t) => t.actionType === "unknown")).toEqual({ actionType: "unknown", approved: 1, turnedDown: 0 });
  });

  it("an empty window is a measured empty result with real shape, not a failure", async () => {
    state.rows = [];
    const out = await ok();
    expect(out).toMatchObject({ available: true, days: 30, byType: [], topReasons: [], lastDecision: null });
    expect(out.since).toBe(new Date(NOW.getTime() - 30 * DAY).toISOString());
  });
});

describe("getDecisionSummary -- reasons", () => {
  it("normalises chips (also when followed by typed text), an empty note, and returns the top 3 with ties alphabetical", async () => {
    const out = await ok();
    // turned down in window: b4 b5 b6 (walk-in chip x3), b7 (none), b8 Duplicate, c1 Not a real request, d2 Other
    expect(out.topReasons).toEqual([
      { reason: "Walk-in, no booking needed", count: 3 },
      { reason: "Duplicate", count: 1 },
      { reason: "No reason given", count: 1 },
    ]);
  });

  it("a note that only begins with a chip word is its own reason; blank notes are 'No reason given'; long text is cut to 80", async () => {
    const long = "x".repeat(120);
    // one rejection per call: the summary exposes only the top 3, so a single row shows its normalised reason
    for (const [note, expected] of [
      ["Otherwise it was fine", "Otherwise it was fine"],
      ["   ", "No reason given"],
      [`  ${long}  `, "x".repeat(80)],
      ["duplicate", "Duplicate"],
      ["Other · typed", "Other"],
    ] as const) {
      state.rows = [{ entityId: "s", action: "proposal.rejected", daysAgo: 1, note, actionType: BOOKING }];
      expect((await ok()).topReasons, JSON.stringify(note)).toEqual([{ reason: expected, count: 1 }]);
    }
  });

  it("the chip list the server counts by is the shared list the client imports", () => {
    expect([...PROPOSAL_REASON_CHIPS]).toEqual([
      "Walk-in, no booking needed",
      "Not a real request",
      "Already handled",
      "Duplicate",
      "Other",
    ]);
  });
});

describe("getDecisionSummary -- lastDecision", () => {
  it("is the newest decision event of all time, not windowed, and never an executed event", async () => {
    state.rows = [
      { entityId: "o1", action: "proposal.approved", daysAgo: 40, actionType: BOOKING },
      { entityId: "o1", action: "proposal.executed", daysAgo: 0, actionType: BOOKING },
    ];
    const out = await ok();
    expect(out.byType).toEqual([]);
    expect(out.lastDecision).toEqual({
      at: new Date(NOW.getTime() - 40 * DAY).toISOString(),
      decision: "approved",
      actionType: BOOKING,
    });
  });

  it("reports turned_down and a null actionType when the proposal row is missing", async () => {
    state.rows = [{ entityId: "m", action: "proposal.rejected", daysAgo: 3, note: "Duplicate" }];
    expect((await ok()).lastDecision).toEqual({
      at: new Date(NOW.getTime() - 3 * DAY).toISOString(),
      decision: "turned_down",
      actionType: null,
    });
  });

  it("is null only when there has never been a decision", async () => {
    state.rows = [{ entityId: "x", action: "proposal.executed", daysAgo: 1, actionType: BOOKING }];
    expect((await ok()).lastDecision).toBeNull();
  });
});

describe("getDecisionSummary -- the SQL it sends", () => {
  it("windows on the audit row's created_at in SQL (DATE_SUB), never on admin_proposals.reviewed_at, and asks for the two decision actions only", async () => {
    await ok(14);
    const windowQ = state.queries.find((q) => /interval/i.test(q.sql));
    expect(windowQ, "a windowed query was sent").toBeDefined();
    expect(windowQ!.sql).toMatch(/`audit_log`\.`created_at` >= DATE_SUB\(NOW\(\), INTERVAL \? DAY\)/);
    expect(windowQ!.sql).not.toMatch(/reviewed_at/i);
    expect(windowQ!.sql).toMatch(/left join `admin_proposals` on `admin_proposals`\.`id` = `audit_log`\.`entity_id`/i);
    expect(windowQ!.values).toEqual(expect.arrayContaining(["proposal", "proposal.approved", "proposal.rejected", 14]));
    expect(windowQ!.values).not.toContain("proposal.executed");
    // PII minimisation: no payload, context, title or reviewer column is selected
    expect(windowQ!.sql).not.toMatch(/payload_json|context_json|title|reviewed_by|review_note/i);
  });

  it("the all-time lookup is ordered newest first with limit 1 and the same two actions", async () => {
    await ok();
    const lastQ = state.queries.find((q) => !/interval/i.test(q.sql));
    expect(lastQ!.sql).toMatch(/order by `audit_log`\.`created_at` desc limit \?/i);
    expect(lastQ!.values).not.toContain("proposal.executed");
  });
});

describe("getDecisionSummary -- a failed read is not a zero", () => {
  it("a throwing query returns available:false with a reason and message, no counts", async () => {
    state.failWith = new Error("connect ETIMEDOUT");
    const out = await getDecisionSummary({ days: 30 });
    expect(state.queries.length, "the read was attempted").toBeGreaterThan(0);
    expect(out.available).toBe(false);
    if (out.available) throw new Error("unreachable");
    expect(out.reason).toBe("error");
    expect(out.message.length).toBeGreaterThan(0);
    expect(out).not.toHaveProperty("byType");
    expect(out).not.toHaveProperty("lastDecision");
  });

  it("no database handle is available:false / no_db", async () => {
    state.noDb = true;
    const out = await getDecisionSummary({ days: 30 });
    expect(out).toMatchObject({ available: false, reason: "no_db" });
  });

  it("an unreadable timestamp fails the read rather than reporting a made-up time", async () => {
    const realQuery = fake.query;
    fake.query = async (q, params) => {
      const [rows, f] = (await realQuery(q, params)) as [unknown[][], unknown[]];
      // the time is column 2 of the window select and column 1 of the all-time lookup
      return [rows.map((r) => r.map((v, i) => (i === (r.length === 5 ? 2 : 1) ? "2026-13-45 99:99:99" : v))), f];
    };
    try {
      const out = await getDecisionSummary({ days: 30 });
      expect(state.queries.length, "the read was attempted").toBeGreaterThan(0);
      expect(out.available).toBe(false);
    } finally {
      fake.query = realQuery;
    }
  });
});
