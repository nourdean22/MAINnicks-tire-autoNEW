/**
 * Win-Back audiences use the canonical opt-out predicate and the shared
 * lapsed-regulars rule (2026-10-25).
 *
 * Before: every segment filter excluded only `customers.smsOptOut = 1`, so a
 * customer who texted STOP or opted out in sms_preferences still counted as a
 * target (sendSms refused each send, but the "<n> TARGETS" number overstated
 * reach), and Win-Back had no way to target the "lapsed regulars" the Customers
 * tab counts (3+ visits, last visit 90 to 365 days ago).
 *
 * The fake db RENDERS every condition with drizzle's MySqlDialect and applies
 * each leg it finds in the SQL to a small customers fixture, so dropping a leg
 * from the filter changes a count here, not just a string.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const dialect = new MySqlDialect();
const render = (c: unknown) => dialect.sqlToQuery(c as SQL);

const DAY = 86_400_000;
type Cust = { id: number; visits: number; daysAgo: number; phone: string };
// B is a lapsed regular who opted out in sms_preferences only (customers.smsOptOut = 0).
const FIXTURE: Cust[] = [
  { id: 1, visits: 4, daysAgo: 120, phone: "2165550101" }, // A: lapsed regular, textable
  { id: 2, visits: 3, daysAgo: 200, phone: "2165550102" }, // B: lapsed regular, opted out in preferences
  { id: 3, visits: 1, daysAgo: 150, phone: "2165550103" }, // C: one visit, below the floor
  { id: 4, visits: 5, daysAgo: 30, phone: "2165550104" }, // D: recent
  { id: 5, visits: 6, daysAgo: 400, phone: "2165550105" }, // E: lost
];
const PREFS_OPTED_OUT = new Set(["2165550102"]);

/** Applies the legs present in the rendered SQL to the fixture. */
function countFor(text: string): number {
  let rows = FIXTURE;
  const floor = /`totalVisits` >= (\d+)/.exec(text);
  if (floor) rows = rows.filter((r) => r.visits >= Number(floor[1]));
  const min = /`lastVisitDate` < DATE_SUB\(NOW\(\), INTERVAL (\d+) DAY\)/.exec(text);
  if (min) rows = rows.filter((r) => r.daysAgo > Number(min[1]));
  const max = /`lastVisitDate` >= DATE_SUB\(NOW\(\), INTERVAL (\d+) DAY\)/.exec(text);
  if (max) rows = rows.filter((r) => r.daysAgo <= Number(max[1]));
  if (/FROM sms_preferences/.test(text)) rows = rows.filter((r) => !PREFS_OPTED_OUT.has(r.phone));
  return rows.length;
}

const state = {
  conditions: [] as string[],
  rendered: [] as Array<{ sql: string; params: unknown[] }>,
  dbOverride: null as unknown,
  inserts: [] as Array<{ values: unknown }>,
};

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          const q = render(cond);
          const text = q.sql;
          state.conditions.push(text);
          state.rendered.push(q);
          const result = Promise.resolve([{ count: countFor(text), avgSpent: 0 }]);
          return Object.assign(result, { orderBy: () => ({ limit: async () => [] }) });
        },
      }),
    }),
    insert: () => ({
      values: (values: unknown) => {
        state.inserts.push({ values });
        return Object.assign(Promise.resolve([{ insertId: 1 }]), { $returningId: async () => [{ id: 99 }] });
      },
    }),
  };
}

vi.mock("../lib/db-helper", () => ({
  db: async () => state.dbOverride ?? fakeDb(),
  dbTyped: async () => fakeDb(),
  requireDb: async () => fakeDb(),
}));
vi.mock("../lib/reviewCopy", () => ({ getReviewCopy: async () => ({ rating: "4.9", countDisplay: "1,700+" }) }));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";

function ctx(): TrpcContext {
  return {
    user: {
      id: 1, openId: "admin-user", email: "admin@nickstire.com", name: "Admin",
      loginMethod: "manus", role: "admin",
      createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  } as TrpcContext;
}
const admin = () => appRouter.createCaller(ctx());

const OTHER_SEGMENTS = ["lapsed", "dormant", "lost", "vip", "fleet", "recent", "tire_customer"] as const;

beforeEach(() => {
  state.conditions = [];
  state.rendered = [];
  state.dbOverride = null;
  state.inserts = [];
});

describe("lapsed_regulars: the Customers tab's rule, contactable by the canonical predicate", () => {
  it("segmentCounts carries qualifying and contactable for lapsed_regulars from one shared rule", async () => {
    const counts = (await admin().winback.segmentCounts()) as Record<string, unknown>;
    // A and B qualify (3+ visits, 90 to 365 days); B opted out in sms_preferences.
    expect(counts.lapsed_regulars).toEqual({ qualifying: 2, contactable: 1 });
    const pair = counts.lapsed_regulars as { qualifying: number; contactable: number };
    expect(pair.contactable).toBeLessThanOrEqual(pair.qualifying);
    for (const seg of OTHER_SEGMENTS) expect(typeof counts[seg], seg).toBe("number");
  });

  it("the lapsed_regulars target filter renders the shared SQL and both NOT EXISTS legs", async () => {
    const res = await admin().winback.campaignReadiness({ targetSegment: "lapsed_regulars" } as never);
    const text = state.conditions[0];
    expect(text).toMatch(/`totalVisits` >= 3/);
    expect(text).toMatch(/INTERVAL 90 DAY/);
    expect(text).toMatch(/INTERVAL 365 DAY/);
    expect(text).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM sms_preferences/);
    expect(text).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM sms_messages/);
    // The target count is the CONTACTABLE number, never the qualifying one.
    expect(res.netTargetCount).toBe(1);
  });
});

