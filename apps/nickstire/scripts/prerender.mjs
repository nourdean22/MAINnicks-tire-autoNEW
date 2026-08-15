/**
 * Build-time prerender script.
 *
 * 1. Starts the production server (or connects to a running one).
 * 2. Visits every route in the route registry with Puppeteer.
 * 3. Waits for React to hydrate and SEOHead to update the <head>.
 * 4. Captures the fully-rendered HTML (including meta tags, JSON-LD, content).
 * 5. Saves static .html files under dist/prerendered/{route}/index.html.
 *
 * Express will serve these to bot User-Agents.
 *
 * Usage:
 *   node scripts/prerender.mjs                 # starts its own server
 *   node scripts/prerender.mjs --port 3000     # connects to running server
 */

import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRERENDER_DIR = path.resolve(ROOT, "dist", "prerendered");

// ─── Parse CLI args ──────────────────────────────────────
const args = process.argv.slice(2);
let externalPort = null;
const portIdx = args.indexOf("--port");
if (portIdx !== -1 && args[portIdx + 1]) {
  externalPort = parseInt(args[portIdx + 1], 10);
}

// ─── Import route registry ──────────────────────────────
// Load all routes for prerender. The 2026-05-05 audit caught two silent
// failures in this function: tsx/esm broken on Node 24, and a temp-script
// import path bug. Both were swallowed by try/catch with only a warning,
// dropping 100+ blog routes from prerender. This rewrite hardens the
// loader against silent failure:
//
//   1. The tsx-based PRERENDER_ROUTES load is the primary path. If it
//      fails AND the regex fallback returns < 50 routes, the build now
//      throws (was: silently shipped <50 routes).
//   2. The blog loader (separate try block below) is now also asserted —
//      if it returns 0 routes when BLOG_SLUGS has 100+ in source, the
//      build throws.
//
// Both paths still log progress so CI output is clear. Sanity thresholds
// (50 for routes, 100 for blogs) are well below current scale (170 +
// 115) and well above any plausible future trim — they'd only fire on
// genuine pipeline breakage.
async function loadRoutes() {
  const { execSync } = await import("child_process");
  const routes = [];
  let primaryLoaderOk = false;
  try {
    // Load full route data (path + title + description) for SEO injection
    const result = execSync(
      `node --import tsx -e "import { PRERENDER_ROUTES } from './shared/routes.ts'; console.log(JSON.stringify(PRERENDER_ROUTES.map(r => ({ path: r.path, title: r.title, description: r.description }))));"`,
      { cwd: ROOT, encoding: "utf-8", timeout: 15000 }
    );
    routes.push(...JSON.parse(result.trim()));
    primaryLoaderOk = true;
    console.log(`[prerender] Loaded ${routes.length} routes via tsx`);
  } catch (err) {
    console.warn("[prerender] tsx route loader failed, trying regex fallback:", err.message);
    const content = fs.readFileSync(path.join(ROOT, "shared", "routes.ts"), "utf-8");
    const re = /path:\s*"([^"]+)".*?prerender:\s*true/gs;
    let match;
    while ((match = re.exec(content)) !== null) {
      routes.push(match[1]);
    }
    console.warn(`[prerender] Regex fallback recovered ${routes.length} routes (no title/description metadata available)`);
  }

  // Sanity gate: routes.ts has ~170 PRERENDER_ROUTES today. If we got
  // fewer than 50, something is wrong with both loader paths.
  if (routes.length < 50) {
    throw new Error(
      `[prerender] FATAL: route loader returned only ${routes.length} routes ` +
      `(expected 50+). Both tsx loader and regex fallback failed. ` +
      `tsx loader status: ${primaryLoaderOk ? "ok" : "failed"}. ` +
      `Check shared/routes.ts and ensure 'tsx' devDep is installed.`
    );
  }

  // ── Pull dynamic blog slugs + per-post SEO metadata from the DB so
  //    DB-seeded articles get prerendered with their REAL title/description,
  //    not a generic placeholder. Without per-post meta, Google sees every
  //    dynamic blog post with the same title → cannibalization + zero ranking.
  //
  //    Implementation: write a temp file and execute it. The previous
  //    approach used `node --import tsx/esm -e "..."` with single-quotes
  //    inside a double-quoted shell argument. Windows cmd.exe doesn't
  //    honor single-quote escaping inside double-quoted strings, so the
  //    `Nick\\'s` literal in the fallback title broke the inline script
  //    parse and the entire blog-metadata fetch silently failed on
  //    Windows.
  try {
    const tempScript = path.join(ROOT, "tmp", "load-blog-routes.mjs");
    fs.mkdirSync(path.dirname(tempScript), { recursive: true });
    // Imports are relative to tempScript's directory (tmp/), so use `../`
    // to escape into the project root. Previously these said `./shared/...`
    // which resolved to `tmp/shared/...` (not exist) and silently failed,
    // dropping all blog routes from the prerender list.
    fs.writeFileSync(
      tempScript,
      `import "dotenv/config";
import { BLOG_SLUGS } from "../shared/routes.ts";
import { BLOG_ARTICLES } from "../shared/blog.ts";
import { getPublishedArticles } from "../server/content-generator.ts";

const dynRows = await getPublishedArticles().catch(() => []);
const staticMap = new Map(BLOG_ARTICLES.map(a => [a.slug, { title: a.metaTitle, description: a.metaDescription }]));
const dynMap = new Map(dynRows.map(a => [a.slug, { title: a.metaTitle, description: a.metaDescription }]));
const slugs = Array.from(new Set([...BLOG_SLUGS, ...dynRows.map(r => r.slug)]));
const out = slugs.map(s => {
  const meta = staticMap.get(s) || dynMap.get(s) || {
    title: "Blog \\u2014 Nick's Tire & Auto",
    description: "Auto repair tips from Cleveland.",
  };
  return { path: "/blog/" + s, title: meta.title, description: meta.description };
});
console.log(JSON.stringify(out));
process.exit(0);
`,
      "utf-8"
    );
    // Run the temp script via tsx — works identically on Windows + POSIX.
    const result = execSync(
      `node --import tsx "${path.relative(ROOT, tempScript).replace(/\\/g, "/")}"`,
      { cwd: ROOT, encoding: "utf-8", timeout: 45000 }
    );
    const blogRoutes = JSON.parse(result.trim());
    // De-dupe against existing routes
    const existing = new Set(routes.map(r => typeof r === "string" ? r : r.path));
    for (const b of blogRoutes) {
      if (!existing.has(b.path)) routes.push(b);
    }
    console.log(`[prerender] Added ${blogRoutes.length} blog routes with per-post SEO metadata`);

    // Sanity gate: BLOG_SLUGS has 115 static entries today. If we got
    // < 100 blog routes, the loader is failing to merge them properly.
    // This is the exact failure mode that shipped to prod on 2026-05-05.
    if (blogRoutes.length < 100) {
      throw new Error(
        `[prerender] FATAL: blog loader returned only ${blogRoutes.length} routes ` +
        `(expected 100+ from BLOG_SLUGS in shared/routes.ts). ` +
        `The blog routes loader silently failed before — fail loud now. ` +
        `Verify BLOG_SLUGS export in shared/routes.ts and that tsx can read .ts files.`
      );
    }
  } catch (err) {
    // Re-throw FATAL errors (the sanity gate above). Only swallow truly
    // optional failures like a missing DB connection augmenting dynamic
    // articles — and even then, log clearly enough that CI catches it.
    if (err.message.startsWith("[prerender] FATAL:")) throw err;
    console.error("[prerender] Blog routes loader failed:", err.message);
    console.error("[prerender] This used to be silently swallowed and dropped 100+ blog routes from prerender.");
    console.error("[prerender] Continuing without blog routes — but the verify-prerender CI workflow will catch the resulting drift on PR.");
  }

  return routes;
}

