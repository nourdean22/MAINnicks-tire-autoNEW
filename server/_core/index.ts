import "dotenv/config";
import { timingSafeEqual, randomUUID } from "crypto";

// ─── Startup env validation ─────────────────────────
const REQUIRED_ENV = ["DATABASE_URL", "JWT_SECRET"] as const;
const RECOMMENDED_ENV = [
  "OWNER_OPEN_ID", "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
  "BRIDGE_API_KEY", "OPENAI_API_KEY",
] as const;

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
import { healthHandler, pingHandler, readyHandler, recoverHandler } from "../lib/health";
import { startSelfHealing, recordRequest } from "../lib/self-healing";
import { createLogger } from "../lib/logger";
import { errorTelemetry } from "../lib/error-telemetry";
import { getAllBreakerHealth, resetAllBreakers } from "../lib/circuit-breaker";
import { AppError, isAppError, errorToHttpResponse } from "../lib/errors";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createPrerenderMiddleware } from "../prerender-middleware";
import { SITEMAP_ROUTES, BLOG_SLUGS } from "@shared/routes";
import { getPublishedArticles } from "../content-generator";
import { markReviewRequestClicked } from "../db";
import { processReviewRequestQueue } from "../routers/reviewRequests";
import { processReminderQueue } from "../routers/reminders";
import { processPostInvoiceFollowUps } from "../postInvoiceFollowUp";
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
  // Compression — gzip/deflate all responses (fixes Ahrefs "Not compressed" for all pages)
  app.use(compression({ threshold: 1024 }));
  // Body parser — 2MB default, photo uploads handled separately
  app.use(express.json({ limit: "2mb" }));
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

  // Security headers — hardened per OWASP recommendations
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    // X-XSS-Protection: 0 — modern best practice, the legacy XSS auditor causes more
    // vulnerabilities than it prevents. CSP is the real protection.
    res.setHeader("X-XSS-Protection", "0");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    // Content Security Policy
    res.setHeader("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://connect.facebook.net https://www.google-analytics.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https: http:",
      "connect-src 'self' https://www.google-analytics.com https://www.facebook.com https://d2xsxph8kpxj0f.cloudfront.net https://api.nhtsa.gov",
      "frame-src https://www.google.com https://maps.google.com",
      "media-src 'self' blob:",
      "frame-ancestors 'none'",
    ].join("; "));
    next();
  });
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
  app.post("/api/health/recover", recoverHandler);

  // ─── Self-Healing Monitor ─────────────────────────────
  startSelfHealing();

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
    ];
    let applied = 0;
    for (const stmt of alters) {
      try { await db.execute(sql.raw(stmt)); applied++; } catch {}
    }
    if (applied > 0) serverLog.info(`Schema migrations: ${applied} column checks passed`);
  }).catch(() => {});

  // ─── Feature Flag Seeding (idempotent) ─────────────────
  import("../services/featureFlags").then(({ seedFlags }) => {
    seedFlags().then(({ seeded, skipped }) => {
      if (seeded > 0) serverLog.info(`Feature flags seeded: ${seeded} new, ${skipped} existing`);
    }).catch(err => serverLog.warn("Feature flag seeding failed", { error: err instanceof Error ? err.message : String(err) }));
  });

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
  }).catch(() => {});
  import("../services/telegram").then(({ startBatchTimer }) => {
    startBatchTimer();
    serverLog.info("Telegram batch timer started");
  }).catch(() => {});
  import("../nour-os-bridge").then(({ startRetryProcessor }) => {
    startRetryProcessor();
    serverLog.info("NOUR OS bridge retry processor started");
  }).catch(() => {});

  // ─── Real-time SSE for admin dashboards ─────────────────
  import("../services/realtimePush").then(({ sseHandler }) => {
    app.get("/api/admin/events", sseHandler);
    serverLog.info("SSE endpoint registered: /api/admin/events");
  }).catch(() => {});

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

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);

  // ─── NOUR OS Bridge REST Endpoints ─────────────────────
  // These are plain REST endpoints (not tRPC) that NOUR OS calls
  // to pull shop data. Authenticated via X-Bridge-Key header.
  registerBridgeRoutes(app);

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
`);
  });

  // Sub-sitemaps for services and locations
  app.get("/sitemap-services.xml", (_req, res) => {
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

  app.get("/sitemap-locations.xml", (_req, res) => {
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

  // ─── SMS Bot Webhook (Twilio) ───────────────────────────
  // Unified inbound SMS handler: runs booking bot + logs communication + parses intent
  // Protected by Twilio signature validation in production
  const { handleIncomingSMS } = await import("../routers/smsBot");
  const { validateTwilioRequest } = await import("../middleware/twilioValidation");
  app.post("/api/sms-webhook", express.urlencoded({ extended: false }), validateTwilioRequest, async (req, res) => {
    try {
      const { Body, From } = req.body;
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
  app.use(twilioWebhookRouter);

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

    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
      const event = stripe.webhooks.constructEvent(req.body, sig || "", webhookSecret);

      if (event.type === "payment_intent.succeeded") {
        const intent = event.data.object as any;
        const invoiceNumber = intent.metadata?.invoiceNumber;
        if (invoiceNumber) {
          const { getDb } = await import("../db");
          const { invoices } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const d = await getDb();
          if (d) {
            await d.update(invoices)
              .set({ paymentStatus: "paid", paymentMethod: "card" })
              .where(eq(invoices.invoiceNumber, invoiceNumber));

            // Emit event
            import("../services/eventBus").then(({ emit }) =>
              emit.invoicePaid({
                invoiceNumber,
                customerName: intent.metadata?.customerName || "Online payment",
                totalAmount: (intent.amount_received || 0) / 100,
                method: "card",
              })
            ).catch(() => {});

            serverLog.info(`[Stripe Webhook] Invoice ${invoiceNumber} marked paid — $${((intent.amount_received || 0) / 100).toFixed(2)}`);
          }
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
        await markReviewRequestClicked(token);
      }
    } catch (err) {
      console.error("[ReviewClick] Error tracking click:", err);
    }
    // Always redirect to Google review page, even if tracking fails
    res.redirect(302, GOOGLE_REVIEW_URL);
  });

  // ─── Periodic review request queue processor ──────────
  // Checks every 5 minutes for pending review requests that are past their scheduled time
  setInterval(async () => {
    try {
      const result = await processReviewRequestQueue();
      if (result.processed > 0) {
        console.log(`[ReviewRequest] Queue processed: ${result.sent} sent, ${result.failed} failed`);
      }
    } catch (err) {
      console.error("[ReviewRequest] Queue processing error:", err);
    }
  }, 5 * 60 * 1000); // Every 5 minutes

  // Periodic maintenance reminder queue processor
  // Checks every 15 minutes for reminders that are past their nextDueDate
  setInterval(async () => {
    try {
      const result = await processReminderQueue();
      if (result.processed > 0) {
        console.log(`[Reminders] Queue processed: ${result.sent} sent, ${result.failed} failed`);
      }
    } catch (err) {
      console.error("[Reminders] Queue processing error:", err);
    }
  }, 15 * 60 * 1000); // Every 15 minutes

  // ─── Automated 7-day post-invoice follow-up ──────────
  // Checks every hour for customers whose last visit was 7 days ago
  // Sends thank you + review request + referral text (same as campaign)
  setInterval(async () => {
    try {
      const result = await processPostInvoiceFollowUps();
      if (result.processed > 0) {
        console.log(`[PostInvoiceFollowUp] Processed: ${result.sent} sent, ${result.failed} failed out of ${result.processed}`);
      }
    } catch (err) {
      console.error("[PostInvoiceFollowUp] Processing error:", err);
    }
  }, 60 * 60 * 1000); // Every 1 hour

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

    // Verify signature if FB_APP_SECRET is configured
    if (appSecret) {
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
    }

    const body = JSON.parse(req.body.toString());

    if (body.object === "page") {
      for (const entry of body.entry || []) {
        for (const event of entry.messaging || []) {
          if (event.message?.text) {
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
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
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
  try { require("../cron/scheduler").stopTieredScheduler(); } catch {}
  try { require("../sms").stopDelayedQueueProcessor(); } catch {}
  try { require("../services/telegram").stopBatchTimer?.(); } catch {}
  try { require("../nour-os-bridge").stopRetryProcessor?.(); } catch {}

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
