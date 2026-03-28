import "dotenv/config";
import express from "express";
import compression from "compression";
import { createServer } from "http";
import net from "net";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import rateLimit from "express-rate-limit";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createPrerenderMiddleware } from "../prerender-middleware";
import { SITEMAP_ROUTES, BLOG_SLUGS } from "@shared/routes";
import { getPublishedArticles } from "../content-generator";
import { markReviewRequestClicked } from "../db";
import { SITE_URL } from "@shared/business";
import { serverCache } from "../cache";
import { logger, createRequestLogger } from "../logger";
import { securityScan } from "../security-audit";

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
  const startTime = Date.now();

  // Trust proxy — required for rate limiting behind reverse proxy
  app.set("trust proxy", 1);

  // ─── GZIP / BROTLI Compression ────────────────────────
  // Compresses all responses > 1KB. Cuts payload size 60-80%.
  app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  }));

  // ─── Structured request logging ──────────────────────
  app.use(createRequestLogger());

  // ─── Performance monitoring (tracks response times per endpoint) ──
  import("../middleware/performanceMonitor").then(({ performanceMiddleware }) => {
    app.use(performanceMiddleware);
  }).catch(() => { /* Performance monitor not critical */ });

  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  // ─── Security scan (XSS, SQLi, path traversal) ──────
  app.use(securityScan());

  // ─── Security headers (CSP + hardened) ────────────────
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
    // Content Security Policy — restrict resource origins
    res.setHeader("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://maps.googleapis.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https://d2xsxph8kpxj0f.cloudfront.net https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://lh3.googleusercontent.com",
      "connect-src 'self' https://d2xsxph8kpxj0f.cloudfront.net https://www.google-analytics.com https://maps.googleapis.com https://api.openai.com",
      "frame-src 'self' https://www.google.com https://maps.google.com",
      "media-src 'self' https://d2xsxph8kpxj0f.cloudfront.net",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "));
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    }
    next();
  });

  // ─── Health check, ping, & readiness endpoints ──────
  app.get("/api/ping", (_req, res) => { res.json({ pong: true, timestamp: Date.now() }); });

  app.get("/api/health", async (_req, res) => {
    const { healthHandler } = await import("../lib/health");
    await healthHandler(_req, res);
  });

  // ─── Cron trigger endpoint (called by Railway worker) ──
  app.post("/api/cron/:jobName", express.json(), async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers["x-cron-secret"] !== cronSecret) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    const { jobName } = req.params;
    try {
      const { registerAllJobs } = await import("../cron/index");
      const { runJobByName } = await import("../cron/index");
      const result = await runJobByName(jobName);
      res.json({ job: jobName, ...result });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    }
  });

  app.get("/api/ready", async (_req, res) => {
    try {
      const { getDb } = await import("../db");
      const db = await getDb();
      if (!db) throw new Error("Database not connected");
      res.json({ status: "ready", database: "connected" });
    } catch (err: any) {
      res.status(503).json({ status: "not_ready", database: err.message });
    }
  });
  // ─── Tracking Rate Limiter ─────────────────────────
  const trackingLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false,
    message: { error: "Rate limited" },
  });

  // ─── Client Error Tracking ──────────────────────────
  app.post("/api/track-error", trackingLimiter, async (req, res) => {
    const { message, stack, breadcrumbs, url, userAgent, componentStack } = req.body || {};
    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Missing error message" });
    }
    const errorData = {
      message: String(message).slice(0, 1000),
      stack: stack ? String(stack).slice(0, 2000) : undefined,
      url: url ? String(url).slice(0, 500) : undefined,
      userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined,
      componentStack: componentStack ? String(componentStack).slice(0, 1000) : undefined,
      breadcrumbs: Array.isArray(breadcrumbs) ? breadcrumbs.slice(-5) : undefined,
    };
    logger.error("[CLIENT ERROR]", errorData);
    // Persist to errorLog table
    try {
      const { getDb } = await import("../db");
      const { errorLog } = await import("../../drizzle/schema");
      const db = await getDb();
      if (db) {
        await db.insert(errorLog).values({
          source: "client",
          message: errorData.message,
          stack: errorData.stack || null,
          url: errorData.url || null,
          userAgent: errorData.userAgent || null,
          metadata: { breadcrumbs: errorData.breadcrumbs, componentStack: errorData.componentStack },
        });
      }
    } catch {
      // Don't let persistence failures break error reporting
    }
    res.json({ ok: true });
  });

  // ─── 404 Tracking ─────────────────────────────────────
  const notFoundLog: Map<string, { count: number; referrer: string; lastSeen: number }> = new Map();
  app.post("/api/track-404", trackingLimiter, (req, res) => {
    const { url, referrer } = req.body || {};
    if (!url || typeof url !== "string") return res.status(400).json({ error: "Missing url" });
    const key = String(url).slice(0, 500);
    const existing = notFoundLog.get(key);
    if (existing) {
      existing.count++;
      existing.lastSeen = Date.now();
      if (referrer) existing.referrer = String(referrer).slice(0, 500);
    } else {
      notFoundLog.set(key, { count: 1, referrer: referrer ? String(referrer).slice(0, 500) : "", lastSeen: Date.now() });
    }
    // Keep only the top 500 entries
    if (notFoundLog.size > 500) {
      const oldest = [...notFoundLog.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (oldest) notFoundLog.delete(oldest[0]);
    }
    res.json({ ok: true });
  });

  // Expose 404 log for admin (will be wired into tRPC admin router too)
  (app as any)._notFoundLog = notFoundLog;

  // ─── Form Abandonment Tracking ────────────────────────
  app.post("/api/track-abandonment", trackingLimiter, async (req, res) => {
    const { phone, name, email, formType, fieldsCompleted } = req.body || {};
    if (!formType || typeof formType !== "string") {
      return res.status(400).json({ error: "Missing formType" });
    }
    try {
      const { getDb } = await import("../db");
      const { formAbandonment } = await import("../../drizzle/schema");
      const db = await getDb();
      if (db) {
        await db.insert(formAbandonment).values({
          phone: phone ? String(phone).slice(0, 20) : null,
          name: name ? String(name).slice(0, 100) : null,
          email: email ? String(email).slice(0, 255) : null,
          formType: String(formType).slice(0, 50),
          fieldsCompleted: Array.isArray(fieldsCompleted) ? fieldsCompleted : null,
        });
      }
      logger.info("[Abandonment] Tracked", { formType, name });
    } catch (err: any) {
      logger.error("[Abandonment] Failed to track", { error: err.message });
    }
    res.json({ ok: true });
  });

  // ─── NOUR OS Proxy — avoids cross-origin calls to autonicks.com ──
  const nourOsProxy = async (req: import("express").Request, res: import("express").Response) => {
    try {
      const nourOsUrl = process.env.NOUR_OS_API_URL ?? "https://autonicks.com";
      const subPath = req.path.replace("/api/nour-os", "/api");
      // Block path traversal attempts
      if (subPath.includes("..") || subPath.includes("//")) {
        res.status(400).json({ error: "Invalid path" });
        return;
      }
      const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
      const upstream = await fetch(`${nourOsUrl}${subPath}${qs}`, {
        method: req.method,
        headers: { "Content-Type": "application/json" },
        ...(req.method !== "GET" && req.body ? { body: JSON.stringify(req.body) } : {}),
        signal: AbortSignal.timeout(8000),
      });
      const data = await upstream.json();
      res.status(upstream.status).json(data);
    } catch {
      res.status(502).json({ error: "NOUR OS unavailable" });
    }
  };
  app.get("/api/nour-os/*", nourOsProxy);
  app.post("/api/nour-os/*", express.json(), nourOsProxy);

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
  app.use("/api/trpc/chat", aiLimiter);
  app.use("/api/trpc/public.diagnose", aiLimiter);
  app.use("/api/trpc/public.askMechanic", aiLimiter);
  app.use("/api/trpc/public.aiSearch", aiLimiter);
  app.use("/api/trpc/laborEstimate.generate", aiLimiter);

  // ─── Twilio webhook routes (SMS + Voice) ──────────────
  import("../routes/webhooks/twilio").then(({ twilioWebhookRouter }) => {
    app.use(twilioWebhookRouter);
  }).catch(() => { /* Twilio webhooks not critical for startup */ });

  // ─── SSE real-time routes (admin feed + order tracking) ──
  import("../services/realtime").then(({ registerSSERoutes }) => {
    registerSSERoutes(app);
  }).catch(() => { /* SSE routes not critical for startup */ });

  // OAuth callback under /api/oauth/callback
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError: ({ path, error }) => {
        console.error(`[tRPC Error] ${path ?? "unknown"}: ${error.message}`);
      },
    })
  );
  // Sitemap.xml — cached server-side (1 hour) to avoid DB query on every crawler hit
  app.get("/sitemap.xml", async (_req, res) => {
    const xml = await serverCache.getOrSet("sitemap:xml", 60 * 60 * 1000, async () => {
      const baseUrl = SITE_URL;
      const now = new Date().toISOString().split("T")[0];

      let dynamicSlugs: string[] = [];
      try {
        const published = await getPublishedArticles();
        dynamicSlugs = published.map((a: any) => a.slug);
      } catch {}

      const allBlogSlugs = Array.from(new Set([...BLOG_SLUGS, ...dynamicSlugs]));

      const urls = [
        ...SITEMAP_ROUTES.map(p =>
          `  <url>\n    <loc>${baseUrl}${p.path}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority.toFixed(1)}</priority>\n  </url>`
        ),
        ...allBlogSlugs.map(s =>
          `  <url>\n    <loc>${baseUrl}/blog/${s}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`
        ),
      ];

      return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    });

    res.setHeader("Content-Type", "application/xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(xml);
  });

  // Robots.txt — controls crawler access
  app.get("/robots.txt", (_req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send(
      `User-agent: *\nAllow: /\nAllow: /favicon.ico\n\n# Public pages — crawl freely\nAllow: /tires\nAllow: /tires/info\nAllow: /services/\nAllow: /about\nAllow: /contact\nAllow: /reviews\nAllow: /specials\nAllow: /faq\nAllow: /blog\nAllow: /diagnose\nAllow: /estimate\nAllow: /fleet\nAllow: /financing\nAllow: /car-care-guide\nAllow: /area/\n\n# Block admin, auth, and private pages from indexing\nDisallow: /admin\nDisallow: /admin/\nDisallow: /my-garage\nDisallow: /portal\nDisallow: /api/\nDisallow: /status/\nDisallow: /inspection/\nDisallow: /loyalty\nDisallow: /referral\n\n# Block query parameters\nDisallow: /*?*\n\n# Crawl delay for polite crawling\nCrawl-delay: 1\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
    );
  });

  // ─── SMS Bot Webhook (Twilio) ───────────────────────────
  // Receives inbound SMS messages and returns Twilio XML response
  const { validateTwilioRequest } = await import("../middleware/twilioValidation");
  const { handleIncomingSMS } = await import("../routers/smsBot");
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

  // Review requests, reminders, and post-invoice follow-ups are handled by the cron system
  // See server/cron/index.ts — duplicate setInterval timers removed to save memory

  // ─── Facebook Messenger Webhook ──────────────────────
  // Webhook verification for Facebook Messenger
  app.get("/api/messenger-webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === process.env.FB_VERIFY_TOKEN) {
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

  // ─── Global error handler (MUST be after all routes) ──
  import("../middleware/errorHandler").then(({ globalErrorHandler }) => {
    app.use(globalErrorHandler);
  }).catch(() => { /* Error handler module not critical */ });

  // ─── Initialize cache layer (Redis or in-memory fallback) ──
  import("../lib/cache").then(({ initCache }) => {
    initCache();
  }).catch(() => { /* Cache init not critical */ });

  // ─── Start cron job system (skip if Railway worker handles it) ──
  if (!process.env.CRON_EXTERNAL) {
    import("../cron/index").then(({ startAllJobs }) => {
      startAllJobs();
    }).catch(() => { /* Cron start not critical */ });
  } else {
    console.log("[Cron] External worker mode — in-process cron disabled");
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
    console.log(`[Perf] Server started in ${Date.now() - startTime}ms`);

    // Start SMS scheduler for post-booking lifecycle messages
    import("../services/sms-scheduler").then(({ startSmsScheduler }) => {
      startSmsScheduler();
    }).catch((err) => {
      console.warn("[SMS Scheduler] Failed to start:", err.message);
    });

    // Cron jobs already started above (or disabled if CRON_EXTERNAL is set)

    // Seed feature flags (idempotent — skips existing)
    import("../services/featureFlags").then(({ seedFlags }) => {
      seedFlags().catch(() => {});
    }).catch(() => {});

    // Hydrate SMS opt-out set from DB so in-memory checks are accurate
    import("../routers/smsBot").then(({ loadOptOutsFromDb }) => {
      loadOptOutsFromDb().catch(() => {});
    }).catch(() => {});
  });

  // ─── Graceful shutdown ─────────────────────────────────
  const shutdown = async (signal: string) => {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    // Stop cron jobs and SMS scheduler first
    try {
      const { stopAllJobs } = await import("../cron");
      stopAllJobs();
    } catch {}
    try {
      const { stopSmsScheduler } = await import("../services/sms-scheduler");
      stopSmsScheduler();
    } catch {}
    server.close(async () => {
      try {
        const { closeDb } = await import("../db");
        await closeDb();
      } catch {}
      console.log("[Shutdown] Complete.");
      process.exit(0);
    });
    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch(console.error);
