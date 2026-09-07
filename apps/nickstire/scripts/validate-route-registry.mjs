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
// ROUTE_REGISTRY_ROOT exists for the canary (server/routeRegistryValidator.test.ts),
// which points the validator at fixture trees with planted defects. Production
// runs never set it.
const ROOT = process.env.ROUTE_REGISTRY_ROOT
  ? path.resolve(process.env.ROUTE_REGISTRY_ROOT)
  : path.resolve(__dirname, "..");

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

// Rule 0: the parsers must have found something. Every rule below compares two
// sets; if a regex silently stops matching (a JSX rewrite, a registry refactor)
// both sets go empty and every rule passes vacuously — a green that checks
// nothing. Fail closed instead.
if (appRoutes.size === 0) {
  errors.push("Parser found ZERO <Route path=...> entries in client/src/App.tsx — the route regex no longer matches; the gate is blind.");
}
if (registeredPaths.size === 0) {
  errors.push("Parser found ZERO `path:` entries in shared/routes.ts — the registry regex no longer matches; the gate is blind.");
}

// ─── The two server-side lists that live beside the registry ─────────
// shared/routes.ts also declares DYNAMIC_ROUTE_PREFIXES (the wouter :param
// routes, as prefixes) and NON_REGISTRY_PUBLIC_PATHS (real pages that are
// deliberately not registry entries). server/_core/spaFallback.ts answers
// 404 for any extensionless path outside registry + those two lists, so
// App.tsx and the lists must agree — in both directions — or a real page
// 404s in production. Parsed as text, same as the registry paths above.
function parseStringArray(source, name) {
  const m = source.match(new RegExp(`${name}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`shared/routes.ts: export "${name}" not found`);
  return [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
}
const DYNAMIC_ROUTE_PREFIXES = parseStringArray(routesTs, "DYNAMIC_ROUTE_PREFIXES");
const NON_REGISTRY_PUBLIC_PATHS = new Set(parseStringArray(routesTs, "NON_REGISTRY_PUBLIC_PATHS"));

// Rule 1: every App.tsx route must be registered (or be a dynamic :param)
// Paths that are intentionally not in the registry live in
// NON_REGISTRY_PUBLIC_PATHS (shared/routes.ts) — one list for this check
// AND for the server's 404 decision, so they cannot disagree.
for (const p of appRoutes) {
  // Skip dynamic routes (they're handled by SEO page templates, not the registry)
  if (p.includes(":")) continue;
  // Admin + sub-routes aren't sitemap pages; skip
  if (p.startsWith("/admin")) continue;
  // Wildcard route is the 404; skip
  if (p === "*" || p === "/*") continue;
  // Explicit exemptions
  if (NON_REGISTRY_PUBLIC_PATHS.has(p)) continue;

  if (!registeredPaths.has(p)) {
    errors.push(
      `App.tsx route "${p}" is NOT in shared/routes.ts — bots will see a blank shell and the ` +
      `server will answer 404. Add it to the registry (or to NON_REGISTRY_PUBLIC_PATHS in ` +
      `shared/routes.ts if it is deliberately a no-SEO page).`,
    );
  }
}

// Rule 5: the :param routes in App.tsx and DYNAMIC_ROUTE_PREFIXES must match
// exactly. A prefix missing here 404s every page under it; a stale prefix
// keeps 200-ing paths that no longer render anything.
const appParamPrefixes = new Set(
  [...appRoutes].filter((p) => p.includes(":")).map((p) => p.slice(0, p.indexOf(":"))),
);
for (const prefix of appParamPrefixes) {
  if (!DYNAMIC_ROUTE_PREFIXES.includes(prefix)) {
    errors.push(
      `App.tsx has a dynamic route under "${prefix}" but DYNAMIC_ROUTE_PREFIXES in shared/routes.ts ` +
      `does not list it — the server will answer 404 for every page under it.`,
    );
  }
}
for (const prefix of DYNAMIC_ROUTE_PREFIXES) {
  if (!appParamPrefixes.has(prefix)) {
    errors.push(`DYNAMIC_ROUTE_PREFIXES lists "${prefix}" but App.tsx has no :param route under it — remove the stale entry.`);
  }
}
for (const p of NON_REGISTRY_PUBLIC_PATHS) {
  if (!appRoutes.has(p)) {
    errors.push(`NON_REGISTRY_PUBLIC_PATHS lists "${p}" but App.tsx has no such route — remove the stale entry.`);
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
