/**
 * DEMO data for the admin v1 fixture lane: a Tuesday afternoon at the shop.
 *
 * Every name, phone and plate here is fictional on purpose: phones are in the
 * NANP 555-01xx fiction block, plates start with FIX, names are invented. No
 * row is copied from production (apps/nickstire/AGENTS.md section 5, PII).
 *
 * Each handler is typed against the real procedure output
 * (inferRouterOutputs<AppRouter>), so `tsc -p tests/e2e/tsconfig.json` fails
 * when a fixture drifts from what the server returns.
 */
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
import { permissionsForAdminRole } from "../../../../shared/adminPermissions";
import { EXPECTED_CAMERAS } from "../../../../shared/cameras";

type Out = inferRouterOutputs<AppRouter>;
type Proc<P extends string> = P extends `${infer A}.${infer B}`
  ? A extends keyof Out
    ? B extends keyof Out[A]
      ? Out[A][B]
      : never
    : never
  : never;

/** Every "router.procedure" name the app serves. */
export type ProcName = {
  [A in keyof Out]: { [B in keyof Out[A]]: `${A & string}.${B & string}` }[keyof Out[A]];
}[keyof Out];

type Handler<P extends string> = (input: unknown, clock: Date) => Proc<P>;

const MIN = 60_000;
const iso = (clock: Date, minutesAgo: number) => new Date(clock.getTime() - minutesAgo * MIN).toISOString();
const at = (clock: Date, minutesAgo: number) => new Date(clock.getTime() - minutesAgo * MIN);
const phone = (n: number) => `(216) 555-01${String(n).padStart(2, "0")}`;

// ── The queue: 2 bookings, 2 leads, 1 callback, 1 owed text, 2 work orders = 8 rows ──

const bookings = (c: Date) => [
  { id: 4101, name: "Rosa Delgado", phone: phone(11), email: null, service: "Tire rotation and balance", vehicle: "2017 Honda CR-V", preferredDate: "2026-10-13", preferredTime: "3:30 PM", message: null, status: "new", priority: "normal", urgency: "routine", referenceCode: "BK-4101", adminNotes: null, stage: null, stageUpdatedAt: null, createdAt: at(c, 95), updatedAt: at(c, 95) },
  { id: 4102, name: "Terrell Washington", phone: phone(12), email: null, service: "Brake inspection", vehicle: "2014 Chevy Malibu", preferredDate: "2026-10-14", preferredTime: "9:00 AM", message: null, status: "new", priority: "high", urgency: "soon", referenceCode: "BK-4102", adminNotes: null, stage: null, stageUpdatedAt: null, createdAt: at(c, 40), updatedAt: at(c, 40) },
  { id: 4099, name: "Glenn Kovac", phone: phone(13), email: null, service: "Oil change", vehicle: "2019 Ford Escape", preferredDate: "2026-10-13", preferredTime: "10:00 AM", message: null, status: "completed", priority: "normal", urgency: "routine", referenceCode: "BK-4099", adminNotes: null, stage: null, stageUpdatedAt: null, createdAt: at(c, 1440), updatedAt: at(c, 200) },
];

const leads = (c: Date) => [
  { id: 7201, name: "Aisha Brooks", email: null, phone: phone(21), vehicle: "2012 Toyota Camry", problem: "Two used tires, 215/60R16", source: "website", status: "new", urgencyScore: 4, callbackId: null, createdAt: at(c, 22), updatedAt: at(c, 22) },
  { id: 7202, name: "Mike Petrovic", email: null, phone: phone(22), vehicle: "2010 Jeep Liberty", problem: "Check engine light", source: "phone", status: "contacted", urgencyScore: 3, callbackId: null, createdAt: at(c, 180), updatedAt: at(c, 60) },
];

const callbacks = (c: Date) => [
  { id: 5301, name: "Linda Nowak", phone: phone(31), reason: "Asked for a price on a front alignment", status: "new", createdAt: at(c, 35), updatedAt: at(c, 35) },
];

