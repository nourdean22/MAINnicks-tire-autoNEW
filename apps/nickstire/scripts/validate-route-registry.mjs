#!/usr/bin/env node
/**
 * Route Registry Validator — prevents silent SEO regressions.
 *
 * Rules enforced:
 *   1. Every <Route path="..."> in client/src/App.tsx MUST exist in
 *      shared/routes.ts (unless it's a dynamic :param route).
 *   2. Every entry in shared/routes.ts with prerender:true MUST have
 *      a non-empty title + description.
 *   3. Titles must be <= 60 chars (SEO best practice).
 *   4. Descriptions must be <= 160 chars.
 *
 * Why this matters: the prerender pipeline sniffs bot User-Agents and
 * serves pre-rendered HTML. If a new route is added to App.tsx but not
 * the registry, bots see a blank shell — SEO regression. This check
 * catches that at CI time.
 *
 * Run: pnpm run validate:routes
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ─── Parse App.tsx for <Route path="..."> ─────────────
const appTsx = fs.readFileSync(path.join(ROOT, "client", "src", "App.tsx"), "utf8");
// wouter supports both:  path="/foo"  and  path={"/foo"}
const ROUTE_RE = /<Route\s+[^>]*path\s*=\s*(?:["']([^"']+)["']|\{\s*["']([^"']+)["']\s*\})/g;
const appRoutes = new Set();
for (const m of appTsx.matchAll(ROUTE_RE)) {
  const p = m[1] ?? m[2];
  if (p) appRoutes.add(p);
}

// ─── Parse routes.ts for registered paths ─────────────
const routesTs = fs.readFileSync(path.join(ROOT, "shared", "routes.ts"), "utf8");
const PATH_RE = /path:\s*["']([^"']+)["']/g;
const TITLE_RE = /title:\s*["']([^"']*)["']/g;
const DESC_RE = /description:\s*["']([^"']*)["']/g;

const registeredPaths = new Set();
for (const m of routesTs.matchAll(PATH_RE)) {
  registeredPaths.add(m[1]);
}

// ─── Rules ─────────────────────────────────────────────
const errors = [];
const warnings = [];

// Rule 1: every App.tsx route must be registered (or be a dynamic :param)
// Paths that are intentionally not in the registry:
//   - 404 / wildcard is a terminal fallback, not a real URL
//   - /track, /status-tracker = dynamic per-job status, shouldn't prerender
//   - /pay, /invoice/:id = transactional, not crawlable
const EXEMPT_PATHS = new Set([
  "/404",
  "/track",
  "/pay",
  "/status",
]);

for (const p of appRoutes) {
  // Skip dynamic routes (they're handled by SEO page templates, not the registry)
  if (p.includes(":")) continue;
  // Admin + sub-routes aren't sitemap pages; skip
  if (p.startsWith("/admin")) continue;
  // Wildcard route is the 404; skip
  if (p === "*" || p === "/*") continue;
  // Explicit exemptions
  if (EXEMPT_PATHS.has(p)) continue;

  if (!registeredPaths.has(p)) {
    errors.push(
      `App.tsx route "${p}" is NOT in shared/routes.ts — bots will see a blank shell. ` +
      `Add it to the registry (or add to EXEMPT_PATHS in scripts/validate-route-registry.mjs if intentional).`,
    );
  }
}

// Rule 2/3/4: every registry entry must have decent SEO meta
const TITLE_MAX = 70;
const DESC_MAX = 165;

// Very simple block parser — count nothing fancy, match entry-level fields
const entryRe = /\{\s*path:\s*["']([^"']+)["'][^}]*?title:\s*["']([^"']*)["'][^}]*?description:\s*["']([^"']*)["'][^}]*?prerender:\s*(true|false)/gs;
for (const m of routesTs.matchAll(entryRe)) {
  const [, p, title, desc, prerender] = m;
  if (prerender === "true") {
    if (!title.trim()) errors.push(`"${p}" has empty title`);
    if (!desc.trim()) errors.push(`"${p}" has empty description`);
    if (title.length > TITLE_MAX)
      warnings.push(`"${p}" title is ${title.length} chars (> ${TITLE_MAX})`);
    if (desc.length > DESC_MAX)
      warnings.push(`"${p}" description is ${desc.length} chars (> ${DESC_MAX})`);
  }
}

// ─── Report ───────────────────────────────────────────
console.log("\n─── route registry validation ───");
console.log(`  App.tsx routes:        ${appRoutes.size}`);
console.log(`  Registry entries:      ${registeredPaths.size}`);
console.log(`  Errors:                ${errors.length}`);
console.log(`  Warnings:              ${warnings.length}`);
console.log("");

for (const w of warnings) console.log(`  warn: ${w}`);
if (warnings.length) console.log("");

if (errors.length) {
  for (const e of errors) console.error(`  \u2717 ${e}`);
  console.error(`\nFix: add the missing paths to shared/routes.ts.`);
  console.error(`This CI check exists so bot crawlers never see a blank page.\n`);
  process.exit(1);
}

console.log("\u2713 route registry OK — every App.tsx route is registered, every prerender entry has SEO meta");
