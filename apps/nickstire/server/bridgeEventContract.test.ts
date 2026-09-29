/**
 * The nickstire -> StateNour bridge contract, bound to config/nickstire-bridge-events.json.
 *
 * The same fixture drives apps/statenour/tests/api/nickstire-bridge-contract.test.ts, which
 * feeds each `data` through StateNour's two receivers. A field renamed on either side goes red
 * in one of the two files. Before this file existed, StateNour's alerts read field names the
 * bridge never sent ("NEW LEAD — Unknown", "JOB COMPLETE — $0"), and estimates rode the
 * invoice event with a constant dedupe key.
 *
 * No network, no file writes: fs is stubbed, fetch is stubbed, and the dispatched event is
 * read back from the bridge's in-memory log (getRecentEvents).
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return { ...actual, appendFileSync: vi.fn(), writeFileSync: vi.fn(), mkdirSync: vi.fn(), existsSync: vi.fn(() => true) };
});

type Entry = {
  type: string;
  adapter: string;
  busTypes: string[];
  input: Record<string, unknown>;
  data: Record<string, unknown>;
};
type Fixture = { notAdapterDriven: Record<string, string>; events: Entry[] };

const FIXTURE_PATH = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "config", "nickstire-bridge-events.json");
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;

// What actually goes over the wire: JSON drops undefined.
const wire = (v: unknown) => JSON.parse(JSON.stringify(v));

type Bridge = typeof import("./nour-os-bridge");
let bridge: Bridge;

beforeEach(async () => {
  // The bridge's 5-minute dedupe map and event log are module state: start each case clean.
  vi.resetModules();
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
  bridge = await import("./nour-os-bridge");
});

function lastEvent() {
  const [evt] = bridge.getRecentEvents(1);
  return evt;
}

describe("nour-os-bridge golden contract (config/nickstire-bridge-events.json)", () => {
  it("covers every NourOsEventType exactly once (an entry, or listed as not adapter-driven)", () => {
    const listed = [...fixture.events.map(e => e.type), ...Object.keys(fixture.notAdapterDriven)];
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual([...bridge.NOUR_OS_EVENT_TYPES].sort());
  });

  it.each(fixture.events.map(e => [e.type, e]))("%s: the on* adapter dispatches exactly the fixture data", async (_t, entry) => {
    const fn = (bridge as unknown as Record<string, (d: unknown) => Promise<void>>)[entry.adapter];
    expect(typeof fn).toBe("function");
    await fn(entry.input);
    const evt = lastEvent();
    expect(evt?.type).toBe(entry.type);
    expect(wire(evt?.data)).toEqual(entry.data);
  });

  const busCases = fixture.events.flatMap(e => e.busTypes.map(b => [b, e] as const));
  it.each(busCases)("event bus %s -> nour-os-bridge dispatches the fixture event", async (busType, entry) => {
    const eb = await import("./services/eventBus");
    const [dest] = (await eb.__routeForTest(busType as never)).filter(d => d.name === "nour-os-bridge");
    await dest.handler({ type: busType as never, data: entry.input, priority: "normal", source: "test", timestamp: "2026-09-29T00:00:00.000Z" });
    const evt = lastEvent();
    expect(evt?.type).toBe(entry.type);
    expect(wire(evt?.data)).toEqual(entry.data);
  });

  it("two distinct estimates are two events (the dedupe key is not constant)", async () => {
    await bridge.onEstimateGenerated({ vehicle: "2010 Test Van", symptom: "squeal", issueCount: 1, source: "ai_estimate_static" });
    await bridge.onEstimateGenerated({ vehicle: "2011 Test Truck", symptom: "shake at speed", issueCount: 1, source: "ai_estimate_static" });
    expect(bridge.getRecentEvents(5).filter(e => e.type === "nickstire:estimate")).toHaveLength(2);
  });

  it("two distinct payments are two revenue events", async () => {
    await bridge.onInvoicePaid({ invoiceNumber: "INV-A", customerName: "Test Customer", totalAmount: 10, method: "card" });
    await bridge.onInvoicePaid({ invoiceNumber: "INV-B", customerName: "Test Customer", totalAmount: 20, method: "card" });
    expect(bridge.getRecentEvents(5).filter(e => e.type === "nickstire:revenue")).toHaveLength(2);
  });

  it("snap-finance invoice_paid shape (invoiceId / name / paymentMethod) still carries amount and customer", async () => {
    await bridge.onInvoicePaid({ invoiceId: 55, totalAmount: 250, paymentMethod: "snap_finance", name: "Test Customer", phone: "2165550199" });
    expect(wire(lastEvent()?.data)).toEqual({ kind: "invoice_paid", invoiceNumber: "55", customer: "Test Customer", totalAmount: 250, method: "snap_finance" });
  });

  // These bus payloads carry no identity the adapter can use; their raw copy reaches StateNour
  // through the statenour-sync destination. The bridge must not ALSO send an empty event whose
  // constant dedupe key would collapse unrelated events.
  it.each([
    ["campaign_sent", { type: "cross-sell-outreach-v2", customerId: 1, phone: "2165550106", service: "alignment", predictionId: "pred-1" }],
    ["stage_changed", { workOrderId: 12, newStatus: "in_progress", changedBy: "tech", note: "started" }],
    ["social_posted", { platforms: ["facebook"], success: true }],
    ["payment_received", { orderNumber: "PO-1", amount: 300, customerName: "Test Customer", cardLast4: "0000" }],
  ])("event bus %s without an identity sends no bridge event", async (busType, data) => {
    const eb = await import("./services/eventBus");
    const route = (await eb.__routeForTest(busType as never)).filter(d => d.name === "nour-os-bridge");
    for (const dest of route) {
      await dest.handler({ type: busType as never, data, priority: "normal", source: "test", timestamp: "2026-09-29T00:00:00.000Z" });
    }
    expect(bridge.getRecentEvents(5)).toHaveLength(0);
  });
});
