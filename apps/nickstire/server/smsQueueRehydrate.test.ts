/**
 * Continuous queue rehydration (2026-07-29, SMS Revenue Agent OS).
 *
 * Boot-only rehydration meant a row that reached status='queued' mid-run
 * (another pod, or stale-'sending' recovery flipping an orphan back) had NO
 * live consumer until the next restart — the in-timer recovery was requeueing
 * rows nothing would ever load. rehydrateQueuedFromDb() is now callable on
 * the drain timer; these tests pin its contract:
 *   1. claims queued rows and loads them into the in-memory queue
 *   2. dedup is by DB id and happens BEFORE the claim (no stranded 'sending')
 *   3. only rows older than the 2-minute claim grace are selected (the
 *      queueForLater dbId-stamp race must not double-load a fresh row)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.unmock("./sms");

let pendingRows: Array<{ id: number; body: string; phone: string }> = [];
let claimCalls = 0;
let whereArgs: unknown[] = [];

vi.mock("./db", () => ({
  getDb: async () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: (arg: unknown) => {
            whereArgs.push(arg);
            return { limit: async () => pendingRows };
          },
        }),
      }),
    }),
    update: () => ({
      set: () => ({
        where: async () => {
          claimCalls++;
          return [{ affectedRows: 1 }, []];
        },
      }),
    }),
    execute: async () => [[]],
  }),
}));

beforeEach(() => {
  vi.resetModules();
  pendingRows = [];
  claimCalls = 0;
  whereArgs = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rehydrateQueuedFromDb", () => {
  it("claims each queued row once and loads it into the in-memory queue", async () => {
    pendingRows = [
      { id: 11, body: "held msg A", phone: "2165550111" },
      { id: 12, body: "held msg B", phone: "2165550112" },
    ];
    const sms = await import("./sms");
    const n = await sms.rehydrateQueuedFromDb();
    expect(n).toBe(2);
    expect(claimCalls).toBe(2);
    expect(sms.getSmsStats().delayedQueueSize).toBe(2);
  });

  it("dedups by DB id BEFORE claiming — a re-run neither double-loads nor strands rows in 'sending'", async () => {
    pendingRows = [{ id: 21, body: "same obligation", phone: "2165550121" }];
    const sms = await import("./sms");

    expect(await sms.rehydrateQueuedFromDb()).toBe(1);
    expect(claimCalls).toBe(1);

    // Second pass returns the SAME row (e.g. stale recovery flipped it back
    // while the in-memory copy still holds it).
    expect(await sms.rehydrateQueuedFromDb()).toBe(0);
    // The dedup fired before the claim — no second UPDATE, no stranded row.
    expect(claimCalls).toBe(1);
    expect(sms.getSmsStats().delayedQueueSize).toBe(1);
  });

  it("two identical texts to the same number are DIFFERENT obligations (id-keyed, not body-keyed)", async () => {
    pendingRows = [
      { id: 31, body: "identical text", phone: "2165550131" },
      { id: 32, body: "identical text", phone: "2165550131" },
    ];
    const sms = await import("./sms");
    const n = await sms.rehydrateQueuedFromDb();
    // The OLD (phone, body) dedup collapsed these to one and stranded the
    // other in 'sending' forever. Both must load now.
    expect(n).toBe(2);
    expect(sms.getSmsStats().delayedQueueSize).toBe(2);
  });

  it("applies the 2-minute claim grace in the WHERE (fresh queueForLater rows are not raced)", async () => {
    const sms = await import("./sms");
    const before = Date.now();
    await sms.rehydrateQueuedFromDb();
    // The where() received an AND of (status='queued', createdAt < NOW-2min).
    // Drizzle's condition object is circular (params reference tables), so
    // walk it cycle-safely collecting Date params — the claim-grace cutoff
    // must be among them, ~2 minutes back.
    const dates: number[] = [];
    const seen = new Set<object>();
    const walk = (v: unknown): void => {
      if (v instanceof Date) { dates.push(v.getTime()); return; }
      if (!v || typeof v !== "object" || seen.has(v)) return;
      seen.add(v);
      for (const inner of Object.values(v as Record<string, unknown>)) walk(inner);
    };
    walk(whereArgs[0]);
    expect(dates.length).toBeGreaterThan(0);
    const cutoff = Math.min(...dates);
    const driftMs = Math.abs(before - 2 * 60_000 - cutoff);
    expect(driftMs).toBeLessThan(10_000);
  });

  it("returns 0 and does not throw when the DB is unavailable", async () => {
    vi.doMock("./db", () => ({ getDb: async () => null }));
    try {
      vi.resetModules();
      const sms = await import("./sms");
      expect(await sms.rehydrateQueuedFromDb()).toBe(0);
    } finally {
      vi.doUnmock("./db");
      vi.resetModules();
    }
  });
});
