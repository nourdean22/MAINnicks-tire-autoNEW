/**
 * The "today" these jobs report is the shop's day, not the UTC day.
 *
 * At 2026-10-12 21:00 ET the clock already reads 2026-10-13 01:00Z. statenourSync
 * (revenue rollup and trends) and intelligenceAutopilot (walk-in split and estimate
 * conversion) used to compare against CURDATE(), which is the database session's
 * UTC day, so today's paid work dropped out after 20:00 ET. Both must bind the
 * Eastern date they computed as a query parameter instead.
 *
 * The database is a recorder. The SQL each job sends is rendered with the MySQL
 * dialect, and the assertion is on the values that would be bound.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const h = vi.hoisted(() => {
  const state = { executed: [] as unknown[] };
  const chain = (rows: unknown[] = []) => {
    const c: Record<string, unknown> = {};
    for (const m of ["from", "where", "orderBy", "limit", "groupBy", "leftJoin", "innerJoin", "having"]) {
      c[m] = () => c;
    }
    c.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(rows).then(res, rej);
    return c;
  };
  const db = {
    execute: async (q: unknown) => {
      state.executed.push(q);
      return [[]];
    },
    select: () => chain(),
    update: () => ({ set: () => ({ where: async () => ({ affectedRows: 0 }) }) }),
    insert: () => ({ values: async () => ({ insertId: 0 }) }),
  };
  return { state, db };
});

vi.mock("./db", () => ({ getDb: async () => h.db }));
vi.mock("./services/customerIntelligence", () => ({
  analyzeCustomers: async () => null,
  getCustomerActionPlan: async () => "",
}));
vi.mock("./services/nickIntelligence", () => ({
  analyzeConversionPipeline: async () => ({}),
  projectRevenue: async () => ({}),
  getShopPulse: async () => ({ thisWeek: { walkRate: 0 } }),
  generateProactiveAlerts: async () => [],
  generateWeeklyInsight: async () => "",
  getEstimateLeadFunnelWindows: async () => null,
}));
vi.mock("./admin-stats", () => ({
  getDashboardStats: async () => ({
    bookings: { total: 0, thisWeek: 0, new: 0, confirmed: 0, completed: 0, cancelled: 0, byService: [] },
    leads: { total: 0, thisWeek: 0, new: 0, contacted: 0, booked: 0, lost: 0, urgent: 0, avgUrgency: 0, bySource: [] },
    chat: { totalSessions: 0, converted: 0, thisWeek: 0 },
    callTracking: { totalCalls: 0, thisWeek: 0, byPage: [] },
    callbacks: { total: 0, new: 0, completed: 0, thisWeek: 0 },
    content: { totalArticles: 0, published: 0 },
    sourceAttribution: { bookingsBySource: [], leadsBySource: [] },
    shopFloor: null,
  }),
  getSiteHealth: async () => ({ indexedPages: 0, notIndexedPages: 0, sheetsConfigured: false }),
}));
vi.mock("./services/featureFlags", () => ({ getAllFlags: async () => [], isEnabled: async () => false }));
vi.mock("./services/nickMemory", () => ({
  recall: async () => [],
  getTopQuestions: async () => [],
  remember: async () => undefined,
}));
vi.mock("./nour-os-bridge", () => ({ getEventAnalytics: () => ({}), getSyncStatus: () => ({}) }));
vi.mock("./services/feedbackLoop", () => ({ detectAnomalies: () => [], getBriefEngagement: () => ({}) }));
vi.mock("./services/eventBus", () => ({ getActiveJourneys: () => [] }));
vi.mock("./services/declinedWorkRecovery", () => ({ getDeclinedWorkLedger: async () => [] }));
vi.mock("./services/declinedWorkSource", () => ({
  declinedWorkSourceState: async () => "unmeasured",
  isMeasured: () => false,
  sourceNote: () => "unmeasured",
}));
vi.mock("./services/shopDriverMirror", () => ({
  checkMirrorHealth: async () => ({ recordsProcessed: 0, details: "" }),
  probeAlgEndpoints: async () => [],
}));
vi.mock("./services/intelligenceEngines", () => ({
  forecastRevenue: async () => ({}),
  generateCrossSellRecommendations: async () => [],
  scoreLeads: async () => [],
  predictCustomerLTV: async () => [],
  analyzeBottlenecks: async () => [],
  analyzeDeclinedWork: async () => null,
  predictChurn: async () => [],
}));
vi.mock("./services/costDetailCoverage", () => ({ checkCostDetailCoverage: async () => ({ reading: null }) }));
vi.mock("./services/telegram", () => ({
  sendTelegram: async () => undefined,
  sendTelegramMessage: async () => undefined,
}));
vi.mock("./services/winbackProcessor", () => ({ processWinbackPending: async () => ({}) }));

/** The bound values of every executed query whose rendered SQL matches the pattern. */
function paramsOf(pattern: RegExp): unknown[][] {
  return h.state.executed
    .map((q) => new MySqlDialect().sqlToQuery(q as SQL))
    .filter((r) => pattern.test(r.sql))
    .map((r) => r.params.map(asInstant));
}

