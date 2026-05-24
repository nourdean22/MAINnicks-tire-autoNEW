import "dotenv/config";
import { timingSafeEqual, randomUUID } from "crypto";

// ─── Startup env validation ─────────────────────────
const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET"] as const;
const RECOMMENDED_ENV = [
  "OWNER_OPEN_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
  "BRIDGE_API_KEY", "OPENAI_API_KEY",
] as const;

// Unify Google API keys — GOOGLE_MAPS_API_KEY works for Places, Maps, and all Google APIs
if (process.env.GOOGLE_MAPS_API_KEY && !process.env.GOOGLE_PLACES_API_KEY) {
  process.env.GOOGLE_PLACES_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
}
if (process.env.GOOGLE_MAPS_API_KEY && !process.env.GOOGLE_SEARCH_CONSOLE_KEY) {
  // GSC uses service account, not API key — but set for scheduler env check
  process.env.GOOGLE_SEARCH_CONSOLE_KEY = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? "configured" : "";
}

const missingRequired = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingRequired.length) {
  console.error(`FATAL: Missing required env vars: ${missingRequired.join(", ")}`);
  process.exit(1);
}
// JWT_SECRET must be at least 32 characters to be cryptographically useful
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET must be at least 32 characters long");
  process.exit(1);
}
const missingRec = RECOMMENDED_ENV.filter(k => !process.env[k]);
if (missingRec.length) {
  console.warn(`WARNING: Missing recommended env vars: ${missingRec.join(", ")}`);
}

import express from "express";
import compression from "compression";
import { createServer } from "http";
import crypto from "crypto";
import net from "net";
import path from "path";
import fs from "fs";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import rateLimit from "express-rate-limit";
import { registerOAuthRoutes } from "./oauth";
import { registerBridgeRoutes } from "./bridge-routes";
import { registerStatenourBridgeRoutes } from "./statenour-bridge-routes";
import { registerNourStrategyRoute } from "../routes/nour-strategy";
import { registerPsychDominanceRoute } from "../routes/psych-dominance";
import { registerBurnoutRadarRoute } from "../routes/burnout-radar";
import { registerSimulatorRoute } from "../routes/simulator";
import { registerNourChiefStrategistRoute } from "../routes/nour-chief-strategist";
import { registerNourOsQueryRoute } from "../routes/nour-os-query";
import { healthHandler, pingHandler, readyHandler, recoverHandler } from "../lib/health";
import { startSelfHealing, recordRequest } from "../lib/self-healing";
import { createLogger } from "../lib/logger";
import { errorTelemetry } from "../lib/error-telemetry";
import { initSentry, flushSentry } from "../lib/sentry";
import { getAllBreakerHealth, resetAllBreakers } from "../lib/circuit-breaker";
import { AppError, isAppError, errorToHttpResponse } from "../lib/errors";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createPrerenderMiddleware } from "../prerender-middleware";
import { SITE_URL } from "@shared/business";

const serverLog = createLogger("server");

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

let _httpServer: ReturnType<typeof createServer> | null = null;

