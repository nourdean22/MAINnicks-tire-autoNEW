/**
 * Wave 4 (job 2026-10-18-bdnick-prune): the business sync posts no customer name, phone or staff
 * note to bdnick.info, through its REAL builder with every source returning identifiers, while
 * the counts still go and the local objects keep the names.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const NAMES = ["Jane Roe", "John Doe", "Maria Stone", "Sam Hill"];
const PHONES = ["2165550101", "2165550102", "2165550103"];
const NOTE = "Left a voicemail for Maria";

const h = vi.hoisted(() => ({
  ci: null as Record<string, unknown> | null,
  posts: [] as Array<{ url: string; body: string }>,
  /** What getOpenDeclinedWorkTotals returns, and how many entries the (capped) ledger returns. */
  open: { openCount: 1, openTotal: 800 } as { openCount: number; openTotal: number },
  openFails: false,
  ledgerLen: 1,
}));

vi.mock("./db", () => ({ getDb: async () => null }));

vi.mock("./services/customerIntelligence", () => ({
  analyzeCustomers: async () => h.ci,
  getCustomerActionPlan: async () => "\nCUSTOMER ACTION PLAN:\n• CALL NOW: John Doe (2165550102) — 170d since last visit.\n• PROTECT: Jane Roe is your #1 spender",
}));

