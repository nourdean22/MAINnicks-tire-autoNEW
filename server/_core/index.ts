import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import path from "path";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import rateLimit from "express-rate-limit";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { healthHandler, pingHandler, readyHandler } from "../lib/health";
import { serveStatic, setupVite } from "./vite";
import { createPrerenderMiddleware } from "../prerender-middleware";
import { SITEMAP_ROUTES, BLOG_SLUGS } from "@shared/routes";
import { getPublishedArticles } from "../content-generator";
import { markReviewRequestClicked } from "../db";
import { processReviewRequestQueue } from "../routers/reviewRequests";
import { processReminderQueue } from "../routers/reminders";
import { processPostInvoiceFollowUps } from "../postInvoiceFollowUp";
import { SITE_URL } from "@shared/business";

// ─── Startup environment validation ──────────────────
// Fail fast if required env vars are missing — better than cryptic runtime errors
const REQUIRED_ENV = [
  "DATABASE_URL",
  "JWT_SECRET",
  "OPENAI_API_KEY",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_PHONE_NUMBER",
] as const;

const missingEnv = REQUIRED_ENV.filter(key => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`FATAL: Missing required environment variables: ${missingEnv.join(", ")}`);
  console.error("Server cannot start. Add these variables to your .env file.");
  process.exit(1);
}

// Warn about optional-but-important vars (degrade gracefully, but flag clearly)
if (!process.env.FB_APP_SECRET) {
  console.warn("WARN: FB_APP_SECRET is not set — Messenger webhook HMAC verification is disabled. Add it to prevent fake message events.");
}

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
  // Body parser — 500kb max. File uploads go through booking.uploadPhoto which handles its own limits.
  // 50mb was dangerously large and could memory-bomb the server with a single request.
  app.use(express.json({ limit: "500kb" }));
  app.use(express.urlencoded({ limit: "500kb", extended: true }));

  // Security headers
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
    if (process.env.NODE_ENV === "production") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });
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
    max: 20, // 20 AI requests per hour per IP — OpenAI tokens are expensive
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

  // ─── Health check endpoints ───────────────────────────
  app.get("/api/ping", pingHandler);        // Lightweight liveness probe
  app.get("/api/ready", readyHandler);      // Readiness probe (checks DB)
  app.get("/api/health", healthHandler);    // Full health check (DB latency, memory, services)

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
  // Sitemap.xml — powered by shared/routes.ts route registry + dynamic blog articles from DB
  app.get("/sitemap.xml", async (_req, res) => {
    const baseUrl = SITE_URL;
    const now = new Date().toISOString().split("T")[0];

    // Fetch published dynamic articles from DB
    let dynamicSlugs: string[] = [];
    try {
      const published = await getPublishedArticles();
      dynamicSlugs = published.map((a: any) => a.slug);
    } catch {}

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
      `User-agent: *\nAllow: /\nAllow: /favicon.ico\n\n# Public pages — crawl freely\nAllow: /tires\nAllow: /tires/info\nAllow: /services/\nAllow: /about\nAllow: /contact\nAllow: /reviews\nAllow: /specials\nAllow: /faq\nAllow: /blog\nAllow: /diagnose\nAllow: /estimate\nAllow: /fleet\nAllow: /financing\nAllow: /car-care-guide\nAllow: /area/\n\n# Block admin, auth, and private pages from indexing\nDisallow: /admin\nDisallow: /admin/\nDisallow: /my-garage\nDisallow: /portal\nDisallow: /api/\nDisallow: /status/\nDisallow: /inspection/\nDisallow: /loyalty\nDisallow: /referral\n\n# Block query parameters\nDisallow: /*?*\n\n# Crawl delay for polite crawling\nCrawl-delay: 1\n\nSitemap: ${SITE_URL}/sitemap.xml\n`
    );
  });

  // ─── SMS Bot Webhook (Twilio) ───────────────────────────
  // Receives inbound SMS messages and returns Twilio XML response
  // Twilio signature verification prevents fake SMS events
  const { handleIncomingSMS } = await import("../routers/smsBot");
  app.post("/api/sms-webhook", express.urlencoded({ extended: false }), async (req, res) => {
    // Verify request is genuinely from Twilio using HMAC-SHA1 signature
    const twilioSignature = req.headers["x-twilio-signature"] as string | undefined;
    const authToken = process.env.TWILIO_AUTH_TOKEN!;
    const callbackUrl = `${req.protocol}://${req.get("host")}/api/sms-webhook`;

    if (!twilioSignature) {
      console.warn("[SMS Webhook] Missing X-Twilio-Signature header — rejecting");
      res.sendStatus(403);
      return;
    }

    try {
      const twilio = await import("twilio");
      const isValid = twilio.validateRequest(authToken, twilioSignature, callbackUrl, req.body);
      if (!isValid) {
        console.warn("[SMS Webhook] Invalid Twilio signature — rejecting");
        res.sendStatus(403);
        return;
      }
    } catch (err) {
      console.error("[SMS Webhook] Signature validation error:", err);
      res.sendStatus(500);
      return;
    }

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

    if (mode === "subscribe" && token === process.env.FB_VERIFY_TOKEN) {
      res.status(200).send(challenge);
    } else {
      res.sendStatus(403);
    }
  });

  // Incoming Messenger messages — HMAC-SHA256 signature verification
  // Facebook signs the raw body with the app secret and sends X-Hub-Signature-256
  app.post("/api/messenger-webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const appSecret = process.env.FB_APP_SECRET;

    if (appSecret) {
      if (!signature) {
        console.warn("[Messenger Webhook] Missing X-Hub-Signature-256 header — rejecting");
        res.sendStatus(403);
        return;
      }

      const crypto = await import("crypto");
      const expectedSignature = "sha256=" + crypto.createHmac("sha256", appSecret).update(req.body).digest("hex");

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        console.warn("[Messenger Webhook] Invalid FB HMAC signature — rejecting");
        res.sendStatus(403);
        return;
      }
    }

    let body: any;
    try {
      body = JSON.parse(req.body.toString());
    } catch {
      res.sendStatus(400);
      return;
    }

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

startServer().catch(console.error);
