/**
 * tRPC call telemetry (2026-10-23, usage telemetry). Nothing recorded which procedures the UI calls, so
 * "what does Nour use inside a page" had no data. A middleware on the base procedure writes ONE
 * system_metrics row per call: metric "trpc.call", value = duration ms, source "trpc", tags
 * { procedure, type, ok, code?, batch }. Appendix E query 3 reads exactly those keys. No input, output,
 * error message or header is recorded. The write is fire-and-forget: a dead sink must not fail or slow a
 * user call, and must not be silent either (one rate-limited ErrorLog row naming the procedure).
 *
 * Driven through the REAL appRouter (paths are the router's own) and, for the batch tag, through the
 * real fetch handler + createTRPCContext. Assertions read what prisma was asked to STORE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/lib/trpc/root";
import { createTRPCContext } from "@/lib/trpc/context";

vi.mock("@/lib/feature-flags", () => ({
  getFlag: () => ({ key: "NICK_MUTATION_LOCK", isOn: false }),
  FLAG_REGISTRY: [],
  getAllFlags: () => [],
  loadFeatureFlagOverrides: vi.fn().mockResolvedValue(undefined),
}));

const { prismaMock, deleteTask } = vi.hoisted(() => ({
  prismaMock: {
    systemMetric: { create: vi.fn() },
    errorLog: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  deleteTask: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/services/tasks", () => ({ deleteTask, listMissions: vi.fn().mockResolvedValue([]) }));

const SESSION = { id: "operator-1", email: "operator@statenour.local", role: "operator" };
const caller = (extra: Record<string, unknown> = {}) =>
  appRouter.createCaller({ session: SESSION, db: prismaMock as never, ...extra });

type Row = { metric: string; value: number; unit: string; source: string; tags: Record<string, unknown> };
const rows = (): Row[] => prismaMock.systemMetric.create.mock.calls.map((c) => c[0].data as Row);
/** Fire-and-forget writes land after the call resolves; let them settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.useRealTimers();
  prismaMock.systemMetric.create.mockReset().mockResolvedValue({ id: "m1" });
  prismaMock.errorLog.create.mockReset().mockResolvedValue({ id: "e1" });
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" });
  deleteTask.mockReset().mockResolvedValue({ id: "task-1" });
});

describe("one row per call, named by the router path", () => {
  it("a successful mutation writes metric trpc.call with the procedure path and ok:true", async () => {
    await caller().brain.pageTabVisit({ page: "/brain", tab: "memory" });
    await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ metric: "trpc.call", unit: "ms", source: "trpc" });
    expect(rows()[0].tags).toEqual({ procedure: "brain.pageTabVisit", type: "mutation", ok: true, batch: 1 });
    expect(typeof rows()[0].value).toBe("number");
    expect(rows()[0].value).toBeGreaterThanOrEqual(0);
  });

  it("a batch of two writes two rows, one per procedure, error marked on the one that threw", async () => {
    deleteTask.mockRejectedValue(new Error("boom: SECRET-ROW-TEXT"));
    const c = caller({ batchSize: 2 });
    const results = await Promise.allSettled([c.brain.pageTabVisit({ page: "/brain", tab: "memory" }), c.task.delete({ id: "task-1" })]);
    await settle();
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    const byProc = Object.fromEntries(rows().map((r) => [r.tags.procedure as string, r.tags]));
    expect(Object.keys(byProc).sort()).toEqual(["brain.pageTabVisit", "task.delete"]);
    expect(byProc["brain.pageTabVisit"]).toMatchObject({ ok: true, batch: 2 });
    expect(byProc["task.delete"]).toMatchObject({ ok: false, code: "INTERNAL_SERVER_ERROR", batch: 2 });
  });

  it("an unauthenticated call is recorded too (the middleware sits outside the auth gate)", async () => {
    await expect(appRouter.createCaller({ session: null, db: prismaMock as never }).task.delete({ id: "task-1" })).rejects.toThrow();
    await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].tags).toMatchObject({ procedure: "task.delete", ok: false, code: "UNAUTHORIZED" });
  });
});

describe("public procedures are measured too", () => {
  it("system.pushVapidKey (publicProcedure, a query, no session) writes a row typed query", async () => {
    await appRouter.createCaller({ session: null, db: prismaMock as never }).system.pushVapidKey();
    await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].tags).toEqual({ procedure: "system.pushVapidKey", type: "query", ok: true, batch: 1 });
  });
});

describe("what is NOT recorded", () => {
  it("no input, no error message, no header: only the five tag keys", async () => {
    deleteTask.mockRejectedValue(new Error("boom: SECRET-ROW-TEXT"));
    await caller({ headers: new Headers({ cookie: "SECRET-COOKIE" }) })
      .task.delete({ id: "SECRET-INPUT-ID" })
      .catch(() => {});
    await caller().brain.pageTabVisit({ page: "/brain?q=SECRET-QUERY", tab: "SECRET-TAB" });
    await settle();
    expect(rows()).toHaveLength(2); // positive control: both calls WERE recorded, so the absences below mean something
    const stored = JSON.stringify(prismaMock.systemMetric.create.mock.calls);
    for (const s of ["SECRET-ROW-TEXT", "SECRET-COOKIE", "SECRET-INPUT-ID", "SECRET-QUERY", "SECRET-TAB"]) expect(stored).not.toContain(s);
    for (const r of rows()) expect(Object.keys(r.tags).every((k) => ["procedure", "type", "ok", "code", "batch"].includes(k))).toBe(true);
  });
});

describe("a dead telemetry sink never fails a user call", () => {
  it("the procedure still returns its result when the metric write rejects, and the failure is logged once with the procedure name", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-01-01T00:00:00Z")); // past any earlier test's rate-limit window
    prismaMock.systemMetric.create.mockRejectedValue(new Error("metrics table gone"));
    const c = caller();
    await expect(c.brain.pageTabVisit({ page: "/brain", tab: "a" })).resolves.toBeDefined();
    await expect(c.brain.pageTabVisit({ page: "/brain", tab: "b" })).resolves.toBeDefined();
    await expect(c.brain.pageTabVisit({ page: "/brain", tab: "c" })).resolves.toBeDefined();
    await vi.advanceTimersByTimeAsync(0);
    await new Promise((r) => setImmediate(r));
    expect(prismaMock.errorLog.create).toHaveBeenCalledTimes(1);
    const logged = prismaMock.errorLog.create.mock.calls[0][0].data;
    expect(logged.message).toContain("trpc-telemetry");
    expect(logged.context).toMatchObject({ procedure: "brain.pageTabVisit" });
    // a minute later the next failure is reported again
    vi.setSystemTime(new Date("2031-01-01T00:01:01Z"));
    await c.brain.pageTabVisit({ page: "/brain", tab: "d" });
    await new Promise((r) => setImmediate(r));
    expect(prismaMock.errorLog.create).toHaveBeenCalledTimes(2);
  });

  it("a synchronous throw in the sink (table missing from the client) is also contained", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2032-01-01T00:00:00Z"));
    prismaMock.systemMetric.create.mockImplementation(() => {
      throw new Error("client has no such model");
    });
    await expect(caller().brain.pageTabVisit({ page: "/brain", tab: "a" })).resolves.toBeDefined();
    expect(prismaMock.systemMetric.create).toHaveBeenCalledTimes(1); // the sink WAS reached and threw
  });

  it("a sink that never settles does not delay the call", async () => {
    prismaMock.systemMetric.create.mockReturnValue(new Promise(() => {}));
    const t0 = Date.now();
    await caller().brain.pageTabVisit({ page: "/brain", tab: "a" });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(prismaMock.systemMetric.create).toHaveBeenCalledTimes(1); // the sink WAS reached and hung
  });
});

describe("recordTrpcCall contains a sink that misbehaves in ways a promise rejection does not", () => {
  const CALL = { procedure: "x.y", type: "query", ok: true, ms: 3, batch: 1 };

  it("a sink that throws synchronously does not throw out of recordTrpcCall", async () => {
    vi.resetModules();
    vi.doMock("@/lib/services/metrics", () => ({
      recordMetricStrict: () => {
        throw new Error("sync sink failure");
      },
    }));
    const { recordTrpcCall } = await import("@/lib/trpc/call-telemetry");
    expect(() => recordTrpcCall(CALL)).not.toThrow();
    vi.doUnmock("@/lib/services/metrics");
  });

  it("a sink that returns a non-promise does not throw out of recordTrpcCall either", async () => {
    vi.resetModules();
    vi.doMock("@/lib/services/metrics", () => ({ recordMetricStrict: () => undefined }));
    const { recordTrpcCall } = await import("@/lib/trpc/call-telemetry");
    expect(() => recordTrpcCall(CALL)).not.toThrow();
    vi.doUnmock("@/lib/services/metrics");
  });
});

describe("batch size comes from the HTTP batch, through the real context", () => {
  afterEach(() => vi.useRealTimers());

  it("a POST batch of two mutations is two rows tagged batch 2, named by the URL's procedure list", async () => {
    const req = new Request("http://localhost/api/trpc/brain.pageTabVisit,task.delete?batch=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "0": { page: "/brain", tab: "memory" }, "1": { id: "task-1" } }),
    });
    const res = await fetchRequestHandler({ endpoint: "/api/trpc", req, router: appRouter, createContext: (o) => createTRPCContext(o) });
    expect(res.status).toBe(200);
    await settle();
    expect(rows().map((r) => r.tags).sort((a, b) => String(a.procedure).localeCompare(String(b.procedure)))).toEqual([
      { procedure: "brain.pageTabVisit", type: "mutation", ok: true, batch: 2 },
      { procedure: "task.delete", type: "mutation", ok: true, batch: 2 },
    ]);
  });

  it("a single (unbatched) call is batch 1", async () => {
    const req = new Request("http://localhost/api/trpc/brain.pageTabVisit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ page: "/brain", tab: "memory" }),
    });
    await fetchRequestHandler({ endpoint: "/api/trpc", req, router: appRouter, createContext: (o) => createTRPCContext(o) });
    await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].tags.batch).toBe(1);
  });
});
