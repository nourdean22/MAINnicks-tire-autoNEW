/**
 * Stale-holder lock sweep (2026-10-10; heartbeat after the same day's review).
 *
 * Two prompt-evolution runs died when a deploy replaced the container mid-run
 * and their cron locks stayed held for the full TTL. The first sweep deleted
 * every lock whose holder was another replica, which also deletes the live
 * lock of the OLD container during a slow deploy overlap (a double fire).
 * Pins: a holder heartbeats its locks by token from its first acquire; the
 * sweep deletes only locks whose heartbeat is stale, never one this process
 * holds, and re-checks staleness in the DELETE; nothing without a replica id
 * (local); a DB error logs and does nothing; the scheduler arms it at startup
 * and it repeats every minute; the timers never keep the process alive.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { sliceBlock } from "../testUtils/sourceBlock";

vi.mock("../lib/logger", () => {
  const l: Record<string, unknown> = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
  l.child = () => l;
  return { createLogger: () => l };
});
const dbRef = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("../db", () => ({ getDb: async () => dbRef.current }));

import { acquireCronLock } from "./index";
import {
  heartbeatHeldLocks,
  LOCK_HEARTBEAT_MS,
  LOCK_STALE_AFTER_SECONDS,
  releaseLocksOfDeadHolders,
  scheduleStaleHolderSweep,
  STALE_HOLDER_SWEEP_DELAY_MS,
} from "./lockLiveness";

type Row = { name: string; holder: string; lock_token: string };

/**
 * A db whose execute answers a SELECT with `rows` (or, for acquireCronLock's
 * ownership read, the token its INSERT wrote) and records every statement's
 * text + params.
 */
function fakeDb(rows: Row[] = [], affected = 1) {
  const calls: Array<{ text: string; params: unknown[] }> = [];
  let inserted: unknown = null;
  const db = {
    execute: vi.fn(async (q: { queryChunks?: unknown[] }) => {
      const chunks = (q?.queryChunks ?? []) as unknown[];
      // drizzle: a StringChunk carries `value: string[]`; a bound value is a Param (`value`) or the raw primitive.
      const isText = (c: unknown): c is { value: string[] } => !!c && typeof c === "object" && Array.isArray((c as { value?: unknown }).value);
      // sql.raw(...) arrives as a nested SQL whose only chunk is text: render it inline, as the driver does.
      const isRaw = (c: unknown): c is { queryChunks: Array<{ value: string[] }> } => !!c && typeof c === "object" && Array.isArray((c as { queryChunks?: unknown }).queryChunks);
      const text = chunks.map((c) => (isText(c) ? c.value.join("") : isRaw(c) ? c.queryChunks.map((x) => x.value.join("")).join("") : "?")).join("").replace(/\s+/g, " ").trim();
      const params = chunks.filter((c) => !isText(c) && !isRaw(c)).map((c) => (c && typeof c === "object" && "value" in (c as object) ? (c as { value: unknown }).value : c));
      calls.push({ text, params });
      if (text.startsWith("INSERT")) inserted = params[1];
      if (text.startsWith("SELECT lock_token")) return [[{ lock_token: inserted, holder: "me:1" }]];
      return text.startsWith("SELECT") ? [rows] : [{ affectedRows: affected }];
    }),
  };
  return { db: db as never, calls };
}

describe("heartbeat", () => {
  it("an acquired lock is touched by its own token, and the first acquire arms an unref'd 30 s heartbeat", async () => {
    const { db, calls } = fakeDb();
    dbRef.current = db;
    const spy = vi.spyOn(globalThis, "setInterval");
    try {
      const lock = await acquireCronLock("heartbeat-probe", 60_000);
      expect(lock.status).toBe("acquired");
      const armed = spy.mock.calls.filter((c) => c[1] === LOCK_HEARTBEAT_MS);
      expect(armed).toHaveLength(1);
      const handle = spy.mock.results[spy.mock.calls.indexOf(armed[0])]?.value as { hasRef?: () => boolean; unref?: () => void } | undefined;
      if (handle && typeof handle.hasRef === "function") expect(handle.hasRef()).toBe(false);
      await acquireCronLock("heartbeat-probe-2", 60_000);
      expect(spy.mock.calls.filter((c) => c[1] === LOCK_HEARTBEAT_MS)).toHaveLength(1); // armed once per process
      const token = (lock as { token: string }).token;
      calls.length = 0;
      expect(await heartbeatHeldLocks({ db })).toBe(2);
      expect(calls.map((c) => c.text)).toEqual([
        "UPDATE cron_locks SET locked_at = NOW() WHERE name = ? AND lock_token = ?",
        "UPDATE cron_locks SET locked_at = NOW() WHERE name = ? AND lock_token = ?",
      ]);
      expect(calls[0].params).toEqual(["heartbeat-probe", token]);
    } finally {
      for (const r of spy.mock.results) clearInterval(r.value as never);
      spy.mockRestore();
      dbRef.current = null;
    }
  });
});

