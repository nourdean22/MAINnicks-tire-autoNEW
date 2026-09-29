/**
 * Statenour worker · Express + node-cron · long-running service.
 *
 * v10.0.529.107 · CP4 of statenour → nickstire monorepo migration.
 * See docs/MIGRATION_PLAN.md §3 for the architecture rationale.
 *
 * Responsibilities:
 *   · Run the small out-of-band node-cron loop that forwards declared worker
 *     jobs to statenour-web.
 *   · Run the local approved-video render loop.
 *   · Expose /health for Railway healthcheck.
 *
 * Q-36 (2026-09-29): the legacy POST /cron/mega* entry points were removed
 * after live Railway inspection proved the project has zero cron services/jobs
 * and the worker itself has no cron schedule. Daily/weekly mega ownership is
 * StateNour/Inngest, not this worker.
 *
 * Auth: every /cron/* endpoint requires the CRON_SECRET shared secret
 * via Authorization: Bearer <CRON_SECRET> header. Railway cron jobs
 * are configured to send this header (see CP7 in the plan).
 *
 * Wave 49 hardening applied: timingSafeEqual on the secret compare ·
 * fail-closed when env is unset (refuses to start instead of allowing
 * empty-vs-empty bypass).
 */

import express from "express";
import {
  startScheduler,
  stopScheduler,
  getSchedulerHealth,
  deriveStaleWindowMs,
  drainInFlight,
} from "./scheduler.js";

const app = express();
const port = Number(process.env.PORT ?? 8080);

// ── Fail-closed on missing CRON_SECRET ──
// Outbound cron forwards authenticate to statenour-web with this bearer.
// Force a non-empty secret at boot so the worker cannot start in a state
// where every scheduled forward is guaranteed to 401.
const CRON_SECRET = (process.env.CRON_SECRET ?? "").trim();
if (!CRON_SECRET) {
  console.error(
    "[worker] CRON_SECRET env var is empty or unset · refusing to start. " +
      "Set it via Railway dashboard before deploying. Required in every environment.",
  );
  process.exit(1);
}

const SERVICE_ROLE = process.env.SERVICE_ROLE ?? "worker";

// ── Liveness / deploy gate · Railway probes THIS path ──
//
// Declared as `healthcheck` on this service in .railway/railway.ts. It used to
// live in apps/worker/railway.json, deleted 2026-09-18 when the project moved to
// Infrastructure as Code.
//
// DUMB BY DESIGN: 200 whenever the process can serve a request. It does NOT
// gate on scheduler state, the DB, or any downstream service.
//
// Why, per the standard probe split. The usual argument — "liveness must not
// check dependencies, or a blip becomes a restart storm" — is the WEAKER half
// here, and on its own it is over-applied: lastTickAt is an in-memory counter,
// no I/O, and OneUptime's own "worker process" pattern wires liveness to exactly
// this shape (a heartbeat freshness check). Two stronger reasons decide it:
//
//   1. RESTART IS NOT THE REPAIR. A liveness probe should fire only when killing
//      the process is genuinely the fix. Here a fresh process resets lastTickAt
//      to 0, so the loop resumes only if it was going to anyway — and the kill
//      additionally bypasses the bounded drain below and can abort an in-flight
//      render. Killing it is strictly worse than leaving it alone.
//   2. THE GRACE AND THE GATE ARE MUTUALLY DEFEATING. msSinceLastTick === null
//      on a fresh process must read healthy, or every restart would fail its own
//      next probe and crashloop with zero forward progress. But a gate that is
//      armed only after the first tick and disarmed by every restart cannot
//      drive a restart. It could never do the job it was written to do.
//
// (The dependency argument is not absent either: scheduler.ts:361-363 returns
// early WITHOUT bumping lastTickAt while a forward is still in flight, and that
// set is populated by an HTTP call to statenour-web. So a downstream stall is one
// of the inputs. But 1 and 2 are what settle it.)
//
// Scheduler freshness is therefore a DIAGNOSTIC: reported in the body below and
// gated at GET /health/scheduler, which nothing restarts on.
//
// This replaced a version that returned 503 when the scheduler looked stale,
// commented "so Railway can restart the instance". That premise was false:
// Railway's docs state it "does not monitor the healthcheck endpoint after the
// deployment has gone live" (docs.railway.com/reference/healthchecks), so the
// 503 could never trigger a restart — it could only fail a DEPLOY, i.e. block
// shipping the very fix a wedged scheduler needs. Restarting also cannot repair
// staleness on its own: a fresh process resets lastTickAt to 0.
const SCHEDULER_STALE_MS = deriveStaleWindowMs();

/** Fresh = never ticked yet (boot grace) or ticked inside the derived window. */
function schedulerIsFresh(msSinceLastTick: number | null): boolean {
  return msSinceLastTick === null || msSinceLastTick < SCHEDULER_STALE_MS;
}

app.get("/health", (_req, res) => {
  const h = getSchedulerHealth();
  // Status is ALWAYS 200 here. `scheduler` is observability, not a gate.
  res.status(200).json({
    ok: true,
    role: SERVICE_ROLE,
    uptime: Math.round(process.uptime()),
    scheduler: schedulerIsFresh(h.msSinceLastTick) ? "running" : "stalled",
    msSinceLastTick: h.msSinceLastTick,
    staleWindowMs: SCHEDULER_STALE_MS,
    isRendering: h.isRendering,
  });
});

// ── Scheduler freshness · DIAGNOSTIC ONLY ──
//
// 503 when the loop has gone quiet longer than the derived window. Safe to
// alert on, safe to poll. **Never point the service `healthcheck` in
// .railway/railway.ts at this**
// — that is exactly the coupling the split above exists to prevent.
app.get("/health/scheduler", (_req, res) => {
  const h = getSchedulerHealth();
  const fresh = schedulerIsFresh(h.msSinceLastTick);
  res.status(fresh ? 200 : 503).json({
    ok: fresh,
    scheduler: fresh ? "running" : "stalled",
    msSinceLastTick: h.msSinceLastTick,
    staleWindowMs: SCHEDULER_STALE_MS,
    inFlightForwards: h.inFlightForwards,
    isRendering: h.isRendering,
  });
});

// Q-36 · No public /cron/mega* entry points live here anymore.
// Live Railway inspection on 2026-09-29 found exactly four services
// (Nick's, StateNour web, StateNour worker, Redis), none with a cron schedule.
// Keeping unused secret-gated endpoints would preserve a phantom dispatch path
// that production cannot call and future docs could mistake for live ownership.

// ── Bootstrap: scheduler + listen ──
startScheduler();

const server = app.listen(port, () => {
  console.log(
    `[worker] listening on :${port} · role=${SERVICE_ROLE} · scheduler started`,
  );
});

// ── Graceful shutdown (Railway sends SIGTERM on redeploys) ──
// Old behavior: process.exit(0) immediately — a multi-minute reel render or an
// in-flight forward was killed mid-write (orphan .mp4, queue item stranded in
// "rendering"). Now: stop new ticks, drain in-flight work (bounded), close the
// HTTP server, then exit. A hard fallback timer guarantees we still exit if a
// drain hangs.
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] received ${signal} · draining before exit`);

  // Guarantee exit even if drain/close hangs.
  const hardExit = setTimeout(() => {
    console.error("[worker] drain timed out · forcing exit");
    process.exit(0);
  }, 35_000);
  hardExit.unref();

  stopScheduler();
  await drainInFlight(30_000);
  server.close(() => {
    console.log("[worker] http server closed · exiting");
    clearTimeout(hardExit);
    process.exit(0);
  });
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
