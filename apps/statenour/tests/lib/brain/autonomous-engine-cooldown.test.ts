/**
 * Cooldown window and commitment-family suppression, against a stateful store.
 *
 * 1. WINDOW. The engine runs on an hourly tick. With a 24 h "row in the last
 *    24 h" cooldown, a once-a-day rule that reached its check a few seconds
 *    EARLIER than yesterday was skipped and slid an hour later, until it fell
 *    out of its ET window and missed a day. 20 h lets it fire in the same hour
 *    every day; it still cannot fire twice in one daily window.
 *
 * 2. FAMILY. The 6 h "one commitment-family message per commitment" check keyed
 *    on the `commitment_` NAME prefix, so overdue_commitment_escalation sat
 *    outside it and could fire on the same commitment as commitment_checkin in
 *    one run. It now keys on targetType "commitment".
 *
 * The fake AutonomousAction model below stores rows and evaluates the filters
 * the engine actually sends (equality, null, gte, startsWith, in), so the
 * cooldown and family reads see their own earlier writes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, unknown>;

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  for (const [k, cond] of Object.entries(where ?? {})) {
    const v = row[k];
    if (cond === null) {
      if (v != null) return false;
    } else if (typeof cond !== "object" || cond instanceof Date) {
      if (v !== cond) return false;
    } else {
      const c = cond as Record<string, unknown>;
      if ("gte" in c && !(v instanceof Date && v.getTime() >= (c.gte as Date).getTime())) return false;
      if ("startsWith" in c && !(typeof v === "string" && v.startsWith(c.startsWith as string))) return false;
      if ("in" in c && !(c.in as unknown[]).includes(v)) return false;
    }
  }
  return true;
}

const s = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  commitments: [] as Array<Record<string, unknown>>,
  /** Open task count: >= 8 makes task_overload_alert (no hour gate, no id) want to fire. */
  openTasks: 0,
  /** quotes_pending answer; null = bridge off. count >= 10 arms quote_conversion_insight (Sundays);
   *  a `quotes` entry with an email arms auto_followup_expired_quote. */
  quotes: null as null | Record<string, unknown>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    autonomousAction: {
      findFirst: vi.fn(async (a: { where?: Record<string, unknown> }) => s.rows.find((r) => matches(r, a?.where)) ?? null),
      findMany: vi.fn(async (a: { where?: Record<string, unknown> }) => s.rows.filter((r) => matches(r, a?.where))),
      create: vi.fn(async (a: { data: Record<string, unknown> }) => {
        const row = { id: `row-${s.rows.length + 1}`, createdAt: new Date(), ...a.data };
        s.rows.push(row);
        return row;
      }),
      update: vi.fn(async (a: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = s.rows.find((r) => r.id === a.where.id);
        if (row) Object.assign(row, a.data);
        return row ?? {};
      }),
      groupBy: vi.fn(async () => []),
    },
    commitment: { findMany: vi.fn(async () => s.commitments) },
    masteryDecision: { findMany: vi.fn(async () => []) },
    decisionReplay: { findMany: vi.fn(async () => []) },
    brainMemory: {
      // Identity snapshot touched just now: daily_score / drift stay quiet.
      findUnique: vi.fn(async () => ({ updatedAt: new Date(), deletedAt: null })),
      findFirst: vi.fn(async () => ({ id: "snap" })),
      findMany: vi.fn(async () => []),
    },
    task: {
      // No workout done today: workout_reminder wants to fire inside 15-17 ET.
      findFirst: vi.fn(async () => null),
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => s.openTasks),
    },
  },
}));
vi.mock("@/lib/nickstire/query", () => ({
  queryNick: vi.fn(async (q: string) =>
    q === "quotes_pending" && s.quotes ? { data: s.quotes } : { error: "bridge off in tests" },
  ),
  queryNickBatch: vi.fn(async () => ({})),
}));
vi.mock("@/lib/services/telegram", () => ({ sendTelegram: vi.fn() }));
vi.mock("@/lib/services/email", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/brain/memory-manager", () => ({ brainMemory: { remember: vi.fn() } }));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/logger", () => ({
  logger: { withSurface: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("@/lib/automation/policy", () => ({
  getPolicy: vi.fn(async () => null),
  logPolicyFire: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/agent-trace", () => ({ mintTraceId: () => "trace-test", recordTrace: vi.fn(async () => undefined) }));
vi.mock("@/lib/ai/confidence-tier", () => ({ canAutoExecute: () => false }));
vi.mock("@/lib/db/brain-bus-emit", () => ({ emitAutonomousFired: vi.fn(async () => undefined) }));

import {
  runAutonomousActions,
  listRuleNames,
  OUTWARD_RULES,
  CUSTOMER_FACING_RULES,
  inCustomerHoursET,
} from "@/lib/brain/autonomous-engine";

const rowsFor = (rule: string) => s.rows.filter((r) => r.ruleName === rule);
async function tickAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  return runAutonomousActions();
}

/** Hourly ticks at :00:03 past each UTC hour, `count` of them from `startIso`. */
async function tickHourly(startIso: string, count: number) {
  const start = Date.parse(startIso);
  for (let i = 0; i < count; i++) await tickAt(new Date(start + i * 3_600_000).toISOString());
}
/** A rule's fires grouped by ET calendar date. */
function firesPerEtDay(rule: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rowsFor(rule)) {
    const day = (r.createdAt as Date).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    out[day] = (out[day] ?? 0) + 1;
  }
  return out;
}

beforeEach(() => {
  vi.useFakeTimers();
  s.rows.length = 0;
  s.commitments.length = 0;
  s.openTasks = 0;
  s.quotes = null;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("cooldown window under an hourly tick", () => {
  it("a rule that fired yesterday at 15:00:05 ET fires again today at 15:00:03 ET", async () => {
    await tickAt("2026-10-07T19:00:05Z"); // Wed 15:00:05 EDT
    expect(rowsFor("workout_reminder")).toHaveLength(1);

    await tickAt("2026-10-08T19:00:03Z"); // Thu 15:00:03 EDT, two seconds "earlier"
    expect(rowsFor("workout_reminder")).toHaveLength(2);
  });

  it("CONTROL: it does not fire twice within one day's window", async () => {
    await tickAt("2026-10-08T19:00:03Z"); // Thu 15:00 EDT
    await tickAt("2026-10-08T20:00:03Z"); // 16:00
    await tickAt("2026-10-08T21:00:03Z"); // 17:00
    expect(rowsFor("workout_reminder")).toHaveLength(1);
  });

  // 20 h alone let a rule whose window is longer than 20 h fire twice in one
  // ET day (measured: quote_conversion_insight at Sun 00 and Sun 21 ET). The
  // window now also covers everything since ET midnight.
  it("a rule with no hour gate, ticked hourly for 48 h, fires exactly once per ET day", async () => {
    s.openTasks = 12;
    await tickHourly("2026-10-11T04:00:03Z", 48); // Sun 00:00 EDT .. Mon 23:00 EDT
    expect(firesPerEtDay("task_overload_alert")).toEqual({ "2026-10-11": 1, "2026-10-12": 1 });
  });

  it("the Sunday-only quote_conversion_insight fires once on its Sunday, not twice", async () => {
    s.quotes = { count: 20, bookedCount: 5 };
    await tickHourly("2026-10-11T04:00:03Z", 48);
    expect(firesPerEtDay("quote_conversion_insight")).toEqual({ "2026-10-11": 1 });
  });

  it("DST fall-back day 2026-11-01 (25 h long) still fires once", async () => {
    s.openTasks = 12;
    // Sat 10-31 00:00 EDT through Mon 11-02 08:00 EST: 24 + 25 + 9 ticks.
    await tickHourly("2026-10-31T04:00:03Z", 58);
    expect(firesPerEtDay("task_overload_alert")).toEqual({
      "2026-10-31": 1,
      "2026-11-01": 1,
      "2026-11-02": 1,
    });
    // ET midnight on both sides of the change: 04:00Z in EDT, 05:00Z in EST.
    expect(etHoursOf("task_overload_alert")).toEqual([0, 0, 0]);
  });
});

/** ET hours (0-23) at which a rule's rows were written. */
const etHoursOf = (rule: string) =>
  rowsFor(rule).map((r) =>
    Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hour12: false })
        .format(r.createdAt as Date),
    ) % 24,
  );

describe("customer-facing rules keep business hours (08:00-20:00 ET), even under an auto policy", () => {
  it("the customer-email rule, ticked hourly for 48 h, fires once per ET day and only inside 8-20 ET", async () => {
    s.quotes = {
      quotes: [{ quoteNumber: "Q1", customerEmail: "lead@example.com", vehicleYear: 2020, vehicleMake: "Honda", vehicleModel: "Civic", grandTotal: 400 }],
      count: 3, // under the pricing / conversion thresholds, so only the follow-up rule acts
      bookedCount: 0,
    };
    await tickHourly("2026-10-11T04:00:03Z", 48); // Sun 00:00 EDT .. Mon 23:00 EDT
    expect(firesPerEtDay("auto_followup_expired_quote")).toEqual({ "2026-10-11": 1, "2026-10-12": 1 });
    // First in-window tick of each day, never the 00:00 tick the day window would otherwise pick.
    expect(etHoursOf("auto_followup_expired_quote")).toEqual([8, 8]);
  });

  it("CONTROL: an operator-only ungated rule is NOT quiet-hour skipped (fires at 00 ET)", async () => {
    s.openTasks = 12;
    await tickHourly("2026-10-11T04:00:03Z", 48);
    expect(etHoursOf("task_overload_alert")).toEqual([0, 0]);
  });

  it("CONTROL: an hour-gated operator rule keeps its own hour", async () => {
    await tickHourly("2026-10-07T04:00:03Z", 24); // Wed 00:00 .. 23:00 EDT
    expect(etHoursOf("workout_reminder")).toEqual([15]);
  });

  it("CONTROL: the window is 08:00 inclusive to 20:00 exclusive, in ET, across DST", () => {
    expect(inCustomerHoursET(new Date("2026-10-11T11:59:59Z"))).toBe(false); // 07:59:59 EDT
    expect(inCustomerHoursET(new Date("2026-10-11T12:00:00Z"))).toBe(true); //  08:00 EDT
    expect(inCustomerHoursET(new Date("2026-10-11T23:59:59Z"))).toBe(true); //  19:59:59 EDT
    expect(inCustomerHoursET(new Date("2026-10-12T00:00:00Z"))).toBe(false); // 20:00 EDT
    expect(inCustomerHoursET(new Date("2026-11-02T12:59:59Z"))).toBe(false); // 07:59:59 EST
    expect(inCustomerHoursET(new Date("2026-11-02T13:00:00Z"))).toBe(true); //  08:00 EST
  });

  it("CUSTOMER_FACING_RULES names real rules, includes the customer email, and sits inside OUTWARD_RULES", () => {
    const rules = listRuleNames().map((r) => r.name);
    expect(CUSTOMER_FACING_RULES.filter((n) => !rules.includes(n)), "names with no rule").toEqual([]);
    expect(CUSTOMER_FACING_RULES).toContain("auto_followup_expired_quote");
    expect(CUSTOMER_FACING_RULES.filter((n) => !OUTWARD_RULES.includes(n)), "not in the pre-flight list").toEqual([]);
    expect(OUTWARD_RULES.filter((n) => !rules.includes(n)), "outward names with no rule").toEqual([]);
  });
});

describe("commitment family · one message per commitment per 6 h", () => {
  it("overdue_commitment_escalation and commitment_checkin cannot both fire for one commitment", async () => {
    // 4 days old (check-in window) AND past its deadline (overdue).
    s.commitments.push({
      id: 7,
      description: "call the supplier",
      status: "active",
      deadline: "2026-10-01",
      createdAt: new Date("2026-10-06T07:00:00Z"),
    });
    await tickAt("2026-10-10T14:00:00Z"); // Sat 10:00 EDT
    const family = s.rows.filter((r) => r.targetType === "commitment" && r.targetId === "7");
    expect(family.map((r) => r.ruleName)).toHaveLength(1);
  });

  it("CONTROL: a different commitment is not suppressed by the first one's row", async () => {
    s.commitments.push(
      { id: 7, description: "a", status: "active", deadline: "2026-10-01", createdAt: new Date("2026-10-06T07:00:00Z") },
      { id: 8, description: "b", status: "active", deadline: "2026-10-01", createdAt: new Date("2026-10-06T07:00:00Z") },
    );
    await tickAt("2026-10-10T14:00:00Z");
    const targets = new Set(s.rows.filter((r) => r.targetType === "commitment").map((r) => r.targetId));
    expect([...targets].sort()).toEqual(["7", "8"]);
  });
});
