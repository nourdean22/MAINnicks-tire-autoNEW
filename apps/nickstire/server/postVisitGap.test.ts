/**
 * The 7-day post-visit text keeps a 3-day gap from any other shop text (Nour, 2026-10-25).
 *
 * It used to be blocked by the 30-day REVIEW cooldown. The review request goes out 60 minutes
 * after service, so every customer who got one was excluded from the thank-you six days later
 * (probe 2026-10-25: 5 of 5 customers in the 6-8 day window blocked, 0 sent). The thank-you is
 * not a review ask; the rule now is "no shop text in the last 3 days", in two places:
 *   - the eligibility query (a skipped customer is never marked, so the exclusion must live in
 *     the query or they refill the .limit(20) every run), and
 *   - hasOutboundTextWithinDays() right before the claim (a text that lands after the query ran).
 *
 * No real database: mysql2 and drizzle are mocked and the fake EVALUATES the real SQL the code
 * hands it, rendered by drizzle's MySqlDialect: the NOT EXISTS subqueries of the eligibility
 * query and the helper's WHERE. So a changed interval, table, direction or status condition
 * changes who gets texted. Fixture phones are bare 10 digits on both sides of the join
 * (probe 2026-10-25: 100% of customers.phone and sms_conversations.phone rows are 10 digits).
 */
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { getTableName } from "drizzle-orm";
import { MySqlDialect } from "drizzle-orm/mysql-core";

const PHONE = "2165550123";
const NOW = new Date("2026-10-25T16:00:00.000Z");
const DAY_MS = 86_400_000;
const dialect = new MySqlDialect();

type TextRow = { daysAgo: number; status: string; direction: "outbound" | "inbound"; phone?: string };
const world = {
  outbound: [] as TextRow[],
  reviewRequests: [] as { daysAgo: number; status: string }[],
  /** null until the eligibility query runs; then whether the query handed the customer back. */
  customerReturned: null as boolean | null,
  /** Subquery tables the evaluator found in the eligibility query (proves it matched something). */
  subqueryTables: [] as string[],
  claims: 0,
  /** Runs right after the eligibility query returns: a text that lands before the send. */
  afterCustomerSelect: undefined as undefined | (() => void),
};

/** Index of the balanced ')' for the '(' at `open`. */
function closeParen(sql: string, open: number): number {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")" && --depth === 0) return i;
  }
  throw new Error("unbalanced parens in rendered SQL");
}

