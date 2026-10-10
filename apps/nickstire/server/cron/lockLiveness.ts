/**
 * Cron lock liveness (2026-10-10): the registry of locks this process holds,
 * the heartbeat that proves the holder alive, and the sweep that releases the
 * locks of a holder that stopped beating. Split from cron/index.ts so that
 * registry keeps scheduling nothing (cronControlPlane.test.ts canary): these
 * timers schedule no job, they only keep cron_locks honest.
 */
import { createLogger } from "../lib/logger";

const log = createLogger("cron");

/**
 * Locks this process currently holds, by job name and token (acquireCronLock
 * adds, releaseCronLock removes), so shutdown can hand them back and the
 * heartbeat can touch them.
 *
 * A deploy replaces the container mid-pulse and the dying process never
 * released its lock, so the job stayed blocked for the FULL TTL - which the
 * per-job budget work lengthened from 10 minutes to 28 for reel-pipeline.
 * Measured 2026-09-09: a holder took the lock at 12:41, the 12:49 deploy killed
 * it, and reel-pipeline was skipped on every pulse until 13:09. Six deploys
 * that day, so roughly an hour of dead pipeline nobody asked for.
 */
export const heldLocks = new Map<string, string>();
/** Set on the first acquire: every holder heartbeats its locks (releaseLocksOfDeadHolders reads the beat). */
let lockHeartbeatArmed = false;

/**
 * Release the cron locks a DEAD process left behind (2026-10-10; heartbeat
 * after the same day's review).
 *
 * Two manual prompt-evolution runs died when a deploy replaced the container
 * mid-run and their locks stayed held for the full TTL (100 minutes). The
 * start command now execs node so the drain runs; this sweep covers a hard
 * kill, an OOM or a crash.
 *
 * Liveness is a heartbeat, not the holder's name: every process touches
 * locked_at every LOCK_HEARTBEAT_MS for each lock it holds (armed on its first
 * acquire, whatever role it runs), and the sweep deletes a live lock only when
 * that heartbeat is older than LOCK_STALE_AFTER_SECONDS. The first version
 * deleted every lock whose holder was another replica, which also deleted the
 * live locks of the OLD container during a slow deploy overlap (it keeps
 * running crons until the new one passes its healthcheck) and would delete a
 * second replica's: a double fire, duplicate texts included. The sweep runs
 * STALE_HOLDER_SWEEP_DELAY_MS after boot, then every minute. Local runs (no
 * replica id) never sweep. A DB error logs and does nothing; the TTL still
 * expires the lock.
 */
export const STALE_HOLDER_SWEEP_DELAY_MS = 120_000;
export const LOCK_HEARTBEAT_MS = 30_000;
/** Five missed heartbeats: only a dead (or wholly frozen) process stops beating this long. */
export const LOCK_STALE_AFTER_SECONDS = 150;
const STALE_SWEEP_INTERVAL_MS = 60_000;

type LockDb = Awaited<ReturnType<typeof import("../db").getDb>>;

const unrefTimer = (t: unknown): void => {
  if (typeof t === "object" && t && "unref" in t) (t as { unref: () => void }).unref();
};

/** Touches locked_at on every lock this process holds, by its own token. Never throws. */
export async function heartbeatHeldLocks(deps: { db?: LockDb } = {}): Promise<number> {
  if (!heldLocks.size) return 0;
  let touched = 0;
  try {
    const db = deps.db ?? (await (await import("../db")).getDb());
    if (!db) return 0;
    const { sql } = await import("drizzle-orm");
    for (const [jobName, token] of heldLocks) {
      const [result] = await db.execute(sql`UPDATE cron_locks SET locked_at = NOW() WHERE name = ${jobName} AND lock_token = ${token}`);
      touched += (result as { affectedRows?: number })?.affectedRows ?? 0;
    }
  } catch (e) {
    log.warn("[cron/locks] heartbeat failed; the sweep may release a lock this process still holds after 150 s", { error: e instanceof Error ? e.message : String(e) });
  }
  return touched;
}

export function ensureLockHeartbeat(): void {
  if (lockHeartbeatArmed) return;
  lockHeartbeatArmed = true;
  unrefTimer(setInterval(() => { void heartbeatHeldLocks(); }, LOCK_HEARTBEAT_MS));
}

export async function releaseLocksOfDeadHolders(deps: {
  replicaId?: string | undefined;
  db?: LockDb;
} = {}): Promise<{ released: Array<{ name: string; holder: string }> }> {
  const replicaId = deps.replicaId ?? process.env.RAILWAY_REPLICA_ID;
  const out: { released: Array<{ name: string; holder: string }> } = { released: [] };
  if (!replicaId) return out;
  try {
    const db = deps.db ?? (await (await import("../db")).getDb());
    if (!db) return out;
    const { sql } = await import("drizzle-orm");
    const [rows] = await db.execute(sql`
      SELECT name, holder, lock_token FROM cron_locks
       WHERE locked_until > NOW()
         AND locked_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(LOCK_STALE_AFTER_SECONDS))} SECOND)
    `);
    const stale = rows as unknown as Array<{ name: string; holder: string; lock_token: string }>;
    for (const row of stale) {
      if (heldLocks.get(row.name) === row.lock_token) continue; // ours: this process is alive by definition
      // Staleness re-checked in the DELETE: a holder that beats between the read and here keeps its lock.
      const [result] = await db.execute(sql`DELETE FROM cron_locks WHERE name = ${row.name} AND lock_token = ${row.lock_token} AND locked_at < DATE_SUB(NOW(), INTERVAL ${sql.raw(String(LOCK_STALE_AFTER_SECONDS))} SECOND)`);
      if (((result as { affectedRows?: number })?.affectedRows ?? 0) > 0) out.released.push({ name: row.name, holder: row.holder });
    }
    if (out.released.length) {
      log.warn("[cron/locks] released locks whose holder stopped its heartbeat", { released: out.released, replicaId });
    }
  } catch (e) {
    log.warn("[cron/locks] stale-holder sweep failed; the TTLs still apply", { error: e instanceof Error ? e.message : String(e) });
  }
  return out;
}

/** Arms the sweep once per process: first pass after delayMs, then every minute. The timers never keep the process alive. */
let staleSweepArmed = false;
export function scheduleStaleHolderSweep(delayMs: number = STALE_HOLDER_SWEEP_DELAY_MS): void {
  if (staleSweepArmed) return;
  staleSweepArmed = true;
  unrefTimer(setTimeout(() => {
    void releaseLocksOfDeadHolders();
    unrefTimer(setInterval(() => { void releaseLocksOfDeadHolders(); }, STALE_SWEEP_INTERVAL_MS));
  }, delayMs));
}
