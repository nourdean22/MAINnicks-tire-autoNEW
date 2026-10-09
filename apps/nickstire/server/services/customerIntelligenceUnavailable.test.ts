/**
 * Q-23 · analyzeCustomers says when its read failed.
 *
 * Its catch (and its no-database branch) returned the same zeros as an empty
 * shop, and both text consumers read them as data:
 *   - getCustomerBrief: "Total: 0 ... Retention rate: 0% ... At-risk customers:
 *     None detected ... Churn risk: LOW", injected into Nick AI's context and
 *     the morning brief;
 *   - getCustomerActionPlan: "RETENTION: Only 0% of customers come back", an
 *     instruction built from placeholder zeros.
 * The whole-read failure now carries `unavailable: true` (the predictChurn /
 * predictRepeatVisits marker), and the two sub-reads that already caught their
 * own errors (lapsed customers, booking patterns) carry their own marker so a
 * failed sub-read is "unknown", not "None detected" or "Busiest day: Sun".
 */
import { afterEach, describe, expect, it, vi } from "vitest";

type Step = () => Promise<unknown>;

const h = vi.hoisted(() => ({
  hasDb: true,
  /** One step per d.select() call, consumed in call order. */
  steps: [] as Array<() => Promise<unknown>>,
}));

/** A drizzle-shaped select chain: every builder method returns itself; awaiting it runs the step. */
function selectChain(step: Step) {
  const q: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) q[m] = () => q;
  q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => step().then(resolve, reject);
  return q;
}

vi.mock("../db", () => ({
  getDb: async () =>
    h.hasDb
      ? {
          select: () => {
            const step = h.steps.shift();
            if (!step) throw new Error("test harness: unexpected extra select()");
            return selectChain(step);
          },
        }
      : null,
}));

import { analyzeCustomers, getCustomerActionPlan, getCustomerBrief } from "./customerIntelligence";

const ok = (rows: unknown): Step => () => Promise.resolve(rows);
const fail: Step = () => Promise.reject(new Error("TiDB timeout"));

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/**
 * A healthy read, in analyzeCustomers' select order: total, active, lapsed,
 * new-this-month, paid invoices, lapsed (at-risk) rows, 90-day bookings.
 * Three invoiced customers, one of them a repeat: retention 33%.
 */
function healthy(overrides: Partial<Record<"atRisk" | "bookings", Step>> = {}): Step[] {
  return [
    ok([{ count: 40 }]),
    ok([{ count: 12 }]),
    ok([{ count: 10 }]),
    ok([{ count: 3 }]),
    ok([
      { customerName: "Ann", totalAmount: 30000, serviceDescription: "Brakes" },
      { customerName: "Ann", totalAmount: 10000, serviceDescription: "Oil change" },
      { customerName: "Bo", totalAmount: 20000, serviceDescription: "Tires" },
      { customerName: "Cy", totalAmount: 5000, serviceDescription: "Oil change" },
    ]),
    overrides.atRisk ?? ok([{ firstName: "Dee", lastName: "Lapsed", phone: "2165550100", lastVisit: daysAgo(200) }]),
    overrides.bookings ?? ok([{ createdAt: daysAgo(3) }, { createdAt: daysAgo(10) }]),
  ];
}

/** The first count read throws: Promise.all rejects into the outer catch. */
function wholeReadFails(): Step[] {
  return [fail, ok([{ count: 0 }]), ok([{ count: 0 }]), ok([{ count: 0 }])];
}

afterEach(() => {
  h.hasDb = true;
  h.steps = [];
});

describe("analyzeCustomers · a failed read is not an empty shop", () => {
  it("a failed count/invoice read returns unavailable: true", async () => {
    h.steps = wholeReadFails();
    const r = await analyzeCustomers();
    expect(r.unavailable).toBe(true);
    expect(r.totalCustomers).toBe(0);
  });

  it("no database is a failed read too", async () => {
    h.hasDb = false;
    const r = await analyzeCustomers();
    expect(r.unavailable).toBe(true);
  });

  it("a successful read carries no marker (control)", async () => {
    h.steps = healthy();
    const r = await analyzeCustomers();
    expect(r.unavailable).toBeUndefined();
    expect(r.atRiskUnavailable).toBeUndefined();
    expect(r.bookingPatternsUnavailable).toBeUndefined();
    expect(r).toMatchObject({ totalCustomers: 40, activeCustomers: 12, lapsedCustomers: 10, retentionRate: 33 });
    expect(r.atRiskCustomers.map((c) => c.name)).toEqual(["Dee Lapsed"]);
  });
});

