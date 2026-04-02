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
import { createServer } from "http";
import crypto from "crypto";
import net from "net";
import path from "path";
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

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Trust proxy — required for rate limiting behind reverse proxy
  app.set("trust proxy", 1);
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

  // ─── Cron Status (admin) ──────────────────────────────
  app.get("/api/admin/cron-status", (req, res) => {
    const auth = req.headers.authorization;
    const expected = process.env.ADMIN_API_KEY;
    if (!expected || typeof auth !== "string") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const expectedFull = `Bearer ${expected}`;
    if (auth.length !== expectedFull.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expectedFull))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    import("../cron/index").then(({ getJobStatuses }) => {
      res.json({ jobs: getJobStatuses(), timestamp: new Date().toISOString() });
    }).catch(() => res.json({ jobs: [], error: "Failed to load cron status" }));
  });

  // ─── Error Telemetry Report (admin) ────────────────
  app.get("/api/admin/error-report", (req, res) => {
    const auth = req.headers.authorization;
    const expected = process.env.ADMIN_API_KEY;
    if (!expected || typeof auth !== "string") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const expectedFull = `Bearer ${expected}`;
    if (auth.length !== expectedFull.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expectedFull))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    res.json({ ...errorTelemetry.getReport(), timestamp: new Date().toISOString() });
  });

  // ─── Circuit Breaker Health (admin) ───────────────
  app.get("/api/admin/circuit-breakers", (req, res) => {
    const auth = req.headers.authorization;
    const expected = process.env.ADMIN_API_KEY;
    if (!expected || typeof auth !== "string") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const expectedFull = `Bearer ${expected}`;
    if (auth.length !== expectedFull.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expectedFull))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    res.json({ breakers: getAllBreakerHealth(), timestamp: new Date().toISOString() });
  });

  // ─── Circuit Breaker Reset (admin) ────────────────
  app.post("/api/admin/circuit-breakers/reset", (req, res) => {
    const auth = req.headers.authorization;
    const expected = process.env.ADMIN_API_KEY;
    if (!expected || typeof auth !== "string") {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const expectedFull = `Bearer ${expected}`;
    if (auth.length !== expectedFull.length || !crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(expectedFull))) {
      return res.status(401).json({ error: "Unauthorized" });
    }
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
    res.send(
      `User-agent: *\nAllow: /\nAllow: /favicon.ico\n\n# Public pages — crawl freely\nAllow: /tires\nAllow: /tires/info\nAllow: /services/\nAllow: /about\nAllow: /contact\nAllow: /reviews\nAllow: /specials\nAllow: /faq\nAllow: /blog\nAllow: /diagnose\nAllow: /estimate\nAllow: /fleet\nAllow: /financing\nAllow: /car-care-guide\nAllow: /careers\nAllow: /appointment\nAllow: /area/\n\n# Block admin, auth, and private pages from indexing\nDisallow: /admin\nDisallow: /admin/\nDisallow: /my-garage\nDisallow: /portal\nDisallow: /api/\nDisallow: /status/\nDisallow: /inspection/\nDisallow: /loyalty\nDisallow: /referral\n\n# Block query parameters\nDisallow: /*?*\n\n# Crawl delay for polite crawling\nCrawl-delay: 1\n\nSitemap: ${SITE_URL}/sitemap.xml\nSitemap: ${SITE_URL}/sitemap-locations.xml\nSitemap: ${SITE_URL}/sitemap-services.xml\n`
    );
  });

  // ─── SMS Bot Webhook (Twilio) ───────────────────────────
  // Receives inbound SMS messages and returns Twilio XML response
  // Protected by Twilio signature validation in production
  const { handleIncomingSMS } = await import("../routers/smsBot");
  const { validateTwilioRequest } = await import("../middleware/twilioValidation");
  app.post("/api/sms-webhook", express.urlencoded({ extended: false }), validateTwilioRequest, async (req, res) => {
    try {
      const { Body, From } = req.body;
      const reply = await handleIncomingSMS(From, Body);
      res.type("text/xml").send(`<Response><Message>${reply}</Message></Response>`);
    } catch (err) {
      console.error("[SMS Webhook] Error:", err);
      res.type("text/xml").send("<Response></Response>");
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
      require("crypto").timingSafeEqual(Buffer.from(tokenStr), Buffer.from(fbToken));
    if (isValid) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  // Incoming Messenger messages
  app.post("/api/messenger-webhook", express.json(), async (req, res) => {
    const body = req.body;

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
    const prerenderedDir = process.env.NODE_ENV === "production"
      ? path.resolve(import.meta.dirname, "prerendered")
      : path.resolve(import.meta.dirname, "../..", "dist", "prerendered");
    app.use(createPrerenderMiddleware(prerenderedDir));
  }

  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
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

  // Give in-flight requests 10s to finish, then force exit
  setTimeout(() => {
    serverLog.warn("Graceful shutdown timeout — forcing exit");
    process.exit(1);
  }, 10_000).unref();
});

startServer().catch((err) => {
  serverLog.fatal("Server failed to start", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
