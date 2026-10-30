/**
 * The Neon pool keeps a warm socket between the worker's 15-minute ticks (railway-audit, 2026-10-30).
 *
 * Railway logs 07:34-12:55Z: 28 `INSERT INTO "AuditEvent"` at avg 822 ms on a :05/:20/:35/:50
 * rhythm, and `user_preferences` reads up to 4,760 ms. EXPLAIN ANALYZE on Neon put the same
 * user_preferences read at 0.030 ms and the INSERT plan at cost 0.02, so the time was not in
 * Postgres. The pool closed idle sockets after the driver default (30 s,
 * @neondatabase/serverless 1.1.0 `idleTimeoutMillis:3e4`), so the first query after each 15-minute
 * gap re-opened a WebSocket, TLS and auth through the pooler. Prisma's query-event duration
 * includes that wait.
 *
 * Asserts what lib/prisma.ts actually hands the adapter (the consumer), not a constant:
 *  - idleTimeoutMillis outlasts the worker's 15-minute tick;
 *  - the 2026-08-19 bounds (connectionTimeoutMillis, query_timeout) are still passed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const captured: Array<Record<string, unknown>> = [];

vi.mock("@prisma/adapter-neon", () => ({
  PrismaNeon: vi.fn(function (this: unknown, config: Record<string, unknown>) {
    captured.push(config);
  }),
}));
vi.mock("@prisma/client", () => ({
  Prisma: {},
  PrismaClient: class {
    $on() {}
  },
}));
vi.mock("@next/env", () => ({ loadEnvConfig: () => {} }));
vi.mock("@/lib/db/slow-query-tracker", () => ({ recordSlowQuery: () => {} }));

const WORKER_TICK_MS = 15 * 60_000; // apps/worker/src/scheduler.ts: brain-bus-drain, device-heartbeat-sentinel "*/15"

describe("Neon pool config passed by lib/prisma.ts", () => {
  beforeEach(() => {
    captured.length = 0;
    vi.resetModules();
    delete (globalThis as { prisma?: unknown }).prisma;
  });

  it("keeps an idle socket longer than the worker's 15-minute tick, and keeps the existing bounds", async () => {
    await import("@/lib/prisma");
    expect(captured).toHaveLength(1);
    const cfg = captured[0];
    expect(typeof cfg.idleTimeoutMillis).toBe("number");
    expect(cfg.idleTimeoutMillis as number).toBeGreaterThan(WORKER_TICK_MS);
    expect(cfg.connectionTimeoutMillis).toBe(10_000);
    expect(cfg.query_timeout).toBe(30_000);
  });
});
