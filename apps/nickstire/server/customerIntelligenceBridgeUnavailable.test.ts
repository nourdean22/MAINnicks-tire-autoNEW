/**
 * Q-23 · a failed customer read must not cross the bridge as zeros.
 *
 * analyzeCustomers now marks a failed read `unavailable: true` (see
 * services/customerIntelligenceUnavailable.test.ts). Its two cross-service
 * consumers used to copy the placeholder zeros field by field:
 *   - GET /api/bridge/intelligence served `customers: { total: 0, ... }`;
 *   - the StateNour business sync posted `customerIntelligence:
 *     { totalCustomers: 0, retentionRate: 0, ... }`, which StateNour persists.
 * Both now say the read failed and carry no numbers. A partial failure (the
 * lapsed-customer or booking sub-read) is forwarded as its own marker.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  ci: null as Record<string, unknown> | null,
  fetchBodies: [] as unknown[],
}));

/** No database: every DB-backed block in both consumers takes its own no-DB branch. */
vi.mock("./db", () => ({ getDb: async () => null }));

vi.mock("./services/customerIntelligence", () => ({
  analyzeCustomers: async () => h.ci,
  getCustomerActionPlan: async () => "\nCUSTOMER ACTION PLAN:\n• test plan",
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
    bookings: { total: 1, thisWeek: 0, new: 0, confirmed: 0, completed: 0, cancelled: 0, byService: [] },
    leads: { total: 1, thisWeek: 0, new: 0, contacted: 0, booked: 0, lost: 0, urgent: 0, avgUrgency: 0, bySource: [] },
    chat: { totalSessions: 0, converted: 0, thisWeek: 0 },
    callTracking: { totalCalls: 0, thisWeek: 0, byPage: [] },
    callbacks: { total: 0, new: 0, completed: 0, thisWeek: 0 },
    content: { totalArticles: 0, published: 0 },
    sourceAttribution: { bookingsBySource: [], leadsBySource: [] },
    shopFloor: null,
  }),
  getSiteHealth: async () => ({ indexedPages: 0, notIndexedPages: 0, sheetsConfigured: false }),
}));

// The sync's other blocks each catch their own failure; stub the modules that
// would otherwise pull in timers or LLM clients so only customerIntelligence
// is under test.
vi.mock("./services/featureFlags", () => ({ getAllFlags: async () => [] }));
vi.mock("./services/nickMemory", () => ({ recall: async () => [], getTopQuestions: async () => [], remember: async () => undefined }));
vi.mock("./nour-os-bridge", () => ({ getEventAnalytics: () => ({}), getSyncStatus: () => ({}) }));
vi.mock("./services/feedbackLoop", () => ({ detectAnomalies: () => [], getBriefEngagement: () => ({}) }));
vi.mock("./services/eventBus", () => ({ getActiveJourneys: () => [] }));
vi.mock("./services/declinedWorkRecovery", () => ({ getDeclinedWorkLedger: async () => [] }));
vi.mock("./services/declinedWorkSource", () => ({
  declinedWorkSourceState: async () => "unmeasured",
  isMeasured: () => false,
  sourceNote: () => "unmeasured",
}));
vi.mock("./services/shopDriverMirror", () => ({ checkMirrorHealth: async () => ({ recordsProcessed: 0, details: "" }) }));

const FAILED = {
  totalCustomers: 0, activeCustomers: 0, lapsedCustomers: 0, lostCustomers: 0, newThisMonth: 0,
  avgLifetimeValue: 0, topSpenders: [], atRiskCustomers: [], servicePatterns: [],
  dayOfWeekPattern: [0, 0, 0, 0, 0, 0, 0], peakHours: new Array(24).fill(0),
  retentionRate: 0, avgTicket: 0, avgVisitsPerCustomer: 0, unavailable: true,
};
const MEASURED = {
  ...FAILED,
  unavailable: undefined,
  totalCustomers: 40, activeCustomers: 12, lapsedCustomers: 10, retentionRate: 33,
};

type Handler = (req: unknown, res: unknown) => Promise<void>;

async function bridgeIntelligence(): Promise<Record<string, unknown>> {
  const routes = new Map<string, Handler>();
  const app = {
    get: (p: string, ...fns: Handler[]) => { routes.set(p, fns[fns.length - 1]); },
    post: () => undefined,
    put: () => undefined,
    delete: () => undefined,
    use: () => undefined,
  };
  const { registerBridgeRoutes } = await import("./_core/bridge-routes");
  registerBridgeRoutes(app as never);
  const handler = routes.get("/api/bridge/intelligence");
  if (!handler) throw new Error("route /api/bridge/intelligence not registered");
  let body: unknown;
  const res = { status() { return res; }, json(b: unknown) { body = b; return res; } };
  await handler({}, res);
  return body as Record<string, unknown>;
}

async function syncedCustomerBlock(): Promise<unknown> {
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    h.fetchBodies.push(JSON.parse(init.body));
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  }));
  const { syncToStatenour } = await import("./cron/jobs/statenourSync");
  await syncToStatenour();
  expect(h.fetchBodies).toHaveLength(1);
  return (h.fetchBodies[0] as { customerIntelligence: unknown }).customerIntelligence;
}

afterEach(() => {
  h.ci = null;
  h.fetchBodies = [];
  vi.unstubAllGlobals();
});

describe("GET /api/bridge/intelligence · customers", () => {
  it("a failed customer read is served as an error, not total: 0", async () => {
    h.ci = FAILED;
    const body = await bridgeIntelligence();
    expect(body.customers).toEqual({ error: "customer intelligence read failed — counts unknown, not zero" });
  });

  it("a successful read is served as numbers (control)", async () => {
    h.ci = MEASURED;
    const body = await bridgeIntelligence();
    expect(body.customers).toMatchObject({ total: 40, active: 12, lapsed: 10, retentionRate: 33 });
    expect(body.customers).not.toHaveProperty("atRiskUnavailable");
  });

  it("a failed lapsed-customer sub-read is forwarded, not served as an empty list", async () => {
    h.ci = { ...MEASURED, atRiskUnavailable: true };
    const body = await bridgeIntelligence();
    expect(body.customers).toMatchObject({ total: 40, atRiskCustomers: [], atRiskUnavailable: true });
  });
});

describe("StateNour business sync · customerIntelligence", () => {
  it("a failed customer read is posted as available:false with no numbers", async () => {
    h.ci = FAILED;
    const block = await syncedCustomerBlock();
    expect(block).toEqual({
      available: false,
      reason: "customer intelligence read failed — counts unknown, not zero",
    });
  });

  it("a successful read is posted as numbers (control)", async () => {
    h.ci = MEASURED;
    const block = await syncedCustomerBlock();
    expect(block).toMatchObject({ available: true, totalCustomers: 40, retentionRate: 33 });
    expect(block).not.toHaveProperty("bookingPatternsUnavailable");
  });

  it("a failed booking sub-read is forwarded with the block", async () => {
    h.ci = { ...MEASURED, bookingPatternsUnavailable: true };
    const block = await syncedCustomerBlock();
    expect(block).toMatchObject({ available: true, totalCustomers: 40, bookingPatternsUnavailable: true });
  });
});