vi.mock("./services/nickIntelligence", () => ({
  analyzeConversionPipeline: async () => ({}),
  projectRevenue: async () => ({}),
  getShopPulse: async () => ({ thisWeek: { walkRate: 0 } }),
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

const MEMORIES = [
  { type: "pattern", content: "FULL CONVERSION: Customer \"Sam Hill\" completed full journey", confidence: 0.9 },
  { type: "insight", content: "VIP customers (3+ visits in 60d): Jane Roe (4 visits, $900)", confidence: 0.8 },
];

vi.mock("./services/featureFlags", () => ({ getAllFlags: async () => [] }));
vi.mock("./services/nickMemory", () => ({
  recall: async () => MEMORIES,
  getTopQuestions: () => [{ topic: "call John Doe", count: 2, lastAsked: "2026-10-19T12:00:00.000Z" }],
  remember: async () => undefined,
}));
vi.mock("./nour-os-bridge", () => ({ getEventAnalytics: () => ({}), getSyncStatus: () => ({}) }));
vi.mock("./services/feedbackLoop", () => ({ detectAnomalies: () => [], getBriefEngagement: () => ({}) }));
vi.mock("./services/eventBus", () => ({
  getActiveJourneys: async () => [{ customer: "Maria Stone", events: ["lead_created", "booking_made"], hoursActive: 5 }],
}));
vi.mock("./services/declinedWorkRecovery", () => ({
  getDeclinedWorkLedger: async () => Array.from({ length: h.ledgerLen }, (_, n) => ({
    workOrderId: `wo-${n + 1}`, orderNumber: `WO-${1001 + n}`, customerName: "Maria Stone", phone: "2165550103",
    vehicle: "2014 Ford F-150", totalDeclinedValue: 800, hasSafetyItems: true,
    declinedItems: [{ description: "Front pads", total: 300, declineReason: "Sam Hill said next payday", safetyRelated: true, outreachAt: null, recoveryMethod: "texted John Doe", recoveryNotes: NOTE, recovered: false }],
  })),
  getOpenDeclinedWorkTotals: async () => {
    if (h.openFails) throw new Error("aggregate read failed");
    return h.open;
  },
}));
vi.mock("./services/declinedWorkSource", () => ({
  declinedWorkSourceState: async () => "measured",
  isMeasured: () => true,
  sourceNote: () => "measured",
  declinedSourceWarning: () => null,
}));
vi.mock("./services/shopDriverMirror", () => ({ checkMirrorHealth: async () => ({ recordsProcessed: 1, details: "ok" }) }));

const CI = {
  totalCustomers: 40, activeCustomers: 12, lapsedCustomers: 10, lostCustomers: 3, newThisMonth: 2,
  avgLifetimeValue: 500, avgTicket: 150, retentionRate: 33, avgVisitsPerCustomer: 2,
  topSpenders: [{ name: "Jane Roe", total: 900, visits: 6 }],
  atRiskCustomers: [{ name: "John Doe", phone: "2165550102", lastVisit: "2026-05-01", daysSince: 170 }],
  servicePatterns: [{ service: "Brakes, Jane Roe 2165550101", count: 9, revenue: 2400 }],
  dayOfWeekPattern: [1, 2, 3, 4, 5, 6, 7], peakHours: new Array(24).fill(0),
};

function stubFetch(): void {
  vi.stubEnv("STATENOUR_SYNC_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: { body: string }) => {
    h.posts.push({ url: String(url), body: String(init.body) });
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  }));
}

function expectNoIdentifiers(body: string): void {
  for (const id of [...NAMES, ...PHONES, NOTE]) expect(body).not.toContain(id);
}

afterEach(() => {
  h.ci = null;
  h.posts = [];
  h.open = { openCount: 1, openTotal: 800 };
  h.openFails = false;
  h.ledgerLen = 1;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("business sync -> /api/sync/business", () => {
  it("posts no customer name, phone or staff note, with every source returning them", async () => {
    h.ci = structuredClone(CI);
    stubFetch();
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    expect(h.posts).toHaveLength(1);
    expectNoIdentifiers(h.posts[0].body);
  });

  it("still posts the counts, ages and totals (control: the blocks are not emptied)", async () => {
    h.ci = structuredClone(CI);
    stubFetch();
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    const body = JSON.parse(h.posts[0].body);
    expect(body.customerIntelligence).toMatchObject({
      available: true, totalCustomers: 40, retentionRate: 33,
      topSpenders: [{ total: 900, visits: 6 }],
      atRiskCustomers: [{ lastVisit: "2026-05-01", daysSince: 170 }],
    });
    expect(body.customerJourneys).toEqual([{ events: ["lead_created", "booking_made"], hoursActive: 5 }]);
    expect(body.declinedWork).toMatchObject({ measured: true, totalRecoverable: 800, customerCount: 1, topItems: [{ orderNumber: "WO-1001", value: 800 }] });
    expect(body.nickAI).toEqual({ memoryCount: 2 });
  });

  it("still fails closed: a refused POST throws, so the cron records a failure, not a completed sync", async () => {
    h.ci = structuredClone(CI);
    vi.stubEnv("STATENOUR_SYNC_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => "forbidden" })));
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await expect(syncToStatenour()).rejects.toThrow(/failed after 3 attempts: 403/);
  });

  it("leaves the local customer data alone: the object nickstire's digest reads keeps the names", async () => {
    h.ci = structuredClone(CI);
    stubFetch();
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    expect(h.ci).toEqual(CI);
  });
});

describe("declinedWork carries the TRUE open totals beside the 10-order subtotal", () => {
  async function declinedBlock(): Promise<Record<string, unknown>> {
    h.ci = structuredClone(CI);
    stubFetch();
    const { syncToStatenour } = await import("./cron/jobs/statenourSync");
    await syncToStatenour();
    return JSON.parse(h.posts[0].body).declinedWork;
  }

  it("sends openCount and openTotal from the uncapped aggregate and flags the sample as capped", async () => {
    h.open = { openCount: 23, openTotal: 4120.5 };
    const dw = await declinedBlock();
    // the existing fields keep their names and meaning: still the sampled ledger rows
    expect(dw).toMatchObject({ measured: true, totalRecoverable: 800, customerCount: 1, openCount: 23, openTotal: 4120.5, capped: true });
  });

  it("capped is false when the sample already holds every open order", async () => {
    h.open = { openCount: 1, openTotal: 800 };
    expect(await declinedBlock()).toMatchObject({ openCount: 1, openTotal: 800, capped: false });
  });

  it("a failed aggregate sends null (UNKNOWN), never 0, and leaves the rest of the block as it was", async () => {
    h.openFails = true;
    const dw = await declinedBlock();
    expect(dw).toMatchObject({ measured: true, totalRecoverable: 800, customerCount: 1, openCount: null, openTotal: null });
    expect((dw.topItems as unknown[]).length).toBe(1);
  });

  it("a failed aggregate beside a FULL 10-order sample is still capped (more may exist)", async () => {
    h.openFails = true;
    h.ledgerLen = 10;
    expect(await declinedBlock()).toMatchObject({ openCount: null, openTotal: null, capped: true });
  });

  it("a failed aggregate beside a short sample is not capped (the sample was not limited)", async () => {
    h.openFails = true;
    h.ledgerLen = 3;
    expect(await declinedBlock()).toMatchObject({ openCount: null, openTotal: null, capped: false });
  });
});
