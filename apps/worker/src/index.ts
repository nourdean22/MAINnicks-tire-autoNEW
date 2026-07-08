/**
 * Statenour worker · Express + node-cron · long-running service.
 *
 * v10.0.529.107 · CP4 of statenour → nickstire monorepo migration.
 * See docs/MIGRATION_PLAN.md §3 for the architecture rationale.
 *
 * Responsibilities (all the things that don't belong on serverless):
 *   · Receive Railway-cron HTTP triggers for /cron/mega + /cron/mega-evening
 *   · Run an in-process node-cron loop for high-frequency jobs
 *     (brain-bus-backfill every 2 min · calendar-premeeting every 15 min ·
 *     bus-exhaustion-watch every 30 min · provider-ping hourly ·
 *     local video render polling)
 *   · Expose /health for Railway healthcheck
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
import { timingSafeEqual } from "node:crypto";
import {
  startScheduler,
  stopScheduler,
  forwardCronToWeb,
  getSchedulerHealth,
  drainInFlight,
} from "./scheduler.js";

const app = express();
const port = Number(process.env.PORT ?? 8080);

// ── Fail-closed on missing CRON_SECRET ──
// Per Wave 49's runner-auth hardening pattern: empty env + empty header
// would compare equal with timingSafeEqual and bypass auth. Force a
// non-empty secret at boot.
const CRON_SECRET = (process.env.CRON_SECRET ?? "").trim();
if (!CRON_SECRET) {
  console.error(
    "[worker] CRON_SECRET env var is empty or unset · refusing to start. " +
      "Set it via Railway dashboard before deploying. Required in every environment.",
  );
  process.exit(1);
}

const SERVICE_ROLE = process.env.SERVICE_ROLE ?? "worker";

function requireCronSecret(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const header = req.header("authorization") ?? "";
  const expected = `Bearer ${CRON_SECRET}`;
  if (header.length !== expected.length) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  // timingSafeEqual requires equal-length buffers · the length check
  // above gates that.
  if (!timingSafeEqual(Buffer.from(header), Buffer.from(expected))) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}

// ── Healthcheck (Railway probes this) ──
// Reports REAL scheduler liveness: if the newest tick is older than the
// staleness window, the loop is wedged and we return 503 so Railway can
// restart the instance (was a hard-coded scheduler:"running" that stayed
// green through a stalled loop).
const SCHEDULER_STALE_MS = 5 * 60_000; // a high-freq job ticks every ~2 min
app.get("/health", (_req, res) => {
  const h = getSchedulerHealth();
  const schedulerHealthy =
    h.msSinceLastTick === null || h.msSinceLastTick < SCHEDULER_STALE_MS;
  res.status(schedulerHealthy ? 200 : 503).json({
    ok: schedulerHealthy,
    role: SERVICE_ROLE,
    uptime: Math.round(process.uptime()),
    scheduler: schedulerHealthy ? "running" : "stalled",
    msSinceLastTick: h.msSinceLastTick,
    isRendering: h.isRendering,
  });
});

// ── Railway cron entry points ──
//
// Wave-65 plan: Railway cron scheduler hits these two endpoints daily.
// Each one fans out into the statenour mega cron's child route list
// (which currently lives in app/api/cron/mega/route.ts on the web
// service). For CP4 we make these endpoints return a stub OK + log ·
// the actual fan-out wires in CP6 when the worker can import the web
// service's mega handler as a workspace dep OR call the web service's
// /api/cron/mega endpoint via internal Railway hostname (deferred to
// CP6 once Railway internal hostnames are known).
//
// Either way, the contract is the same as today's Vercel cron: the
// secret-gated endpoint just needs to fire on schedule and return 200.

// CP6 wiring: both endpoints forward to statenour-web's existing
// /api/cron/mega route handler with the slot query param. The handler
// runs the full child-cron fan-out exactly as it did on Vercel · no
// behavior change · just a different upstream caller.
app.post("/cron/mega", requireCronSecret, async (_req, res) => {
  console.log("[worker] /cron/mega triggered at", new Date().toISOString());
  const ok = await forwardCronToWeb("mega?slot=morning");
  res.status(ok ? 200 : 502).json({ ok, slot: "morning" });
});

app.post("/cron/mega-evening", requireCronSecret, async (_req, res) => {
  console.log("[worker] /cron/mega-evening triggered at", new Date().toISOString());
  const ok = await forwardCronToWeb("mega?slot=evening");
  res.status(ok ? 200 : 502).json({ ok, slot: "evening" });
});

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
