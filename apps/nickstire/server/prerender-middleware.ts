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

  // ─── Answer-engine crawlers ────────────────────────────────────────────
  // The list above was built for search engines. `gptbot` is OpenAI's MODEL
  // TRAINING crawler — it is not what answers a question. The agents that
  // actually produce a customer-facing answer about this shop are separate
  // user agents, and none of them were here, so nickstire.org served them the
  // empty SPA shell: visible to the crawler that only trains a model, invisible
  // to the ones that cite a business when someone asks who to call.
  //
  // Cheapest possible change with the largest asymmetry — the prerendered HTML,
  // the semantic-parity guard and the bot-serving path already exist. This is
  // the organ, repointed.
  //
  // Verify against the vendor docs before editing; these are the published UA
  // tokens, matched case-insensitively as substrings:
  "oai-searchbot", // OpenAI — indexes for ChatGPT Search results
  "chatgpt-user", // OpenAI — live fetch when a user asks about a page
  "perplexitybot", // Perplexity — index
  "perplexity-user", // Perplexity — live fetch on a user question
  "claude-user", // Anthropic — live fetch on a user question
  "claude-searchbot", // Anthropic — search indexing
  "google-extended", // Google — Gemini / AI Overviews grounding
  "meta-externalagent", // Meta AI
  "amazonbot", // Amazon / Alexa
  "youbot", // You.com
  "cohere-ai", // Cohere
  "duckassistbot", // DuckDuckGo AI answers
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
  } catch (e) { /* directory read for counting prerendered files — non-critical */ log.warn("[prerender-middleware] operation failed:", e); }
  return count;
}
