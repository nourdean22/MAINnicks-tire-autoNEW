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
import { startScheduler, forwardCronToWeb } from "./scheduler.js";

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
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    role: SERVICE_ROLE,
    uptime: Math.round(process.uptime()),
    scheduler: "running",
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

app.listen(port, () => {
  console.log(
    `[worker] listening on :${port} · role=${SERVICE_ROLE} · scheduler started`,
  );
});

// ── Graceful shutdown (Railway sends SIGTERM on redeploys) ──
function shutdown(signal: string): void {
  console.log(`[worker] received ${signal} · shutting down`);
  process.exit(0);
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