const owedTexts = (_c: Date) => [
  { conversationId: 9401, phone: phone(41), customerName: "DeShawn Carter", preview: "Is my Malibu ready yet?", waitingMinutes: 42, overdue: true, texts: 2 },
];

const workOrders = (c: Date) => [
  { id: 8801, orderNumber: "WO-8801", customerId: 3101, vehicleId: null, status: "in_progress", priority: "normal", assignedBay: "2", assignedTech: "Zach", assignedTechId: null, assignedAdvisor: null, diagnosis: null, customerComplaint: "Grinding when braking", internalNotes: null, techNotes: null, serviceDescription: "Front pads and rotors", customerName: "Paul Szabo", customerPhone: phone(51), vehicleYear: 2015, vehicleMake: "Nissan", vehicleModel: "Altima", vehicleVin: null, vehicleMileage: 118400, blockerType: null, blockerNote: null, blockerSince: null, promisedAt: at(c, -60), startedAt: at(c, 70), completedAt: null, pickedUpAt: null, estimatedCompletion: null, actualCompletion: null, quotedTotal: "389.00", partsCost: "160.00", laborCost: "200.00", tax: "29.00", discount: "0.00", total: "389.00", createdAt: at(c, 150), updatedAt: at(c, 20) },
  { id: 8802, orderNumber: "WO-8802", customerId: 3102, vehicleId: null, status: "waiting_parts", priority: "high", assignedBay: "4", assignedTech: "Manny", assignedTechId: null, assignedAdvisor: null, diagnosis: null, customerComplaint: "Tire won't hold air", internalNotes: null, techNotes: null, serviceDescription: "Two new tires, 225/65R17", customerName: "Janet Hruska", customerPhone: phone(52), vehicleYear: 2018, vehicleMake: "Chevrolet", vehicleModel: "Equinox", vehicleVin: null, vehicleMileage: 64200, blockerType: "parts", blockerNote: "Tires due from the distributor at 4 pm", blockerSince: at(c, 50), promisedAt: at(c, -120), startedAt: at(c, 90), completedAt: null, pickedUpAt: null, estimatedCompletion: null, actualCompletion: null, quotedTotal: "312.00", partsCost: "240.00", laborCost: "50.00", tax: "22.00", discount: "0.00", total: "312.00", createdAt: at(c, 120), updatedAt: at(c, 50) },
];

// ── The lot: five cars on property, plates FIX 1001..1005 ──

const lotVisits = (c: Date) =>
  [
    { id: "v-1001", plate: "FIX 1001", arrived: 125, bay: "2", bayAt: 70, state: "IN_BAY" },
    { id: "v-1002", plate: "FIX 1002", arrived: 95, bay: "4", bayAt: 90, state: "IN_BAY" },
    { id: "v-1003", plate: "FIX 1003", arrived: 38, bay: null, bayAt: null, state: "WAITING" },
    { id: "v-1004", plate: "FIX 1004", arrived: 21, bay: null, bayAt: null, state: "WAITING" },
    { id: "v-1005", plate: "FIX 1005", arrived: 9, bay: null, bayAt: null, state: "ON_LOT" },
  ].map((v) => ({
    marks: null,
    markHistory: [],
    visitId: v.id,
    camera: "lot-east",
    state: v.state,
    arrivedAt: iso(c, v.arrived),
    waitStartedAt: iso(c, v.arrived - 2),
    bayEnteredAt: v.bayAt === null ? null : iso(c, v.bayAt),
    bayExitedAt: null,
    departedAt: null,
    onPropertyMinutes: v.arrived,
    sinceFirstSeenMinutes: v.arrived,
    waitMinutes: v.bayAt === null ? v.arrived - 2 : v.arrived - v.bayAt,
    bayMinutes: v.bayAt,
    bay: v.bay,
    preexisting: false,
    entryEvidence: "camera",
    plateStatus: "CONFIRMED",
    plateText: v.plate,
    open: true,
    customerMatch: "NONE",
    estimatedFields: [] as string[],
    cameraPose: null,
    dataClass: "PRODUCTION",
    commissioningRunId: null,
  }));