describe("getCustomerBrief · never renders a failed read as confident zeros", () => {
  it("a failed read says UNAVAILABLE, not 'Total: 0 ... Churn risk: LOW'", async () => {
    h.steps = wholeReadFails();
    const brief = await getCustomerBrief();
    expect(brief).toContain("UNAVAILABLE");
    expect(brief).not.toContain("Total: 0");
    expect(brief).not.toContain("Retention rate: 0%");
    expect(brief).not.toContain("None detected");
    expect(brief).not.toContain("Churn risk: LOW");
  });

  it("a successful read renders its numbers (control)", async () => {
    h.steps = healthy();
    const brief = await getCustomerBrief();
    expect(brief).not.toContain("UNAVAILABLE");
    expect(brief).toContain("Total: 40 | Active (90d): 12 | Lapsed: 10");
    expect(brief).toContain("Retention rate: 33%");
    expect(brief).toContain("Dee Lapsed");
  });

  it("a failed lapsed-customer read is unknown, not 'None detected'", async () => {
    h.steps = healthy({ atRisk: fail });
    const r = await analyzeCustomers();
    expect(r.atRiskUnavailable).toBe(true);
    expect(r.unavailable).toBeUndefined();

    h.steps = healthy({ atRisk: fail });
    const brief = await getCustomerBrief();
    expect(brief).toContain("At-risk customers: unknown");
    expect(brief).not.toContain("None detected");
    expect(brief).toContain("Total: 40"); // the rest of the read still renders
  });

  it("a successful empty lapsed read still says 'None detected' (control)", async () => {
    h.steps = healthy({ atRisk: ok([]) });
    const brief = await getCustomerBrief();
    expect(brief).toContain("At-risk customers: None detected");
  });

  it("a failed booking read names no busiest day or peak hour", async () => {
    h.steps = healthy({ bookings: fail });
    const r = await analyzeCustomers();
    expect(r.bookingPatternsUnavailable).toBe(true);
    expect(r.unavailable).toBeUndefined();

    h.steps = healthy({ bookings: fail });
    const brief = await getCustomerBrief();
    expect(brief).toContain("Busiest day / peak hour: unknown");
    expect(brief).not.toContain("Busiest day: Sun");
    expect(brief).not.toContain("Peak hour: 0:00");
  });
});

describe("getCustomerActionPlan · no instruction built from placeholder zeros", () => {
  it("a failed read says the plan is unavailable, not 'Only 0% of customers come back'", async () => {
    h.steps = wholeReadFails();
    const plan = await getCustomerActionPlan();
    expect(plan).toContain("unavailable");
    expect(plan).not.toContain("Only 0%");
    expect(plan).not.toContain("RETENTION");
  });

  it("a successful read still produces its actions (control)", async () => {
    h.steps = healthy();
    const plan = await getCustomerActionPlan();
    expect(plan).toContain("RETENTION: Only 33% of customers come back");
    expect(plan).toContain("CALL NOW: Dee Lapsed");
    expect(plan).not.toContain("unavailable");
  });
});

describe("a MEASURED empty population names no day, no rate and no risk level (2026-10-09)", () => {
  /** A readable shop with customers on file but nothing in any window. */
  function quiet(): Step[] {
    return [ok([{ count: 5 }]), ok([{ count: 0 }]), ok([{ count: 0 }]), ok([{ count: 0 }]), ok([]), ok([]), ok([])];
  }

  it("the brief says so instead of 'Sun / 0:00', 'Retention rate: 0%' and 'Churn risk: LOW'", async () => {
    h.steps = quiet();
    const brief = await getCustomerBrief();
    expect(brief).not.toContain("UNAVAILABLE");
    expect(brief).toContain("Busiest day / peak hour: no bookings in the last 90 days");
    expect(brief).not.toContain("Peak hour: 0:00");
    expect(brief).toContain("Retention rate: no paid invoices to measure it on");
    expect(brief).toContain("Churn risk: no active or lapsed customers to compare");
  });

  it("the plan gives no RETENTION instruction with no paid invoices", async () => {
    h.steps = quiet();
    expect(await getCustomerActionPlan()).not.toContain("RETENTION:");
  });

  it("control: a measured, populated shop still names its day, rate, risk and instruction", async () => {
    h.steps = healthy();
    const brief = await getCustomerBrief();
    expect(brief).toMatch(/Busiest day: \w{3} \| Slowest: \w{3} \| Peak hour: \d+:00/);
    expect(brief).toContain("Retention rate: 33% (customers who came back)");
    expect(brief).toMatch(/Churn risk: (HIGH|MODERATE|LOW)/);
    h.steps = healthy();
    expect(await getCustomerActionPlan()).toContain("RETENTION: Only 33% of customers come back");
  });
});

describe("the brief and plan on the shop's clock, and the plan on a failed at-risk read (2026-10-09)", () => {
  it("buckets a booking by its New York day and hour (21:30 EDT Friday, 01:30Z Saturday)", async () => {
    h.steps = healthy({ bookings: ok([{ createdAt: new Date("2026-10-10T01:30:00Z") }]) });
    const r = await analyzeCustomers();
    expect(r.dayOfWeekPattern).toEqual([0, 0, 0, 0, 0, 1, 0]);
    expect(r.peakHours[21]).toBe(1);
    expect(r.peakHours[1]).toBe(0);
  });

  it("the plan says the at-risk list is unknown when its read failed", async () => {
    h.steps = healthy({ atRisk: fail });
    const plan = await getCustomerActionPlan();
    expect(plan).toContain("AT-RISK: unknown");
    expect(plan).not.toContain("CALL NOW");
  });
});