/** A bound UTC "YYYY-MM-DD HH:MM:SS" text as its instant. A bare date stays a string, so a date-only bind never equals an instant. */
function asInstant(p: unknown): unknown {
  if (typeof p === "string" && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(p)) return new Date(`${p.replace(" ", "T")}Z`);
  return p;
}

beforeEach(() => {
  h.state.executed = [];
  // Only Date is faked: the jobs await real promises.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T01:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** True when the instant falls inside the [start, end) pair a query bound. */
function falls(instant: Date, bound: unknown[]): boolean {
  const [start, end] = bound;
  return start instanceof Date && end instanceof Date && instant >= start && instant < end;
}

/** A paid invoice at 2026-10-13 01:00Z: 2026-10-12 21:00 EDT, still the Oct 12 shop day. */
const PAID_AT_9PM_ET_OCT_12 = new Date("2026-10-13T01:00:00Z");
const SHOP_DAY_OCT_11: [Date, Date] = [new Date("2026-10-11T04:00:00Z"), new Date("2026-10-12T04:00:00Z")];
const SHOP_DAY_OCT_12: [Date, Date] = [new Date("2026-10-12T04:00:00Z"), new Date("2026-10-13T04:00:00Z")];
/** Seven and fourteen days back from Oct 12, at Eastern midnight (EDT). */
const WEEK_START = new Date("2026-10-05T04:00:00Z");
const FORTNIGHT_START = new Date("2026-09-28T04:00:00Z");

describe("the shop's 'today' at 2026-10-12 21:00 ET", () => {
  // Each assertion pins the instant pair one query binds, so reverting one query
  // fails its own assertion even when another query in the same job binds a similar range.
  it("statenourSync's day queries bind Eastern day ranges, and the 21:00 ET invoice lands on Oct 12 only", async () => {
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    const dayBounds = paramsOf(/invoiceDate >= \? AND invoiceDate < \? AND paymentStatus = 'paid'/);
    // Raw sql() must bind UTC text: a Date would be formatted in the process zone by mysql2.
    const rawDayBinds = h.state.executed
      .map((q) => new MySqlDialect().sqlToQuery(q as SQL))
      .filter((r) => /invoiceDate >= \? AND invoiceDate < \? AND paymentStatus = 'paid'/.test(r.sql))
      .flatMap((r) => r.params);
    expect(rawDayBinds).toHaveLength(4);
    expect(rawDayBinds.every((p) => typeof p === "string")).toBe(true);
    expect(dayBounds).toContainEqual(SHOP_DAY_OCT_12);
    expect(dayBounds).toContainEqual(SHOP_DAY_OCT_11);
    expect(dayBounds.filter((b) => falls(PAID_AT_9PM_ET_OCT_12, b))).toEqual([SHOP_DAY_OCT_12]);
  });

  it("statenourSync's week and month revenue start at Eastern midnight of those days", async () => {
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    const openEnded = paramsOf(/invoiceDate >= \? AND paymentStatus = 'paid'/);
    expect(openEnded).toContainEqual([new Date("2026-10-05T04:00:00Z")]);
    expect(openEnded).toContainEqual([new Date("2026-10-01T04:00:00Z")]);
  });

  it("statenourSync's lead trend windows start at Eastern midnight, seven and fourteen days back", async () => {
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    expect(paramsOf(/FROM leads WHERE createdAt >= \?$/)).toContainEqual([new Date("2026-10-05T04:00:00Z")]);
    expect(paramsOf(/FROM leads WHERE createdAt >= \? AND createdAt < \?$/)).toContainEqual([
      new Date("2026-09-28T04:00:00Z"),
      new Date("2026-10-05T04:00:00Z"),
    ]);
  });

  it("statenourSync's trend revenue and booking queries each bind their own week windows", async () => {
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    // Each SQL shape is matched in full, including the unspaced paymentStatus='paid', so a
    // revert of any one of these binds fails its own line.
    expect(paramsOf(/SUM\(totalAmount\),0\) as rev FROM invoices WHERE invoiceDate >= \? AND paymentStatus='paid'$/)).toEqual([[WEEK_START]]);
    expect(paramsOf(/SUM\(totalAmount\),0\) as rev FROM invoices WHERE invoiceDate >= \? AND invoiceDate < \? AND paymentStatus='paid'$/)).toEqual([[FORTNIGHT_START, WEEK_START]]);
    expect(paramsOf(/FROM bookings WHERE createdAt >= \?$/)).toEqual([[WEEK_START]]);
    expect(paramsOf(/FROM bookings WHERE createdAt >= \? AND createdAt < \?$/)).toEqual([[FORTNIGHT_START, WEEK_START]]);
  });

  it("intelligenceAutopilot's walk-in split binds today's Eastern day range, and the 21:00 ET invoice lands on Oct 12", async () => {
    const { runIntelligenceAutopilot } = await import("./cron/jobs/intelligenceAutopilot");
    await runIntelligenceAutopilot();
    const walkIns = paramsOf(/FROM invoices\s+WHERE invoiceDate >= \? AND invoiceDate < \? AND paymentStatus = 'paid'/);
    expect(walkIns).toContainEqual(SHOP_DAY_OCT_12);
    expect(walkIns.filter((b) => falls(PAID_AT_9PM_ET_OCT_12, b))).toEqual([SHOP_DAY_OCT_12]);
    expect(paramsOf(/FROM bookings\s+WHERE createdAt >= \? AND createdAt < \? AND status IN/)).toContainEqual(SHOP_DAY_OCT_12);
  });

  it("intelligenceAutopilot's estimate counts bind the seven-day start on both the pending and the paid branch", async () => {
    const { runIntelligenceAutopilot } = await import("./cron/jobs/intelligenceAutopilot");
    await runIntelligenceAutopilot();
    expect(paramsOf(/COUNT\(CASE WHEN paymentStatus = 'pending' AND invoiceDate >= \? THEN 1 END\) as estimates,\s+COUNT\(CASE WHEN paymentStatus = 'paid' AND invoiceDate >= \? THEN 1 END\) as closed\s+FROM invoices/)).toEqual([[WEEK_START, WEEK_START]]);
  });

  it("intelligenceAutopilot's seven-day inspection window starts at Eastern midnight, Oct 5", async () => {
    const { runIntelligenceAutopilot } = await import("./cron/jobs/intelligenceAutopilot");
    await runIntelligenceAutopilot();
    expect(paramsOf(/FROM invoices\s+WHERE invoiceDate >= \?\s+AND totalAmount <= 500/)).toContainEqual([
      new Date("2026-10-05T04:00:00Z"),
    ]);
  });
});
