/**
 * Q-10 · the cron runner side of the SIGTERM drain, against the REAL tiered
 * runner (scheduler.ts runTier) and the REAL in-flight tracker (cron/index.ts).
 * Only the database is stubbed out: getDb() → null puts the lock layer on its
 * in-memory "fallback" path, exactly as when cron_locks is unreachable.
 *
 * Positive control (origin/main ca45b9f): stopTieredScheduler() only cleared
 * interval handles, so a pass already inside runTier went on to start every
 * remaining job in its list after SIGTERM, and nothing recorded which handler
 * was mid-run for shutdown to wait on. On main this file fails: runTier,
 * trackCronRun/inFlightCronRuns and the drain gate do not exist.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: async () => null }));

import { __resetCronDrainForTest, inFlightCronRuns, runJobByName, registerJob, whenCronRunsSettled } from "./index";
import { runTier, stopTieredScheduler, type Tier } from "./scheduler";
import { createGracefulShutdown } from "../_core/gracefulShutdown";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * Wait out the awaits runTier makes before a handler starts. They include cold
 * dynamic imports (drizzle-orm, ../db), which take real I/O time on the first
 * pass — a fixed number of microtask flushes was measured flaky (2 of 4 runs).
 */
async function until(cond: () => boolean) {
  await vi.waitFor(() => expect(cond()).toBe(true), { timeout: 10_000, interval: 5 });
}

describe("cron shutdown drain", () => {
  beforeEach(() => { __resetCronDrainForTest(); });
  afterEach(() => { __resetCronDrainForTest(); });

  it("a job in flight at SIGTERM finishes, and no later job in the pass starts", async () => {
    const first = deferred();
    const secondHandler = vi.fn(async () => ({ recordsProcessed: 0 }));
    const tier: Tier = {
      name: "test-pulse",
      intervalMs: 15 * 60_000,
      running: false,
      lastRun: null,
      jobs: [
        { name: "job-a", handler: async () => { await first.promise; return { recordsProcessed: 1 }; } },
        { name: "job-b", handler: secondHandler },
      ],
    };

    const pass = runTier(tier);
    await until(() => inFlightCronRuns().includes("job-a"));

    // SIGTERM → the scheduler stop the shutdown handler runs first
    stopTieredScheduler();
    let settled = false;
    const drained = whenCronRunsSettled().then(() => { settled = true; });
    await new Promise((r) => setImmediate(r));
    expect(settled).toBe(false); // job-a is still running, drain waits for it

    first.resolve();
    await drained;
    await pass;
    expect(inFlightCronRuns()).toEqual([]);
    expect(secondHandler).not.toHaveBeenCalled();
    expect(tier.running).toBe(false);
  });

  it("a tier pass that fires after SIGTERM starts nothing", async () => {
    const handler = vi.fn(async () => ({}));
    stopTieredScheduler();
    await runTier({ name: "test-late", intervalMs: 60_000, running: false, lastRun: null, jobs: [{ name: "job-late", handler }] });
    expect(handler).not.toHaveBeenCalled();
  });

  it("the HTTP job trigger refuses to start a job after SIGTERM", async () => {
    const handler = vi.fn(async () => ({}));
    registerJob("q10-http-job", 60, handler);
    stopTieredScheduler();
    const res = await runJobByName("q10-http-job");
    expect(res).toMatchObject({ status: "skipped", details: "server shutting down — no new job starts" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("end to end: the shutdown function exits 0 only after the in-flight tier job settles", async () => {
    const first = deferred();
    const tier: Tier = {
      name: "test-e2e",
      intervalMs: 60_000,
      running: false,
      lastRun: null,
      jobs: [{ name: "job-slow", handler: async () => { await first.promise; return {}; } }],
    };
    const pass = runTier(tier);
    await until(() => inFlightCronRuns().includes("job-slow"));

    const exit = vi.fn();
    const shutdown = createGracefulShutdown({
      graceMs: 25_000,
      exit,
      log: { info: () => undefined, warn: () => undefined },
      stops: [{ label: "scheduler", run: stopTieredScheduler }],
      sources: [{ label: "cron", pending: inFlightCronRuns, settled: whenCronRunsSettled }],
    });
    const done = shutdown();
    await new Promise((r) => setImmediate(r));
    expect(exit).not.toHaveBeenCalled();

    first.resolve();
    await done;
    await pass;
    expect(exit).toHaveBeenCalledWith(0);
  });
});
