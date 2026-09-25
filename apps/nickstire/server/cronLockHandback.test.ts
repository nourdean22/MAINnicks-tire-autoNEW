/**
 * A DEPLOY SHOULD NOT COST A FULL LOCK TTL.
 *
 * Measured in production 2026-09-09: a dyno took the reel-pipeline lock at
 * 12:41, the 12:49 deploy replaced the container, and every pulse from 12:50 to
 * 13:09 logged "skipped: cross-dyno lock held by another process" — because the
 * dying process never handed the lock back and the TTL had to expire on its own.
 *
 * That window got LONGER, not shorter, from the per-job budget work: the TTL is
 * 2x the job's budget, so reel-pipeline went from 10 minutes to 28. Six deploys
 * that day. The cost was self-inflicted and invisible in every green suite.
 *
 * The fix hands the lock back on SIGTERM by SHORTENING it, never deleting it —
 * because the one case that matters is a SIGTERM the process survives, and a
 * deleted lock would let another dyno start the same paid job immediately.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sliceBlock } from "./testUtils/sourceBlock";

const INDEX = readFileSync(path.join(__dirname, "cron", "index.ts"), "utf8");
const CORE = readFileSync(path.join(__dirname, "_core", "index.ts"), "utf8");

describe("locks this process holds are tracked", () => {
  it("acquire records the lock, release forgets it", () => {
    expect(INDEX).toContain("const heldLocks = new Map<string, LockToken>()");
    expect(INDEX).toContain("heldLocks.set(jobName, newToken)");
    expect(INDEX).toContain("heldLocks.delete(lock.jobName)");
  });

  it("it records ONLY when we actually own the lock", () => {
    // The set must sit after the token comparison, never before it — recording
    // a lock we lost would make shutdown shorten someone else's lock.
    const fn = INDEX.slice(INDEX.indexOf("export async function acquireCronLock"));
    const compareAt = fn.indexOf("arr[0].lock_token !== newToken");
    const setAt = fn.indexOf("heldLocks.set(jobName, newToken)");
    expect(compareAt).toBeGreaterThan(-1);
    expect(setAt).toBeGreaterThan(compareAt);
  });
});

describe("shutdown shortens, and only its own locks", () => {
  const fn = INDEX.slice(
    INDEX.indexOf("export async function relinquishHeldLocksForShutdown"),
    INDEX.indexOf("export async function releaseCronLock"),
  );

  it("it UPDATEs a grace window rather than DELETEing", () => {
    expect(fn).toContain("UPDATE cron_locks");
    expect(fn).toContain("SET locked_until");
    // A delete here would permit an immediate concurrent fire if the process
    // survives the signal.
    expect(fn).not.toContain("DELETE FROM cron_locks");
  });

  it("the UPDATE is guarded on our own token", () => {
    expect(fn).toContain("lock_token = ${token}");
  });

  it("it never EXTENDS a lock — only shortens one", () => {
    // The trailing predicate is the whole safety property: it matches only rows
    // whose expiry is further out than the grace window.
    expect(fn).toContain("locked_until > DATE_ADD(NOW(), INTERVAL");
  });

  it("the grace window is short but non-zero", () => {
    expect(INDEX).toContain("export const SHUTDOWN_LOCK_GRACE_SECONDS = 90");
    const secs = Number(/SHUTDOWN_LOCK_GRACE_SECONDS = (\d+)/.exec(INDEX)?.[1]);
    expect(secs).toBeGreaterThan(0);
    // Must stay well under the shortest real TTL, or it buys nothing.
    expect(secs).toBeLessThan(10 * 60);
  });

  it("one failing lock cannot abort the rest, and it never throws", () => {
    expect(fn).toContain("one lock failing must not stop the rest");
    expect(fn).toContain("shutdown is best-effort");
  });
});

describe("the shutdown path actually calls it", () => {
  it("SIGTERM hands the locks back", () => {
    expect(CORE).toContain("relinquishHeldLocksForShutdown()");
    // Q-10 · the SIGTERM handler runs the stops declared in the
    // createGracefulShutdown({...}) wiring; the handback must be one of them,
    // and the handler must actually call that wiring.
    const stops = sliceBlock(CORE, "createGracefulShutdown({", "sources: [", { label: "_core/index.ts" });
    expect(stops).toContain("relinquishHeldLocksForShutdown");
    const handler = sliceBlock(CORE, 'process.on("SIGTERM"', "});", { label: "_core/index.ts" });
    expect(handler).toContain("shutdownOnSigterm()");
    expect(CORE).toContain("const shutdownOnSigterm = createGracefulShutdown({");
  });

  it("it is fire-and-forget — shutdown never waits on it", () => {
    const region = CORE.slice(CORE.indexOf("relinquishHeldLocksForShutdown()"));
    expect(region.slice(0, 300)).toContain(".catch(");
  });

  it("PLANTED CANARY: it runs AFTER the scheduler is stopped", () => {
    // Handing a lock back while the tier loop can still fire would let this
    // same dyno immediately re-acquire it.
    const stopAt = CORE.indexOf("stopTieredScheduler()");
    const handbackAt = CORE.indexOf("relinquishHeldLocksForShutdown()");
    expect(stopAt).toBeGreaterThan(-1);
    expect(handbackAt).toBeGreaterThan(stopAt);
  });
});