const departedVisits = (c: Date) =>
  lotVisits(c).slice(0, 2).map((v, i) => ({
    ...v,
    visitId: `v-09${i}`,
    plateText: `FIX 09${i + 1}0`,
    state: "DEPARTED",
    departedAt: iso(c, 200 + i * 30),
    bayExitedAt: iso(c, 210 + i * 30),
  }));

// ── Approvals: three held items ──

const proposals = (c: Date) => [
  { id: "6f1c2d1e-0001-4c55-9b7a-1a2b3c4d5e01", source: "ai", actor: "nick-agent", actionType: "create_callback", entityType: "lead", entityId: "7201", title: "Call Aisha Brooks back about two used tires", payloadJson: { name: "Aisha Brooks", reason: "Two used tires, 215/60R16" }, contextJson: { why: "Web lead 22 minutes old, no reply yet" }, confidence: 82, status: "pending_review", reviewedBy: null, reviewedAt: null, reviewNote: null, executedAt: null, executionResultJson: null, idempotencyKey: null, createdAt: at(c, 18), updatedAt: at(c, 18), downstream: null },
  { id: "6f1c2d1e-0002-4c55-9b7a-1a2b3c4d5e02", source: "ai", actor: "nick-agent", actionType: "create_booking_request", entityType: "callback", entityId: "5301", title: "Book Linda Nowak for a front alignment Wednesday 10 am", payloadJson: { name: "Linda Nowak", service: "Front alignment", preferredDate: "2026-10-14" }, contextJson: { why: "She asked for an alignment price on the callback form" }, confidence: 74, status: "pending_review", reviewedBy: null, reviewedAt: null, reviewNote: null, executedAt: null, executionResultJson: null, idempotencyKey: null, createdAt: at(c, 30), updatedAt: at(c, 30), downstream: null },
  { id: "6f1c2d1e-0003-4c55-9b7a-1a2b3c4d5e03", source: "ai", actor: "nick-agent", actionType: "create_callback", entityType: "lead", entityId: "7202", title: "Follow up with Mike Petrovic on the check engine light", payloadJson: { name: "Mike Petrovic", reason: "Check engine light, no visit booked" }, contextJson: { why: "Contacted 3 hours ago, no booking since" }, confidence: 61, status: "pending_review", reviewedBy: null, reviewedAt: null, reviewNote: null, executedAt: null, executionResultJson: null, idempotencyKey: null, createdAt: at(c, 55), updatedAt: at(c, 55), downstream: null },
];

/** A commissioned camera reporting HEALTHY all day (the shape lot.health builds per camera). */
function healthyCamera(cam: (typeof EXPECTED_CAMERAS)[number], c: Date) {
  const dayStart = new Date("2026-10-13T00:00:00-04:00").getTime();
  return {
    camera: cam.camera,
    label: cam.label,
    role: cam.role,
    healthProfile: cam.healthProfile,
    commissioned: true,
    registered: true,
    state: "HEALTHY" as const,
    facets: { producer: "alive", source: "connected", frames: "fresh", pose: "ok", calibration: "valid", vision: "seeing", auth: "ok", events: "ok", control: "ok", media: "ok", home: "ok", cloud: "ok" } as const,
    reason: "heartbeat 12s ago",
    ageSeconds: 12,
    stateForSeconds: 6 * 3600,
    stability: { dropsToday: 0, transitionsToday: 0 },
    mode: "PRODUCTION" as string | null,
    commissioningRunId: null,
    producer: null,
    source: null,
    vision: null,
    transport: null,
    conversation: null,
    cloud: null,
    openVisits: cam.role === "vehicle_truth" ? 5 : 0,
    timeline: { anchorKnown: true, segments: [{ state: "HEALTHY", fromMs: dayStart, toMs: c.getTime(), open: true, reason: null }], current: { state: "HEALTHY", sinceMs: dayStart, forSeconds: Math.round((c.getTime() - dayStart) / 1000) } },
  };
}