/** True when the customer passes every NOT EXISTS subquery of the rendered eligibility WHERE. */
function passesNotExists(q: { sql: string; params: unknown[] }): boolean {
  world.subqueryTables = [];
  let passes = true;
  for (const m of q.sql.matchAll(/NOT EXISTS \(/g)) {
    const open = m.index! + m[0].length - 1;
    const body = q.sql.slice(open + 1, closeParen(q.sql, open));
    const table = /FROM (\w+)/.exec(body)?.[1];
    if (table !== "sms_messages" && table !== "review_requests") throw new Error(`unexpected subquery table ${table}`);
    world.subqueryTables.push(table);
    const iv = /INTERVAL (\?|\d+) DAY/.exec(body);
    if (!iv) throw new Error("subquery without an INTERVAL");
    const days =
      iv[1] === "?"
        ? Number(q.params[(q.sql.slice(0, open + 1 + iv.index).match(/\?/g) ?? []).length])
        : Number(iv[1]);
    const failedExcluded = body.includes("<> 'failed'");
    const outboundOnly = body.includes("= 'outbound'");
    const rows: TextRow[] =
      table === "sms_messages"
        ? world.outbound
        : world.reviewRequests.map((r) => ({ ...r, direction: "outbound" as const }));
    const hit = rows.some(
      (r) =>
        (r.phone ?? PHONE) === PHONE &&
        r.daysAgo <= days &&
        (!failedExcluded || r.status !== "failed") &&
        (!outboundOnly || r.direction === "outbound"),
    );
    if (hit) passes = false;
  }
  return passes;
}

/** Rows of sms_messages JOIN sms_conversations the helper's rendered WHERE keeps. */
function helperRows(q: { sql: string; params: unknown[] }): { id: number }[] {
  const conds = [...q.sql.matchAll(/`(\w+)`\.`(\w+)` (=|<>|>=) \?/g)];
  if (conds.length === 0) throw new Error("helper WHERE has no column conditions");
  const kept = world.outbound.filter((r) =>
    conds.every((c, i) => {
      const p = q.params[i];
      const [, table, col, op] = c;
      if (table === "sms_conversations" && col === "phone") return (r.phone ?? PHONE) === p;
      if (table === "sms_messages" && col === "direction") return r.direction === p;
      if (table === "sms_messages" && col === "status") return op === "<>" ? r.status !== p : r.status === p;
      if (table === "sms_messages" && col === "createdAt") {
        const cutoff = p instanceof Date ? p.getTime() : new Date(`${String(p).replace(" ", "T")}Z`).getTime();
        return NOW.getTime() - r.daysAgo * DAY_MS >= cutoff;
      }
      throw new Error(`unexpected helper condition ${table}.${col}`);
    }),
  );
  return kept.map((_, i) => ({ id: i + 1 }));
}

const customer = { id: 9, firstName: "Sam", phone: PHONE, segment: "recent" };

const fakeDb = {
  select: () => ({
    from: (table: unknown) => {
      const name = getTableName(table as never);
      let q: { sql: string; params: unknown[] } | undefined;
      const chain = {
        innerJoin: () => chain,
        where: (cond: Parameters<typeof dialect.sqlToQuery>[0]) => {
          q = dialect.sqlToQuery(cond);
          return chain;
        },
        limit: async () => {
          if (name === "review_settings") return [{ id: 1, enabled: 1, delayMinutes: 60, maxPerDay: 20, cooldownDays: 30, messageTemplate: null }];
          if (name === "customers") {
            world.customerReturned = passesNotExists(q!);
            const out = world.customerReturned ? [customer] : [];
            world.afterCustomerSelect?.();
            return out;
          }
          if (name === "sms_messages") return helperRows(q!);
          // The old gate (isPhoneOnReviewCooldown) reads review_requests: model it as 30 days.
          if (name === "review_requests") return world.reviewRequests.some((r) => r.status !== "failed" && r.daysAgo <= 30) ? [{ id: 1 }] : [];
          throw new Error(`unexpected read of ${name}`);
        },
      };
      return chain;
    },
  }),
  update: () => ({
    set: () => ({
      where: async () => {
        world.claims++;
        return [{ affectedRows: 1 }];
      },
    }),
  }),
};

const { sendSms } = vi.hoisted(() => ({ sendSms: vi.fn() }));
vi.mock("./sms", () => ({ sendSms }));
vi.mock("./services/featureFlags", () => ({ isEnabled: vi.fn(async () => true) }));
vi.mock("mysql2/promise", () => ({ default: { createPool: () => ({ end: async () => {} }) } }));
vi.mock("drizzle-orm/mysql2", () => ({ drizzle: () => fakeDb }));

const DB_URL = "mysql://test:test@127.0.0.1:1/never";
vi.stubEnv("DATABASE_URL", DB_URL);
const { getDb, resetDbConnection, hasOutboundTextWithinDays } = await import("./db");

afterAll(() => {
  resetDbConnection();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  // The vitest config unstubs env before each test and getDb is lazy: rebuild the (mocked) singleton.
  vi.stubEnv("DATABASE_URL", DB_URL);
  resetDbConnection();
  await getDb();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  // The per-send pacing sleep resolves immediately.
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((cb: () => void) => {
    cb();
    return 0 as unknown as ReturnType<typeof setTimeout>;
  }) as typeof setTimeout);
  sendSms.mockReset();
  sendSms.mockResolvedValue({ success: true, sid: "SM_fixture" });
  world.outbound = [];
  world.reviewRequests = [];
  world.customerReturned = null;
  world.subqueryTables = [];
  world.claims = 0;
  world.afterCustomerSelect = undefined;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function runLane() {
  const { processPostInvoiceFollowUps } = await import("./postInvoiceFollowUp");
  return processPostInvoiceFollowUps();
}

describe("the thank-you is no longer blocked by the review cooldown", () => {
  it("texts a customer whose review request went out 5 days ago (the probe's 5 of 5 case)", async () => {
    world.reviewRequests = [{ daysAgo: 5, status: "sent" }];
    // The review lane sends through sendSms, which logs an outbound sms_messages row.
    world.outbound = [{ daysAgo: 5, status: "sent", direction: "outbound" }];
    const res = await runLane();
    expect(res).toMatchObject({ processed: 1, sent: 1, skipped: 0, failed: 0 });
    expect(sendSms).toHaveBeenCalledTimes(1);
    expect(sendSms).toHaveBeenCalledWith(PHONE, expect.stringContaining("Thanks for coming in"), { via: "shop" });
  });

  it("control: a customer with no texts at all is texted", async () => {
    const res = await runLane();
    expect(res).toMatchObject({ sent: 1, skipped: 0 });
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("the scanner located its subject: exactly one NOT EXISTS, over sms_messages", async () => {
    await runLane();
    expect(world.subqueryTables).toEqual(["sms_messages"]);
  });
});

describe("the 3-day gap from any other shop text", () => {
  it("control A: an outbound text 1 day ago skips the customer in the QUERY, no claim, no send", async () => {
    world.outbound = [{ daysAgo: 1, status: "sent", direction: "outbound" }];
    const res = await runLane();
    expect(world.customerReturned).toBe(false);
    expect(res.processed).toBe(0);
    expect(sendSms).not.toHaveBeenCalled();
    expect(world.claims).toBe(0);
  });

  it("control A2: a review-request text sent yesterday also holds the thank-you back", async () => {
    world.reviewRequests = [{ daysAgo: 1, status: "sent" }];
    world.outbound = [{ daysAgo: 1, status: "sent", direction: "outbound" }];
    await runLane();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("control B: an outbound text 4 days ago is outside the gap, so the customer is texted", async () => {
    world.outbound = [{ daysAgo: 4, status: "sent", direction: "outbound" }];
    const res = await runLane();
    expect(world.customerReturned).toBe(true);
    expect(res).toMatchObject({ sent: 1, skipped: 0 });
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("control C: a FAILED outbound text 1 day ago does not count (the customer never got it)", async () => {
    world.outbound = [{ daysAgo: 1, status: "failed", direction: "outbound" }];
    const res = await runLane();
    expect(world.customerReturned).toBe(true);
    expect(res).toMatchObject({ sent: 1 });
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it("control E: the customer's own reply (inbound) yesterday is not a shop text", async () => {
    world.outbound = [{ daysAgo: 1, status: "received", direction: "inbound" }];
    const res = await runLane();
    expect(res).toMatchObject({ sent: 1 });
  });

  it("control F: a QUEUED text (parked for the 8 AM window) 1 day ago counts, it will go out", async () => {
    world.outbound = [{ daysAgo: 1, status: "queued", direction: "outbound" }];
    await runLane();
    expect(sendSms).not.toHaveBeenCalled();
  });

  it("belt and braces: a text that lands AFTER the query ran blocks the send, no claim", async () => {
    world.afterCustomerSelect = () => {
      world.outbound.push({ daysAgo: 0, status: "sent", direction: "outbound" });
    };
    const res = await runLane();
    expect(world.customerReturned).toBe(true); // the query let the customer through
    expect(res).toMatchObject({ processed: 1, sent: 0, skipped: 1 });
    expect(sendSms).not.toHaveBeenCalled();
    expect(world.claims).toBe(0);
  });
});

describe("hasOutboundTextWithinDays (the helper alone)", () => {
  it.each([
    ["an outbound text 1 day ago", { daysAgo: 1, status: "sent", direction: "outbound" }, true],
    ["a queued outbound text 1 day ago", { daysAgo: 1, status: "queued", direction: "outbound" }, true],
    ["an outbound text 4 days ago", { daysAgo: 4, status: "sent", direction: "outbound" }, false],
    ["a failed outbound text 1 day ago", { daysAgo: 1, status: "failed", direction: "outbound" }, false],
    ["an inbound text 1 day ago", { daysAgo: 1, status: "received", direction: "inbound" }, false],
    ["another phone's outbound text 1 day ago", { daysAgo: 1, status: "sent", direction: "outbound", phone: "2165550999" }, false],
  ] as [string, TextRow, boolean][])("%s -> %s", async (_label, row, expected) => {
    world.outbound = [row];
    await expect(hasOutboundTextWithinDays(PHONE, 3)).resolves.toBe(expected);
  });

  it("no texts at all -> false", async () => {
    await expect(hasOutboundTextWithinDays(PHONE, 3)).resolves.toBe(false);
  });

  it("control D: an unreadable database fails SAFE (true: do not send), like isPhoneOnReviewCooldown", async () => {
    resetDbConnection();
    vi.stubEnv("DATABASE_URL", "");
    await expect(hasOutboundTextWithinDays(PHONE, 3)).resolves.toBe(true);
  });
});
