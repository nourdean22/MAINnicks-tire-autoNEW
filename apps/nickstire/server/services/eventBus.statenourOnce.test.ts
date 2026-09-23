/**
 * Q-12 phase 0 (docs/adr/0019-idempotent-bridge-writes.md §9): a bus event reaches
 * statenour's /api/sync/events once, and never less than it did before.
 *
 * Two bus destinations POST there: "nour-os-bridge" (via its typeMap into the REAL
 * nour-os-bridge.ts, driven here with fetch stubbed) and "statenour-sync" (a direct
 * fetch). Before phase 0 both handled "all". A type may leave statenour-sync only when
 * its bridge copy is faithful: distinct events stay distinct (the bridge dedupes on a
 * content hash for 5 min) and the emitter's identifying value reaches statenour. The
 * mis-wired adapters fail that, so those types keep both paths until they are fixed.
 *
 * Handlers are invoked through the real routing (routeFor, which dispatch() uses)
 * instead of dispatch() itself, so Telegram / manager SMS / DB destinations never run.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { BusinessEvent } from "./eventBus";

type Fixture = { data: Record<string, unknown>; mark: string };

// Realistic payloads, shaped like each type's real emitter. `mark` is a value unique to
// the event that must reach statenour if the copy is faithful. `n` makes a distinct event.
const FIXTURES: Record<BusinessEvent, (n: number) => Fixture> = {
  // emit.leadCaptured (routers/lead.ts)
  lead_captured: n => ({ data: { id: 7100 + n, name: `Lead ${n}`, phone: `216555010${n}`, source: "web", urgencyScore: 3 }, mark: `Lead ${n}` }),
  // emit.callbackRequested (routers/callback.ts)
  callback_requested: n => ({ data: { name: `Caller ${n}`, phone: `216555020${n}`, reason: null }, mark: `216555020${n}` }),
  // emit.bookingCreated (routers/booking.ts)
  booking_created: n => ({ data: { id: 7200 + n, name: `Booker ${n}`, phone: `216555030${n}`, service: "brakes", urgency: "normal", refCode: `REF${n}` }, mark: `REF${n}` }),
  // emit.bookingCompleted (routers/booking.ts)
  booking_completed: n => ({ data: { id: 7300 + n, name: `Done ${n}`, service: "tires" }, mark: `Done ${n}` }),
  // emit.tireOrderPlaced (routers/gatewayTire.ts)
  tire_order_placed: n => ({ data: { orderNumber: `TO-${n}`, customerName: `Tire ${n}`, tireBrand: "B", tireModel: "M", quantity: 4, totalAmount: 400 + n }, mark: `TO-${n}` }),
  // emit.invoiceCreated (routers/booking.ts)
  invoice_created: n => ({ data: { invoiceNumber: `INV-${n}`, customerName: `Inv ${n}`, totalAmount: 100 + n, source: "booking" }, mark: `INV-${n}` }),
  // cron/jobs/reviewMonitor.ts
  review_detected: n => ({ data: { rating: 5, reviewText: `great ${n}`, customerName: `Reviewer ${n}` }, mark: `Reviewer ${n}` }),
  // emit.invoicePaid (routers/payments.ts)
  invoice_paid: n => ({ data: { invoiceNumber: `PAID-${n}`, customerName: `Payer ${n}`, totalAmount: 200 + n, method: "card" }, mark: `PAID-${n}` }),
  // emit.paymentReceived
  payment_received: n => ({ data: { orderNumber: `PO-${n}`, amount: 300 + n, customerName: `Pay ${n}`, cardLast4: "4242" }, mark: `PO-${n}` }),
  // emit.estimateGenerated (routers/estimates.ts)
  estimate_generated: n => ({ data: { vehicle: "2012 Civic", symptom: `grinding ${n}`, issueCount: 2, source: "ai_estimate_static" }, mark: `grinding ${n}` }),
  // emit.emergencyRequest (routers/emergency.ts)
  emergency_request: n => ({ data: { name: `Stuck ${n}`, phone: `216555040${n}`, problem: `flat on I-90 ${n}`, urgency: "high" }, mark: `flat on I-90 ${n}` }),
  // cron/jobs/crossSellOutreach.ts
  campaign_sent: n => ({ data: { type: "cross-sell-outreach-v2", customerId: 7400 + n, phone: `216555050${n}`, service: "alignment", predictionId: `pred-${n}` }, mark: `pred-${n}` }),
  // routers/workOrders.ts
  stage_changed: n => ({ data: { workOrderId: 7500 + n, newStatus: "in_progress", changedBy: "tech", note: `stage ${n}` }, mark: `stage ${n}` }),
  // emit.socialPosted (routers/nick/chat.ts)
  social_posted: n => ({ data: { platforms: [`plat-${n}`], success: true }, mark: `plat-${n}` }),
  // not mapped by the bridge
  mirror_synced: n => ({ data: { rows: n, table: `mirror-${n}` }, mark: `mirror-${n}` }),
  data_refreshed: n => ({ data: { what: `refresh-${n}` }, mark: `refresh-${n}` }),
  "social_draft:sync": n => ({ data: { id: `draft-${n}`, content: "hello", status: "pending" }, mark: `draft-${n}` }),
};

const BRIDGE_ONLY: BusinessEvent[] = [
  "lead_captured", "callback_requested", "booking_created", "booking_completed",
  "tire_order_placed", "invoice_created", "review_detected",
];
const SYNC_ONLY: BusinessEvent[] = ["social_draft:sync", "mirror_synced", "data_refreshed"];
// Bridge adapter reads fields these emitters never send (onRevenueMilestone,
// onInvoiceCreated for estimates, onCampaignResult, onStageChanged, onEmergencyRequest).
const MISWIRED_BOTH: BusinessEvent[] = [
  "invoice_paid", "payment_received", "estimate_generated",
  "campaign_sent", "social_posted", "stage_changed", "emergency_request",
];

type Post = { via: "bridge" | "direct"; body: string };
const posts: Post[] = [];
const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
  if (String(url).endsWith("/api/sync/events")) {
    const body = String(init?.body ?? "");
    posts.push({ via: Array.isArray(JSON.parse(body).events) ? "bridge" : "direct", body });
  }
  return new Response("{}", { status: 200 });
});

// The bridge reads its config at import time, so env + fetch are set before any import.
let eb: typeof import("./eventBus");
let caseNo = 0;

async function settle(): Promise<void> {
  // The bus fires the bridge without awaiting it; let its pushes land.
  for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r));
}

async function send(type: BusinessEvent, data: Record<string, unknown>): Promise<void> {
  const route = (await eb.__routeForTest(type)).filter(d => d.name === "nour-os-bridge" || d.name === "statenour-sync");
  for (const dest of route) {
    await dest.handler({ type, data, priority: "normal", source: "test", timestamp: "2026-09-23T00:00:00.000Z" });
  }
  await settle();
}

describe("eventBus -> statenour: once, and never lossy", () => {
  const eventsPath = path.join(mkdtempSync(path.join(tmpdir(), "q12-")), "events.jsonl");
  // vitest.config sets unstubEnvs/unstubGlobals, which clear stubs around every test, so
  // they are re-applied per test. The bridge reads its env at import time: it is imported
  // here, while the stubs are live, and the bus's lazy import then reuses that instance.
  function stub(): void {
    vi.stubEnv("STATENOUR_SYNC_KEY", "test-key");
    vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.test");
    vi.stubEnv("NOUR_OS_EVENTS_PATH", eventsPath);
    vi.stubGlobal("fetch", fetchMock);
  }
  beforeAll(async () => {
    stub();
    await import("../nour-os-bridge");
    eb = await import("./eventBus");
  });
  beforeEach(() => {
    stub();
    posts.length = 0;
    caseNo += 10; // fresh identities per case: the bridge's 5-min dedupe map is module state
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("the three lists cover every bus type exactly once", () => {
    const listed = [...BRIDGE_ONLY, ...SYNC_ONLY, ...MISWIRED_BOTH];
    expect([...listed].sort()).toEqual([...eb.BUSINESS_EVENTS].sort());
    expect(new Set(listed).size).toBe(listed.length);
  });

  it.each(BRIDGE_ONLY.map(t => [t]))("%s: one POST, via the bridge, carrying the event's identity", async type => {
    const f = FIXTURES[type](caseNo);
    await send(type, f.data);
    expect(posts.map(p => p.via)).toEqual(["bridge"]);
    expect(posts[0].body).toContain(f.mark);
  });

  it.each(BRIDGE_ONLY.map(t => [t]))("%s: two distinct events are two POSTs (the bridge dedupe does not merge them)", async type => {
    await send(type, FIXTURES[type](caseNo + 1).data);
    await send(type, FIXTURES[type](caseNo + 2).data);
    expect(posts.map(p => p.via)).toEqual(["bridge", "bridge"]);
  });

  it.each(SYNC_ONLY.map(t => [t]))("%s: one POST, direct, as nickstire:<type> (the only path)", async type => {
    const f = FIXTURES[type](caseNo);
    await send(type, f.data);
    expect(posts.map(p => p.via)).toEqual(["direct"]);
    expect(JSON.parse(posts[0].body).type).toBe(`nickstire:${type}`);
    expect(posts[0].body).toContain(f.mark);
  });

  // Positive control for the rule above, and the stale check for this list: each of these
  // bridge copies loses the event's identity today. When an adapter is fixed, its case
  // here goes red: move the type to BRIDGE_ONLY and drop it from statenour-sync.
  it.each(MISWIRED_BOTH.map(t => [t]))("%s: bridge copy is lossy, so the direct copy is kept", async type => {
    const f = FIXTURES[type](caseNo);
    await send(type, f.data);
    const direct = posts.filter(p => p.via === "direct");
    expect(direct).toHaveLength(1);
    expect(direct[0].body).toContain(f.mark);
    expect(posts.filter(p => p.via === "bridge").some(p => p.body.includes(f.mark))).toBe(false);
  });
});