/** getDashboardStats(): the bundle's stats slice and adminDashboard.stats are the same read. */
const dashboardStats = () => ({
  _unavailableCounts: [],
  bookings: { total: 3, new: 2, confirmed: 0, completed: 1, cancelled: 0, thisWeek: 3, byService: [] },
  leads: { total: 2, new: 1, contacted: 1, booked: 0, closed: 0, lost: 0, urgent: 1, thisWeek: 2, bySource: [], avgUrgency: 3.5 },
  content: { totalArticles: 0, published: 0, drafts: 0, rejected: 0, totalNotifications: 0, activeNotifications: 0, generationLogs: 0, recentGenerations: 0 },
  chat: { totalSessions: 0, converted: 0, thisWeek: 0 },
  users: { total: 1, admins: 1 },
  recentActivity: [],
  sourceAttribution: { bookingsBySource: [], leadsBySource: [], callsBySource: [] },
  callTracking: { totalCalls: 6, thisWeek: 6, byPage: [] },
  callbacks: { total: 1, new: 1, completed: 0, thisWeek: 1 },
  memberships: { warning: 0 },
  tires: { new: 0 },
  shopFloor: { invoicesToday: 7, invoicesThisWeek: 12, invoicesThisMonth: 81, revenueToday: 1840, revenueThisWeek: 3120, revenueThisMonth: 21400, dataAsOf: null, avgTicket: 263, estimatesToday: 4, estimatesThisWeek: 9, conversionRate: 0.62, declinedWorkCount: 3, declinedWorkValue: 940, paymentMethods: [], totalCustomers: 0, vipCustomers: 0 },
});

/** getSiteHealth(): its own honest unknowns (0 = "GSC sync required", review numbers fetched elsewhere). */
const siteHealth = () => ({
  domains: ["nickstire.org", "www.nickstire.org"],
  sitemapPageCount: 120,
  totalBlogPosts: 16,
  hardcodedBlogPosts: 6,
  dynamicBlogPosts: 10,
  googleReviewRating: null,
  googleReviewCount: null,
  sheetsConfigured: false,
  sheetsUrl: "",
  indexedPages: 0,
  notIndexedPages: 0,
  crawledNotIndexed: 0,
  discoveredNotIndexed: 0,
});

const ok = { available: true, error: null };

