/**
 * resetDbConnection() must never end a pool that requests are still using
 * (2026-10-03, Sentry "Pool is closed" / "Connection lost", Sept 27-28).
 *
 * It used to call pool.end() synchronously. mysql2's end() rejects every later
 * getConnection() with "Pool is closed." and quits in-use connections, so a
 * self-healing reset broke unrelated requests that already held the old drizzle
 * handle. The fake pool below models exactly those two mysql2 behaviours.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("./db");

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

const h = vi.hoisted(() => {
  type FakePool = {
    id: number;
    closed: boolean;
    endCalls: number;
    inFlight: Set<Pending>;
    query: (q: unknown) => Promise<unknown>;
    end: () => Promise<void>;
  };
  const pools: FakePool[] = [];
  return { pools };
});

function makePool() {
  const pool = {
    id: h.pools.length + 1,
    closed: false,
    endCalls: 0,
    inFlight: new Set<Pending>(),
    query(_q: unknown): Promise<unknown> {
      if (pool.closed) return Promise.reject(new Error("Pool is closed."));
      return new Promise((resolve, reject) => {
        const p: Pending = {
          resolve: (v) => { pool.inFlight.delete(p); resolve(v); },
          reject: (e) => { pool.inFlight.delete(p); reject(e); },
        };
        pool.inFlight.add(p);
      });
    },
    async end() {
      pool.endCalls++;
      pool.closed = true;
      for (const p of [...pool.inFlight]) p.reject(new Error("Connection lost: The server closed the connection."));
    },
  };
  h.pools.push(pool);
  return pool;
}

vi.mock("mysql2/promise", () => ({ default: { createPool: () => makePool() } }));
vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: (pool: { id: number; query: (q: unknown) => Promise<unknown> }) => ({
    poolId: pool.id,
    execute: (q: unknown) => pool.query(q),
  }),
}));

const savedUrl = process.env.DATABASE_URL;
beforeEach(() => {
  process.env.DATABASE_URL = "mysql://test:3306/db";
  h.pools.length = 0;
  vi.useFakeTimers();
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => {
  if (savedUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedUrl;
});

const settle = (p: Promise<unknown>) =>
  p.then((v) => ({ ok: true as const, v }), (e: Error) => ({ ok: false as const, e: e.message }));

describe("resetDbConnection · in-flight requests survive a reset", () => {
  it("an in-flight query and a query issued after reset on the old handle both succeed", async () => {
    const { getDb, resetDbConnection } = await import("./db");
    const oldDb = await getDb();
    expect(oldDb.poolId).toBe(1);

    const inFlight = settle(oldDb.execute("SELECT notifications"));
    resetDbConnection();
    const duringReset = settle(oldDb.execute("SELECT specials"));

    for (const p of [...h.pools[0].inFlight]) p.resolve([{ ok: 1 }]);

    expect(await inFlight).toEqual({ ok: true, v: [{ ok: 1 }] });
    expect(await duringReset).toEqual({ ok: true, v: [{ ok: 1 }] });
  });

  it("the next getDb() gets a fresh pool, and the retired pool is ended after the grace period", async () => {
    const mod = await import("./db");
    const oldDb = await mod.getDb();
    mod.resetDbConnection();

    const newDb = await mod.getDb();
    expect(newDb.poolId).toBe(2);
    expect(h.pools[0].endCalls).toBe(0);

    // RETIRED_POOL_GRACE_MS in db.ts is 60s.
    await vi.advanceTimersByTimeAsync(59_999);
    expect(h.pools[0].endCalls).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.pools[0].endCalls).toBe(1);
    expect(h.pools[1].endCalls).toBe(0);
    // Control: once retired and ended, the old handle does fail — the fake models mysql2.
    expect(await settle(oldDb.execute("SELECT 1"))).toEqual({ ok: false, e: "Pool is closed." });
  });

  it("reset with no pool yet is a no-op (no timer, no throw)", async () => {
    const { resetDbConnection } = await import("./db");
    expect(() => resetDbConnection()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
