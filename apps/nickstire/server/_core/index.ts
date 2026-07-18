import "dotenv/config";
import { timingSafeEqual, randomUUID } from "crypto";

// ─── Startup env validation ─────────────────────────
const REQUIRED_ENV = [
  "DATABASE_URL",
  "JWT_SECRET",
  "OWNER_OPEN_ID",
  "ADMIN_API_KEY",
  "STATENOUR_SYNC_KEY",
] as const;
const RECOMMENDED_ENV = [
  "GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_PHONE_NUMBER",
  "BRIDGE_API_KEY", "OPENAI_API_KEY",
] as const;

// Unify Google API keys — GOOGLE_MAPS_API_KEY works for Places, Maps, and all Google APIs
if (process.env.GOOGLE_MAPS_API_KEY && !process.env.GOOGLE_PLACES_API_KEY) {
  process.env.GOOGLE_PLACES_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
}
// GSC scheduler env-check synthesis. 2026-06-10 gap-sweep fix: this used
// to be nested inside `if (GOOGLE_MAPS_API_KEY && ...)`, so deleting the
// Maps key silently stopped Search Console syncing even though GSC auths
// via the SERVICE ACCOUNT (gsc-data.ts), not the Maps key. Now the
// "configured" marker derives ONLY from the real GSC credentials, fully
// independent of the Maps key.
if (!process.env.GOOGLE_SEARCH_CONSOLE_KEY) {
  const gscReady = !!(process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  process.env.GOOGLE_SEARCH_CONSOLE_KEY = gscReady ? "configured" : "";
}

const missingRequired = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingRequired.length) {
  console.error(`FATAL: Missing required env vars: ${missingRequired.join(", ")}`);
  process.exit(1);
}
// Both apps in the monorepo read DATABASE_URL, but nickstire is MySQL/TiDB and
// statenour is Postgres. A wrong-engine URL leaking in (root .env, a worktree
// env copy) otherwise surfaces as an opaque mysql2 pool error deep in a request.
// Fail loudly at boot on the scheme instead.
if (process.env.DATABASE_URL && !process.env.DATABASE_URL.startsWith("mysql://")) {
  console.error("FATAL: DATABASE_URL must be a mysql:// URL for nickstire (got a wrong-engine URL — Postgres?)");
  process.exit(1);
}
// JWT_SECRET must be at least 32 characters to be cryptographically useful
if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  console.error("FATAL: JWT_SECRET must be at least 32 characters long");
  process.exit(1);
}
// ADMIN_API_KEY must be at least 32 characters to be cryptographically useful
if (process.env.ADMIN_API_KEY && process.env.ADMIN_API_KEY.length < 32) {
  console.error("FATAL: ADMIN_API_KEY must be at least 32 characters long");
  process.exit(1);
}
// STATENOUR_SYNC_KEY must be at least 32 characters to be cryptographically useful
if (process.env.STATENOUR_SYNC_KEY && process.env.STATENOUR_SYNC_KEY.length < 32) {
  console.error("FATAL: STATENOUR_SYNC_KEY must be at least 32 characters long");
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
import { registerOAuthRoutes } from "./oauth";
import { registerBridgeRoutes } from "./bridge-routes";
import { registerStatenourBridgeRoutes } from "./statenour-bridge-routes";
import { registerNourStrategyRoute } from "../routes/nour-strategy";
import { registerPsychDominanceRoute } from "../routes/psych-dominance";
import { registerBurnoutRadarRoute } from "../routes/burnout-radar";
import { registerSimulatorRoute } from "../routes/simulator";
import { registerNourChiefStrategistRoute } from "../routes/nour-chief-strategist";
import { registerNourOsQueryRoute } from "../routes/nour-os-query";
import { registerAnalyticsRoutes } from "../routes/analyticsRoutes";
import { requireAdminApiKey, registerAdminRoutes } from "../routes/adminRoutes";
import { registerMetaRoutes } from "../routes/metaRoutes";
import { registerPushRoutes } from "../routes/pushRoutes";
import { runServerMigrations } from "../services/migrations";
import { apiLimiter, formLimiter, aiLimiter, uploadLimiter } from "../middleware/rateLimiters";
import { securityHeaders } from "../middleware/securityHeaders";
import { healthHandler, pingHandler, readyHandler, recoverHandler } from "../lib/health";
import { startSelfHealing, recordRequest } from "../lib/self-healing";
import { createLogger } from "../lib/logger";
import { errorTelemetry } from "../lib/error-telemetry";
import { initSentry, flushSentry } from "../lib/sentry";
import { AppError, isAppError, errorToHttpResponse } from "../lib/errors";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { createPrerenderMiddleware } from "../prerender-middleware";
import { SITE_URL } from "@shared/business";
import { startTieredScheduler } from "../cron/scheduler";
import { validateTwilioRequest } from "../middleware/twilioValidation";

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
  // Trust proxy — explicit Cloudflare/Railway reverse proxy trust
  const TRUST_PROXY = process.env.TRUST_PROXY ?? "loopback, linklocal, uniquelocal";
  app.set("trust proxy", TRUST_PROXY);
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
  // /generated is the PERMANENT public identity of every generated asset — it is
  // what lives in reel_jobs.mp4Url and what Meta fetches at publish time. It used
  // to be served straight off data/generated on the container's EPHEMERAL disk, so
  // a redeploy took every master with it: all 5 published reels and all 3 held
  // ones measured 404 on 2026-07-18, hours after publishing.
  //
  // Object storage is now tried FIRST, with local disk kept as a transitional
  // fallback for anything written before the bucket existed. The URL shape is
  // unchanged on purpose, so rows already storing these URLs stay valid.
  // Wildcard, NOT ":name" — an object key may contain slashes ("reels/x.mp4"),
  // and a named param stops at the first one, so prefixed keys silently fell
  // through to a 404. Caught by fetching a real stored object over HTTP; the
  // storage-layer round trip passed because it never went through this route.
  app.get(/^\/generated\/(.+)$/, async (req, res, next) => {
    try {
      const key = decodeURIComponent(req.params[0] as string);
      const { storageGetStream } = await import("../storage");
      const obj = await storageGetStream(key);
      if (obj) {
        if (obj.contentType) res.type(obj.contentType);
        if (obj.contentLength !== undefined) res.setHeader("Content-Length", String(obj.contentLength));
        // Immutable: a given key's bytes never change (new renders get new keys).
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        obj.body.pipe(res);
        return;
      }
    } catch {
      // Fall through to disk rather than 500 — a store hiccup should not make a
      // locally-present asset unreachable.
    }
    next();
  });
  app.use("/generated", express.static(path.join(process.cwd(), "data", "generated")));
  // A missing media file must 404 — before this, misses fell through to the
  // SPA catch-all and answered 200 text/html, hiding media loss from every
  // monitor and from Meta (baseline finding generated-404-001: 4 of 12
  // probed /generated/ URLs were dead behind lying 200s).
  app.use("/generated", (_req, res) => res.status(404).json({ error: "media not found" }));

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
  app.use(securityHeaders);
  // Request tracking for self-healing anomaly detection (non-blocking, ~0ms)
  app.use((_req, _res, next) => { recordRequest(); next(); });

  // Rate limiting for public API endpoints to prevent spam/abuse
  // (apiLimiter, formLimiter, aiLimiter, uploadLimiter definitions moved
  // to ../middleware/rateLimiters — the app.use(...) wiring stays here.)

  app.use("/api/trpc", apiLimiter);
  // Apply stricter limits to mutation-heavy endpoints. We use Regex paths
  // to ensure tRPC batch requests (comma-separated boundaries) don't bypass
  // the limiters, and to match full endpoint names exactly.

  const withBatchRegex = (endpoint: string) => new RegExp(`^/api/trpc/(.*,)?${endpoint.replace(/\./g, "\\.")}(,.*)?$`);

  app.use(withBatchRegex("booking.uploadPhoto"), uploadLimiter);
  app.use(withBatchRegex("booking.create"), formLimiter);
  app.use(withBatchRegex("lead.submit"), formLimiter);
  app.use(withBatchRegex("callback.submit"), formLimiter);
  app.use(withBatchRegex("waitlist.join"), formLimiter);
  app.use(withBatchRegex("emergency.submit"), formLimiter);
  app.use(withBatchRegex("financing.trackApplication"), formLimiter);
  // Blocks batch-bypassing where an attacker sends /api/trpc/chat.message,chat.message 100 times
  // but express-rate-limit only counts it as 1 request.
  const blockBatchedLimits = (req: any, res: any, next: any) => {
    if (req.path.includes(",")) {
      return res.status(429).json({ error: "Batched requests are not allowed for rate-limited endpoints." });
    }
    next();
  };

  // Matches chat.message and chat.history
  app.use(withBatchRegex("chat.message"), blockBatchedLimits, aiLimiter);
  app.use(withBatchRegex("chat.history"), blockBatchedLimits, aiLimiter);
  app.use(withBatchRegex("diagnose.analyze"), blockBatchedLimits, aiLimiter);
  app.use(withBatchRegex("search.ai"), blockBatchedLimits, aiLimiter);
  app.use(withBatchRegex("memberships.startCheckout"), formLimiter);
  app.use(withBatchRegex("laborEstimate.generate"), aiLimiter);
  app.use(withBatchRegex("costEstimator.estimate"), aiLimiter);
  app.use(withBatchRegex("estimates.generate"), aiLimiter);
  app.use(withBatchRegex("nourOsQuote.createQuote"), formLimiter);
  app.use(withBatchRegex("fleet.submit"), formLimiter);

  // wave-122 (CRITICAL S7/S8) — Vapi tool tRPC endpoints
  app.use(withBatchRegex("voiceAgent.bookSlot"), formLimiter);
  app.use(withBatchRegex("voiceAgent.escalate"), formLimiter);
  app.use(withBatchRegex("voiceAgent.sendConfirmationSms"), formLimiter);

  // wave-122 (HIGH S5/S8) — payments endpoints
  app.use(withBatchRegex("payments.lookupInvoice"), formLimiter);
  app.use(withBatchRegex("payments.createPaymentIntent"), formLimiter);
  app.use(withBatchRegex("payments.confirmPayment"), formLimiter);

  // Tire-order endpoints
  app.use(withBatchRegex("gatewayTire.placeOrder"), formLimiter);
  app.use(withBatchRegex("gatewayTire.createCheckout"), formLimiter);
  app.use(withBatchRegex("gatewayTire.confirmCheckout"), formLimiter);

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

  // ─── Public analytics + telemetry sinks ────────────────
  // POST /api/analytics/conversion, /api/track-abandoned, /api/uber-code,
  // /api/cwv — moved verbatim to ../routes/analyticsRoutes (each keeps
  // its own per-route express.json({ limit }) body parser). Registered
  // here, in the same position the handlers occupied (before tRPC).
  registerAnalyticsRoutes(app);

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
  // Moved verbatim to ../services/migrations. Fire-and-forget — bare
  // call (NOT awaited) so it never blocks boot, exactly as before.
  runServerMigrations();

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
    try {
      startTieredScheduler();
      serverLog.info("Tiered Job Scheduler active");
    } catch (err) {
      console.error("[Scheduler] Failed to start:", err);
    }

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

  // ─── Admin REST endpoints + statenour Ultron bridge ─────
  // SSE /api/admin/events (auth-gated, async-registered), requireAdminApiKey
  // middleware, all /api/admin/* handlers, and GET /api/bridge/voice-latency
  // (STATENOUR_SYNC_KEY bearer) moved verbatim to ../routes/adminRoutes.
  // requireAdminApiKey is also imported module-top so /api/health/recover
  // above still resolves it. Registered here, in the same position the SSE
  // block occupied (before tRPC).
  registerAdminRoutes(app);

  // ─── PWA Push Notification Subscription ──────────────────
  // POST /api/push/subscribe (semi-public; inline admin-key check sets the
  // isAdmin flag) + GET /api/push/vapid-key moved verbatim to
  // ../routes/pushRoutes. Registered in the same position they occupied.
  registerPushRoutes(app);

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
  registerMetaRoutes(app);

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
    const { isRedirectedPath } = await import("./redirects");
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

    // GSC audit 2026-07-04: never emit a URL that 301s (redirects.ts is the
    // truth). Catches registry aliases AND DB-published slugs that were later
    // redirected (e.g. /blog/car-ac-not-blowing-cold).
    const urls = [
      ...SITEMAP_ROUTES.filter(p => !isRedirectedPath(p.path)).map(p =>
        `  <url>\n    <loc>${baseUrl}${p.path}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
      ),
      ...allBlogSlugs.filter(s => !isRedirectedPath(`/blog/${s}`)).map(s =>
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

  // IndexNow key file — verifies host ownership so Bing/IndexNow accepts our
  // instant URL-submission pings. The key is public by design (published here);
  // a submission POSTs { host, key, keyLocation, urlList } to bing.com/indexnow.
  app.get("/d274e03f24e4438599616695d23dab67.txt", (_req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send("d274e03f24e4438599616695d23dab67");
  });

  // llms.txt — structured guidance for AI answer-engines (ChatGPT,
  // Perplexity, Gemini, Claude). Emerging standard; near-zero local
  // competitors publish one. Consolidates entity facts + the canonical
  // service catalog with REAL prices so AI assistants answering "best tire
  // shop in Euclid" / "brake repair cost Cleveland" have a clean, machine-
  // extractable source. Plain text at the domain root; not prerender-gated,
  // so it works regardless of the prerendered-money-page coverage state.
  app.get("/llms.txt", (_req, res) => {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    const b = SITE_URL;
    res.send(`# Nick's Tire & Auto
> Full-service auto repair and tire shop on Euclid Ave serving Cleveland, Euclid, and Northeast Ohio. Open 7 days, walk in (no appointment needed), written estimate before any work — you don't pay until you say yes.

## Key facts
- Address: 17625 Euclid Ave, Cleveland, OH 44112
- Phone: (216) 862-0005
- Hours: Monday-Saturday 8AM-6PM, Sunday 9AM-4PM (open 7 days a week)
- Rating: 4.9 stars from 1,700+ Google reviews
- Warranty: 12 months / 12,000 miles on parts and labor
- No appointment needed — first-come, first-served. Free drop-off with a ride back to work.
- Financing: $10 down, no credit check, approved in about 90 seconds (Acima, Snap, Koalafi, American First)
- Service area: Cleveland, Euclid, East Cleveland, South Euclid, Cleveland Heights, Shaker Heights, Garfield Heights, Lakewood, Parma, Mentor, Lyndhurst, Richmond Heights, Willoughby

## Services
- [Brake repair](${b}/brakes): Pads from $149/axle, pads + rotors from $279/axle. Free check, written quote, same-day.
- [Tires - new & used](${b}/tires): Used from $25 installed (most sizes $40-80), new from $89 installed. Free install package (mount, balance, valve stems, TPMS reset, alignment check).
- [Oil change](${b}/oil-change): Conventional from $49, full synthetic from $80. Free 21-point check included.
- [Engine diagnostics / check-engine light](${b}/diagnostics): Free code scan, honest diagnosis, written estimate first.
- [Ohio E-Check / emissions](${b}/emissions): Failed-emissions repair, O2 sensors, EVAP, catalytic converters. Same-day pass.
- [Wheel alignment](${b}/alignment): Stops uneven tire wear and pulling. Most vehicles same-day.
- [Auto repair (all services)](${b}/services): Brakes, tires, oil, diagnostics, alignment, emissions, suspension, batteries. All makes and models including European.
- [Financing](${b}/financing): $10 down, no credit check, drive away today.

## Common questions
- Why is my car shaking or vibrating when I brake? Usually a warped brake rotor: the surface is no longer flat, so the pad grabs unevenly and you feel it in the wheel or pedal. Common on Cleveland cars from stop-and-go traffic and winter heat cycles. The fix is resurfacing or replacing the rotor, most often as a pads + rotors job. Free check at 17625 Euclid Ave, written quote before any work.
- Is it safe to drive with grinding brakes? No. Grinding means the pads are worn out and bare metal is cutting into the rotor, so every stop does more damage and your stopping distance gets longer. Get it checked the same day. Open 7 days, walk in or call (216) 862-0005.
- How much does a brake job cost in Cleveland? At Nick's Tire & Auto: pad replacement from $149 per axle, pads + rotors from $279 per axle, full brake job from $499 per axle. Free check and a written quote before any work, and you don't pay until you say yes.
- Where can I get brakes done near me in Cleveland (44112)? Nick's Tire & Auto, 17625 Euclid Ave, Cleveland, OH 44112 (east side), serving Euclid, East Cleveland, Cleveland Heights, South Euclid, and Lyndhurst. First-come-first-served, walk in 7 days a week, no appointment needed.

## Guides
- [Auto repair blog](${b}/blog): 120+ Cleveland-specific guides on brakes, tires, winter prep, repair costs, and common car problems.

## Contact
- Call or text (216) 862-0005 · 17625 Euclid Ave, Cleveland, OH 44112 · ${b}
`);
  });

  // Sub-sitemaps for services and locations
  app.get("/sitemap-services.xml", async (_req, res) => {
    const { SITEMAP_ROUTES } = await import("@shared/routes");
    const { isRedirectedPath } = await import("./redirects");
    const baseUrl = SITE_URL;
    const now = new Date().toISOString().split("T")[0];
    const serviceRoutes = SITEMAP_ROUTES.filter(r =>
      (r.group === "service" || r.group === "seo-service" || r.group === "vehicle" || r.group === "problem" || r.group === "seasonal")
      && !isRedirectedPath(r.path)
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
    const { isRedirectedPath } = await import("./redirects");
    const baseUrl = SITE_URL;
    const now = new Date().toISOString().split("T")[0];
    const locationRoutes = SITEMAP_ROUTES.filter(r =>
      (r.group === "city" || r.group === "neighborhood") && !isRedirectedPath(r.path)
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
      // wave-fix-2026-05-25 (audit #113) · differentiate "Stripe not
      // configured at all" from "half-configured · webhook secret
      // missing but API key present". The latter is the silent-failure
      // case where real payments arrive at Stripe but webhook events
      // get dropped silently · invoices never mark as paid · customer
      // pays + we don't know. Force a 500 so the events stack up in
      // Stripe's retry queue (visible operator signal) instead of
      // disappearing.
      const hasSecretKey = !!process.env.STRIPE_SECRET_KEY;
      if (hasSecretKey) {
        serverLog.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET is missing but STRIPE_SECRET_KEY is set — Stripe is half-configured. Real payment events are being DROPPED. Set STRIPE_WEBHOOK_SECRET on Railway or events will continue to fail.");
        return res.sendStatus(500);
      }
      // Stripe not configured at all (no key + no webhook) — silent
      // 200 is correct · no events expected so don't make noise.
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
      const rawBody = (req as express.Request & { rawBody?: Buffer }).rawBody || req.body;
      const event = stripe.webhooks.constructEvent(rawBody, sig || "", webhookSecret);

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

      // Out-of-band refund completed directly on Stripe Dashboard
      if (event.type === "charge.refunded") {
        const charge = event.data.object as any;
        const tireOrderNumber = charge.metadata?.tireOrderNumber;
        if (tireOrderNumber) {
          const { getDb } = await import("../db");
          const { tireOrders } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const d = await getDb();
          if (d) {
            await d.update(tireOrders)
              .set({ paymentStatus: "refunded", updatedAt: new Date() })
              .where(eq(tireOrders.orderNumber, tireOrderNumber));
            serverLog.info(`[Stripe Webhook] Out-of-band refund recorded for order ${tireOrderNumber}`);
          }
        }

        // Delegate invoice status update and ShopDriver sync to the writeback service
        const { processStripeRefundEvent } = await import("../services/refundWriteback");
        await processStripeRefundEvent(event);
      }

      // ─── Nonstop Nick membership (chunk 4/5) ─────────────
      // Subscription lifecycle → memberships.status. The subscription carries
      // our metadata (plan:"nonstop-nick", phone) set in createMembershipCheckout,
      // so we bind the row to the member's phone. Upsert by stripeSubscriptionId
      // (unique) so Stripe retries are idempotent — second delivery of the same
      // event changes the same row to the same state, no duplicate membership.
      if (
        event.type === "customer.subscription.created" ||
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.deleted"
      ) {
        const sub = event.data.object as any;
        // Accept any Nonstop Nick tier (base $7.99 or +$9.99 with repair discount).
        const { isKnownMembershipPlan, mapSubscriptionEventToStatus, normalizeMembershipPhone } =
          await import("../lib/membership-guards");
        const subPlan = String(sub.metadata?.plan || "");
        if (isKnownMembershipPlan(subPlan)) {
          const { getDb } = await import("../db");
          const { memberships } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const d = await getDb();
          if (d) {
            // Stripe status → our enum (tested in membership-guards):
            // active/trialing = active; past_due/unpaid = past_due (grace);
            // deleted event or canceled = canceled; else incomplete.
            const status = mapSubscriptionEventToStatus(event.type, String(sub.status));
            const periodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000) : null;
            const phone = normalizeMembershipPhone(sub.metadata?.phone);

            // Upsert by the unique stripeSubscriptionId. Try update first; if no
            // row exists yet (created event arriving before any row), insert.
            const updated = await d.update(memberships)
              .set({
                status,
                currentPeriodEnd: periodEnd,
                canceledAt: status === "canceled" ? new Date() : null,
                stripeCustomerId: sub.customer ? String(sub.customer) : undefined,
                ...(phone ? { phone } : {}),
              })
              .where(eq(memberships.stripeSubscriptionId, String(sub.id)));
            const affected = (updated as unknown as { affectedRows?: number; rowsAffected?: number })?.affectedRows
              ?? (updated as unknown as { affectedRows?: number; rowsAffected?: number })?.rowsAffected ?? 0;

            if (affected === 0 && phone) {
              // No existing row — first time we've seen this subscription. Insert.
              await d.insert(memberships).values({
                plan: subPlan,
                phone,
                name: sub.metadata?.customerName || null,
                status,
                stripeCustomerId: sub.customer ? String(sub.customer) : null,
                stripeSubscriptionId: String(sub.id),
                currentPeriodEnd: periodEnd,
              }).catch((e: unknown) => {
                // Unique-key race (two events landed at once) → the other write
                // won; safe to ignore. Anything else, log.
                serverLog.warn(`[Stripe Webhook] membership insert skipped (likely race): ${e instanceof Error ? e.message : String(e)}`);
              });
              serverLog.info(`[Stripe Webhook] Nonstop Nick membership created for ${phone} — ${status}`);
            } else {
              serverLog.info(`[Stripe Webhook] Nonstop Nick membership ${sub.id} → ${status} (affected=${affected})`);
            }
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
    // forensic-audit HIGH · the global express.json (with verify) parses the
    // body first and sets req._body, so the route-level express.raw is
    // skipped and req.body is a PARSED OBJECT — createHmac.update(object)
    // threw a TypeError that killed the handler with no response, so FB
    // retried then disabled the webhook. Use the exact signed bytes the
    // global verify stashed on req.rawBody.
    const rawBuf: Buffer = (req as unknown as { rawBody?: Buffer }).rawBody
      ?? (Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? "")));
    const expectedSig = "sha256=" + createHmac("sha256", appSecret).update(rawBuf).digest("hex");
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
      body = JSON.parse(rawBuf.toString());
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
    const { installRedirects, trailingSlashRedirect, hostCanonicalRedirect } = await import("./redirects");
    // Host first (www → apex), then slash-strip, then the alias 301 fires.
    app.use(hostCanonicalRedirect);
    app.use(trailingSlashRedirect);
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

  // Terminal error handler — MUST be the last middleware registered. Hand-rolled
  // REST routes that throw synchronously (or call next(err)) land here with a
  // sanitized, request-id-correlated JSON response instead of Express's default
  // stack-leaking handler. tRPC errors are handled separately by its onError hook.
  app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) return next(err);
    const appErr = isAppError(err) ? err : AppError.fromUnknown(err, req.path);
    if (!appErr.isOperational) {
      serverLog.error("unhandled_route_error", {
        path: req.path,
        requestId: res.locals.requestId,
        error: appErr.message,
      });
    }
    const { status, body } = errorToHttpResponse(appErr);
    res.status(status).json({ ...body, requestId: res.locals.requestId });
  });

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
  serverLog.fatal("Server failed to start", { error: err instanceof Error ? err.stack : String(err) });
  process.exit(1);
});
