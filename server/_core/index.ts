import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import rateLimit from "express-rate-limit";
import { registerOAuthRoutes } from "./oauth";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { getPublishedArticles } from "../content-generator";
import { markReviewRequestClicked } from "../db";
import { processReviewRequestQueue } from "../routers/reviewRequests";
import { processReminderQueue } from "../routers/reminders";

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
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

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
  // Sitemap.xml (dynamic — includes published AI articles from DB)
  app.get("/sitemap.xml", async (_req, res) => {
    const baseUrl = "https://nickstire.org";
    const now = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format per sitemap spec

    // Page definitions with SEO priority and change frequency
    const pages: { path: string; priority: string; changefreq: string }[] = [
      { path: "/", priority: "1.0", changefreq: "daily" },
      { path: "/tires", priority: "0.9", changefreq: "weekly" },
      { path: "/brakes", priority: "0.9", changefreq: "weekly" },
      { path: "/diagnostics", priority: "0.9", changefreq: "weekly" },
      { path: "/emissions", priority: "0.9", changefreq: "weekly" },
      { path: "/oil-change", priority: "0.8", changefreq: "weekly" },
      { path: "/general-repair", priority: "0.8", changefreq: "weekly" },
      { path: "/about", priority: "0.7", changefreq: "monthly" },
      { path: "/contact", priority: "0.8", changefreq: "monthly" },
      { path: "/blog", priority: "0.7", changefreq: "daily" },
      { path: "/faq", priority: "0.7", changefreq: "monthly" },
      // City-specific landing pages
      { path: "/euclid-auto-repair", priority: "0.8", changefreq: "monthly" },
      { path: "/lakewood-auto-repair", priority: "0.8", changefreq: "monthly" },
      { path: "/parma-auto-repair", priority: "0.8", changefreq: "monthly" },
      { path: "/east-cleveland-auto-repair", priority: "0.8", changefreq: "monthly" },
      // Seasonal landing pages
      { path: "/winter-car-care-cleveland", priority: "0.7", changefreq: "monthly" },
      { path: "/summer-car-care-cleveland", priority: "0.7", changefreq: "monthly" },
      // Dedicated SEO service pages
      { path: "/brake-repair-cleveland", priority: "0.8", changefreq: "monthly" },
      { path: "/check-engine-light-cleveland", priority: "0.8", changefreq: "monthly" },
      { path: "/tire-repair-cleveland", priority: "0.8", changefreq: "monthly" },
      { path: "/suspension-repair-cleveland", priority: "0.8", changefreq: "monthly" },
      { path: "/ac-repair-cleveland", priority: "0.8", changefreq: "monthly" },
      { path: "/diagnostics-cleveland", priority: "0.8", changefreq: "monthly" },
      // Vehicle make pages
      { path: "/toyota-repair-cleveland", priority: "0.7", changefreq: "monthly" },
      { path: "/honda-repair-cleveland", priority: "0.7", changefreq: "monthly" },
      { path: "/ford-repair-cleveland", priority: "0.7", changefreq: "monthly" },
      { path: "/chevy-repair-cleveland", priority: "0.7", changefreq: "monthly" },
      // Problem-specific pages
      { path: "/car-shaking-while-driving", priority: "0.7", changefreq: "monthly" },
      { path: "/brakes-grinding", priority: "0.7", changefreq: "monthly" },
      { path: "/check-engine-light-flashing", priority: "0.7", changefreq: "monthly" },
      { path: "/car-overheating", priority: "0.7", changefreq: "monthly" },
      // Services overview
      { path: "/services", priority: "0.9", changefreq: "weekly" },
      // New city landing pages
      { path: "/shaker-heights-auto-repair", priority: "0.8", changefreq: "monthly" },
      { path: "/cleveland-heights-auto-repair", priority: "0.8", changefreq: "monthly" },
      { path: "/mentor-auto-repair", priority: "0.8", changefreq: "monthly" },
      { path: "/strongsville-auto-repair", priority: "0.8", changefreq: "monthly" },
      { path: "/south-euclid-auto-repair", priority: "0.8", changefreq: "monthly" },
      { path: "/garfield-heights-auto-repair", priority: "0.8", changefreq: "monthly" },
      // New vehicle make pages
      { path: "/nissan-repair-cleveland", priority: "0.7", changefreq: "monthly" },
      { path: "/hyundai-repair-cleveland", priority: "0.7", changefreq: "monthly" },
      { path: "/kia-repair-cleveland", priority: "0.7", changefreq: "monthly" },
      { path: "/jeep-repair-cleveland", priority: "0.7", changefreq: "monthly" },
      { path: "/bmw-repair-cleveland", priority: "0.7", changefreq: "monthly" },
      { path: "/dodge-ram-repair-cleveland", priority: "0.7", changefreq: "monthly" },
      // New problem pages
      { path: "/car-wont-start", priority: "0.7", changefreq: "monthly" },
      { path: "/steering-wheel-shaking", priority: "0.7", changefreq: "monthly" },
      { path: "/car-pulling-to-one-side", priority: "0.7", changefreq: "monthly" },
      { path: "/transmission-slipping", priority: "0.7", changefreq: "monthly" },
      { path: "/ac-not-blowing-cold", priority: "0.7", changefreq: "monthly" },
      { path: "/battery-keeps-dying", priority: "0.7", changefreq: "monthly" },
      // Utility pages
      { path: "/reviews", priority: "0.7", changefreq: "weekly" },
      { path: "/diagnose", priority: "0.7", changefreq: "monthly" },
      { path: "/specials", priority: "0.7", changefreq: "weekly" },
      { path: "/pricing", priority: "0.7", changefreq: "monthly" },
      { path: "/fleet", priority: "0.7", changefreq: "monthly" },
      { path: "/financing", priority: "0.7", changefreq: "monthly" },
      { path: "/rewards", priority: "0.6", changefreq: "monthly" },
      { path: "/car-care-guide", priority: "0.6", changefreq: "monthly" },
      { path: "/refer", priority: "0.5", changefreq: "monthly" },
      { path: "/status", priority: "0.6", changefreq: "monthly" },
      { path: "/ask", priority: "0.6", changefreq: "weekly" },
      { path: "/my-garage", priority: "0.5", changefreq: "monthly" },
      { path: "/review", priority: "0.6", changefreq: "monthly" },
      // Legal pages
      { path: "/privacy-policy", priority: "0.4", changefreq: "yearly" },
      { path: "/terms", priority: "0.4", changefreq: "yearly" },
    ];

    const hardcodedBlogSlugs = [
      "5-signs-brakes-need-replacing",
      "check-engine-light-common-causes",
      "ohio-echeck-what-to-know",
      "when-to-replace-tires",
      "spring-car-maintenance-checklist",
      "synthetic-vs-conventional-oil",
    ];

    // Fetch published dynamic articles from DB
    let dynamicSlugs: string[] = [];
    try {
      const published = await getPublishedArticles();
      dynamicSlugs = published.map((a: any) => a.slug);
    } catch {}

    const allBlogSlugs = Array.from(new Set([...hardcodedBlogSlugs, ...dynamicSlugs]));

    const urls = [
      ...pages.map(p =>
        `  <url>\n    <loc>${baseUrl}${p.path}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
      ),
      ...allBlogSlugs.map(s =>
        `  <url>\n    <loc>${baseUrl}/blog/${s}</loc>\n    <lastmod>${now}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`
      ),
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>`;
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Cache-Control", "public, max-age=3600"); // Cache for 1 hour
    res.send(xml);
  });

  // Robots.txt — dynamically uses the request host for correct sitemap reference
  app.get("/robots.txt", (req, res) => {
    const host = req.get("host") || "nickstire.org";
    const protocol = req.protocol || "https";
    const sitemapUrl = `https://nickstire.org/sitemap.xml`;
    res.setHeader("Content-Type", "text/plain");
    res.send(
      `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin/\nDisallow: /api/\nDisallow: /api\n\nSitemap: ${sitemapUrl}\n`
    );
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
