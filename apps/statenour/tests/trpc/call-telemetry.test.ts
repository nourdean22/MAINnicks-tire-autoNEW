/**
 * tRPC call telemetry (2026-10-23, usage telemetry; aggregated after the pre-PR review). A middleware on
 * the base procedure counts every call in memory per (procedure, type, ok, code) and ONE createMany per
 * minute per process writes the buckets to system_metrics: metric "trpc.call", value = total ms of the
 * bucket, source "trpc", tags { procedure, type, ok, code?, count, max_ms }. One insert per call would have
 * been 17,280 rows a day per 5-second poller against a table that gets about 460 rows a day in all, and
 * would have queued on the 10-slot Prisma pool beside the user's own queries. Appendix E query 3 reads
 * exactly those keys. No input, output, error message, header or URL is recorded. A dead sink must not
 * fail or delay a user call, and must not be silent either (one ErrorLog row per failed flush).
 *
 * Driven through the REAL appRouter (paths are the router's own) and, for the HTTP batch, the real fetch
 * handler + createTRPCContext. Assertions read what prisma was asked to STORE.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { appRouter } from "@/lib/trpc/root";
import { createTRPCContext } from "@/lib/trpc/context";
import { flushTrpcTelemetry, recordTrpcCall } from "@/lib/trpc/call-telemetry";

vi.mock("@/lib/feature-flags", () => ({
  getFlag: () => ({ key: "NICK_MUTATION_LOCK", isOn: false }),
  FLAG_REGISTRY: [],
  getAllFlags: () => [],
  loadFeatureFlagOverrides: vi.fn().mockResolvedValue(undefined),
}));

const { prismaMock, deleteTask } = vi.hoisted(() => ({
  prismaMock: {
    systemMetric: { createMany: vi.fn() },
    errorLog: { create: vi.fn() },
    auditEvent: { create: vi.fn() },
  },
  deleteTask: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/services/tasks", () => ({ deleteTask, listMissions: vi.fn().mockResolvedValue([]) }));

const SESSION = { id: "operator-1", email: "operator@statenour.local", role: "operator" };
const caller = () => appRouter.createCaller({ session: SESSION, db: prismaMock as never });

type Row = { metric: string; value: number; unit: string; source: string; tags: Record<string, unknown> };
const writes = () => prismaMock.systemMetric.createMany.mock.calls.length;
const rows = (): Row[] => prismaMock.systemMetric.createMany.mock.calls.flatMap((c) => c[0].data as Row[]);
const byProc = () => Object.fromEntries(rows().map((r) => [`${r.tags.procedure}|${r.tags.ok}`, r]));
const minute = () => vi.advanceTimersByTimeAsync(60_000);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  prismaMock.systemMetric.createMany.mockReset().mockResolvedValue({ count: 1 });
  prismaMock.errorLog.create.mockReset().mockResolvedValue({ id: "e1" });
  prismaMock.auditEvent.create.mockReset().mockResolvedValue({ id: "a1" });
  deleteTask.mockReset().mockResolvedValue({ id: "task-1" });
  await flushTrpcTelemetry(); // drain anything an earlier test left in the buckets
  prismaMock.systemMetric.createMany.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("aggregated, off the response path", () => {
  it("a call writes nothing while it runs; one row per bucket lands when the minute is up", async () => {
    await caller().brain.pageTabVisit({ page: "/brain", tab: "memory" });
    expect(writes()).toBe(0);
    await minute();
    expect(writes()).toBe(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ metric: "trpc.call", unit: "ms", source: "trpc" });
    expect(rows()[0].tags).toMatchObject({ procedure: "brain.pageTabVisit", type: "mutation", ok: true, count: 1 });
    expect(Object.keys(rows()[0].tags).sort()).toEqual(["count", "max_ms", "ok", "procedure", "type"]);
  });

  it("50 calls inside a minute are at most ONE write, and the aggregated count is 50", async () => {
    const c = caller();
    for (let i = 0; i < 50; i++) await c.brain.pageTabVisit({ page: "/brain", tab: "memory" });
    await minute();
    expect(writes()).toBe(1);
    expect(rows()).toHaveLength(1);
    expect(rows()[0].tags.count).toBe(50);
  });

  it("a quiet minute writes nothing at all", async () => {
    await minute();
    await minute();
    expect(writes()).toBe(0);
  });

  it("the next minute starts fresh buckets: counts do not accumulate across flushes", async () => {
    await caller().brain.pageTabVisit({ page: "/brain", tab: "a" });
    await minute();
    await caller().brain.pageTabVisit({ page: "/brain", tab: "b" });
    await caller().brain.pageTabVisit({ page: "/brain", tab: "c" });
    await minute();
    expect(rows().map((r) => r.tags.count)).toEqual([1, 2]);
  });
});

describe("what a bucket holds", () => {
  it("value is the total ms, count the calls, max_ms the slowest", async () => {
    for (const ms of [10, 30, 20]) recordTrpcCall({ procedure: "x.y", type: "query", ok: true, ms });
    await minute();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].value).toBe(60);
    expect(rows()[0].tags).toEqual({ procedure: "x.y", type: "query", ok: true, count: 3, max_ms: 30 });
  });

  it("a NaN or negative duration counts as 0 ms instead of poisoning the bucket total", async () => {
    recordTrpcCall({ procedure: "x.y", type: "query", ok: true, ms: Number.NaN });
    recordTrpcCall({ procedure: "x.y", type: "query", ok: true, ms: -5 });
    recordTrpcCall({ procedure: "x.y", type: "query", ok: true, ms: 7 });
    await minute();
    expect(rows()[0].value).toBe(7);
    expect(rows()[0].tags).toMatchObject({ count: 3, max_ms: 7 });
  });

  it("an error with no code is still its own bucket, apart from the successes of that procedure", async () => {
    recordTrpcCall({ procedure: "x.y", type: "query", ok: true, ms: 1 });
    recordTrpcCall({ procedure: "x.y", type: "query", ok: false, ms: 1 });
    await minute();
    expect(rows().map((r) => [r.tags.ok, r.tags.count]).sort()).toEqual([[false, 1], [true, 1]].sort());
  });

  it("ok and error calls of one procedure are separate buckets, the error carries its code", async () => {
    recordTrpcCall({ procedure: "x.y", type: "query", ok: true, ms: 1 });
    recordTrpcCall({ procedure: "x.y", type: "query", ok: false, code: "UNAUTHORIZED", ms: 2 });
    recordTrpcCall({ procedure: "x.y", type: "query", ok: false, code: "UNAUTHORIZED", ms: 2 });
    recordTrpcCall({ procedure: "x.y", type: "query", ok: false, code: "BAD_REQUEST", ms: 2 });
    await minute();
    expect(rows().map((r) => [r.tags.ok, r.tags.code ?? null, r.tags.count]).sort()).toEqual(
      [[false, "BAD_REQUEST", 1], [false, "UNAUTHORIZED", 2], [true, null, 1]].sort(),
    );
  });

  it("through the real router: a batch of two is two buckets named by the router path, error marked on the throw", async () => {
    deleteTask.mockRejectedValue(new Error("boom: SECRET-ROW-TEXT"));
    const c = caller();
    const results = await Promise.allSettled([c.brain.pageTabVisit({ page: "/brain", tab: "memory" }), c.task.delete({ id: "task-1" })]);
    await minute();
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(Object.keys(byProc()).sort()).toEqual(["brain.pageTabVisit|true", "task.delete|false"]);
    expect(byProc()["task.delete|false"].tags).toMatchObject({ code: "INTERNAL_SERVER_ERROR", count: 1 });
  });

  it("an unauthenticated call is recorded too (the middleware sits outside the auth gate)", async () => {
    await expect(appRouter.createCaller({ session: null, db: prismaMock as never }).task.delete({ id: "task-1" })).rejects.toThrow();
    await minute();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].tags).toMatchObject({ procedure: "task.delete", ok: false, code: "UNAUTHORIZED" });
  });

  it("public procedures are measured too (system.pushVapidKey, a query, no session)", async () => {
    await appRouter.createCaller({ session: null, db: prismaMock as never }).system.pushVapidKey();
    await minute();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].tags).toMatchObject({ procedure: "system.pushVapidKey", type: "query", ok: true, count: 1 });
  });

  it("an HTTP batch of two mutations is two buckets, named by the URL's procedure list", async () => {
    const req = new Request("http://localhost/api/trpc/brain.pageTabVisit,task.delete?batch=1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ "0": { page: "/brain", tab: "memory" }, "1": { id: "task-1" } }),
    });
    const res = await fetchRequestHandler({ endpoint: "/api/trpc", req, router: appRouter, createContext: (o) => createTRPCContext(o) });
    expect(res.status).toBe(200);
    await minute();
    expect(Object.keys(byProc()).sort()).toEqual(["brain.pageTabVisit|true", "task.delete|true"]);
  });
});

describe("what is NOT recorded", () => {
  it("no input, no error message, no header: only the six tag keys", async () => {
    deleteTask.mockRejectedValue(new Error("boom: SECRET-ROW-TEXT"));
    await appRouter
      .createCaller({ session: SESSION, db: prismaMock as never, headers: new Headers({ cookie: "SECRET-COOKIE" }) })
      .task.delete({ id: "SECRET-INPUT-ID" })
      .catch(() => {});
    await caller().brain.pageTabVisit({ page: "/brain?q=SECRET-QUERY", tab: "SECRET-TAB" });
    await minute();
    expect(rows()).toHaveLength(2); // positive control: both calls WERE recorded, so the absences below mean something
    const stored = JSON.stringify(prismaMock.systemMetric.createMany.mock.calls);
    for (const s of ["SECRET-ROW-TEXT", "SECRET-COOKIE", "SECRET-INPUT-ID", "SECRET-QUERY", "SECRET-TAB"]) expect(stored).not.toContain(s);
    for (const r of rows()) expect(Object.keys(r.tags).every((k) => ["procedure", "type", "ok", "code", "count", "max_ms"].includes(k))).toBe(true);
  });
});

describe("a dead telemetry sink never fails or delays a user call, and is not silent", () => {
  it("a failed flush logs once with the procedure names and DROPS the bucket: nothing is retried or kept", async () => {
    prismaMock.systemMetric.createMany.mockRejectedValue(new Error("metrics table gone"));
    const c = caller();
    await expect(c.brain.pageTabVisit({ page: "/brain", tab: "a" })).resolves.toBeDefined();
    await minute();
    expect(writes()).toBe(1);
    expect(prismaMock.errorLog.create).toHaveBeenCalledTimes(1);
    const logged = prismaMock.errorLog.create.mock.calls[0][0].data;
    expect(logged.message).toContain("trpc-telemetry");
    expect(logged.context).toMatchObject({ procedures: ["brain.pageTabVisit"] });
    // the bucket is gone: a quiet minute does not retry it, and a new call starts at count 1
    await minute();
    expect(writes()).toBe(1);
    prismaMock.systemMetric.createMany.mockResolvedValue({ count: 1 });
    await c.brain.pageTabVisit({ page: "/brain", tab: "b" });
    await minute();
    expect(writes()).toBe(2);
    expect(prismaMock.systemMetric.createMany.mock.calls[1][0].data[0].tags.count).toBe(1);
  });

  it("a createMany that throws synchronously is contained, and the flush resolves", async () => {
    prismaMock.systemMetric.createMany.mockImplementation(() => {
      throw new Error("client has no such model");
    });
    await caller().brain.pageTabVisit({ page: "/brain", tab: "a" });
    await expect(flushTrpcTelemetry()).resolves.toBeUndefined();
    expect(writes()).toBe(1); // the sink WAS reached and threw
    expect(prismaMock.errorLog.create).toHaveBeenCalledTimes(1);
  });

  it("a flush that never settles does not delay the call, and the next minute still flushes the next bucket", async () => {
    prismaMock.systemMetric.createMany.mockReturnValueOnce(new Promise(() => {}));
    const t0 = Date.now();
    await caller().brain.pageTabVisit({ page: "/brain", tab: "a" });
    expect(Date.now() - t0).toBe(0);
    await minute();
    expect(writes()).toBe(1); // the sink WAS reached and hung
    await caller().brain.pageTabVisit({ page: "/brain", tab: "b" });
    await minute();
    expect(writes()).toBe(2);
  });

  it("recordTrpcCall itself never throws, whatever it is handed", () => {
    expect(() => recordTrpcCall(undefined as never)).not.toThrow();
    expect(() => recordTrpcCall({ procedure: "x.y", type: "query", ok: true, ms: Number.NaN })).not.toThrow();
  });
});

describe("process exit", () => {
  const KEY = Symbol.for("statenour.trpcTelemetry.sigterm");

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[KEY];
  });

  it("registers ONE SIGTERM drain however many calls are recorded, and the drain flushes the open buckets", async () => {
    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[KEY];
    // Isolate: take the runner's own SIGTERM listeners away so ours is the only one, then put them back.
    const stash = process.listeners("SIGTERM");
    process.removeAllListeners("SIGTERM");
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const fresh = await import("@/lib/trpc/call-telemetry");
      fresh.recordTrpcCall({ procedure: "x.y", type: "query", ok: true, ms: 1 });
      fresh.recordTrpcCall({ procedure: "x.y", type: "query", ok: true, ms: 1 });
      const added = process.listeners("SIGTERM");
      expect(added).toHaveLength(1);

      process.removeListener("SIGTERM", added[0]); // what once() does when the signal arrives
      added[0]("SIGTERM");
      await vi.advanceTimersByTimeAsync(0);
      expect(writes()).toBe(1);
      expect(prismaMock.systemMetric.createMany.mock.calls[0][0].data[0].tags.count).toBe(2);
      // nobody else handles SIGTERM, so default termination is restored (re-raised), not swallowed
      expect(kill).toHaveBeenCalledWith(process.pid, "SIGTERM");
    } finally {
      kill.mockRestore();
      process.removeAllListeners("SIGTERM");
      for (const l of stash) process.on("SIGTERM", l as NodeJS.SignalsListener);
    }
  });

  it("when another SIGTERM handler exists the drain flushes but does not re-raise the signal", async () => {
    vi.resetModules();
    delete (globalThis as Record<symbol, unknown>)[KEY];
    const stash = process.listeners("SIGTERM");
    process.removeAllListeners("SIGTERM");
    const other = () => {};
    process.on("SIGTERM", other);
    const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
    try {
      const fresh = await import("@/lib/trpc/call-telemetry");
      fresh.recordTrpcCall({ procedure: "x.y", type: "query", ok: true, ms: 1 });
      const ours = process.listeners("SIGTERM").find((l) => l !== other)!;
      process.removeListener("SIGTERM", ours);
      ours("SIGTERM");
      await vi.advanceTimersByTimeAsync(0);
      expect(writes()).toBe(1);
      expect(kill).not.toHaveBeenCalled();
    } finally {
      kill.mockRestore();
      process.removeAllListeners("SIGTERM");
      for (const l of stash) process.on("SIGTERM", l as NodeJS.SignalsListener);
    }
  });
});
