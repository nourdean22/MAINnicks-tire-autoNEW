/**
 * The "today" these jobs report is the shop's day, not the UTC day.
 *
 * At 2026-10-12 21:00 ET the clock already reads 2026-10-13 01:00Z. statenourSync and
 * intelligenceAutopilot used to compare against CURDATE(), the database session's UTC day, so
 * today's paid work dropped out after 20:00 ET. The two kinds of date column bind differently:
 *   - invoices.invoiceDate and alg_estimates.estimateDate hold the shop's day as stored (ALG dates
 *     land at that day's midnight; timed tickets carry the shop's wall clock). They compare with
 *     the shop's date key, never with a UTC instant.
 *   - createdAt columns are real instants. They compare with Eastern midnight as a UTC instant.
 *
 * The database is a recorder. The SQL each job sends is rendered with the MySQL dialect, and the
 * assertion is on the values that would be bound.
 */
import { afterAll, beforeAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

/**
 * Module mocks are installed for this file only. beforeAll installs them and afterAll removes
 * them, and each test re-imports the jobs against them. Under singleFork a file-scope vi.mock
 * would otherwise stay in the one shared process for every later file.
 */
const MOCKS: Array<[string, () => unknown]> = [
  ["./db", () => ({ getDb: async () => h.db })],
  ["./services/customerIntelligence", () => ({
    analyzeCustomers: async () => null,
    getCustomerActionPlan: async () => "",
  })],
  ["./services/nickIntelligence", () => ({
    analyzeConversionPipeline: async () => ({}),
    projectRevenue: async () => ({}),
    getShopPulse: async () => ({ thisWeek: { walkRate: 0 } }),
    generateProactiveAlerts: async () => [],
    generateWeeklyInsight: async () => "",
    getEstimateLeadFunnelWindows: async () => null,
  })],
  ["./admin-stats", () => ({
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
  })],
  ["./services/featureFlags", () => ({ getAllFlags: async () => [], isEnabled: async () => false })],
  ["./services/nickMemory", () => ({
    recall: async () => [],
    getTopQuestions: async () => [],
    remember: async () => undefined,
  })],
  ["./nour-os-bridge", () => ({ getEventAnalytics: () => ({}), getSyncStatus: () => ({}) })],
  ["./services/feedbackLoop", () => ({ detectAnomalies: () => [], getBriefEngagement: () => ({}) })],
  ["./services/eventBus", () => ({ getActiveJourneys: () => [] })],
  ["./services/declinedWorkRecovery", () => ({ getDeclinedWorkLedger: async () => [] })],
  ["./services/declinedWorkSource", () => ({
    declinedWorkSourceState: async () => "unmeasured",
    isMeasured: () => false,
    sourceNote: () => "unmeasured",
  })],
  ["./services/shopDriverMirror", () => ({
    checkMirrorHealth: async () => ({ recordsProcessed: 0, details: "" }),
    probeAlgEndpoints: async () => [],
  })],
  ["./services/intelligenceEngines", () => ({
    forecastRevenue: async () => ({}),
    generateCrossSellRecommendations: async () => [],
    scoreLeads: async () => [],
    predictCustomerLTV: async () => [],
    analyzeBottlenecks: async () => [],
    analyzeDeclinedWork: async () => null,
    predictChurn: async () => [],
  })],
  ["./services/costDetailCoverage", () => ({ checkCostDetailCoverage: async () => ({ reading: null }) })],
  ["./services/telegram", () => ({
    sendTelegram: async () => undefined,
    sendTelegramMessage: async () => undefined,
  })],
  ["./services/winbackProcessor", () => ({ processWinbackPending: async () => ({}) })],
];

beforeAll(() => {
  for (const [modulePath, factory] of MOCKS) vi.doMock(modulePath, factory);
});

afterAll(() => {
  for (const [modulePath] of MOCKS) vi.doUnmock(modulePath);
  vi.resetModules();
});

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
  vi.resetModules();
  // Only Date is faked: the jobs await real promises.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-13T01:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), text: async () => "" })));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Shop-day keys: invoice dates and estimate dates bind as these strings.
const DAY_OCT_12 = "2026-10-12";
const DAY_OCT_11 = "2026-10-11";
const WEEK_KEY = "2026-10-05";
const FORTNIGHT_KEY = "2026-09-28";
const MONTH_KEY = "2026-10-01";
// createdAt instants: Eastern midnight as UTC.
const SHOP_DAY_OCT_12: [Date, Date] = [new Date("2026-10-12T04:00:00Z"), new Date("2026-10-13T04:00:00Z")];
const WEEK_START = new Date("2026-10-05T04:00:00Z");
const FORTNIGHT_START = new Date("2026-09-28T04:00:00Z");

describe("the shop's 'today' at 2026-10-12 21:00 ET", () => {
  // Each assertion pins the value one query binds, so reverting one query fails its own assertion
  // even when another query in the same job binds a similar value.
  it("statenourSync's day queries bind the shop's date key, so the 21:00 ET invoice is an Oct 12 row", async () => {
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    const dayKeys = paramsOf(/DATE\(invoiceDate\) = \? AND paymentStatus = 'paid'/);
    expect(dayKeys).toContainEqual([DAY_OCT_12]);
    expect(dayKeys).toContainEqual([DAY_OCT_11]);
    // A date key, not an instant: invoiceDate holds the shop's day as stored.
    expect(dayKeys.flat().every((p) => typeof p === "string")).toBe(true);
  });

  it("statenourSync's week and month revenue bind the shop's week and month keys", async () => {
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    const openEnded = paramsOf(/invoiceDate >= \? AND paymentStatus = 'paid'/);
    expect(openEnded).toContainEqual([WEEK_KEY]);
    expect(openEnded).toContainEqual([MONTH_KEY]);
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

  it("statenourSync's trend revenue binds date keys, and its booking queries bind Eastern instants", async () => {
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    // Each SQL shape is matched in full, including the unspaced paymentStatus='paid', so a revert
    // of any one of these binds fails its own line.
    expect(paramsOf(/SUM\(totalAmount\),0\) as rev FROM invoices WHERE invoiceDate >= \? AND paymentStatus='paid'$/)).toEqual([[WEEK_KEY]]);
    expect(paramsOf(/SUM\(totalAmount\),0\) as rev FROM invoices WHERE invoiceDate >= \? AND invoiceDate < \? AND paymentStatus='paid'$/)).toEqual([[FORTNIGHT_KEY, WEEK_KEY]]);
    expect(paramsOf(/FROM bookings WHERE createdAt >= \?$/)).toEqual([[WEEK_START]]);
    expect(paramsOf(/FROM bookings WHERE createdAt >= \? AND createdAt < \?$/)).toEqual([[FORTNIGHT_START, WEEK_START]]);
  });

  it("intelligenceAutopilot's walk-in split binds today's date key, and its bookings bind today's Eastern instants", async () => {
    const { runIntelligenceAutopilot } = await import("./cron/jobs/intelligenceAutopilot");
    await runIntelligenceAutopilot();
    expect(paramsOf(/FROM invoices\s+WHERE DATE\(invoiceDate\) = \? AND paymentStatus = 'paid'/)).toContainEqual([DAY_OCT_12]);
    expect(paramsOf(/FROM bookings\s+WHERE createdAt >= \? AND createdAt < \? AND status IN/)).toContainEqual(SHOP_DAY_OCT_12);
  });

  it("intelligenceAutopilot's seven-day inspection window binds the Oct 5 key", async () => {
    const { runIntelligenceAutopilot } = await import("./cron/jobs/intelligenceAutopilot");
    await runIntelligenceAutopilot();
    expect(paramsOf(/FROM invoices\s+WHERE invoiceDate >= \?\s+AND totalAmount <= 500/)).toContainEqual([WEEK_KEY]);
  });
});