describe("releaseLocksOfDeadHolders", () => {
  it("deletes only locks whose heartbeat is stale, by token, re-checking staleness in the DELETE, whoever holds them", async () => {
    const { db, calls } = fakeDb([
      { name: "prompt-evolution-weekly", holder: "e857eb33-57ca-4045-8eb8-565d811bac28:30", lock_token: "t-dead-1" },
      { name: "reel-pipeline", holder: "11111111-2222-4333-8444-555555555555:7", lock_token: "t-dead-2" },
    ]);
    const r = await releaseLocksOfDeadHolders({ replicaId: "11111111-2222-4333-8444-555555555555", db });
    expect(r.released).toEqual([
      { name: "prompt-evolution-weekly", holder: "e857eb33-57ca-4045-8eb8-565d811bac28:30" },
      { name: "reel-pipeline", holder: "11111111-2222-4333-8444-555555555555:7" },
    ]);
    // Liveness is the heartbeat: no holder-name rule (a live old container or a second replica keeps beating).
    expect(calls[0].text).toContain("locked_until > NOW()");
    expect(calls[0].text).toContain(`locked_at < DATE_SUB(NOW(), INTERVAL ${LOCK_STALE_AFTER_SECONDS} SECOND)`);
    expect(calls[0].text).not.toContain("holder NOT LIKE");
    expect(calls[0].params).toEqual([]);
    expect(calls.slice(1).map((c) => c.text)).toEqual([
      `DELETE FROM cron_locks WHERE name = ? AND lock_token = ? AND locked_at < DATE_SUB(NOW(), INTERVAL ${LOCK_STALE_AFTER_SECONDS} SECOND)`,
      `DELETE FROM cron_locks WHERE name = ? AND lock_token = ? AND locked_at < DATE_SUB(NOW(), INTERVAL ${LOCK_STALE_AFTER_SECONDS} SECOND)`,
    ]);
    expect(calls[1].params).toEqual(["prompt-evolution-weekly", "t-dead-1"]);
  });

  it("a holder that beat between the read and the DELETE keeps its lock and is not reported", async () => {
    const { db } = fakeDb([{ name: "reel-pipeline", holder: "old:1", lock_token: "t" }], 0);
    expect((await releaseLocksOfDeadHolders({ replicaId: "r1", db })).released).toEqual([]);
  });

  it("never deletes a lock this process holds, even with a stale-looking beat", async () => {
    const mine = fakeDb();
    dbRef.current = mine.db;
    try {
      const lock = await acquireCronLock("held-here", 60_000);
      const token = (lock as { token: string }).token;
      const { db, calls } = fakeDb([{ name: "held-here", holder: "me:1", lock_token: token }]);
      expect((await releaseLocksOfDeadHolders({ replicaId: "r1", db })).released).toEqual([]);
      expect(calls.filter((c) => c.text.startsWith("DELETE"))).toHaveLength(0);
    } finally {
      dbRef.current = null;
    }
  });

  it("nothing to release is a quiet no-op; no replica id (local) never queries; a DB error logs and does nothing", async () => {
    const clean = fakeDb([]);
    expect((await releaseLocksOfDeadHolders({ replicaId: "r1", db: clean.db })).released).toEqual([]);
    expect(clean.calls).toHaveLength(1);

    const local = fakeDb([{ name: "x", holder: "other:1", lock_token: "t" }]);
    expect((await releaseLocksOfDeadHolders({ replicaId: undefined, db: local.db })).released).toEqual([]);
    expect(local.calls).toHaveLength(0);

    const broken = { execute: vi.fn(async () => { throw new Error("db down (test)"); }) } as never;
    await expect(releaseLocksOfDeadHolders({ replicaId: "r1", db: broken })).resolves.toEqual({ released: [] });
  });

  it("the scheduler arms the sweep at startup: first pass two minutes after boot, then every minute, unref'd", () => {
    const src = readFileSync(resolve(__dirname, "scheduler.ts"), "utf8");
    const block = sliceBlock(src, "export function startTieredScheduler(): void {", "for (const tier of tiers)", { label: "scheduler.ts startTieredScheduler" });
    expect(block).toContain("scheduleStaleHolderSweep()");
    expect(STALE_HOLDER_SWEEP_DELAY_MS).toBe(120_000);

    vi.useFakeTimers();
    try {
      const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
      const intervalSpy = vi.spyOn(globalThis, "setInterval");
      scheduleStaleHolderSweep(5_000);
      scheduleStaleHolderSweep(5_000); // armed once per process
      expect(timeoutSpy.mock.calls.filter((c) => c[1] === 5_000)).toHaveLength(1);
      expect(intervalSpy.mock.calls.filter((c) => c[1] === 60_000)).toHaveLength(0);
      vi.advanceTimersByTime(5_000);
      expect(intervalSpy.mock.calls.filter((c) => c[1] === 60_000)).toHaveLength(1);
      timeoutSpy.mockRestore();
      intervalSpy.mockRestore();
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
