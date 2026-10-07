#!/usr/bin/env node
/**
 * Local prerender drift check.
 *
 * Mirrors the .github/workflows/verify-prerender.yml logic so devs
 * can run it before pushing instead of finding out via failed CI.
 * Also useful when a regen feels off — fast sanity check that the
 * prerendered/ tree matches the route+blog source of truth.
 *
 * Run: pnpm prerender:check
 *
 * Exits 0 if MISSING <= 5 (matches CI threshold). Reports extras as
 * informational — DB-dynamic blogs surface as legit "extras" and
 * can't be predicted from static source.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRERENDER_DIR = path.resolve(ROOT, "prerendered");

if (!fs.existsSync(PRERENDER_DIR)) {
  console.error(`[prerender:check] No prerendered/ at ${PRERENDER_DIR} — run 'pnpm run regen' first.`);
  process.exit(2);
}

// Compute the expected set AND the sitemap subset from ONE tsx call. A second
// nested -e string would be a second place for the two lists to drift apart.
//
// Guide leaf pages are in here too (2026-10-07). server/_core/index.ts put
// every /guides/:slug into sitemap.xml on 2026-09-11, but this list was built
// from the route registry alone and GUIDES is not a registry group — so the
// "a missing artifact for a SITEMAP route is never tolerable" rule below could
// not see 40 advertised URLs that had no artifact at all. The sitemap is what
// Google reads; the expected set has to follow the sitemap's sources, not the
// registry's. A redirected guide is skipped exactly as the sitemap skips it.
//
// NO ARROW FUNCTIONS in this payload. It is a double-quoted shell string, and
// Windows reads the ">" in "=>" as a redirect — which surfaces as
// "SyntaxError: Invalid or unexpected token" with nothing pointing at the
// real cause. Use function declarations and for-loops here.
const expectedJson = execSync(
  `node --import tsx -e "import { PRERENDER_ROUTES, BLOG_SLUGS, SITEMAP_ROUTES } from './shared/routes.ts'; import { GUIDES } from './shared/guides.ts'; import { isRedirectedPath } from './server/_core/redirects.ts'; function f(p){ return p === '/' ? 'index.html' : p.replace(/^\\//, '') + '/index.html'; } const e = []; for (const r of PRERENDER_ROUTES) e.push(f(r.path)); for (const s of BLOG_SLUGS) e.push('blog/' + s + '/index.html'); const m = []; for (const r of SITEMAP_ROUTES) m.push(f(r.path)); for (const g of GUIDES) { if (isRedirectedPath('/guides/' + g.slug)) continue; e.push('guides/' + g.slug + '/index.html'); m.push('guides/' + g.slug + '/index.html'); } console.log(JSON.stringify({ e: e, m: m }));"`,
  { cwd: ROOT, encoding: "utf-8", timeout: 15000 }
);
const parsed = JSON.parse(expectedJson);
const expected = new Set(parsed.e);
/** Artifacts for URLs we advertise to crawlers. A gap here is indexed, not just uncrawled. */
const sitemapExpected = new Set(parsed.m);


// Compute actual set from prerendered/.
const actual = new Set();
function walk(dir, prefix = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) walk(full, rel);
    else if (entry.name === "index.html") actual.add(rel);
  }
}
walk(PRERENDER_DIR);

const missing = [...expected].filter(x => !actual.has(x)).sort();
const extra = [...actual].filter(x => !expected.has(x)).sort();

console.log(`expected: ${expected.size}`);
console.log(`actual:   ${actual.size}`);
console.log(`missing:  ${missing.length}`);
console.log(`extra:    ${extra.length} (DB-dynamic blogs etc — informational)`);

if (missing.length > 0) {
  console.log("\nMissing (in source but not prerendered):");
  for (const m of missing.slice(0, 50)) console.log("  - " + m);
}
if (extra.length > 0 && process.env.VERBOSE) {
  console.log("\nExtras (prerendered but not in source — usually fine):");
  for (const e of extra.slice(0, 50)) console.log("  - " + e);
}

// A tolerance of 5 was hiding a real regression. On 2026-09-10 three job leaf
// pages shipped with sitemap:true + prerender:true, their artifacts were never
// generated, and this gate printed all three by name and then exited 0 —
// "OK." — because 3 <= 5. Three URLs sat in the sitemap serving an empty SPA
// shell to crawlers while a brand-new test suite reported the fix as shipped,
// because that suite asserted the registry BOOLEAN rather than the artifact.
//
// A missing artifact for a SITEMAP route is never tolerable: the URL is
// advertised, so the empty shell is what gets indexed. The count tolerance
// survives only for non-sitemap prerender entries, where a gap costs crawl
// budget rather than an indexed blank page.
const missingSitemap = missing.filter((m) => sitemapExpected.has(m));
if (missingSitemap.length > 0) {
  console.error(
    [
      "",
      `FAIL: ${missingSitemap.length} SITEMAP route(s) have no prerendered artifact.`,
      "These URLs are advertised to crawlers and would serve an empty shell:",
      ...missingSitemap.map((m) => "  - " + m),
      "",
      "Run the prerender refresh workflow — it carries GOOGLE_MAPS_API_KEY.",
      "A local 'pnpm run regen' without that key strips the live review cards",
      "from /reviews.",
    ].join("\n")
  );
  process.exit(1);
}

if (missing.length > 5) {
  console.error(`\nFAIL: ${missing.length} missing — run 'pnpm run regen'.`);
  process.exit(1);
}
console.log("\nOK.");
