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
  inserts: [] as Array<{ values: unknown }>,
};

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: (cond: unknown) => {
          const text = render(cond).sql;
          state.conditions.push(text);
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
  db: async () => fakeDb(),
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

describe("the booking follow-up lane is gone", () => {
  it("no followUps procedure is registered", () => {
    const procedures = Object.keys((appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures);
    expect(procedures.filter((p) => p.startsWith("followUps."))).toEqual([]);
    expect(procedures.some((p) => p.startsWith("winback."))).toBe(true);
  });
});
