/**
 * An online-estimate lead reaches StateNour with its own lead id (audit 2026-09-29).
 *
 * laborEstimate.generate (routers/public.ts) creates a lead when the visitor leaves
 * a name, phone or email, then emits lead_captured. It used to emit `id: 0`. The
 * StateNour bridge dedupes lead events on leadId for 5 minutes
 * (nour-os-bridge.ts pickKeyFields), so the first online-estimate lead got through
 * and every other one inside that window was dropped: no sync event, no lead alert.
 *
 * Part 1 drives the REAL procedure with the db, estimator, ShopDriver push and bus
 * mocked. Part 2 feeds what the router emitted through the REAL bridge routing
 * (fetch stubbed, as eventBus.statenourOnce.test.ts does) and asserts the consumer
 * end: two leads are two POSTs to StateNour.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  nextLeadId: 9101,
  dbAvailable: true,
  inserted: [] as Array<Record<string, unknown>>,
  leadCaptured: vi.fn(),
  pushEstimate: vi.fn(async () => undefined),
}));

vi.mock("./db", () => ({
  getDb: async () =>
    h.dbAvailable
      ? {
          insert: () => ({
            values: (row: Record<string, unknown>) => {
              h.inserted.push(row);
              return { $returningId: async () => [{ id: h.nextLeadId++ }] };
            },
          }),
        }
      : null,
}));

vi.mock("./laborEstimate", () => ({
  generateLaborEstimate: async () => ({
    repairTitle: "Front Brake Pad Replacement",
    lineItems: [],
    grandTotalLow: 180,
    grandTotalHigh: 260,
  }),
}));

vi.mock("./services/shopDriverSync", () => ({ pushEstimate: h.pushEstimate }));

vi.mock("./services/eventBus", () => ({ emit: { leadCaptured: h.leadCaptured } }));

const VISITOR = {
  year: "2012",
  make: "Honda",
  model: "Civic",
  repairDescription: "front brakes grinding",
  customerName: "Test Customer",
  customerPhone: "2165550123",
};

async function submitEstimate(input: Record<string, unknown>) {
  const { laborEstimateRouter } = await import("./routers/public");
  return laborEstimateRouter.createCaller({} as never).generate(input as never);
}

describe("online-estimate lead · the router emits the lead's real id", () => {
  beforeEach(() => {
    h.nextLeadId = 9101;
    h.dbAvailable = true;
    h.inserted.length = 0;
    h.leadCaptured.mockClear();
    h.pushEstimate.mockClear();
  });

  it("two visitors produce two lead_captured events carrying their own inserted ids", async () => {
    await submitEstimate(VISITOR);
    await vi.waitFor(() => expect(h.leadCaptured).toHaveBeenCalledTimes(1));
    await submitEstimate({ ...VISITOR, customerName: "Second Customer", customerPhone: "2165550124" });
    await vi.waitFor(() => expect(h.leadCaptured).toHaveBeenCalledTimes(2));

    const ids = h.leadCaptured.mock.calls.map(([data]) => (data as { id: number }).id);
    expect(ids).toEqual([9101, 9102]);
    expect(h.leadCaptured.mock.calls[0]![0]).toMatchObject({ source: "estimate", name: "Test Customer" });
  });

  it("with no database there is no lead row, so no lead event, and the estimate still reaches ShopDriver", async () => {
    h.dbAvailable = false;
    await submitEstimate(VISITOR);
    await vi.waitFor(() => expect(h.pushEstimate).toHaveBeenCalledTimes(1));
    expect(h.leadCaptured).not.toHaveBeenCalled();
  });

  it("CONTROL: an anonymous estimate creates no lead and emits nothing (unchanged)", async () => {
    const { customerName: _n, customerPhone: _p, ...anonymous } = VISITOR;
    const result = await submitEstimate(anonymous);
    expect(result).toMatchObject({ repairTitle: "Front Brake Pad Replacement" });
    // Give a stray fire-and-forget pipeline the same chance the other cases get.
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(h.inserted).toHaveLength(0);
    expect(h.pushEstimate).not.toHaveBeenCalled();
    expect(h.leadCaptured).not.toHaveBeenCalled();
  });
});

describe("online-estimate lead · the StateNour bridge receives each one", () => {
  const posts: string[] = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    if (String(url).endsWith("/api/sync/events")) posts.push(String(init?.body ?? ""));
    return new Response("{}", { status: 200 });
  });
  const eventsPath = path.join(mkdtempSync(path.join(tmpdir(), "estimate-lead-")), "events.jsonl");

  beforeEach(() => {
    // The bridge reads its env at import time; vitest.config unstubs around every test.
    vi.stubEnv("STATENOUR_SYNC_KEY", "test-key");
    vi.stubEnv("STATENOUR_SYNC_URL", "https://statenour.test");
    vi.stubEnv("NOUR_OS_EVENTS_PATH", eventsPath);
    vi.stubGlobal("fetch", fetchMock);
    posts.length = 0;
    h.nextLeadId = 9201;
    h.dbAvailable = true;
    h.leadCaptured.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function throughTheBridge(data: Record<string, unknown>) {
    await import("./nour-os-bridge");
    const eb = await vi.importActual<typeof import("./services/eventBus")>("./services/eventBus");
    const route = (await eb.__routeForTest("lead_captured")).filter((d) => d.name === "nour-os-bridge");
    expect(route).toHaveLength(1);
    await route[0]!.handler({ type: "lead_captured", data, priority: "high", source: "lead", timestamp: new Date().toISOString() });
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  }

  it("two online-estimate leads a minute apart are two POSTs to StateNour, each with its lead id", async () => {
    await submitEstimate(VISITOR);
    await submitEstimate({ ...VISITOR, customerName: "Second Customer", customerPhone: "2165550124" });
    await vi.waitFor(() => expect(h.leadCaptured).toHaveBeenCalledTimes(2));

    for (const [data] of h.leadCaptured.mock.calls) await throughTheBridge(data as Record<string, unknown>);

    expect(posts).toHaveLength(2);
    expect(posts.map((b) => JSON.parse(b).events[0].data.leadId)).toEqual([9201, 9202]);
  });

  it("CONTROL: two lead events that share an id collapse into one POST (the dedupe the old id: 0 hit)", async () => {
    const base = { name: "Test Customer", phone: "2165550123", source: "estimate", urgencyScore: 3 };
    await throughTheBridge({ ...base, id: 9301 });
    await throughTheBridge({ ...base, id: 9301, name: "Second Customer", phone: "2165550124" });
    expect(posts).toHaveLength(1);
  });
});