describe("every win-back audience excludes customers who opted out anywhere", () => {
  it.each(OTHER_SEGMENTS)("%s uses the canonical predicate, not the bare smsOptOut flag", async (seg) => {
    await admin().winback.campaignReadiness({ targetSegment: seg });
    const text = state.conditions[0];
    expect(text).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM sms_preferences/);
    expect(text).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM sms_messages/);
    expect(text, "bare eq(customers.smsOptOut, 0) renders as a bound parameter").not.toMatch(/`smsOptOut` = \?/);
  });
});

/** Each `lastVisitDate <op> DATE_SUB(NOW(), INTERVAL n DAY)` comparison, in SQL order. */
function visitIntervals(text: string): Array<{ op: string; days: number }> {
  const re = /`lastVisitDate` (<|>=) DATE_SUB\(NOW\(\), INTERVAL (\d+) DAY\)/g;
  return [...text.matchAll(re)].map((m) => ({ op: m[1], days: Number(m[2]) }));
}

describe("visit windows are day-buckets computed in SQL and can match a row", () => {
  it("recent is last visit 30 to 90 days ago: < 30 days, then >= 90 days", async () => {
    await admin().winback.campaignReadiness({ targetSegment: "recent" });
    const text = state.conditions[0];
    expect(visitIntervals(text)).toEqual([{ op: "<", days: 30 }, { op: ">=", days: 90 }]);
    expect(text).toMatch(/`lastVisitDate` IS NOT NULL/);
  });

  it.each([
    ["lapsed", [{ op: "<", days: 90 }, { op: ">=", days: 180 }]],
    ["dormant", [{ op: "<", days: 180 }, { op: ">=", days: 365 }]],
    ["lost", [{ op: "<", days: 365 }]],
    ["tire_customer", [{ op: "<", days: 180 }]],
  ] as const)("%s binds no JavaScript Date: its window is DATE_SUB in SQL", async (seg, expected) => {
    await admin().winback.campaignReadiness({ targetSegment: seg });
    expect(visitIntervals(state.conditions[0])).toEqual(expected);
    expect(state.rendered[0].params.some((p) => p instanceof Date), `${seg} bound a JS Date`).toBe(false);
  });

  it.each([...OTHER_SEGMENTS, "lapsed_regulars"] as const)("%s: no self-contradictory lastVisitDate window", async (seg) => {
    await admin().winback.campaignReadiness({ targetSegment: seg } as never);
    const bounds = visitIntervals(state.conditions[0]);
    for (const lo of bounds.filter((b) => b.op === "<")) for (const hi of bounds.filter((b) => b.op === ">=")) {
      expect(lo.days, `${seg}: the < side must be the smaller interval`).toBeLessThan(hi.days);
    }
  });
});

