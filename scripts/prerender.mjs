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
  try {
    // Load full route data (path + title + description) for SEO injection
    const result = execSync(
      `node --import tsx/esm -e "import { PRERENDER_ROUTES } from './shared/routes.ts'; console.log(JSON.stringify(PRERENDER_ROUTES.map(r => ({ path: r.path, title: r.title, description: r.description }))));"`,
      { cwd: ROOT, encoding: "utf-8", timeout: 15000 }
    );
    return JSON.parse(result.trim());
  } catch {
    // Fallback: read the file and extract paths with regex
    console.log("[prerender] Falling back to regex route extraction...");
    const content = fs.readFileSync(path.join(ROOT, "shared", "routes.ts"), "utf-8");
    const paths = [];
    const re = /path:\s*"([^"]+)".*?prerender:\s*true/gs;
    let match;
    while ((match = re.exec(content)) !== null) {
      paths.push(match[1]);
    }
    return paths;
  }
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

          // Navigate and wait for the page to fully render
          const url = `http://localhost:${port}${routePath}`;
          await page.goto(url, {
            waitUntil: "networkidle0",
            timeout: 30000,
          });

          // Wait for React effects (SEOHead useEffect sets title, meta, canonical)
          // The SEOHead component runs in useEffect which fires after render
          await page.evaluate(() => new Promise((r) => setTimeout(r, 1500)));

          // Wait for title to change from the default (indicates SEOHead ran)
          await page.waitForFunction(
            () => !document.title.includes("Cleveland Auto Repair & Tire Shop"),
            { timeout: 3000 }
          ).catch(() => {});

          // Get the full HTML
          let html = await page.content();

          // Inject correct SEO tags from route registry if React's useEffect didn't update them
          const routeInfo = routeMap.get(routePath);
          if (routeInfo) {
            const BASE_URL = "https://autonicks.com";
            const canonicalUrl = `${BASE_URL}${routePath === "/" ? "" : routePath}`;

            // Fix title if it's still the default
            if (html.includes("Cleveland Auto Repair &amp; Tire Shop") || html.includes("Cleveland&#x27;s #1")) {
              html = html.replace(/<title>[^<]*<\/title>/, `<title>${routeInfo.title}</title>`);
            }

            // Fix meta description if it's still the default
            if (routeInfo.description) {
              html = html.replace(
                /(<meta\s+name="description"\s+content=")[^"]*(")/,
                `$1${routeInfo.description}$2`
              );
            }

            // Fix canonical URL
            html = html.replace(
              /(<link\s+rel="canonical"\s+href=")[^"]*(")/,
              `$1${routePath === "/" ? BASE_URL + "/" : canonicalUrl}$2`
            );

            // Fix OG tags
            html = html.replace(
              /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
              `$1${routeInfo.title}$2`
            );
            html = html.replace(
              /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
              `$1${routeInfo.description}$2`
            );
            html = html.replace(
              /(<meta\s+property="og:url"\s+content=")[^"]*(")/,
              `$1${canonicalUrl}$2`
            );

            // Fix Twitter tags
            html = html.replace(
              /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,
              `$1${routeInfo.title}$2`
            );
            html = html.replace(
              /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
              `$1${routeInfo.description}$2`
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
