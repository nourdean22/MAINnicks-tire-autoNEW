/**
 * In-place SEO patch for stale prerendered files.
 *
 * Re-running the full Puppeteer prerender takes ~10 minutes and a live dev
 * server. This script does a surgical fix on existing prerendered HTML files
 * for two confirmed issues found in the 2026-04-30 SEO audit:
 *
 *   1. Corrupted meta description / og:description / twitter:description.
 *      Cause: pre-Apr-26 version of prerender.mjs did not escape `$` in
 *      replacement strings, so descriptions containing prices like `$149`
 *      or `$10 down` got mangled into `<meta name="description" content="9`
 *      because `$1` was interpreted as a capture-group backreference.
 *      Affected: /tires, /financing, /cleveland-auto-repair (3 pages).
 *
 *   2. Duplicate FAQPage JSON-LD. The shop-wide FAQ schema lived in
 *      `client/index.html` AND every page that has its own FAQ schema
 *      (ServicePage, FAQ, BrakeRepair, ...) emitted a second FAQPage,
 *      tripping the "duplicate FAQPage" structured-data error in Search
 *      Console on 91/142 pages.
 *      Fix: index.html FAQPage block has been removed; this script strips
 *      the matching FAQPage schema from already-emitted prerendered files.
 *
 * Run with:
 *   node scripts/patch-prerender-seo.mjs
 *
 * Idempotent — re-running on already-patched files is a no-op.
 *
 * SCOPE NOTE: this script was a one-shot historical fix for the 3
 * affected top-level routes (/tires, /financing, /cleveland-auto-repair).
 * It iterates only top-level prerendered/{slug}/index.html files; it
 * does NOT recurse into prerendered/blog/<slug>/index.html. The
 * 2026-05-05 .github/workflows/verify-prerender.yml workflow is the
 * ongoing defense against drift, including for blog posts. If a
 * similar corruption ever recurs in blog HTML, prefer re-running
 * `pnpm run regen` over extending this script.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRERENDER_DIR = path.resolve(ROOT, "prerendered");
const ROUTES_FILE = path.resolve(ROOT, "shared", "routes.ts");

// ─── Load route registry ─────────────────────────────────
// Regex-parse shared/routes.ts directly so we don't need tsx at runtime.
// Each route entry has the shape:
//   { path: "/foo", priority: ..., changefreq: ..., title: "...", description: "...", group: ..., sitemap: ..., prerender: ... }
// We extract path / title / description triplets.
function loadRoutes() {
  const src = fs.readFileSync(ROUTES_FILE, "utf-8");
  const routes = [];
  // Match every `{ ... path: "..." ... }` style entry. Use a tolerant regex
  // that captures the three fields anywhere within a single object literal.
  const objectRe = /\{\s*(?:[^{}]|\{[^{}]*\})*\}/g;
  let match;
  while ((match = objectRe.exec(src)) !== null) {
    const block = match[0];
    const pathMatch = block.match(/path:\s*"([^"]+)"/);
    const titleMatch = block.match(/title:\s*"((?:[^"\\]|\\.)*)"/);
    const descMatch = block.match(/description:\s*"((?:[^"\\]|\\.)*)"/);
    if (!pathMatch || !titleMatch) continue;
    const unesc = (s) => s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    routes.push({
      path: pathMatch[1],
      title: unesc(titleMatch[1]),
      description: descMatch ? unesc(descMatch[1]) : "",
    });
  }
  return routes;
}

// ─── HTML attribute escaping (mirror of prerender.mjs) ───
const escAttr = (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/"/g, "&quot;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;");

// ─── Main ────────────────────────────────────────────────
function main() {
  if (!fs.existsSync(PRERENDER_DIR)) {
    console.error(`[patch] No prerendered/ dir at ${PRERENDER_DIR}`);
    process.exit(1);
  }

  const routes = loadRoutes();
  const routeMap = new Map(routes.map(r => [r.path, r]));

  // Walk every {slug}/index.html under prerendered/
  const entries = fs.readdirSync(PRERENDER_DIR, { withFileTypes: true });

  let touched = 0;
  let metaFixed = 0;
  let faqStripped = 0;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(PRERENDER_DIR, entry.name, "index.html");
    if (!fs.existsSync(filePath)) continue;

    const slug = entry.name;
    const routePath = "/" + slug;
    const routeInfo = routeMap.get(routePath);

    let html = fs.readFileSync(filePath, "utf-8");
    let changed = false;

    // ── (1) FIX BROKEN META DESCRIPTION / OG / TWITTER ───
    // The corruption pattern: a value with `$1`, `$2`, etc. backreferences
    // was injected unescaped, producing garbage like:
    //   content="...<meta name="description" content="0 down..."
    // Detect this by checking for nested `<meta` inside a meta `content="..."`.
    const corruption = /<meta\s+(?:name|property)="(?:[a-z:]+)"\s+content="[^"]*<meta/i;
    if (routeInfo && corruption.test(html)) {
      // Re-emit the affected meta tags with the canonical description
      // from routes.ts. Use a function-form replacer to sidestep
      // backreference interpretation entirely.
      const descAttr = escAttr(routeInfo.description || "");
      const titleAttr = escAttr(routeInfo.title || "");

      // Strip the broken meta description and re-emit a clean one.
      // Match from the OPENING `<meta name="description"` through the next
      // `>` that closes a tag whose content attr opened with a `"`.
      // Greedy-but-safe: stop at the first `>` AFTER all the trash.
      html = html.replace(
        /<meta\s+name="description"[\s\S]*?>/i,
        () => `<meta name="description" content="${descAttr}">`
      );
      html = html.replace(
        /<meta\s+property="og:description"[\s\S]*?>/i,
        () => `<meta property="og:description" content="${descAttr}">`
      );
      html = html.replace(
        /<meta\s+name="twitter:description"[\s\S]*?>/i,
        () => `<meta name="twitter:description" content="${descAttr}">`
      );
      // og:title and twitter:title can also be affected if the title contains `$`.
      if (titleAttr) {
        html = html.replace(
          /<meta\s+property="og:title"\s+content="[^"]*<meta[\s\S]*?>/i,
          () => `<meta property="og:title" content="${titleAttr}">`
        );
        html = html.replace(
          /<meta\s+name="twitter:title"\s+content="[^"]*<meta[\s\S]*?>/i,
          () => `<meta name="twitter:title" content="${titleAttr}">`
        );
      }

      metaFixed++;
      changed = true;
    }

    // ── (2) STRIP DUPLICATE FAQPage SCHEMA FROM index.html ─
    // The shop-wide FAQPage from index.html had a stable signature: it
    // started with the "Do I need an appointment at Nick's Tire & Auto?"
    // question. Strip the entire <script type="application/ld+json"> block
    // that contains that question.
    const faqSignature = "Do I need an appointment at Nick";
    const faqRe = /<script type="application\/ld\+json">\s*\{[^<]*?"@type":\s*"FAQPage"[^<]*?Do I need an appointment at Nick[\s\S]*?<\/script>/;
    if (faqRe.test(html) && html.includes(faqSignature)) {
      // Only strip if this page has ANOTHER FAQPage schema (page-specific).
      // Otherwise we'd leave the page with zero FAQ schema.
      const faqCount = (html.match(/"@type":\s*"FAQPage"/g) || []).length;
      if (faqCount > 1) {
        html = html.replace(faqRe, "");
        faqStripped++;
        changed = true;
      }
    }

    if (changed) {
      fs.writeFileSync(filePath, html, "utf-8");
      touched++;
    }
  }

  console.log(`\n[patch-prerender-seo] Done.`);
  console.log(`  Touched files:           ${touched}`);
  console.log(`  Broken meta fixed:       ${metaFixed}`);
  console.log(`  Duplicate FAQ stripped:  ${faqStripped}`);
}

main();