describe("create", () => {
  it("accepts lapsed_regulars and stores the lapsed templates verbatim", async () => {
    const res = await admin().winback.create({ name: "Regulars", targetSegment: "lapsed_regulars" } as never);
    expect(res).toMatchObject({ success: true });
    const campaign = state.inserts[0].values as { targetSegment: string; targetCount: number };
    expect(campaign).toMatchObject({ targetSegment: "lapsed_regulars", targetCount: 1 });
    const regularBodies = state.inserts.slice(1).map((i) => (i.values as { body: string }).body);

    state.inserts = [];
    await admin().winback.create({ name: "Lapsed", targetSegment: "lapsed" });
    const lapsedBodies = state.inserts.slice(1).map((i) => (i.values as { body: string }).body);
    expect(regularBodies.length).toBe(4);
    expect(regularBodies).toEqual(lapsedBodies);
  });

  it("still refuses the retired declined segment", async () => {
    await expect(admin().winback.create({ name: "x", targetSegment: "declined" } as never)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });
});

describe("the send-time check uses the same predicate", () => {
  // A holdout result skips the processor's real 1.5 s rate-limit sleep (no fake timers behind await import()).
  const sendSms = vi.fn(async () => ({ success: true, heldOut: true, experimentId: "t" }));
  const executed: string[] = [];

  async function runProcessor(eligible: boolean) {
    sendSms.mockClear();
    executed.length = 0;
    const db = {
      execute: vi.fn(async (q: SQL) => {
        const text = render(q).sql;
        executed.push(text);
        if (/FROM winback_sends ws/.test(text)) {
          return [[{ id: 11, phone: "2165550102", personalizedBody: "Hi", campaignId: 3, customerId: 2 }]];
        }
        if (/FROM sms_preferences/.test(text)) return [eligible ? [{ eligible: 1 }] : []];
        if (/SET status = 'sent'/.test(text)) return [{ affectedRows: 1 }];
        return [[]];
      }),
    };
    vi.resetModules();
    vi.doMock("../db", () => ({ getDb: async () => db }));
    vi.doMock("../sms", () => ({ sendSms, isShopGatewayReachable: async () => true }));
    vi.doMock("../services/featureFlags", () => ({ isEnabled: async () => true }));
    vi.doMock("../services/telegram", () => ({ sendTelegram: async () => true }));
    try {
      const { processWinbackPending } = await import("../services/winbackProcessor");
      return await processWinbackPending();
    } finally {
      for (const m of ["../db", "../sms", "../services/featureFlags", "../services/telegram"]) vi.doUnmock(m);
    }
  }

  it("a customer opted out in sms_preferences is marked failed and never texted", async () => {
    await runProcessor(false);
    expect(sendSms).not.toHaveBeenCalled();
    const fail = executed.find((t) => /SET status = 'failed'/.test(t));
    expect(fail).toMatch(/AND status = 'pending'/);
  });

  it("an eligible customer is texted", async () => {
    await runProcessor(true);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });
});

describe("admin processPending counts a failure only on the row it changed", () => {
  function drainDb(failAffected: number) {
    const send = { id: 7, customerId: 2, phone: "2165550102", personalizedBody: "Hi", campaignId: 3 };
    return {
      select: () => ({
        from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [{ send, campaignStatus: "active" }] }) }) }),
      }),
      execute: async () => [[]], // not eligible
      update: () => ({ set: () => ({ where: async () => [{ affectedRows: failAffected }] }) }),
    };
  }

  it("a fail write that changed no row (the cron got there first) is not counted", async () => {
    state.dbOverride = drainDb(0);
    await expect(admin().winback.processPending()).resolves.toMatchObject({ processed: 1, failed: 0 });
  });

  it("control: a fail write that changed the row is counted", async () => {
    state.dbOverride = drainDb(1);
    await expect(admin().winback.processPending()).resolves.toMatchObject({ processed: 1, failed: 1 });
  });
});

/**
 * Consent chronology, run on the REAL rendered SQL in node:sqlite (the MySQL-only
 * RIGHT() is registered as a function; everything else in the predicate is portable).
 * Mirrors sendSms's index (server/sms.ts): a later START/UNSTOP/YES in the same
 * conversation lifts a STOP; same timestamp, the higher id wins.
 */
describe("campaign eligibility honours a later START, like sendSms", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { customerCampaignEligibleSql } = await import("../lib/sms-eligibility");

  function eligible(messages: Array<{ id: number; body: string; at: string }>): boolean {
    const db = new DatabaseSync(":memory:");
    db.function("RIGHT", (s: unknown, n: unknown) => String(s ?? "").slice(-Number(n)));
    db.exec(`
      CREATE TABLE customers (id INTEGER, phone TEXT, smsOptOut INTEGER);
      CREATE TABLE sms_preferences (phone TEXT, opted_out INTEGER);
      CREATE TABLE sms_conversations (id INTEGER, phone TEXT);
      CREATE TABLE sms_messages (id INTEGER, conversationId INTEGER, direction TEXT, body TEXT, createdAt TEXT);
      INSERT INTO customers VALUES (1, '+12165550101', 0);
      INSERT INTO sms_conversations VALUES (9, '2165550101');
    `);
    const ins = db.prepare("INSERT INTO sms_messages VALUES (?, 9, 'inbound', ?, ?)");
    for (const m of messages) ins.run(m.id, m.body, m.at);
    const q = render(customerCampaignEligibleSql(1));
    return db.prepare(q.sql).all(...(q.params as never[])).length === 1;
  }

  it("positive control: no messages = eligible", () => {
    expect(eligible([])).toBe(true);
  });
  it("STOP alone = not eligible", () => {
    expect(eligible([{ id: 1, body: "stop", at: "2026-10-01 10:00:00" }])).toBe(false);
  });
  it("STOP then START = eligible", () => {
    expect(eligible([
      { id: 1, body: "STOP", at: "2026-10-01 10:00:00" },
      { id: 2, body: " start ", at: "2026-10-02 10:00:00" },
    ])).toBe(true);
  });
  it("START then STOP = not eligible", () => {
    expect(eligible([
      { id: 1, body: "START", at: "2026-10-01 10:00:00" },
      { id: 2, body: "STOP", at: "2026-10-02 10:00:00" },
    ])).toBe(false);
  });
  it("same timestamp: the higher id wins", () => {
    const at = "2026-10-01 10:00:00";
    expect(eligible([{ id: 1, body: "STOP", at }, { id: 2, body: "UNSTOP", at }])).toBe(true);
    expect(eligible([{ id: 1, body: "YES", at }, { id: 2, body: "STOP", at }])).toBe(false);
  });
});
