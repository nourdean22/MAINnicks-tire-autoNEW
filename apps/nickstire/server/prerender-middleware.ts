/**
 * Prerender Middleware — Serves static prerendered HTML to bots AND real users.
 *
 * 2026-05-24 PSI fix · pre-fix this middleware only intercepted bot UAs.
 * Real users got a 12KB SPA shell + 777KB JS bundle to render the H1 ·
 * mobile LCP measured 7.0s (target <2.5s). The prerendered file
 * (~260KB) already contained the H1 text inline. Now real users get
 * the prerendered HTML on first paint · LCP fires off the static paint
 * (target ~1.5s). React still mounts on top and re-renders the tree
 * for client-side interactivity · the brief overlap is below the LCP
 * measurement window.
 *
 * When a GET request hits a route that has a prerendered HTML file,
 * the middleware serves it directly. All non-GET requests, API routes,
 * static assets, and routes without a prerendered counterpart fall
 * through to the normal SPA handler.
 *
 * Bots still benefit · same fast static HTML, with X-Prerendered: true
 * header so log analyzers can distinguish. Cache-Control 3600 stays
 * the same for both populations.
 */

import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";

import { createLogger } from "./lib/logger";

const log = createLogger("prerender-middleware");
// Bot User-Agent patterns (case-insensitive matching)
const BOT_PATTERNS = [
  "googlebot",
  "bingbot",
  "slurp",        // Yahoo
  "duckduckbot",
  "baiduspider",
  "yandexbot",
  "sogou",
  "facebot",       // Facebook
  "facebookexternalhit",
  "twitterbot",
  "linkedinbot",
  "whatsapp",
  "telegrambot",
  "applebot",
  "ia_archiver",   // Alexa
  "semrushbot",
  "ahrefsbot",
  "mj12bot",       // Majestic
  "dotbot",
  "petalbot",
  "bytespider",
  "gptbot",
  "claudebot",
  "anthropic-ai",
  "google-inspectiontool",
  "google-structured-data-testing-tool",
  "mediapartners-google",
];

function isBot(userAgent: string): boolean {
  const ua = userAgent.toLowerCase();
  return BOT_PATTERNS.some((pattern) => ua.includes(pattern));
}

/**
 * Creates the prerender middleware.
 * @param prerenderedDir - Absolute path to the directory containing prerendered HTML files.
 */
export function createPrerenderMiddleware(prerenderedDir: string) {
  // Check if prerendered directory exists
  if (!fs.existsSync(prerenderedDir)) {
    console.info("[prerender:init] No prerendered directory found — middleware disabled.");
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  const fileCount = countHtmlFiles(prerenderedDir);
  console.info(`[prerender:init] Serving ${fileCount} prerendered pages to bots from ${prerenderedDir}`);

  return (req: Request, res: Response, next: NextFunction) => {
    // Only intercept GET requests
    if (req.method !== "GET") return next();

    // wave-181.12 · CRITICAL bypass during prerender runs.
    // The prerender puppeteer identifies as Googlebot to avoid getting
    // the SPA shell. Without this bypass, the middleware would serve
    // the OLD prerendered HTML BACK to puppeteer, which would then
    // capture it as "fresh" — a circular bug where every prerender pass
    // just replays the prior output. Setting PRERENDER_MODE=true on the
    // spawned server (via scripts/prerender.mjs + regen-prerender.mjs +
    // prerender-comparison-only.mjs) makes the middleware fall through,
    // letting puppeteer hit the live React render. Captured for the
    // first time in wave-181.12 after diagnosing why /parma-heights had
    // a stale "Free Uber Both Ways" title even after cities.ts was
    // updated to "Used Tires $60 · Open Sundays".
    if (process.env.PRERENDER_MODE === "true") return next();

    // 2026-05-24 PSI fix · gate REMOVED · was `if (!isBot(userAgent)) return next();`
    // Pre-fix real users got the 12KB SPA shell + waited for React to
    // render the H1 · mobile LCP 7s. Now real users get the prerendered
    // HTML on first paint · React hydrates on top after. Bots still
    // get the same fast path. Admin routes don't have prerendered files
    // so they fall through naturally.
    //
    // The /admin path stays SPA · the `prerendered/` dir contains only
    // public marketing pages (index, blog, diagnose, guides, tires). Any
    // future admin route additions to prerendered/ should be explicit.

    // Skip API routes, static assets, and file requests
    const urlPath = req.path;
    if (
      urlPath.startsWith("/api/") ||
      urlPath.startsWith("/assets/") ||
      urlPath.startsWith("/admin") || // SPA shell only · no prerender
      urlPath.includes(".") // has file extension (css, js, png, etc.)
    ) {
      return next();
    }

    // Look for prerendered HTML
    let htmlPath: string;
    if (urlPath === "/" || urlPath === "") {
      htmlPath = path.join(prerenderedDir, "index.html");
    } else {
      // Try /path/index.html
      htmlPath = path.join(prerenderedDir, urlPath, "index.html");
    }

    if (fs.existsSync(htmlPath)) {
      const userAgent = req.get("user-agent") || "";
      const isUserBot = isBot(userAgent);
      // Quiet log · only emit on bot hits + a 1% sample of human hits
      // to avoid log spam during normal traffic. Spec: keep visibility
      // into what bots see without drowning out signal on real users.
      if (isUserBot || Math.random() < 0.01) {
        console.info(`[prerender:serve] ${urlPath} ${isUserBot ? "BOT" : "USER"} ${userAgent.slice(0, 50)}`);
      }
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Prerendered", "true");
      // Short cache for human hits · long cache for bots (header same)
      // Real users want fresh content after deploys · the 5-min cache
      // matches the Vite bundle hash invalidation cadence.
      res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
      return res.sendFile(htmlPath);
    }

    // No prerendered file found — fall through to SPA
    next();
  };
}

function countHtmlFiles(dir: string): number {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true, recursive: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".html")) count++;
    }
  } catch (e) { /* directory read for counting prerendered files — non-critical */ log.warn("[prerender-middleware] operation failed:", e); }
  return count;
}
