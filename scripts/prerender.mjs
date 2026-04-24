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
// We dynamically import the compiled routes since it's a .ts file.
// For the prerender script, we read the routes directly via a simple approach.
async function loadRoutes() {
  const { execSync } = await import("child_process");
  const routes = [];
  try {
    // Load full route data (path + title + description) for SEO injection
    const result = execSync(
      `node --import tsx/esm -e "import { PRERENDER_ROUTES } from './shared/routes.ts'; console.log(JSON.stringify(PRERENDER_ROUTES.map(r => ({ path: r.path, title: r.title, description: r.description }))));"`,
      { cwd: ROOT, encoding: "utf-8", timeout: 15000 }
    );
    routes.push(...JSON.parse(result.trim()));
  } catch {
    // Fallback: read the file and extract paths with regex
    console.log("[prerender] Falling back to regex route extraction...");
    const content = fs.readFileSync(path.join(ROOT, "shared", "routes.ts"), "utf-8");
    const re = /path:\s*"([^"]+)".*?prerender:\s*true/gs;
    let match;
    while ((match = re.exec(content)) !== null) {
      routes.push(match[1]);
    }
  }

  // ── Pull dynamic blog slugs + per-post SEO metadata from the DB so
  //    DB-seeded articles get prerendered with their REAL title/description,
  //    not a generic placeholder. Without per-post meta, Google sees every
  //    dynamic blog post with the same title → cannibalization + zero ranking.
  //
  //    We also merge in static BLOG_ARTICLES from @shared/blog (their real
  //    metaTitle/metaDescription) so legacy posts get proper SEO injection too.
  try {
    // Note: dotenv/config MUST be imported before content-generator so
    // DATABASE_URL is populated before getDb() reads it.
    const result = execSync(
      `node --import tsx/esm -e "` +
      `import 'dotenv/config'; ` +
      `import { BLOG_SLUGS } from './shared/routes.ts'; ` +
      `import { BLOG_ARTICLES } from './shared/blog.ts'; ` +
      `import { getPublishedArticles } from './server/content-generator.ts'; ` +
      `const dynRows = await getPublishedArticles().catch(() => []); ` +
      `const staticMap = new Map(BLOG_ARTICLES.map(a => [a.slug, { title: a.metaTitle, description: a.metaDescription }])); ` +
      `const dynMap = new Map(dynRows.map(a => [a.slug, { title: a.metaTitle, description: a.metaDescription }])); ` +
      `const slugs = Array.from(new Set([...BLOG_SLUGS, ...dynRows.map(r => r.slug)])); ` +
      `const out = slugs.map(s => { const meta = staticMap.get(s) || dynMap.get(s) || { title: 'Blog | Nick\\'s Tire & Auto', description: 'Auto repair tips from Cleveland.' }; return { path: '/blog/' + s, title: meta.title, description: meta.description }; }); ` +
      `console.log(JSON.stringify(out));` +
      `process.exit(0);` +
      `"`,
      { cwd: ROOT, encoding: "utf-8", timeout: 45000 }
    );
    const blogRoutes = JSON.parse(result.trim());
    // De-dupe against existing routes
    const existing = new Set(routes.map(r => typeof r === "string" ? r : r.path));
    for (const b of blogRoutes) {
      if (!existing.has(b.path)) routes.push(b);
    }
    console.log(`[prerender] Added ${blogRoutes.length} blog routes with per-post SEO metadata`);
  } catch (err) {
    console.warn("[prerender] Could not load dynamic blog slugs from DB:", err.message);
  }

  return routes;
}

// ─── Start production server if needed ───────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn("node", ["dist/index.js"], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: "production", PORT: "4173" },
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
      if (line.includes("Server running") && !started) {
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
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  let success = 0;
  let failed = 0;

  // Process routes in batches to avoid overwhelming the server
  const BATCH_SIZE = 5;
  for (let i = 0; i < routes.length; i += BATCH_SIZE) {
    const batch = routes.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (routePath) => {
        const page = await browser.newPage();
        try {
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
          await page.goto(url, {
            waitUntil: "networkidle0",
            timeout: 45000,
          });

          // Wait for React effects (SEOHead useEffect sets title, meta, canonical)
          await page.evaluate(() => new Promise((r) => setTimeout(r, 6000)));

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

            // INSERT meta description if missing
            if (!html.includes('name="description"') && routeInfo.description) {
              html = html.replace("</head>", `  <meta name="description" content="${esc(routeInfo.description)}" />\n  </head>`);
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

          // INSERT H1 if missing (critical for SEO — fixes "H1 tag missing" errors)
          if (routeInfo && !/<h1[\s>]/i.test(html)) {
            // Inject a visually-hidden H1 into <main> or <body>
            const h1Tag = `<h1 style="position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);border:0">${routeInfo.title}</h1>`;
            if (html.includes('id="main-content"')) {
              html = html.replace('id="main-content">', `id="main-content">${h1Tag}`);
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
        } catch (err) {
          failed++;
          console.error(`  ✗ ${routePath}: ${err.message}`);
        } finally {
          await page.close();
        }
      })
    );
  }

  await browser.close();

  if (serverProc) {
    serverProc.kill("SIGTERM");
  }

  console.log(`\n[prerender] Done: ${success} succeeded, ${failed} failed out of ${routes.length} routes.`);

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[prerender] Fatal error:", err);
  process.exit(1);
});