// ─── Start production server if needed ───────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["dist/index.js"], {
      cwd: ROOT,
      // wave-181.3 · PRERENDER_MODE=true tells server/_core/index.ts to
      // skip cron scheduler + SMS queue + Telegram batch + NOUR OS bridge
      // so puppeteer can reach networkidle0 without competing background
      // network traffic. Without this, prerender hung indefinitely on
      // routes 55+ because the server's network was never idle.
      env: { ...process.env, NODE_ENV: "production", PORT: "4173", PRERENDER_MODE: "true" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let started = false;
    const timeout = setTimeout(() => {
      if (!started) {
        proc.kill();
        reject(new Error("Server failed to start within 30s"));
      }
    }, 30000);

    proc.stdout.on("data", (data) => {
      const line = data.toString();
      // wave-181.3: server now emits "[server:ready]" (pino-style) not the
      // old "Server running" string. Match either so this stays compatible
      // if logging is refactored again.
      if ((line.includes("[server:ready]") || line.includes("Server running")) && !started) {
        started = true;
        clearTimeout(timeout);
        resolve({ proc, port: 4173 });
      }
    });

    proc.stderr.on("data", (data) => {
      console.error("[server]", data.toString());
    });

    proc.on("exit", (code) => {
      if (!started) {
        clearTimeout(timeout);
        reject(new Error(`Server exited with code ${code}`));
      }
    });
  });
}