export const HANDLERS = {
  "auth.me": (_i, c) => ({ id: 1, openId: "demo-owner", name: "Demo owner", email: null, loginMethod: "demo", role: "admin", loyaltyPoints: 0, loyaltyTier: "bronze", totalVisits: 0, totalSpent: 0, createdAt: at(c, 60 * 24 * 400), updatedAt: at(c, 60), lastSignedIn: at(c, 60) }),
  "adminSecurity.status": () => ({ mfaRequired: false, adminRole: "owner", permissions: permissionsForAdminRole("owner"), mfaEnabled: false, mfaVerified: true, mfaVerifiedAt: null }),
  "adminSecurity.recentActions": (_i, c) => [
    { reference: "ADM-3301", actor: "demo-owner", action: "lead.contacted", entityType: "admin_action", entityId: "7202", createdAt: at(c, 60) },
  ],
  "adminSecurity.integrationFreshness": (_i, c) => ({ readable: true, source: "alg_probe_log", connected: true, lastSuccessfulAt: at(c, 12), lastAttemptAt: at(c, 12), lastAttemptOutcome: "success", failuresSinceLastSuccess: 0, generatedAt: c }),
  "adminSecurity.queueFeedbackSummary": (_i, c) => ({ readable: true, total: 14, since: iso(c, 60 * 24 * 7), byType: [{ itemType: "booking", keep: 5, less: 2 }, { itemType: "lead", keep: 4, less: 3 }] }),
  "adminDashboard.overviewMediumBundle": (_i, c) => ({
    stats: dashboardStats(),
    bookings: bookings(c),
    leads: leads(c),
    callbacks: callbacks(c),
    health: siteHealth(),
    owedTexts: owedTexts(c),
    callbackServed: {},
    slices: { stats: ok, bookings: ok, leads: ok, callbacks: ok, health: ok, owedTexts: ok, callbackServed: ok },
    anyUnavailable: false,
    unavailableSlices: [],
  }),
  "workOrders.list": (_i, c) => workOrders(c),
  "proposals.counts": () => ({ readable: true, count: 3 }),
  "proposals.list": (_i, c) => proposals(c),
  "proposals.actionTypes": () => [
    { actionType: "create_callback", label: "Create a callback", describe: "Creates a callback request for the crew" },
    { actionType: "create_booking_request", label: "Create a booking request", describe: "Creates a booking request for the front desk" },
  ],
  "lot.now": (_i, c) => ({
    ok: true,
    asOf: c.toISOString(),
    neverIngested: false,
    commissioningVisits: 0,
    truncated: false,
    staleSeconds: 40,
    counts: { onProperty: 5, onLotNotInBay: 3, waitingForBay: 2, inBays: 2, bayUnknown: 0, postService: 0, preexisting: 0, preexistingWaiting: 0, arrivalsToday: 14, passThroughsToday: 3, departuresToday: 9, leftWithoutBay: 1, arrivalTimeUnknown: 0 },
    waits: { oldestWaitMinutes: 36, medianMinutes: 19, p90Minutes: 34, sampleSize: 11 },
    bays: [
      { bay: "1", occupiedMinutes: null },
      { bay: "2", occupiedMinutes: 70 },
      { bay: "3", occupiedMinutes: null },
      { bay: "4", occupiedMinutes: 90 },
    ],
    identity: { plateConfirmed: 5, plateAmbiguous: 0, customerExact: 2, customerConfusable: 0, customerAmbiguous: 0 },
    marks: { available: false, openMarked: 0, customerWaiting: 0, serviceStarted: 0, serviceDone: 0, notAJob: 0, markedShare: null },
  }),
  "lot.activity": (_i, c) => {
    const arrivals = [0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 2, 1, 2, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    return {
      ok: true,
      asOf: c.toISOString(),
      hours: arrivals.map((n, hour) => ({ hour, arrivals: n, passThroughs: hour === 11 || hour === 13 ? 1 : 0, baselineArrivals: hour >= 8 && hour <= 17 ? 2 : 0 })),
      totals: { arrivals: 14, passThroughs: 2, crossings: 16, passThroughShare: 2 / 16 },
      history: { priorDaysWithData: 7, days: [1, 2, 3, 4, 5, 6, 7].map((dayOffset) => ({ dayOffset, arrivals: 18 + (dayOffset % 3) * 3, passThroughs: 2 })) },
    };
  },
  "lot.health": (_i, c) => ({
    ok: true,
    asOf: c.toISOString(),
    thresholds: { heartbeatSeconds: 30, staleAfterSeconds: 60, offlineAfterSeconds: 120, frameStaleAfterSeconds: 15, backlogWarnSeconds: 60, blindInferenceMaxAgeSeconds: 600 },
    windowColumnsStored: true,
    shopOpen: true,
    cameras: EXPECTED_CAMERAS.filter((cam) => cam.commissioned).map((cam) => healthyCamera(cam, c)),
    healthy: 2,
    expected: 2,
    coverage: (() => {
      const openMs = new Date("2026-10-13T08:00:00-04:00").getTime();
      const nowMs = c.getTime();
      const hours = [8, 9, 10, 11, 12, 13, 14].map((hour) => {
        const startMs = openMs + (hour - 8) * 60 * MIN;
        const endMs = Math.min(startMs + 60 * MIN, nowMs);
        const m = Math.round((endMs - startMs) / MIN);
        return { hour, startMs, endMs, elapsedMinutes: m, watchedMinutes: m, unknownMinutes: 0, solarMinutes: 0, pct: 1, pctExpected: 1 };
      });
      const elapsed = hours.reduce((n, h) => n + h.elapsedMinutes, 0);
      return { camera: "sign", weekday: "tuesday", openMs, closeMs: new Date("2026-10-13T18:00:00-04:00").getTime(), nowMs, anchorKnown: true, pct: 1, pctExpected: 1, elapsedMinutes: elapsed, watchedMinutes: elapsed, unknownMinutes: 0, solarMinutes: 0, hours };
    })(),
    transitions: [],
  }),
  "lot.conversations": () => ({ ok: true, conversations: [], visualAvailable: false }),
  "lot.commissioningRuns": () => ({ ok: true, runs: [] }),
  "nourOsBridge.shopFloor": () => ({ active: 2, blocked: 1, overdue: 0, readyForPickup: 0, inProgress: 1, totalValueInProgress: 701, byStatus: { in_progress: 1, waiting_parts: 1 } }),
  "contentAdmin.operationsSignal": () => ({ heldReels: 0, openPublishes: 0, total: 0, unknown: false, videoProviderBlocked: 0 }),
  "adminDashboard.stats": () => dashboardStats(),
  "controlCenter.shopSales": () => ({
    available: true,
    cents: 312_000,
    invoiceCount: 12,
    period: "last_7d",
    window: { fromISO: "2026-10-07", toISO: "2026-10-13", label: "Last 7 days" },
    throughDate: "2026-10-13",
    sync: { state: "ok", lastAt: "2026-10-14T00:00:00.000Z", etDate: "2026-10-13", etTime: "8:00 PM" },
    windowSynced: true,
    basis: "invoice_date",
    grossOrNet: "gross_tax_inclusive",
    definitionVersion: "demo",
    exclusions: { pendingCount: 0, pendingCents: 0, partialCount: 0, partialCentsFullValue: 0, refundedCount: 0, refundedCents: 0, blankInvoiceNumbers: 0 },
    reconciledToShopReport: false,
    caveats: [],
  }),
  // The Billed card asks for a sync once per page load; the fixture says one ran within 30 min.
  "shopdriver.syncOnAdminLoad": () => ({ started: false }),
  "controlCenter.todayPulse": (_i, c) => ({
    available: true,
    declinedWork: { openCount: 3, openCents: 94_000, last30: 11 },
    calls: { last24h: 6, reachedTool24h: 4, abandoned24h: 1, lastCallAt: at(c, 14) },
    revenue: { invoices7d: 12, revenue7dCents: 312_000, throughDate: at(c, 0) },
    obligations: { available: true, open: 0, overdue: 0, overdue4h: 0 },
  }),
  "controlCenter.topMoneyMoves": () => [],
  "dispatch.expectedArrivals": () => [],
  "dispatch.phoneTireDemandToday": () => ({ total: 2, sizes: [{ size: "215/60R16", count: 2, new: 0, used: 2 }], sizeUnknown: 0 }),
  "inspection.list": () => [],
  "inspection.get": () => null,
  "closedLoop.recent": () => ({ measurements: [], total: 0 }),
  "closedLoop.summary": () => ({ lifted: 0, noLift: 0, regression: 0, total: 0, pending: 0 }),
  "promises.listOpen": () => [],
  "sms.gatewayHealth": (_i, c) => ({ configured: true, readable: true, online: true, lastSeen: iso(c, 2), deviceName: "Shop phone", deviceId: "demo-device", ageMinutes: 2 }),
  "smsPerformance.laneHealth": () => ({ windowDays: 7, cron: { readable: true, runs: {} }, sms: { readable: true, byVariant: [] }, holdout: { state: "read", byLane: [] }, holdoutArmed: {} }),
  "vapi.recentCalls": () => ({ success: true, calls: [] }),
  "vehicleData.warrantyIngestFreshness": (_i, c) => ({ ok: true, lastSuccessAt: iso(c, 600), stale: false, armed: true }),
  "intelligence.nextBestActions": () => ({ actions: [] }),
  "lot.visits": (input, c) => {
    const openOnly = (input as { openOnly?: boolean } | undefined)?.openOnly === true;
    return { ok: true, marksAvailable: false, rows: openOnly ? lotVisits(c) : [...lotVisits(c), ...departedVisits(c)] };
  },
} satisfies { [P in ProcName]?: Handler<P> };