async function startServer() {
  const app = express();
  const server = createServer(app);
  _httpServer = server;
  // Trust proxy — required for rate limiting behind reverse proxy
  app.set("trust proxy", 1);
  // Remove X-Powered-By header — leaks server technology to attackers
  app.disable("x-powered-by");
  // Compression — gzip/deflate all responses (fixes Ahrefs "Not compressed" for all pages)
  app.use(compression({ threshold: 1024 }));
  // Body parser — 2MB default, photo uploads handled separately.
  // Wave-104: capture raw body bytes for webhooks that need HMAC over the
  // exact bytes the sender signed (Capevace SMS Gateway). Stashed on
  // req.rawBody. Adds negligible memory cost; webhook handlers opt in.
  app.use(express.json({
    limit: "2mb",
    verify: (req: import("express").Request & { rawBody?: Buffer }, _res, buf: Buffer) => {
      req.rawBody = buf;
    },
  }));
  app.use(express.urlencoded({ limit: "2mb", extended: true }));

  // ─── Request ID + Duration Tracking ──────────────────
  // Generates a UUID per request, attaches to res.locals and response header.
  // Logs slow requests (>5s) for performance investigation.
  const SLOW_REQUEST_THRESHOLD_MS = 5_000;
  app.use((req, res, next) => {
    const requestId = crypto.randomUUID();
    res.locals.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);

    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      if (duration > SLOW_REQUEST_THRESHOLD_MS) {
        serverLog.warn(`Slow request: ${req.method} ${req.path} took ${duration}ms`, {
          requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          duration,
        });
      }
    });

    next();
  });

  // Performance: Cache-Control for static-ish API responses
  app.use((req, res, next) => {
    if (req.path === "/api/health" || req.path === "/api/ping") {
      res.setHeader("Cache-Control", "public, max-age=5"); // 5s cache
    } else if (req.path.startsWith("/api/trpc/") && req.method === "GET") {
      res.setHeader("Cache-Control", "private, max-age=10"); // 10s for tRPC queries
    }
    next();
  });

  // Security headers — uses the centralized middleware from securityHeaders.ts
  // (includes CSP with all allowed domains: ahrefs, GA, Meta, etc.)
  app.use((await import("../middleware/securityHeaders")).securityHeaders);
  // Request tracking for self-healing anomaly detection (non-blocking, ~0ms)
  app.use((_req, _res, next) => { recordRequest(); next(); });

  // Rate limiting for public API endpoints to prevent spam/abuse
  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests. Please try again later or call us at (216) 862-0005." },
  });

  // Stricter rate limit for form submissions (booking, lead, callback)
  const formLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 form submissions per hour per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many submissions. Please call us directly at (216) 862-0005." },
  });

  app.use("/api/trpc", apiLimiter);
  // Apply stricter limits to mutation-heavy endpoints
  // Stricter rate limit for AI/chat endpoints (expensive operations)
  const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 30, // 30 AI requests per hour per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many AI requests. Please try again later or call us at (216) 862-0005." },
  });

  // Upload limiter — tighter than forms: 15 uploads/hour/IP (each is a ~7MB base64 payload)
  const uploadLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 15,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many file uploads. Please try again later." },
  });

  app.use("/api/trpc/booking.uploadPhoto", uploadLimiter);
  app.use("/api/trpc/booking.create", formLimiter);
  app.use("/api/trpc/lead.submit", formLimiter);
  app.use("/api/trpc/callback.submit", formLimiter);
  app.use("/api/trpc/waitlist.join", formLimiter);
  app.use("/api/trpc/emergency.submit", formLimiter);
  app.use("/api/trpc/financing.trackApplication", formLimiter);
  app.use("/api/trpc/chat", aiLimiter);
  app.use("/api/trpc/public.diagnose", aiLimiter);
  app.use("/api/trpc/public.askMechanic", aiLimiter);
  app.use("/api/trpc/public.aiSearch", aiLimiter);
  app.use("/api/trpc/laborEstimate.generate", aiLimiter);
  app.use("/api/trpc/costEstimator.estimate", aiLimiter);
  app.use("/api/trpc/estimates.generate", aiLimiter);
  app.use("/api/trpc/nourOsQuote.createQuote", formLimiter);
  app.use("/api/trpc/fleet.submit", formLimiter);

  // wave-122 (CRITICAL S7/S8) — Vapi tool tRPC endpoints are
  // documented as Vapi-HMAC protected, but the HMAC middleware only
  // mounts on /api/webhooks/vapi — NOT on /api/trpc/voiceAgent.*.
  // Without rate limit, anyone can POST to .sendConfirmationSms with
  // arbitrary {phone, summary} and weaponize our Twilio account to
  // spray SMS. formLimiter caps 10 req/min per IP — sufficient brake.
  app.use("/api/trpc/voiceAgent.bookSlot", formLimiter);
  app.use("/api/trpc/voiceAgent.escalate", formLimiter);
  app.use("/api/trpc/voiceAgent.sendConfirmationSms", formLimiter);

  // wave-122 (HIGH S5/S8) — payments endpoints. lookupInvoice was
  // brute-forceable (invoice-number prefix + customer phone) under
  // the loose 100 req/15min apiLimiter. createPaymentIntent burns
  // real Stripe API quota per call. confirmPayment is the
  // amount-verified write path (gated additionally by Stripe
  // amount check at routers/payments.ts:147). All three need the
  // tighter per-form ceiling.
  app.use("/api/trpc/payments.lookupInvoice", formLimiter);
  app.use("/api/trpc/payments.createPaymentIntent", formLimiter);
  app.use("/api/trpc/payments.confirmPayment", formLimiter);

  // Tire-order endpoints — placeOrder writes DB rows + fires emails,
  // createCheckout burns Stripe API quota per call, confirmCheckout
  // retrieves a Stripe session per call. Same tight per-form ceiling.
  app.use("/api/trpc/gatewayTire.placeOrder", formLimiter);
  app.use("/api/trpc/gatewayTire.createCheckout", formLimiter);
  app.use("/api/trpc/gatewayTire.confirmCheckout", formLimiter);

  // v1.7 audit follow-up · defense-in-depth on the 4 statenour-gated
  // AI endpoints. v1.7 added statenourAuth middleware (closing the
  // unauth hole that let anyone burn OpenAI tokens). This adds a
  // rate-limit floor on top: even with a leaked sync key, an attacker
  // is capped at the aiLimiter window.
  app.use("/api/nour-strategy", aiLimiter);
  app.use("/api/agents/psych-dominance", aiLimiter);
  app.use("/api/nour-chief-strategist", aiLimiter);
  app.use("/api/agents/simulator", aiLimiter);
  app.use("/api/agents/burnout-radar", aiLimiter);

  // ─── Deploy Version Endpoint ──────────────────────────
  // Proves which commit is actually running on Railway
  app.get("/api/version", (_req, res) => {
    res.json({
      status: "ok",
      uptime: Math.round(process.uptime()),
    });
  });

  // ─── Health Endpoints ──────────────────────────────────
  app.get("/api/health", healthHandler);
  app.get("/api/ping", pingHandler);
  app.get("/api/ready", readyHandler);
  // SEC-3 (migration-audit 2026-05-17) · /api/health/recover is a
  // mutating self-healing trigger. Pre-fix it was publicly reachable
  // alongside the read-only probes above. requireAdminApiKey is a
  // hoisted function declaration (defined ~240 lines below) · forward
  // reference is safe (same pattern as the SSE registration at L487).
  app.post("/api/health/recover", requireAdminApiKey, recoverHandler);

  // ─── Abandoned Form Tracking ──────────────────────────
  // Receives navigator.sendBeacon from BookingWizard on page unload
  // ─── Conversion-event sink ─────────────────────────────
  // The `useConversionTracking` hook on the client fans every CTA / form
  // / capture event here. We log to the standard logger (so logs/grep
  // can audit) AND push into an in-memory ring buffer (`conversionEvents`)
  // so the admin Conversion Preview tab can show a live feed without a
  // DB migration.
  //
  // Batch 9 of the conversion overhaul will move this to a dedicated
  // table for proper funnel analytics. For now, ring buffer + logger is
  // enough to validate the wiring end-to-end.
  app.post("/api/analytics/conversion", express.json({ limit: "8kb" }), async (req, res) => {
    try {
      const body = req.body as Record<string, unknown> | null;
      if (!body || typeof body !== "object" || typeof body.type !== "string") {
        return res.sendStatus(204);
      }
      const { recordConversionEvent } = await import("../services/conversionEvents");
      recordConversionEvent({
        type: String(body.type).slice(0, 80),
        page: typeof body.page === "string" ? body.page.slice(0, 200) : undefined,
        element: typeof body.element === "string" ? body.element.slice(0, 200) : undefined,
        value: typeof body.value === "number" ? body.value : undefined,
        props: typeof body.props === "object" && body.props !== null ? body.props as Record<string, unknown> : undefined,
        ip: req.ip,
        ua: req.get("user-agent")?.slice(0, 300),
      });
      res.sendStatus(204);
    } catch (e) {
      // Conversion analytics never blocks UX — swallow errors.
      console.warn("[server:conversionEvent] failed:", e);
      res.sendStatus(204);
    }
  });

  app.post("/api/track-abandoned", express.json(), async (req, res) => {
    try {
      const { name, phone, service, vehicle, step: formStep } = req.body || {};
      // wave-147 — was `if (!name && !phone) return sendStatus(204)`,
      // which silently dropped the majority of step-1 abandonment events
      // (users who picked a service + bounced before touching name/phone).
      // Now: keep at least one of {name, phone, service} as the signal of
      // real engagement; only reject totally-empty beacons.
      if (!name && !phone && !service) return res.sendStatus(204);
      const { savePartialForm } = await import("../services/abandonedForms");
      const sessionId = `beacon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      savePartialForm({
        sessionId,
        formType: "booking",
        name: typeof name === "string" ? name.slice(0, 200) : undefined,
        phone: typeof phone === "string" ? phone.slice(0, 20) : undefined,
        service: typeof service === "string" ? service.slice(0, 200) : undefined,
        pageUrl: `/book (step ${formStep || "?"})`,
      });
      res.sendStatus(204);
    } catch (e) {
      console.warn("[server:abandonedForm] tracking failed:", e);
      res.sendStatus(204);
    }
  });

  // ─── Uber drop-off code tracking ────────────────────
  // Hits from UberDropoffWidget — records to audit_log so drop-off-ratio
  // bridge endpoint can count Uber-out events.
  app.post("/api/uber-code", express.json({ limit: "2kb" }), async (req, res) => {
    try {
      const body = req.body as { code?: string };
      if (!body?.code) return res.sendStatus(204);
      const { db } = await import("../lib/db-helper");
      const { auditLog } = await import("../../drizzle/schema");
      const { randomUUID } = await import("crypto");
      const d = await db();
      if (!d) return res.sendStatus(204);
      await d.insert(auditLog).values({
        id: randomUUID(),
        actor: "public",
        action: "customer.uber_requested",
        entityType: "uber_code",
        entityId: body.code.slice(0, 32),
        changes: { code: body.code, userAgent: req.headers["user-agent"]?.toString().slice(0, 200) ?? null },
        ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.ip || null,
      });
      res.sendStatus(204);
    } catch {
      res.sendStatus(204);
    }
  });

  // ─── Core Web Vitals telemetry ──────────────────────
  // Receives navigator.sendBeacon from client/src/lib/cwv.ts
  // No auth — it's anonymous metric data. Batched samples per request.
  app.post("/api/cwv", express.json({ limit: "32kb" }), async (req, res) => {
    try {
      const { recordCwvSample } = await import("../lib/cwv-telemetry");
      const body = req.body as { samples?: unknown };
      if (!Array.isArray(body?.samples)) return res.sendStatus(204);
      // Cap per-request to prevent abuse
      for (const s of (body.samples as unknown[]).slice(0, 25)) {
        if (typeof s !== "object" || !s) continue;
        const sample = s as {
          metric?: string; value?: number; route?: string;
          navType?: string; sessionId?: string; timestamp?: number;
        };
        if (!sample.metric || typeof sample.value !== "number") continue;
        recordCwvSample({
          metric: sample.metric as "LCP" | "CLS" | "INP" | "FCP" | "TTFB",
          value: sample.value,
          route: (sample.route || "/").slice(0, 200),
          navType: (sample.navType || "navigate").slice(0, 40),
          sessionId: (sample.sessionId || "anon").slice(0, 80),
          timestamp: sample.timestamp,
        });
      }
      res.sendStatus(204);
    } catch {
      res.sendStatus(204);
    }
  });

  // ─── Self-Healing Monitor ─────────────────────────────
  startSelfHealing();

  // ─── Sentry (opt-in via SENTRY_DSN) ───────────────────
  initSentry().catch((err) => serverLog.warn("Sentry init failed", { err }));

  // ─── Event Bus (eagerly init so self-healing sees it ready) ──
  import("../services/eventBus").then(({ initEventBus }) => {
    initEventBus();
    serverLog.info("Event bus initialized");
  }).catch(err => console.error("[EventBus] Failed to init:", err));

  // ─── Schema Migrations (idempotent ALTER TABLE) ────────
  import("../db").then(async ({ getDb }) => {
    const db = await getDb();
    if (!db) return;
    const { sql } = await import("drizzle-orm");
    const alters = [
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS totalSpent int NOT NULL DEFAULT 0 AFTER totalVisits`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS firstVisitDate timestamp NULL AFTER lastVisitDate`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS vehicleYear varchar(10) NULL AFTER balanceDue`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS vehicleMake varchar(50) NULL AFTER vehicleYear`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS vehicleModel varchar(50) NULL AFTER vehicleMake`,
      // Migration 0024: Retention SMS tracking
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS lastRetentionTier int DEFAULT NULL`,
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS lastRetentionDate timestamp DEFAULT NULL`,
      // Migration 0025: Booking confirmation tracking
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmedAt timestamp NULL`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmationMethod varchar(20) NULL`,
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS confirmationSentAt timestamp NULL`,
      // Revenue pipeline: quote $ tracking + money aging on leads
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS estimatedValueCents int DEFAULT NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS lastFollowUpAt timestamp DEFAULT NULL`,
      // Google Ads offline conversion tracking (gclid)
      `ALTER TABLE bookings ADD COLUMN IF NOT EXISTS gclid varchar(255) DEFAULT NULL`,
      `ALTER TABLE leads ADD COLUMN IF NOT EXISTS gclid varchar(255) DEFAULT NULL`,
      // PWA push subscriptions table
      `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id varchar(36) NOT NULL PRIMARY KEY,
        customer_id varchar(36) DEFAULT NULL,
        endpoint text NOT NULL,
        p256dh varchar(255) NOT NULL,
        auth_key varchar(255) NOT NULL,
        is_admin tinyint(1) NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_push_customer (customer_id),
        INDEX idx_push_admin (is_admin)
      )`,
      // ═══ CRITICAL: invoices.workOrderId — linking invoices to work orders ═══
      // Root cause of: admin $0 revenue, nickActions.shopPulse failure,
      // invoices.intelligence failure, customer-intelligence failure, statenourSync failure.
      // Drizzle schema had this column but actual TiDB table never got it.
      `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS workOrderId int NULL AFTER bookingId`,
      // ═══ review_pipeline schema drift (admin review queue) ═══
      `ALTER TABLE review_pipeline ADD COLUMN IF NOT EXISTS reviewed int NOT NULL DEFAULT 0`,
      `ALTER TABLE review_pipeline ADD COLUMN IF NOT EXISTS responseSent int NOT NULL DEFAULT 0`,
    ];
    let applied = 0;
    for (const stmt of alters) {
      try { await db.execute(sql.raw(stmt)); applied++; } catch (e) { console.warn("[server:migration] schema ALTER failed:", stmt.slice(0, 60), e); }
    }
    if (applied > 0) serverLog.info(`Schema migrations: ${applied} column checks passed`);
  }).catch(e => console.warn("[server:migration] schema migration runner failed:", e));

  // ─── Feature Flag Seeding (idempotent) ─────────────────
  import("../services/featureFlags").then(({ seedFlags }) => {
    seedFlags().then(({ seeded, skipped }) => {
      if (seeded > 0) serverLog.info(`Feature flags seeded: ${seeded} new, ${skipped} existing`);
    }).catch(err => serverLog.warn("Feature flag seeding failed", { error: err instanceof Error ? err.message : String(err) }));
  });

  // wave-181.3 · PRERENDER_MODE skips all background workers (cron,
  // SMS queue, Telegram batch, NOUR OS bridge). Without this, the
  // prerender Puppeteer step couldn't reach networkidle0 because cron
  // jobs constantly fired Twilio SMS attempts during the prerender
  // run — turning a 15-min job into a multi-hour hang.
  const isPrerenderMode = process.env.PRERENDER_MODE === "true";

  if (!isPrerenderMode) {
    // ─── Tiered Cron Scheduler ──────────────────────────────
    // 4 tiers: heartbeat(5m), pulse(15m), hourly(2h), daily(24h)
    // + 2 standalone: morning brief + daily report (12h)
    import("../cron/scheduler").then(({ startTieredScheduler }) => {
      startTieredScheduler();
      serverLog.info("Tiered scheduler started");
    }).catch(err => console.error("[Scheduler] Failed to start:", err));

    // Explicitly start background timers (removed auto-start from module imports)
    import("../sms").then(({ startDelayedQueueProcessor }) => {
      startDelayedQueueProcessor();
      serverLog.info("SMS delayed queue processor started");
    }).catch(e => console.warn("[server:init] SMS queue processor startup failed:", e));
    import("../services/telegram").then(({ startBatchTimer }) => {
      startBatchTimer();
      serverLog.info("Telegram batch timer started");
    }).catch(e => console.warn("[server:init] Telegram batch timer startup failed:", e));
    import("../nour-os-bridge").then(({ startRetryProcessor }) => {
      startRetryProcessor();
      serverLog.info("NOUR OS bridge retry processor started");
    }).catch(e => console.warn("[server:init] NOUR OS bridge retry processor startup failed:", e));
  } else {
    serverLog.info("[prerender-mode] Skipping cron scheduler, SMS queue, Telegram batch, NOUR OS bridge");
  }

  // ─── Real-time SSE for admin dashboards ─────────────────
  // v1.7 audit fix · pre-fix this SSE stream of admin activity was
  // publicly readable. Every other /api/admin/* route in this file
  // applies requireAdminApiKey; the SSE registration was the lone
  // exception. requireAdminApiKey is a hoisted function declaration
  // (defined ~30 lines below), so the forward reference is safe.
  import("../services/realtimePush").then(({ sseHandler }) => {
    app.get("/api/admin/events", requireAdminApiKey, sseHandler);
    serverLog.info("SSE endpoint registered: /api/admin/events (auth-gated)");
  }).catch(e => console.warn("[server:init] SSE endpoint registration failed:", e));

  // ─── Admin API Key middleware (shared by all admin REST endpoints) ───
  function requireAdminApiKey(req: any, res: any, next: any) {
    const auth = req.headers.authorization;
    const expected = process.env.ADMIN_API_KEY;
    if (!expected || typeof auth !== "string") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const expectedFull = `Bearer ${expected}`;
    if (auth.length !== expectedFull.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expectedFull))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  }

  // ─── Cron Status (admin) ──────────────────────────────
  app.get("/api/admin/cron-status", requireAdminApiKey, (req, res) => {
    import("../cron/index").then(({ getJobStatuses }) => {
      res.json({ jobs: getJobStatuses(), timestamp: new Date().toISOString() });
    }).catch(() => res.json({ jobs: [], error: "Failed to load cron status" }));
  });

  // ─── Feature Flag REST API (admin key auth) ────────
  app.get("/api/admin/flags", requireAdminApiKey, async (_req, res) => {
    const { getAllFlags } = await import("../services/featureFlags");
    res.json(await getAllFlags());
  });
  app.post("/api/admin/flags/toggle", requireAdminApiKey, express.json(), async (req, res) => {
    const { key, value } = req.body;
    if (!key || typeof value !== "boolean") { res.status(400).json({ error: "key and value required" }); return; }
    const { setFlag } = await import("../services/featureFlags");
    await setFlag(key, value);
    res.json({ key, value, toggled: true });
  });

  // ─── Error Telemetry Report (admin) ────────────────
  app.get("/api/admin/error-report", requireAdminApiKey, (_req, res) => {
    res.json({ ...errorTelemetry.getReport(), timestamp: new Date().toISOString() });
  });

  // ─── Circuit Breaker Health (admin) ───────────────
  app.get("/api/admin/circuit-breakers", requireAdminApiKey, (_req, res) => {
    res.json({ breakers: getAllBreakerHealth(), timestamp: new Date().toISOString() });
  });

  // ─── Circuit Breaker Reset (admin) ────────────────
  app.post("/api/admin/circuit-breakers/reset", requireAdminApiKey, (_req, res) => {
    resetAllBreakers();
    res.json({ success: true, breakers: getAllBreakerHealth(), timestamp: new Date().toISOString() });
  });

  // ─── VAPI Voice Latency Observability (admin) ────
  // wave-181.4 · migrated from statenour-os v10.0.527 Arc A F4 per the
  // business-separation directive. Surfaces P50/P95 per stage + breach
  // streak + recommended-delta from the voice_latency_events table.
  app.get("/api/admin/voice-latency", requireAdminApiKey, async (req, res) => {
    try {
      const days = Math.max(1, Math.min(90, parseInt(String(req.query.days || "7"), 10) || 7));
      const { getVoiceLatencyState } = await import("../services/voice-latency");
      const state = await getVoiceLatencyState(days);
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── VAPI Call State (admin · Phase 4 · wave-181.63) ────────
  // Real-time view of in-flight VAPI calls + their current state in
  // the 4-state agent flow (greeted → intent_captured → tool_called →
  // confirmed). Backed by voice_latency_events with `state_<name>`
  // stage namespacing · zero migration cost. Drill in to a single
  // call's full state trail via ?callId=<vapi-uuid>.
  app.get("/api/admin/voice-call-states", requireAdminApiKey, async (req, res) => {
    try {
      const callId = typeof req.query.callId === "string" ? req.query.callId : null;
      const maxAgeMinutes = Math.max(
        1,
        Math.min(120, parseInt(String(req.query.maxAgeMin || "10"), 10) || 10),
      );
      const { getActiveCallStates, getCallStateHistory } = await import(
        "../services/voice-call-state"
      );
      if (callId) {
        // Single-call drill-in · full state trail oldest → newest.
        const history = await getCallStateHistory(callId);
        res.json({ callId, history });
        return;
      }
      // Roster view · all in-flight calls within the lookback window.
      const active = await getActiveCallStates({ maxAgeMinutes });
      res.json({
        windowMinutes: maxAgeMinutes,
        count: active.length,
        states: active,
        byState: active.reduce<Record<string, number>>((acc, s) => {
          acc[s.latestState] = (acc[s.latestState] ?? 0) + 1;
          return acc;
        }, {}),
      });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── VAPI Call Analytics (admin) ─────────────────
  // wave-181.4 · proxies VAPI's /call list endpoint with aggregations.
  // Migrated from statenour-os v10.0.269 (/api/system/vapi-calls).
  app.get("/api/admin/vapi-calls", requireAdminApiKey, async (req, res) => {
    const days = Math.max(1, Math.min(90, parseInt(String(req.query.days || "7"), 10) || 7));
    const since = new Date(Date.now() - days * 86_400_000);
    const apiKey = (process.env.VAPI_API_KEY || "").trim();
    if (!apiKey) {
      res.json({
        windowDays: days, sinceIso: since.toISOString(), totalCalls: 0,
        byStatus: {}, byEndedReason: {}, avgDurationSec: 0,
        mostRecent: null, totalCostUsd: 0, error: "VAPI_API_KEY not set",
      });
      return;
    }
    interface VapiCall {
      id: string;
      status?: string;
      endedReason?: string | null;
      createdAt?: string;
      startedAt?: string | null;
      endedAt?: string | null;
      cost?: number;
      costBreakdown?: { total?: number };
    }
    try {
      const r = await fetch(`https://api.vapi.ai/call?limit=100&createdAtGt=${encodeURIComponent(since.toISOString())}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        // wave-181.16 code-review F2 · was unbounded fetch. The cron
        // version uses AbortSignal.timeout(30_000). Admin tile UX wants
        // a faster fail, so 15s here so a slow VAPI doesn't starve the
        // Express request pool.
        signal: AbortSignal.timeout(15_000),
      });
      if (!r.ok) {
        res.json({
          windowDays: days, sinceIso: since.toISOString(), totalCalls: 0,
          byStatus: {}, byEndedReason: {}, avgDurationSec: 0,
          mostRecent: null, totalCostUsd: 0, error: `VAPI returned ${r.status}`,
        });
        return;
      }
      // wave-181.16 code-review F5 · was assuming VAPI's default sort.
      // Explicit DESC sort so calls[0] is guaranteed-most-recent
      // regardless of upstream behavior changes.
      const calls = ((await r.json()) as VapiCall[])
        .filter((c) => c.createdAt)
        .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
      const byStatus: Record<string, number> = {};
      const byEndedReason: Record<string, number> = {};
      let durationSum = 0;
      let durationCount = 0;
      let costSum = 0;
      for (const c of calls) {
        byStatus[c.status ?? "(unknown)"] = (byStatus[c.status ?? "(unknown)"] ?? 0) + 1;
        byEndedReason[c.endedReason ?? "(none)"] = (byEndedReason[c.endedReason ?? "(none)"] ?? 0) + 1;
        if (c.startedAt && c.endedAt) {
          const durMs = new Date(c.endedAt).getTime() - new Date(c.startedAt).getTime();
          if (durMs > 0) {
            durationSum += durMs;
            durationCount += 1;
          }
        }
        const cost = c.costBreakdown?.total ?? c.cost ?? 0;
        if (typeof cost === "number") costSum += cost;
      }
      const mostRecent = calls[0]
        ? {
            id: calls[0].id,
            createdAt: calls[0].createdAt,
            status: calls[0].status,
            endedReason: calls[0].endedReason,
            durationSec: calls[0].startedAt && calls[0].endedAt
              ? Math.round((new Date(calls[0].endedAt).getTime() - new Date(calls[0].startedAt).getTime()) / 1000)
              : null,
          }
        : null;
      res.json({
        windowDays: days, sinceIso: since.toISOString(), totalCalls: calls.length,
        byStatus, byEndedReason,
        avgDurationSec: durationCount > 0 ? Math.round(durationSum / durationCount / 1000) : 0,
        mostRecent, totalCostUsd: Number(costSum.toFixed(2)),
      });
    } catch (err) {
      // wave-181.16 code-review F4 · was returning bare { error } with 500,
      // diverging from the other two failure paths which return full shape
      // with 200. Statenour Ultron tile crashes if shape diverges. Now
      // uniformly returns the full shape with the error annotation.
      res.json({
        windowDays: days, sinceIso: since.toISOString(), totalCalls: 0,
        byStatus: {}, byEndedReason: {}, avgDurationSec: 0,
        mostRecent: null, totalCostUsd: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // ─── Bridge endpoint for statenour Ultron tile (read-only) ───
  // wave-181.4 · the statenour Ultron voice-latency-tile reads from
  // this endpoint after the VAPI migration. Auth via STATENOUR_SYNC_KEY
  // bearer matching the existing bridge pattern.
  app.get("/api/bridge/voice-latency", async (req, res) => {
    // wave-181.15 · silent-failure audit Finding #1 (CRITICAL security):
    // was using plain === for secret compare. Even though network noise
    // makes the timing-attack slow, every other bridge endpoint in this
    // repo (statenour-bridge-routes.ts, bridge-routes.ts, vapi.ts) uses
    // timingSafeEqual with length guard — this one regressed. Aligned
    // with the project pattern.
    const expected = (process.env.STATENOUR_SYNC_KEY || "").trim();
    const got = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
    if (
      !expected ||
      !got ||
      expected.length !== got.length ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(got))
    ) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    try {
      const days = Math.max(1, Math.min(90, parseInt(String(req.query.days || "7"), 10) || 7));
      const { getVoiceLatencyState } = await import("../services/voice-latency");
      const state = await getVoiceLatencyState(days);
      res.json(state);
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ─── PWA Push Notification Subscription ──────────────────
  app.post("/api/push/subscribe", express.json(), async (req, res) => {
    try {
      const { endpoint, keys, isAdmin, customerId } = req.body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        res.status(400).json({ error: "Missing subscription data" });
        return;
      }

      // v1.7 audit fix · pre-fix any anonymous caller could POST
      // { isAdmin: true, ... } and create an admin-flagged push
      // subscription, then receive admin push notifications. Now
      // isAdmin=true requires an admin API key on the request.
      let isAdminVerified = false;
      if (isAdmin) {
        const auth = req.headers.authorization;
        const expected = process.env.ADMIN_API_KEY;
        if (expected && typeof auth === "string") {
          const expectedFull = `Bearer ${expected}`;
          if (auth.length === expectedFull.length &&
              timingSafeEqual(Buffer.from(auth), Buffer.from(expectedFull))) {
            isAdminVerified = true;
          }
        }
        if (!isAdminVerified) {
          res.status(401).json({ error: "isAdmin requires admin API key" });
          return;
        }
      }

      const { getDb } = await import("../db");
      const { pushSubscriptions } = await import("../../drizzle/schema");
      const { eq } = await import("drizzle-orm");
      const { nanoid } = await import("nanoid");
      const db = await getDb();
      if (!db) { res.status(503).json({ error: "DB unavailable" }); return; }

      // Upsert — don't duplicate endpoints
      const existing = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint)).limit(1);
      if (existing.length > 0) {
        await db.update(pushSubscriptions).set({ p256dh: keys.p256dh, auth: keys.auth }).where(eq(pushSubscriptions.id, existing[0].id));
        res.json({ success: true, action: "updated" });
      } else {
        await db.insert(pushSubscriptions).values({ id: nanoid(), endpoint, p256dh: keys.p256dh, auth: keys.auth, isAdmin: isAdminVerified, customerId: customerId || null });
        res.json({ success: true, action: "created" });
      }
    } catch (err) {
      console.warn("[push:subscribe] failed:", err);
      res.status(500).json({ error: "Subscription failed" });
    }
  });

  app.get("/api/push/vapid-key", (_req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) { res.status(503).json({ error: "Push not configured" }); return; }
    res.json({ publicKey: key });
  });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // ─── NOUR OS Bridge REST Endpoints ─────────────────────
  // These are plain REST endpoints (not tRPC) that NOUR OS calls
  // to pull shop data. Authenticated via X-Bridge-Key header.
  // Higher body limit for bridge report ingestion (large JSON payloads)
  app.use("/api/bridge/ingest-reports", express.json({ limit: "20mb" }));
  registerBridgeRoutes(app);

  // ─── Statenour Bridge (v11.1 cross-ring contract) ─────
  // 5 endpoints authed via X-Statenour-Sync-Key header. See
  // docs/NICKSTIRE-QUERY-CONTRACT.md (mirror lives in statenour-os).
  registerStatenourBridgeRoutes(app);

  // ─── Nour Strategy — AI Lead Analysis ──────────────────
  registerNourStrategyRoute(app);

  // ─── AI Agent Endpoints ─────────────────────────────────
  registerPsychDominanceRoute(app);
  registerBurnoutRadarRoute(app);
  registerSimulatorRoute(app);
  registerNourChiefStrategistRoute(app);
  registerNourOsQueryRoute(app);

  // Higher body limit for photo upload (base64 encoded images up to 7.5MB)
  app.use("/api/trpc/booking.uploadPhoto", express.json({ limit: "12mb" }));

  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ path, error, ctx }) => {
        const route = path ? `/api/trpc/${path}` : "unknown";
        const requestId = ctx?.res?.locals?.requestId as string | undefined;
        serverLog.error(`[tRPC] ${route}: ${error.message}`, { route, requestId });
        errorTelemetry.record(error, { route, requestId });
      },
    })
  );
  // Sitemap.xml — powered by shared/routes.ts route registry + dynamic blog articles from DB
  app.get("/sitemap.xml", async (_req, res) => {
    const { SITEMAP_ROUTES, BLOG_SLUGS } = await import("@shared/routes");
    const { getPublishedArticles } = await import("../content-generator");
    const baseUrl = SITE_URL;
    const now = new Date().toISOString().split("T")[0];

    // Fetch published dynamic articles from DB
    let dynamicSlugs: string[] = [];
    try {
      const published = await getPublishedArticles();
      dynamicSlugs = published.map((a: any) => a.slug);
    } catch (err) {
      console.error("[Sitemap] Failed to fetch dynamic articles:", err instanceof Error ? err.message : err);
    }

    const allBlogSlugs = Array.from(new Set([...BLOG_SLUGS, ...dynamicSlugs]));

    const urls = [
      ...SITEMAP_ROUTES.map(p =>
        `  <url>\n    <loc>${baseUrl}${p.path}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
      ),
      ...allBlogSlugs.map(s =>
        `  <url>\n    <loc>${baseUrl}/blog/${s}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`
      ),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  });

  // Robots.txt — controls crawler access
  app.get("/robots.txt", (_req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(`User-agent: *
Allow: /

# Block admin, auth, and private pages
Disallow: /admin
Disallow: /admin/
Disallow: /my-garage
Disallow: /portal
Disallow: /api/
Disallow: /status/
Disallow: /inspection/
Disallow: /loyalty
Disallow: /referral

# Block tracking parameters only
Disallow: /*?utm_*
Disallow: /*?ref=*
Disallow: /*?fbclid=*
Disallow: /*?gclid=*

Crawl-delay: 1

Sitemap: ${SITE_URL}/sitemap.xml
Sitemap: ${SITE_URL}/sitemap-services.xml
Sitemap: ${SITE_URL}/sitemap-locations.xml
Sitemap: ${SITE_URL}/sitemap-images.xml
`);
  });

  // Sub-sitemaps for services and locations
  app.get("/sitemap-services.xml", async (_req, res) => {
    const { SITEMAP_ROUTES } = await import("@shared/routes");
    const baseUrl = SITE_URL;
    const now = new Date().toISOString().split("T")[0];
    const serviceRoutes = SITEMAP_ROUTES.filter(r =>
      r.group === "service" || r.group === "seo-service" || r.group === "vehicle" || r.group === "problem" || r.group === "seasonal"
    );
    const urls = serviceRoutes.map(p =>
      `  <url>\n    <loc>${baseUrl}${p.path}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
    );
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  });

  app.get("/sitemap-locations.xml", async (_req, res) => {
    const { SITEMAP_ROUTES } = await import("@shared/routes");
    const baseUrl = SITE_URL;
    const now = new Date().toISOString().split("T")[0];
    const locationRoutes = SITEMAP_ROUTES.filter(r =>
      r.group === "city" || r.group === "neighborhood"
    );
    const urls = locationRoutes.map(p =>
      `  <url>\n    <loc>${baseUrl}${p.path}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
    );
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  });

  // ─── Image Sitemap — surfaces shop photos in Google Image Search ───
  // 2026-05-06 SEO wave: maps real shop photos to the pages they
  // appear on so Google's image graph associates each photo with
  // its service intent. Every entry includes a description (alt
  // text) and title for richer image-search snippets.
  app.get("/sitemap-images.xml", async (_req, res) => {
    const baseUrl = SITE_URL;

    // Map: page-path → array of photos that appear on it. Mirrors
    // what's actually rendered on each page (PhotoRibbon + heros).
    // 2026-05-06 wave-16 · refreshed to surface the new pro photo pack
    // (14 new .webp files added in this wave) so Google Image Search
    // re-crawls and indexes them. Old photos that are no longer rendered
    // on these pages have been removed.
    type ImgEntry = { src: string; title: string; caption: string };
    const HOME_PHOTOS: ImgEntry[] = [
      { src: "/photos/shop-exterior-hero-wide-sign-bays.webp", title: "Nick's Tire & Auto storefront on Euclid Avenue Cleveland", caption: "Full yellow sign, open service bays, and tire stacks at Nick's Tire & Auto on Euclid Avenue in Cleveland." },
      { src: "/photos/bmw-premium-front-shop-sign.webp",       title: "BMW at Nick's Tire & Auto Cleveland",                       caption: "Maroon BMW convertible in front of Nick's Tire & Auto with the full shop sign visible — every make, even European." },
      { src: "/photos/busy-shop-action-mechanics.webp",        title: "Real techs working inside Nick's Tire & Auto",              caption: "Nick's Tire & Auto technicians working inside the tire and auto repair bay with tires and equipment around them." },
      { src: "/photos/rugged-tire-tread-closeup.webp",         title: "Aggressive tire tread closeup at Nick's Tire",              caption: "Close-up of aggressive tire tread at Nick's Tire & Auto showing deep tread blocks and rugged pattern." },
      { src: "/photos/parking-lot-cars.webp",                  title: "Lines of cars at Nick's Tire & Auto Cleveland",             caption: "Customer cars in line at the lot on a busy Cleveland Saturday." },
      { src: "/photos/exterior-winter-allweather.webp",        title: "Nick's Tire open through Cleveland winter storms",          caption: "Customers' cars in line during a Cleveland snowstorm — open every day." },
      { src: "/photos/interior-service-bay-car-lift.webp",     title: "Car on the lift inside Nick's Tire service bay",            caption: "Vehicle raised on a lift inside Nick's Tire & Auto service bay with tire inventory and shop equipment visible." },
      { src: "/photos/shop-exterior-busy-service-wide.webp",   title: "Busy service exterior at Nick's Tire Cleveland",            caption: "Nick's Tire & Auto service bays active with vehicles and technicians at the Euclid Avenue shop." },
    ];
    const TIRES_PHOTOS: ImgEntry[] = [
      { src: "/photos/rugged-tire-tread-closeup.webp",      title: "Tire authority — aggressive tread closeup",                 caption: "Close-up of aggressive tire tread at Nick's Tire & Auto Cleveland." },
      { src: "/photos/tire-wheel-changer-closeup.webp",     title: "Tire installation on the wheel changer",                    caption: "Tire mounted on a wheel at Nick's Tire & Auto on the tire changer machine during installation." },
      { src: "/photos/busy-shop-action-mechanics.webp",     title: "Real techs running tire installs",                          caption: "Nick's Tire & Auto technicians working tire installs inside the Cleveland shop bays." },
      { src: "/photos/shop-exterior-cones-vertical.webp",   title: "Pull-up tire line — cones guiding the lane",                caption: "Nick's Tire & Auto exterior with yellow and black lane cones, open bays, and tire stacks." },
      { src: "/photos/exterior-winter-allweather.webp",     title: "Same-day winter tire install Cleveland",                    caption: "Cleveland winter weather at Nick's Tire — same-day winter tire install." },
    ];
    const BRAKES_PHOTOS: ImgEntry[] = [
      { src: "/photos/undercar-brake-repair-action.webp", title: "Under-car brake repair at Nick's Tire Cleveland",           caption: "Underbody auto repair at Nick's Tire & Auto with a vehicle lifted and parts laid out on the shop floor." },
      { src: "/photos/interior-service-bay-car-lift.webp",title: "Brake job on the lift at Nick's Tire & Auto",                caption: "Vehicle raised on a lift inside Nick's Tire & Auto service bay with brake-job tools and tire inventory visible." },
      { src: "/photos/busy-shop-action-mechanics.webp",   title: "Multiple brake jobs running simultaneously",                 caption: "Nick's Tire & Auto technicians running brake jobs in the Cleveland bays." },
      { src: "/photos/parking-lot-cars.webp",             title: "Cars waiting for brake service at Nick's Tire",              caption: "Customer cars waiting for brake service in the lot." },
    ];
    const DIAGNOSTICS_PHOTOS: ImgEntry[] = [
      { src: "/photos/interior-service-bay-car-lift.webp",  title: "Cleveland diagnostic bay with car on lift",                caption: "Vehicle raised on a lift inside Nick's Tire & Auto service bay during diagnostic work." },
      { src: "/photos/busy-shop-action-mechanics.webp",     title: "Real techs running diagnostic jobs",                       caption: "Nick's Tire & Auto technicians running diagnostic jobs in the Cleveland shop bays." },
      { src: "/photos/front-desk.webp",                     title: "Diagnostic write-up at the front desk",                    caption: "Diagnostic write-up handed to a customer at the Nick's Tire & Auto front desk." },
      { src: "/photos/undercar-brake-repair-action.webp",   title: "Underbody inspection during diagnostic",                   caption: "Underbody inspection at Nick's Tire & Auto during the diagnostic process." },
    ];
    const ABOUT_PHOTOS: ImgEntry[] = [
      { src: "/photos/nicks-tire-auto-shop-sign-cleveland-ohio.webp",        title: "Nick's Tire & Auto shop sign — Cleveland Ohio",              caption: "Yellow Nick's Tire & Auto sign on Euclid Avenue in Cleveland Ohio with tire stacks and tire brand banners visible." },
      { src: "/photos/nicks-tire-auto-customer-waiting-area-cleveland.webp", title: "Customer waiting area inside Nick's Tire & Auto Cleveland",   caption: "Bright interior customer waiting area at Nick's Tire & Auto in Cleveland with a couch by the window, the 'Brakes Forever' wall sign, and tire displays." },
      { src: "/photos/nicks-tire-auto-shop-interior-cleveland-ohio.webp",    title: "Nick's Tire & Auto shop interior — Cleveland Ohio",           caption: "Wide interior shot of Nick's Tire & Auto shop in Cleveland Ohio with brake parts displays, tire stacks, sunlit lounge area, and customer parking visible through the window." },
      { src: "/photos/shop-exterior-hero-wide-sign-bays.webp",               title: "Nick's Tire & Auto storefront — Euclid Avenue Cleveland",    caption: "Full storefront with yellow sign and open service bays at Nick's Tire & Auto in Cleveland." },
      { src: "/photos/busy-shop-action-mechanics.webp",                      title: "Inside Nick's Tire & Auto — real techs at work",             caption: "Nick's Tire & Auto technicians working inside the tire and auto repair bay." },
    ];
    const CONTACT_PHOTOS: ImgEntry[] = [
      { src: "/photos/nicks-tire-auto-cleveland-euclid-ave-storefront.webp", title: "Nick's Tire & Auto storefront on Euclid Avenue Cleveland",    caption: "Wide street-view of Nick's Tire & Auto on Euclid Avenue in Cleveland Ohio with General Tire and Continental tire brand banners and red-white-blue tire displays in front." },
      { src: "/photos/roadside-sign-exterior-wide.webp",                     title: "Nick's Tire & Auto roadside sign — wayfinding",               caption: "Nick's Tire & Auto roadside sign and shop exterior on Euclid Avenue in Cleveland Ohio." },
      { src: "/photos/parking-lot-sign-perspective-wide.webp",               title: "Parking lot perspective at Nick's Tire & Auto",               caption: "Nick's Tire & Auto parking lot with roadside sign, parked vehicles, and service bays visible." },
    ];
    // wave-181.x · operator-supplied real-shop photos · indexed in image-sitemap
    // for Google Image Search ranking on direct query intent. Each filename
    // carries brand + geo + service keywords that match real GSC queries.
    const MOES_PHOTOS: ImgEntry[] = [
      { src: "/photos/moes-tire-euclid-cleveland-ohio-service-bays.webp", title: "Moe's Tire Euclid — now Nick's Tire & Auto · Cleveland Ohio service bays", caption: "Wide exterior photo of the Moe's Tire & Auto location on Euclid Avenue in Cleveland Ohio (now operating as Nick's Tire & Auto) showing four open service bays, BRAKE REPAIR, MUFFLER REPAIR, and OIL CHANGE signs, and priced tire stacks ready for install." },
    ];
    const TIRE_SHOP_NEAR_ME_PHOTOS: ImgEntry[] = [
      { src: "/photos/nicks-tire-auto-cleveland-euclid-ave-storefront.webp", title: "Tire shop near me Cleveland Ohio — Nick's Tire & Auto on Euclid Avenue", caption: "Real local tire shop in Cleveland Ohio — Nick's Tire & Auto storefront with General Tire and Continental brand banners, tire displays on the sidewalk, and open service bays on Euclid Avenue." },
      { src: "/photos/nicks-tire-auto-shop-sign-cleveland-ohio.webp",        title: "Nick's Tire & Auto shop sign — Cleveland tire shop on Euclid", caption: "Tire shop sign for Nick's Tire & Auto in Cleveland Ohio with the 'New Used Tires · We Fix Flats · Brakes · Oil Change' banner and tire stacks in front." },
    ];
    const AUTO_REPAIR_PHOTOS: ImgEntry[] = [
      { src: "/photos/auto-mechanic-tire-shop-cleveland-ohio.webp",            title: "Auto mechanic working on a customer's car at Nick's Tire & Auto Cleveland Ohio", caption: "Auto mechanic at Nick's Tire & Auto in Cleveland Ohio working under the hood of a blue Kia Stinger with the 'Mechanic on Duty Euclid Ave' sign visible and other customer cars in the lot waiting for service." },
      { src: "/photos/nicks-tire-brake-muffler-oil-change-cleveland-ohio.webp", title: "Brake repair, muffler repair, and oil change shop — Nick's Tire & Auto Cleveland", caption: "Exterior of Nick's Tire & Auto in Cleveland Ohio with prominent BRAKE REPAIR, MUFFLER REPAIR, and OIL CHANGE signs above the service bays plus priced tire stacks ready for install." },
    ];
    // wave-181.x · brake-page gets the explicit BRAKE REPAIR signage photo
    // appended to its existing under-car action shot for stronger image-search
    // signal on "brake repair near me" + "brake specials near me" GSC queries.
    BRAKES_PHOTOS.push({
      src: "/photos/nicks-tire-brake-muffler-oil-change-cleveland-ohio.webp",
      title: "Brake repair shop in Cleveland — Nick's Tire & Auto on Euclid Avenue",
      caption: "Brake repair shop signage at Nick's Tire & Auto in Cleveland Ohio with BRAKE REPAIR, MUFFLER REPAIR, and OIL CHANGE marquees above the service bays.",
    });

    const pages: Array<{ path: string; photos: ImgEntry[] }> = [
      { path: "/",                       photos: HOME_PHOTOS },
      { path: "/new-tires-cleveland",    photos: TIRES_PHOTOS },
      { path: "/used-tires-cleveland",   photos: TIRES_PHOTOS },
      { path: "/tires",                  photos: TIRES_PHOTOS },
      { path: "/brakes",                 photos: BRAKES_PHOTOS },
      { path: "/diagnostics",            photos: DIAGNOSTICS_PHOTOS },
      { path: "/about",                  photos: ABOUT_PHOTOS },
      { path: "/contact",                photos: CONTACT_PHOTOS },
      // wave-181.x · new entries · these pages now have hero photos that
      // match their search intent. Image-sitemap signals are the missing
      // link between the new photo files and Google Image Search rankings.
      { path: "/moes-tire-euclid",       photos: MOES_PHOTOS },
      { path: "/tire-shop-near-me",      photos: TIRE_SHOP_NEAR_ME_PHOTOS },
      { path: "/auto-repair-near-me",    photos: AUTO_REPAIR_PHOTOS },
    ];

    const escapeXml = (s: string) =>
      s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

    const urls = pages.map((p) => {
      const imageNodes = p.photos.map((img) =>
        `    <image:image>\n      <image:loc>${baseUrl}${img.src}</image:loc>\n      <image:title>${escapeXml(img.title)}</image:title>\n      <image:caption>${escapeXml(img.caption)}</image:caption>\n    </image:image>`
      ).join("\n");
      return `  <url>\n    <loc>${baseUrl}${p.path}</loc>\n${imageNodes}\n  </url>`;
    });

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join("\n")}
</urlset>`;
    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  });

  // ─── SMS Bot Webhook (Twilio) ───────────────────────────
  // Unified inbound SMS handler: runs booking bot + logs communication + parses intent
  // Protected by Twilio signature validation in production
  const { handleIncomingSMS } = await import("../routers/smsBot");
  const { validateTwilioRequest } = await import("../middleware/twilioValidation");
  app.post("/api/sms-webhook", express.urlencoded({ extended: false }), validateTwilioRequest, async (req, res) => {
    try {
      const { Body, From, MessageSid } = req.body;

      // Dedup — Twilio delivers inbound webhooks at-least-once. A
      // redelivery must not re-run the booking-bot state machine (it
      // would double-advance / re-save the booking), re-fire
      // executeAutoAction, or re-send the bot's TwiML reply. If this
      // MessageSid is already recorded, ack with empty TwiML and skip.
      const { getOrCreateConversation, addSmsMessage, smsMessageExists } = await import("../db");
      if (MessageSid && (await smsMessageExists(String(MessageSid)))) {
        console.warn(`[SMS] Duplicate inbound webhook ignored: ${String(MessageSid).slice(0, 12)}`);
        res.type("text/xml").send("<Response></Response>");
        return;
      }
      // Persist inbound — the conversation-thread record + the dedup
      // marker the check above reads.
      if (From && Body) {
        try {
          const conversation = await getOrCreateConversation(String(From));
          await addSmsMessage({
            conversationId: conversation.id,
            direction: "inbound",
            body: String(Body),
            twilioSid: MessageSid ? String(MessageSid) : undefined,
            status: "received",
          });
        } catch (persistErr) {
          console.warn("[SMS] Failed to persist inbound webhook SMS:", persistErr instanceof Error ? persistErr.message : persistErr);
        }
      }

      // 1. Run booking bot state machine (returns reply text)
      const reply = await handleIncomingSMS(From, Body);

      // 2. Log communication + parse intent (fire-and-forget)
      import("../services/smsResponseParser").then(async ({ parseSmsResponse, executeAutoAction }) => {
        const parsed = parseSmsResponse(Body);
        // Execute auto-actions for high-confidence intents (confirm, cancel, approve)
        if (parsed.autoAction && !parsed.requiresHuman) {
          await executeAutoAction(parsed, From);
        }
        // Log to communication table
        const { getDb } = await import("../db");
        const { communicationLog } = await import("../../drizzle/schema");
        const db = await getDb();
        if (db) {
          await db.insert(communicationLog).values({
            customerPhone: From,
            type: "sms",
            direction: "inbound",
            body: (Body || "").slice(0, 5000),
            metadata: { parsedIntent: parsed.intent, botReply: reply.slice(0, 200) },
          });
        }
      }).catch((err) => console.warn("[SMS] Background processing error:", err instanceof Error ? err.message : err));

      // XML-escape the reply to prevent malformed Twilio responses
      const safeReply = reply.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      res.type("text/xml").send(`<Response><Message>${safeReply}</Message></Response>`);
    } catch (err) {
      console.error("[SMS Webhook] Error:", err);
      res.type("text/xml").send("<Response></Response>");
    }
  });

  // ─── Voice Webhooks (Twilio) ──────────────────────────
  // Mount AI voice receptionist endpoints
  const { twilioWebhookRouter } = await import("../routes/webhooks/twilio");
  // CRITICAL: Mount ONLY on /api/v1/webhooks — NOT app.use(router) globally.
  // Global mount applies Twilio signature validation to ALL requests (including
  // homepage/admin), returning 403 + XML <Response/> and blocking the entire site.
  // The router defines routes with full paths (/api/v1/webhooks/...) so we mount
  // at /api/v1/webhooks to scope the validation middleware to only webhook requests.
  app.use("/api/v1/webhooks", twilioWebhookRouter);

  // ─── Vapi Webhook (AI receptionist) ────────────────────
  // Vapi posts tool calls + call lifecycle events to /api/webhooks/vapi.
  // The webhook router handles signature validation + tool dispatch.
  // Mounted at /api/webhooks (not /api/v1/webhooks) to keep Twilio's
  // signature middleware off this route.
  const { vapiWebhookRouter } = await import("../routes/webhooks/vapi");
  app.use("/api/webhooks", vapiWebhookRouter);

  // ─── SMS Gateway Webhook (Shop Phone — Samsung F25e) ────
  // Wave-103 — SMS Gateway by Capevace cloud relay POSTs here for
  // inbound customer texts to 216-862-0005, plus delivery receipts.
  // Mounted at /api/webhooks (no Twilio middleware). HMAC validated
  // inside the router itself.
  const { smsGatewayWebhookRouter } = await import("../routes/webhooks/smsGateway");
  app.use("/api/webhooks", smsGatewayWebhookRouter);

  // wave-181.87 · AgentPhone webhook removed (operator preference ·
  // VAPI handles outbound confirmation + recovery calls via the existing
  // /api/webhooks/vapi handler · which now dispatches by callId lookup
  // across confirmation_calls + alg_estimates voice_recovery_call_id).

  // ─── Stripe Webhook ─────────────────────────────────────
  // Receives payment_intent.succeeded events to confirm invoice payments
  // even if the client drops before calling confirmPayment
  app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"] as string | undefined;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      // Stripe webhooks not configured — skip silently
      return res.sendStatus(200);
    }

    const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      // Misconfigured: webhook secret set but no API key. Ack so Stripe
      // doesn't retry a request that can never succeed — and log loudly.
      serverLog.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET is set but STRIPE_SECRET_KEY is missing");
      return res.sendStatus(200);
    }

    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(stripeSecretKey);
      const event = stripe.webhooks.constructEvent(req.body, sig || "", webhookSecret);

      if (event.type === "payment_intent.succeeded") {
        const intent = event.data.object as any;
        const invoiceNumber = intent.metadata?.invoiceNumber;
        // Skip for tire orders — finalizeTireOrderPayment (below) owns the
        // invoice update for those, including the correct collected total.
        if (invoiceNumber && !intent.metadata?.tireOrderNumber) {
          const { getDb } = await import("../db");
          const { invoices } = await import("../../drizzle/schema");
          const { and, eq, ne } = await import("drizzle-orm");
          const d = await getDb();
          if (d) {
            // 2026-05-23 · idempotency claim. Pre-fix the UPDATE ran on
            // every Stripe retry (network blip / 5xx response → Stripe
            // retries the same event) — second invocation duplicated the
            // invoicePaid emit which fan-out triggers manager SMS +
            // journey tracker + Telegram + push notifications. Now the
            // conditional WHERE means only the first event claims the
            // payment; subsequent retries change zero rows and skip emit.
            const result = await d.update(invoices)
              .set({ paymentStatus: "paid", paymentMethod: "card" })
              .where(and(
                eq(invoices.invoiceNumber, invoiceNumber),
                ne(invoices.paymentStatus, "paid"),
              ));
            // mysql2 returns affectedRows; drizzle wraps it.
            const affected = (result as unknown as { affectedRows?: number; rowsAffected?: number })?.affectedRows
              ?? (result as unknown as { affectedRows?: number; rowsAffected?: number })?.rowsAffected ?? 0;

            if (affected === 1) {
              // First-time claim — fan out.
              import("../services/eventBus").then(({ emit }) =>
                emit.invoicePaid({
                  invoiceNumber,
                  customerName: intent.metadata?.customerName || "Online payment",
                  totalAmount: (intent.amount_received || 0) / 100,
                  method: "card",
                })
              ).catch(e => console.warn("[server:stripeWebhook] event bus invoice paid dispatch failed:", e));

              serverLog.info(`[Stripe Webhook] Invoice ${invoiceNumber} marked paid — $${((intent.amount_received || 0) / 100).toFixed(2)}`);
            } else {
              serverLog.info(`[Stripe Webhook] Invoice ${invoiceNumber} retry — already paid, skipping fan-out (affected=${affected})`);
            }
          }
        }
        // Tire-order checkouts surface here too — the metadata is mirrored
        // onto the PaymentIntent, so payment is finalised even if the
        // Stripe endpoint isn't subscribed to checkout.session.completed.
        if (intent.metadata?.tireOrderNumber) {
          const { finalizeTireOrderPayment } = await import("../services/payments");
          await finalizeTireOrderPayment({
            tireOrderNumber: intent.metadata.tireOrderNumber,
            invoiceNumber: intent.metadata.invoiceNumber,
            amountCents: intent.amount_received || 0,
          });
        }
      }

      // Tire-order checkout completed — finalises the order (idempotent;
      // the payment_intent.succeeded branch above is the fallback path).
      if (event.type === "checkout.session.completed") {
        const session = event.data.object as any;
        const tireOrderNumber = session.metadata?.tireOrderNumber as string | undefined;
        if (session.payment_status === "paid" && tireOrderNumber) {
          const { finalizeTireOrderPayment } = await import("../services/payments");
          await finalizeTireOrderPayment({
            tireOrderNumber,
            invoiceNumber: session.metadata?.invoiceNumber,
            amountCents: session.amount_total || 0,
          });
        }
      }

      res.sendStatus(200);
    } catch (err) {
      serverLog.error("[Stripe Webhook] Verification failed:", { error: err instanceof Error ? err.message : String(err) });
      res.status(400).send("Webhook signature verification failed");
    }
  });

  // ─── Review click tracking redirect ───────────────────
  // When a customer clicks the review link in their SMS, this endpoint:
  // 1. Records the click in the database
  // 2. Redirects them to the actual Google review page
  const { GBP_REVIEW_URL: GOOGLE_REVIEW_URL } = await import("@shared/const");
  app.get("/api/review-click/:token", async (req, res) => {
    try {
      const { token } = req.params;
      if (token && token.length <= 64) {
        const { markReviewRequestClicked } = await import("../db");
        await markReviewRequestClicked(token);
      }
    } catch (err) {
      console.error("[ReviewClick] Error tracking click:", err);
    }
    // Always redirect to Google review page, even if tracking fails
    res.redirect(302, GOOGLE_REVIEW_URL);
  });

  // NOTE: Review request queue, reminder queue, and post-invoice follow-ups
  // are handled by the tiered scheduler (cron/scheduler.ts) — no duplicate
  // setInterval timers needed here. Removed to save ~3 timer + import overhead.

  // ─── Facebook Messenger Webhook ──────────────────────
  // Webhook verification for Facebook Messenger
  app.get("/api/messenger-webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    const fbToken = process.env.FB_VERIFY_TOKEN;
    const tokenStr = typeof token === "string" ? token : "";
    const isValid = mode === "subscribe" && fbToken && tokenStr.length === fbToken.length &&
      timingSafeEqual(Buffer.from(tokenStr), Buffer.from(fbToken));
    if (isValid) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  // Incoming Messenger messages — validate X-Hub-Signature-256 to prevent forged requests
  app.post("/api/messenger-webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const appSecret = process.env.FB_APP_SECRET;

    // v1.7 audit fix · pre-fix the verify block was conditional on
    // appSecret being set; if it wasn't set, ANY caller could send
    // forged Messenger events that triggered handleMessengerMessage.
    // Stripe/Twilio/Snap webhooks all hard-fail when their secret is
    // unset; Messenger was the lone outlier. Now consistent.
    if (!appSecret) {
      console.warn("[Messenger] Webhook called but FB_APP_SECRET unset — rejecting");
      return res.status(503).json({ error: "Messenger webhook not configured" });
    }
    if (!signature) {
      console.warn("[Messenger] Missing X-Hub-Signature-256 header");
      return res.sendStatus(403);
    }
    const { createHmac } = await import("crypto");
    const expectedSig = "sha256=" + createHmac("sha256", appSecret).update(req.body).digest("hex");
    if (signature.length !== expectedSig.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      console.warn("[Messenger] Invalid signature — possible forged request");
      return res.sendStatus(403);
    }

    // wave-181.65 (bug-hunter deeper pass) · JSON.parse was unguarded.
    // A valid-HMAC-signed body that's malformed JSON (transit corruption,
    // Facebook API misbehavior, or a sufficiently-motivated attacker with
    // app secret) would throw an unhandled rejection inside this async
    // Express handler. Wrap + validate shape before iterating so the
    // for-of loops below can't crash on unexpected types.
    let body: { object?: string; entry?: Array<{ messaging?: Array<{ message?: { text?: string }; sender?: { id?: string } }> }> };
    try {
      body = JSON.parse(req.body.toString());
    } catch (err) {
      console.warn("[Messenger] Webhook body was not valid JSON", { err: err instanceof Error ? err.message : String(err) });
      return res.status(400).json({ error: "invalid json body" });
    }

    if (body && body.object === "page" && Array.isArray(body.entry)) {
      for (const entry of body.entry) {
        if (!entry || !Array.isArray(entry.messaging)) continue;
        for (const event of entry.messaging) {
          if (event?.message?.text && event.sender?.id) {
            const { handleMessengerMessage } = await import(
              "../routers/messengerBot"
            );
            await handleMessengerMessage(event.sender.id, event.message.text);
          }
        }
      }
    }

    res.sendStatus(200);
  });

  // URL canonicalization — 301 redirects for duplicate SEO aliases.
  // Must run BEFORE prerender middleware so bots hitting alias URLs get
  // redirected to the canonical URL immediately (no stale prerender served).
  {
    const { installRedirects } = await import("./redirects");
    installRedirects(app);
  }

  // Prerender middleware — serve static HTML to bots for SEO
  // In production, prerendered files live in dist/prerendered/
  // In development, they may exist in dist/prerendered/ from a prior build
  {
    // Check multiple prerender locations (dist/prerendered, or project root /prerendered)
    const candidates = [
      path.resolve(import.meta.dirname, "prerendered"), // dist/prerendered (production build)
      path.resolve(import.meta.dirname, "..", "prerendered"), // project root /prerendered (git-tracked)
      path.resolve(import.meta.dirname, "../..", "prerendered"), // project root from nested dist
      path.resolve(import.meta.dirname, "../..", "dist", "prerendered"), // dev: dist/prerendered
    ];
    const prerenderedDir = candidates.find(d => fs.existsSync(d)) || candidates[0];
    app.use(createPrerenderMiddleware(prerenderedDir));
  }

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000", 10);
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.info(`[server:init] Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    const mem = process.memoryUsage();
    const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    console.info(`[server:ready] http://localhost:${port}/ | Memory: heap=${heapMB}MB rss=${rssMB}MB`);

    // wave-181.26 · arm admin-activity for 2 min post-restart so the
    // first pulse-tier pass of ShopDriver/ALG mirrors doesn't skip
    // with "admin inactive." Without this, post-Railway-restart
    // invoice + estimate data on the dashboard can be 25+ min stale.
    import("../lib/adminActivity").then(({ armAdminActivityForStartup }) => {
      armAdminActivityForStartup();
      console.info("[server:ready] admin-activity armed for 2 min post-startup grace (catches first ALG/ShopDriver mirror pass)");
    }).catch((err) => {
      console.error("[server:ready] adminActivity startup arm failed:", err);
    });
  });
}

// ─── Graceful Shutdown on Unhandled Rejection ───────
// The logger already catches uncaughtException (exits) and unhandledRejection (logs).
// This adds graceful HTTP server shutdown so in-flight requests finish before exit.
let shuttingDown = false;

process.on("unhandledRejection", (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  serverLog.error("Unhandled rejection detected in server process", { error: msg });
  errorTelemetry.record(
    reason instanceof Error ? reason : new Error(msg),
    { route: "process:unhandledRejection" }
  );
});

process.on("SIGTERM", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  serverLog.info("SIGTERM received — starting graceful shutdown");

  // 1. Stop accepting new connections
  _httpServer?.close(() => serverLog.info("HTTP server closed"));

  // 2. Stop all timers (cron, SMS queue, Telegram batch, NOUR OS retry)
  try { require("../cron/scheduler").stopTieredScheduler(); } catch (e) { console.warn("[server:shutdown] scheduler stop failed:", e); }
  try { require("../sms").stopDelayedQueueProcessor(); } catch (e) { console.warn("[server:shutdown] SMS queue stop failed:", e); }
  try { require("../services/telegram").stopBatchTimer?.(); } catch (e) { console.warn("[server:shutdown] Telegram timer stop failed:", e); }
  try { require("../nour-os-bridge").stopRetryProcessor?.(); } catch (e) { console.warn("[server:shutdown] NOUR OS bridge stop failed:", e); }

  // 3. Give in-flight requests 10s to finish, then force exit
  setTimeout(() => {
    serverLog.warn("Graceful shutdown timeout — forcing exit");
    process.exit(1);
  }, 10_000).unref();
});

startServer().catch((err) => {
  serverLog.fatal("Server failed to start", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
