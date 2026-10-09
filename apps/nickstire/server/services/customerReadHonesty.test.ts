/**
 * The customer numbers are on the shop's clock, and a failed at-risk read is said (2026-10-09).
 *
 * Review of the Q-23 wave found three more places a customer number was wrong or silent:
 *   - analyzeNewCustomerVelocity counted "this month" from the UTC month, which turns over at
 *     20:00 ET on the last day: that evening scored "0 new customers this month";
 *   - the alerts and the evening debrief gated on `atRiskCustomers.length > 0`, so a failed
 *     lapsed-customer read (an empty placeholder list) dropped the line without a word;
 *   - (the brief's busiest day / peak hour is covered in customerIntelligenceUnavailable.test.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  execute: vi.fn(),
  customers: null as null | Record<string, unknown>,
}));

vi.mock("../db", () => ({ getDb: async () => ({ execute: h.execute }) }));

/** A drizzle-shaped fake: every builder call returns itself; awaiting it yields one zero row. */
function chain(): unknown {
  const target = () => undefined;
  const proxy: unknown = new Proxy(target, {
    get: (_t, key) =>
      key === "then"
        ? (resolve: (v: unknown) => unknown) => resolve([{ count: 0, total: 0 }])
        : () => proxy,
    apply: () => proxy,
  });
  return proxy;
}
/** The db handle itself must not be thenable (an async db() would resolve it away). */
const handle = new Proxy({}, { get: (_t, key) => (key === "then" ? undefined : () => chain()) });
vi.mock("../lib/db-helper", () => ({ db: async () => handle }));
vi.mock("./customerIntelligence", async (orig) => ({
  ...(await orig<typeof import("./customerIntelligence")>()),
  analyzeCustomers: async () => h.customers,
}));

import { shopMonthBounds } from "./customerStatsRead";
import { analyzeNewCustomerVelocity } from "./engines/growth";
import { generateProactiveAlerts } from "./nickIntelligence";

afterEach(() => {
  vi.useRealTimers();
  h.execute.mockReset();
  h.customers = null;
});

/** Flatten a drizzle sql object's params. */
function params(q: { queryChunks: unknown[] }): unknown[] {
  const out: unknown[] = [];
  const walk = (chunks: unknown[]) => {
    for (const c of chunks) {
      if (c && typeof c === "object" && "queryChunks" in c) walk((c as { queryChunks: unknown[] }).queryChunks);
      else if (!(c && typeof c === "object" && "value" in c)) out.push(c);
    }
  };
  walk(q.queryChunks);
  return out;
}

describe("the shop's month", () => {
  it("is still October at 20:30 ET on Oct 31, when UTC already says November", () => {
    expect(shopMonthBounds(new Date("2026-11-01T00:30:00Z"))).toEqual({
      lastMonthStart: "2026-09-01",
      monthStart: "2026-10-01",
      nextMonthStart: "2026-11-01",
    });
  });

  it("wraps the year both ways", () => {
    expect(shopMonthBounds(new Date("2026-01-15T17:00:00Z")).lastMonthStart).toBe("2025-12-01");
    expect(shopMonthBounds(new Date("2026-12-15T17:00:00Z")).nextMonthStart).toBe("2027-01-01");
  });

  it("analyzeNewCustomerVelocity counts the shop's month, not the UTC month", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-01T00:30:00Z")); // 20:30 EDT, Oct 31
    h.execute.mockResolvedValue([[{ thisMonth: 9, lastMonth: 8, lastYear: 90 }], []]);
    await analyzeNewCustomerVelocity();
    const sent = params(h.execute.mock.calls[0][0]);
    expect(sent).toEqual(["2026-10-01", "2026-11-01", "2026-09-01", "2026-10-01"]);
  });
});

describe("a failed at-risk read is said, not dropped", () => {
  const base = {
    totalCustomers: 900, activeCustomers: 300, lapsedCustomers: 100, lostCustomers: 500, retentionRate: 41,
    avgVisitsPerCustomer: 2, avgTicket: 300, avgLifetimeValue: 600, newThisMonth: 4, topSpenders: [],
    servicePatterns: [], dayOfWeekPattern: [0, 0, 0, 0, 0, 0, 0], peakHours: new Array(24).fill(0),
  };
  // A Wednesday 10:00 ET: none of the day-of-week alert branches fire.
  const WEDNESDAY = new Date("2026-10-07T14:00:00Z");

  it("the proactive alerts say the check did not run", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WEDNESDAY);
    h.customers = { ...base, atRiskCustomers: [], atRiskUnavailable: true };
    const alerts = await generateProactiveAlerts();
    expect(alerts).toContain("⚠️ At-risk customer check did not run: the customer read failed");
  });

  it("control: a readable at-risk list still raises its customer", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(WEDNESDAY);
    h.customers = {
      ...base,
      atRiskCustomers: [{ name: "Dee Lapsed", phone: "2165550100", lastVisit: "2026-03-01", daysSince: 220 }],
    };
    const alerts = await generateProactiveAlerts();
    expect(alerts.some((a) => a.startsWith("💸 AT-RISK CUSTOMER: Dee Lapsed"))).toBe(true);
    expect(alerts.some((a) => a.includes("did not run"))).toBe(false);
  });
});
