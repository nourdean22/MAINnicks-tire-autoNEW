/**
 * Prerender Middleware — Serves static prerendered HTML to search engine bots.
 *
 * When a known bot User-Agent requests a page, this middleware checks if a
 * prerendered HTML file exists for that route. If so, it serves the static
 * HTML directly (which contains all meta tags, JSON-LD, content). If not,
 * it falls through to the normal SPA handler.
 *
 * For regular users, this middleware does nothing — they get the SPA as usual.
 */

import type { Request, Response, NextFunction } from "express";
import fs from "fs";
import path from "path";

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

    // Only intercept if it's a bot
    const userAgent = req.get("user-agent") || "";
    if (!isBot(userAgent)) return next();

    // Skip API routes, static assets, and file requests
    const urlPath = req.path;
    if (
      urlPath.startsWith("/api/") ||
      urlPath.startsWith("/assets/") ||
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
      console.info(`[prerender:serve] ${urlPath} to ${userAgent.slice(0, 50)}`);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("X-Prerendered", "true");
      // Cache prerendered pages for bots (1 hour)
      res.setHeader("Cache-Control", "public, max-age=3600");
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
  } catch { /* directory read for counting prerendered files — non-critical */ }
  return count;
}