// ─── Main prerender loop ─────────────────────────────────
async function main() {
  console.log("[prerender] Loading route registry...");
  const routeData = await loadRoutes();
  // routeData is either [{path, title, description}] or ["/path1", "/path2"] (fallback)
  const routes = routeData.map(r => typeof r === "string" ? r : r.path);
  const routeMap = new Map();
  routeData.forEach(r => {
    if (typeof r === "object") routeMap.set(r.path, r);
  });
  console.log(`[prerender] Found ${routes.length} routes to prerender.`);

  // Clean and create output directory
  if (fs.existsSync(PRERENDER_DIR)) {
    fs.rmSync(PRERENDER_DIR, { recursive: true });
  }
  fs.mkdirSync(PRERENDER_DIR, { recursive: true });

  let serverProc = null;
  let port = externalPort;

  if (!port) {
    console.log("[prerender] Starting production server...");
    const server = await startServer();
    serverProc = server.proc;
    port = server.port;
  }

  console.log(`[prerender] Connecting to http://localhost:${port}`);

  // Dynamic import of puppeteer
  const puppeteer = await import("puppeteer");
  // let (not const): the per-route loop relaunches Chrome if it crashes mid-run.
  let browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  let success = 0;
  let failed = 0;

  // Process routes in batches to avoid overwhelming the server.
  // wave-181.3 · BATCH_SIZE reduced 5→2 to investigate hang at route ~54.
  // BATCH_SIZE=5 was creating 5 simultaneous puppeteer pages per batch;
  // if one hung at networkidle0 the whole batch waited 45s+. With
  // PRERENDER_MODE skipping cron, contention should be low enough that 2
  // works fine and pinpoints which route hangs.
  // 2026-05-30 · kept at 2. Tried 8 against the real DB and it DEADLOCKED the
  // mysql pool (connectionLimit ~10; 8 concurrent pages each holding multiple
  // query connections exhausts it → progress stalls). 2 is pool-safe and
  // progresses reliably; speed comes from the trimmed render-wait below.
  const BATCH_SIZE = 2;
  // wave-2026-05-30 · PER-ROUTE HARD TIMEOUT + browser-crash recovery.
  // Root cause of the 0/338 CI cancellations: at ~route 60 Chrome crashes
  // (OOM on the runner from accumulated heavy React DOMs — crashpad_handler
  // showed up in the orphan-process list), and the NEXT browser.newPage()
  // hangs forever on the dead browser. newPage() was OUTSIDE the try, with
  // no timeout — so the Promise.all never resolved, the for-loop never
  // advanced, and the whole run froze until the job-level cap killed it
  // (32 min of zero output after 60 good routes). The committed goto-timeout
  // never fired (0 soft-timeouts) because the hang isn't in goto.
  //
  // Fix: race the ENTIRE per-route task against a hard wall-clock budget so
  // no single wedged page/newPage/content call can stall the batch, and if
  // the browser process has died, relaunch it before the next route. This
  // converts "one crash kills all remaining routes" into "one route fails,
  // the rest still render." ROUTE_BUDGET_MS covers goto(12s)+wait(3s)+
  // title-wait(8s)+content/serialize with headroom.
  //
  // 2026-08-15: raised 35s → 50s to fit the soft-404 reload below. This is a
  // CAP, not a delay — a healthy route still finishes in ~15-23s and never
  // touches it. Only a route that captured a not-found branch spends the extra
  // ~14s, and there are ~10 of those out of 346.
  const ROUTE_BUDGET_MS = 50000;

  // Visible copy of a client-side not-found branch. Must stay in sync with the
  // same list in scripts/check-prerender-semantic.mjs, which fails the build
  // when one of these reaches the committed tree.
  const SOFT_404_MARKERS = ["ARTICLE NOT FOUND", "PAGE NOT FOUND"];
  for (let i = 0; i < routes.length; i += BATCH_SIZE) {
    const batch = routes.slice(i, i + BATCH_SIZE);
    // If Chrome died on the previous batch, relaunch before continuing so
    // newPage() below doesn't hang on a dead browser. `.connected` is a
    // getter in puppeteer v22+; older builds expose `.isConnected()` — handle
    // both so this doesn't silently no-op on a version mismatch.
    const browserAlive =
      typeof browser.connected === "boolean" ? browser.connected : browser.isConnected();
    if (!browserAlive) {
      console.error("[prerender] browser disconnected — relaunching Chrome…");
      try { await browser.close(); } catch { /* already dead */ }
      browser = await puppeteer.default.launch({
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
      });
    }
    await Promise.all(
      batch.map(async (routePath) => {
        let page = null;
        let timer = null;
        const renderOne = async () => {
          page = await browser.newPage();
          // Set a reasonable viewport
          await page.setViewport({ width: 1280, height: 800 });

          // ── CRITICAL: identify as Googlebot so the server's prerender
          //    middleware serves the rich pre-rendered HTML (if one exists
          //    for this route) instead of the bare SPA shell. Without this
          //    the server's UA-sniffing check served 19KB shells to
          //    Puppeteer, which captured them as 'prerendered' output and
          //    overwrote the real 140KB files. Also bumps hydration wait
          //    from 2.5s → 6s to survive heavy-cron CPU load on the server.
          await page.setUserAgent(
            "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
          );

          // Navigate and wait for the page to fully render
          const url = `http://localhost:${port}${routePath}`;
          // wave-2026-05-30 · RESILIENT capture. A DB-backed fetch (e.g. the
          // reviews widget) hangs when regen runs without a live DB, so the
          // page never reaches network-idle. Don't drop the route on timeout —
          // the page IS loaded and React has already rendered the static SEO
          // content (title, FAQ, AEO block, pricing, schema). Catch the
          // timeout and fall through to capture anyway; only the dynamic
          // widget degrades to empty, which is fine for prerender/SEO. Shorter
          // 20s budget so genuinely-hung pages don't waste 45s each.
          try {
            await page.goto(url, { waitUntil: "networkidle2", timeout: 12000 });
          } catch (navErr) {
            console.log(`    [soft-timeout] ${routePath}: ${String(navErr.message).split("\n")[0]} — capturing rendered HTML anyway`);
          }

          // Wait for React effects (SEOHead useEffect sets title, meta, canonical)
          await page.evaluate(() => new Promise((r) => setTimeout(r, 3000)));

          // Wait for title to change AWAY from any of the known defaults.
          await page.waitForFunction(
            () => {
              const t = document.title || "";
              return !t.startsWith("NOUR OS") &&
                     !t.includes("Cleveland Auto Repair & Tire Shop") &&
                     !t.includes("Cleveland&#x27;s #1 New &amp; Used Tire Shop");
            },
            { timeout: 8000 }
          ).catch(() => {});

          // Get the full HTML
          let html = await page.content();

          // ── Soft-404 guard ────────────────────────────────────────────
          // A DB-backed article renders BlogPost's not-found branch whenever
          // its tRPC query has not resolved — or has errored past `retry: 1` —
          // by capture time. What gets committed is a SOFT 404: HTTP 200, full
          // Article JSON-LD, "ARTICLE NOT FOUND" as the only visible copy, and
          // the URL sitting in the sitemap. Ten shipped that way in 6d99b9e3c
          // (2026-08-11) and a clean CI refresh still produced eight, so this is
          // not a one-off — it is nondeterministic per route, and it has
          // happened before (9a6c5ef04, 2026-07-09).
          //
          // React will not refetch a query that already settled, so waiting
          // longer cannot fix an errored one — reload and capture again. Costs
          // nothing on the 336 routes that never match. If the article genuinely
          // does not exist, the second attempt renders the same not-found HTML
          // and behaviour is exactly as before.
          if (SOFT_404_MARKERS.some((marker) => html.includes(marker))) {
            console.log(`    [soft-404] ${routePath}: not-found branch captured — reloading once`);
            try {
              await page.reload({ waitUntil: "networkidle2", timeout: 8000 });
            } catch {
              /* capture whatever rendered, same as the goto path above */
            }
            await page
              .waitForFunction(
                (markers) => !markers.some((m) => (document.body?.innerText || "").includes(m)),
                { timeout: 6000 },
                SOFT_404_MARKERS,
              )
              .catch(() => {});
            html = await page.content();
            const stillBroken = SOFT_404_MARKERS.some((marker) => html.includes(marker));
            console.log(
              `    [soft-404] ${routePath}: ${stillBroken ? "STILL not-found after reload" : "recovered"}`,
            );
          }

          // Inject correct SEO tags from route registry if React's useEffect didn't update them
          const routeInfo = routeMap.get(routePath);
          if (routeInfo) {
            const BASE_URL = "https://nickstire.org";
            const canonicalUrl = `${BASE_URL}${routePath === "/" ? "" : routePath}`;

            // Escape HTML attribute chars in injected values (titles/descriptions
            // may contain &, ", <, > that would break the rendered tag).
            const esc = (s) => String(s)
              .replace(/&/g, "&amp;")
              .replace(/"/g, "&quot;")
              .replace(/</g, "&lt;")
              .replace(/>/g, "&gt;");
            // Escape literal $ in the replacement VALUE — String.replace treats $n
            // as a capture-group backreference, so titles/descs containing `$149`
            // (common for pricing) would get mangled into garbage without this.
            const escReplace = (s) => esc(s).replace(/\$/g, "$$$$");

            const safeTitle = escReplace(routeInfo.title);
            const safeDesc = routeInfo.description ? escReplace(routeInfo.description) : "";

            // Fix title if it's any known default (expanded detection)
            const currentTitleMatch = html.match(/<title>([^<]*)<\/title>/);
            const currentTitle = currentTitleMatch ? currentTitleMatch[1] : "";
            const isDefaultTitle =
              currentTitle.startsWith("NOUR OS") ||
              currentTitle.includes("Cleveland Auto Repair &amp; Tire Shop") ||
              currentTitle.includes("Cleveland&#x27;s #1") ||
              currentTitle.includes("Cleveland's #1 New & Used") ||
              // Also catch the default template title that Puppeteer serializes
              // with HTML-entity-encoded & (so `&` → `&amp;`).
              currentTitle.includes("Cleveland's #1 New &amp; Used") ||
              currentTitle.includes("Nick's Tire &amp; Auto — Cleveland") ||
              currentTitle.trim() === "";
            if (isDefaultTitle) {
              html = html.replace(/<title>[^<]*<\/title>/, `<title>${safeTitle}</title>`);
            }

            // Fix meta description if it's still the default
            if (routeInfo.description) {
              html = html.replace(
                /(<meta\s+name="description"\s+content=")[^"]*(")/,
                `$1${safeDesc}$2`
              );
            }

            // Fix or INSERT canonical URL
            if (html.includes('rel="canonical"')) {
              html = html.replace(
                /(<link\s+rel="canonical"\s+href=")[^"]*(")/,
                `$1${routePath === "/" ? BASE_URL + "/" : canonicalUrl}$2`
              );
            } else {
              html = html.replace("</head>", `  <link rel="canonical" href="${routePath === "/" ? BASE_URL + "/" : canonicalUrl}" />\n  </head>`);
            }

            // INSERT meta description if missing.
            // Use escReplace (not just esc) — the value lands inside
            // String.replace's replacement parameter, so `$149` would be
            // interpreted as a backreference without the $-escape.
            if (!html.includes('name="description"') && routeInfo.description) {
              html = html.replace("</head>", `  <meta name="description" content="${escReplace(routeInfo.description)}" />\n  </head>`);
            }

            // Fix OG tags
            html = html.replace(
              /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
              `$1${safeTitle}$2`
            );
            html = html.replace(
              /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
              `$1${safeDesc}$2`
            );
            html = html.replace(
              /(<meta\s+property="og:url"\s+content=")[^"]*(")/,
              `$1${canonicalUrl}$2`
            );

            // Fix Twitter tags
            html = html.replace(
              /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,
              `$1${safeTitle}$2`
            );
            html = html.replace(
              /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
              `$1${safeDesc}$2`
            );
          }

          // INSERT H1 if missing (critical for SEO — fixes "H1 tag missing" errors).
          // Use escReplace on title because route titles contain `$` for pricing
          // (e.g. "$149/Axle") and would otherwise be interpreted as
          // capture-group backreferences in the replacement string.
          if (routeInfo && !/<h1[\s>]/i.test(html)) {
            const h1Title = routeInfo.title ? escReplace(routeInfo.title) : "";
            const h1Tag = `<h1 style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0">${h1Title}</h1>`;
            // Match <main ...id="main-content"...> with ANY attributes/order
            // (PageLayout renders <main id="main-content" className="flex-1">,
            // so the literal string "id=\"main-content\">" never matched).
            if (/<main[^>]*id="main-content"[^>]*>/i.test(html)) {
              html = html.replace(/(<main[^>]*id="main-content"[^>]*>)/i, `$1${h1Tag}`);
            } else if (html.includes('<main')) {
              html = html.replace(/<main([^>]*)>/, `<main$1>${h1Tag}`);
            }
          }

          // Inject internal links if page has fewer than 3 (outside nav/header)
          {
            // Strip nav/header to avoid counting navigation links
            const bodyWithoutNav = html
              .replace(/<nav[\s\S]*?<\/nav>/gi, "")
              .replace(/<header[\s\S]*?<\/header>/gi, "");
            const internalLinkCount = (bodyWithoutNav.match(/<a\s[^>]*href="\/(tires|brakes|services|contact|reviews|diagnostics|oil-change|emissions|financing|blog|diagnose|estimate|about|appointments)/gi) || []).length;

            if (internalLinkCount < 3) {
              const linkStyle = 'style="color:#999;text-decoration:none;font-size:13px;margin:0 4px"';
              const linksBlock = `<nav aria-label="Related pages" style="padding:2rem 1rem;border-top:1px solid #222">\n  <p style="font-size:12px;color:#666;margin-bottom:8px">Explore More</p>\n  <a href="/tires" ${linkStyle}>Tires</a> &middot; <a href="/brakes" ${linkStyle}>Brakes</a> &middot; <a href="/diagnostics" ${linkStyle}>Diagnostics</a> &middot; <a href="/oil-change" ${linkStyle}>Oil Change</a> &middot; <a href="/emissions" ${linkStyle}>Emissions</a> &middot; <a href="/services" ${linkStyle}>All Services</a> &middot; <a href="/reviews" ${linkStyle}>Reviews</a> &middot; <a href="/contact" ${linkStyle}>Contact</a> &middot; <a href="/financing" ${linkStyle}>Financing</a> &middot; <a href="/blog" ${linkStyle}>Blog</a> &middot; <a href="/diagnose" ${linkStyle}>Diagnose My Car</a> &middot; <a href="/estimate" ${linkStyle}>Cost Estimator</a>\n</nav>`;

              if (html.includes("</main>")) {
                html = html.replace("</main>", `${linksBlock}\n</main>`);
              } else if (html.includes("<footer")) {
                html = html.replace(/<footer/, `${linksBlock}\n<footer`);
              }
              console.log(`    [links] Injected internal links for ${routePath} (had ${internalLinkCount} internal links)`);
            }
          }

          // wave-181.3 SEO audit · strip admin bundle modulepreload from
          // public pages. Vite auto-injects modulepreload for every chunk
          // in the dependency graph, including the admin chunk, which
          // wastes ~140KB of bandwidth on every mobile first paint. Admin
          // is lazy-loaded in App.tsx so the preload is purely waste.
          // Strip it on every route except /admin/*.
          //
          // wave-181.20 extension (Mobile + CWV audit) · also strip the
          // blog and vendor-charts modulepreloads from public non-blog
          // pages. Combined waste before this pass:
          //   admin-*.js          ~22KB brotli on EVERY page
          //   blog-*.js           ~195KB brotli on EVERY page
          //   vendor-charts-*.js  ~118KB brotli on EVERY page
          // = ~335KB brotli of pointless modulepreload on each first
          // paint of /, /brakes, /tires, every city page, every compare
          // page. None of those chunks are needed until the user clicks
          // into /blog/* or /admin/*. Stripping them keeps the
          // route-based code-split benefits Vite already provides without
          // forcing a deeper refactor of App.tsx imports.
          // Regex handles both `crossorigin` (bare) and `crossorigin=""`
          // (with empty value) which Vite emits in different versions.
          if (!routePath.startsWith("/admin")) {
            html = html.replace(
              /\s*<link\s+rel="modulepreload"\s+crossorigin(?:="")?\s+href="\/assets\/admin-[^"]+\.js"\s*\/?>\s*/g,
              ""
            );
            html = html.replace(
              /\s*<link\s+rel="modulepreload"\s+crossorigin(?:="")?\s+href="\/assets\/vendor-charts-[^"]+\.js"\s*\/?>\s*/g,
              ""
            );
          }
          if (!routePath.startsWith("/blog")) {
            html = html.replace(
              /\s*<link\s+rel="modulepreload"\s+crossorigin(?:="")?\s+href="\/assets\/blog-[^"]+\.js"\s*\/?>\s*/g,
              ""
            );
          }

          // Add prerendered marker
          html = html.replace("</head>", '  <meta name="prerendered" content="true" />\n  </head>');

          // Determine output path
          let outPath;
          if (routePath === "/") {
            outPath = path.join(PRERENDER_DIR, "index.html");
          } else {
            const dir = path.join(PRERENDER_DIR, routePath);
            fs.mkdirSync(dir, { recursive: true });
            outPath = path.join(dir, "index.html");
          }

          fs.writeFileSync(outPath, html, "utf-8");
          success++;

          // Quick content check
          const hasContent = html.length > 5000;
          const hasTitle = /<title>[^<]+<\/title>/.test(html);
          const status = hasContent && hasTitle ? "✓" : "⚠";
          console.log(`  ${status} ${routePath} (${Math.round(html.length / 1024)}KB)`);
        };

        try {
          // Race the whole render against a hard wall-clock budget. If a
          // wedged page, a dead-browser newPage(), or a hung content() blows
          // past it, reject so this route is counted failed and the batch
          // advances — a single stuck route can no longer freeze the run.
          await Promise.race([
            renderOne(),
            new Promise((_, reject) => {
              timer = setTimeout(
                () => reject(new Error(`route budget ${ROUTE_BUDGET_MS}ms exceeded — skipping`)),
                ROUTE_BUDGET_MS,
              );
            }),
          ]);
        } catch (err) {
          failed++;
          console.error(`  ✗ ${routePath}: ${err.message}`);
        } finally {
          if (timer) clearTimeout(timer);
          // Non-blocking close: on a crashed browser page.close() ITSELF
          // hangs (the original `await page.close()` in finally was a second
          // freeze point). Fire-and-forget; the next batch's connected-check
          // relaunches Chrome if it actually died.
          if (page) page.close().catch(() => {});
        }
      })
    );
  }

  try { await browser.close(); } catch { /* may already be down */ }

  if (serverProc) {
    serverProc.kill("SIGTERM");
  }

  console.log(`\n[prerender] Done: ${success} succeeded, ${failed} failed out of ${routes.length} routes.`);

  // wave-2026-05-30 · partial-success policy. The per-route hard timeout
  // (ROUTE_BUDGET_MS) intentionally SKIPS a route that can't render in budget
  // rather than freezing the whole run. So a small number of skips is the
  // resilience mechanism working as designed — committing 335/338 fresh pages
  // is far better than discarding all of them over a few slow blog posts
  // (the old `failed > 0 → exit 1` did exactly that: CI got 335 good routes,
  // then threw them away + skipped the commit). Fail loudly only if a LARGE
  // fraction fails, which signals a real systemic problem (dead DB, bad build)
  // rather than a couple of slow pages.
  const failRate = routes.length > 0 ? failed / routes.length : 0;
  if (failRate > 0.1) {
    console.error(`[prerender] FATAL: ${failed}/${routes.length} routes failed (${Math.round(failRate * 100)}%) — over the 10% tolerance. Not trusting this run.`);
    process.exit(1);
  }
  if (failed > 0) {
    console.warn(`[prerender] ${failed} route(s) skipped (under the 10% tolerance) — committing the ${success} that rendered.`);
  }
}

main().catch((err) => {
  console.error("[prerender] Fatal error:", err);
  process.exit(1);
});
