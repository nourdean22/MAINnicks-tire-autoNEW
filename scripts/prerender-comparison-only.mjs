/**
 * Targeted prerender — comparison pages only.
 *
 * The full prerender pipeline (scripts/prerender.mjs) has a hang at
 * route ~54 we haven't root-caused yet (puppeteer memory leak or a
 * specific route stuck on networkidle0). This script bypasses the
 * problem by prerendering ONLY the 14 wave-181.3 comparison routes
 * that flipped from prerender:false → true. Those are the routes that
 * SHIP THE SERP FIX. The other ~320 routes already have valid
 * prerendered HTML in the repo from prior CI runs.
 *
 * Pipeline:
 *   1. Boot prod server on a random port with PRERENDER_MODE=true
 *   2. Wait for /api/health
 *   3. Launch puppeteer
 *   4. Walk the 14 paths serially (no batch — easier to debug)
 *   5. Write to dist/prerendered/<path>/index.html
 *   6. Copy each dist/prerendered/<path>/ → prerendered/<path>/
 *   7. Kill server, exit 0
 *
 * Run with: pnpm tsx scripts/prerender-comparison-only.mjs
 * (or with node since it's mjs, just `node scripts/prerender-comparison-only.mjs`)
 */

import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import net from "net";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DIST_PRERENDER_DIR = path.join(ROOT, "dist", "prerendered");
const FINAL_PRERENDER_DIR = path.join(ROOT, "prerendered");

// wave-181.3 · the 14 comparison routes + the /compare hub that just
// flipped from prerender:false → true. These are the ONLY routes that
// need fresh HTML to ship the SERP fix.
const ROUTES = [
  "/conrads-tire-alternative-cleveland",
  "/mavis-tire-alternative-cleveland",
  "/discount-tire-alternative-cleveland",
  "/firestone-alternative-cleveland",
  "/monro-mr-tire-alternative-cleveland",
  "/big-o-tires-alternative-cleveland",
  "/ntb-alternative-cleveland",
  "/nicks-tire-vs-conrads-cleveland",
  "/nicks-tire-vs-mavis-cleveland",
  "/nicks-tire-vs-firestone-cleveland",
  "/compare",
  "/best-tire-shops-cleveland",
  "/best-conrads-tire-alternatives-cleveland",
  "/conrads-vs-mavis-tire-cleveland",
  "/firestone-vs-discount-tire-cleveland",
  // wave-181.5 · new keyword-led SERP-fix pages
  "/no-credit-check-tires-cleveland",
  "/tire-shop-open-sunday-cleveland",
];

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

async function waitForHealth(port, maxSec = 30) {
  const start = Date.now();
  while (Date.now() - start < maxSec * 1000) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return true;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  const port = await findFreePort();
  console.log(`[targeted] Booting server on :${port} with PRERENDER_MODE=true`);
  const serverProc = spawn("node", ["dist/index.js"], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: "production", PORT: String(port), PRERENDER_MODE: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  serverProc.stdout.on("data", () => {}); // drain
  serverProc.stderr.on("data", () => {}); // drain

  const healthy = await waitForHealth(port, 60);
  if (!healthy) {
    console.error("[targeted] Server failed to start within 60s");
    serverProc.kill();
    process.exit(1);
  }
  console.log(`[targeted] Server ready · prerendering ${ROUTES.length} comparison routes serially`);

  const puppeteer = await import("puppeteer");
  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  let success = 0;
  let failed = 0;

  for (const routePath of ROUTES) {
    const page = await browser.newPage();
    try {
      await page.setViewport({ width: 1280, height: 800 });
      await page.setUserAgent(
        "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      );
      const url = `http://localhost:${port}${routePath}`;

      // Use domcontentloaded instead of networkidle0 — these pages don't
      // need to wait for every background fetch, just React hydration.
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.evaluate(() => new Promise((r) => setTimeout(r, 4000))); // React hydrate

      // Sanity: wait for title to be set
      await page.waitForFunction(
        () => document.title && !document.title.startsWith("NOUR OS"),
        { timeout: 5000 }
      ).catch(() => {});

      let html = await page.content();

      // Strip admin modulepreload (matches scripts/prerender.mjs logic)
      if (!routePath.startsWith("/admin")) {
        html = html.replace(
          /\s*<link\s+rel="modulepreload"\s+crossorigin\s+href="\/assets\/admin-[^"]+\.js"\s*\/?>\s*/g,
          ""
        );
      }
      // Prerendered marker
      html = html.replace("</head>", '  <meta name="prerendered" content="true" />\n  </head>');

      // Write to dist/prerendered
      const distDir = path.join(DIST_PRERENDER_DIR, routePath);
      fs.mkdirSync(distDir, { recursive: true });
      const distOut = path.join(distDir, "index.html");
      fs.writeFileSync(distOut, html, "utf-8");

      // Copy to /prerendered (git-tracked)
      const finalDir = path.join(FINAL_PRERENDER_DIR, routePath);
      fs.mkdirSync(finalDir, { recursive: true });
      const finalOut = path.join(finalDir, "index.html");
      fs.writeFileSync(finalOut, html, "utf-8");

      const ok = html.length > 5000;
      console.log(`  ${ok ? "✓" : "⚠"} ${routePath} (${Math.round(html.length / 1024)}KB)`);
      success++;
    } catch (err) {
      failed++;
      console.error(`  ✗ ${routePath}: ${err.message}`);
    } finally {
      await page.close();
    }
  }

  await browser.close();
  serverProc.kill();

  console.log(`\n[targeted] Done · ${success} success / ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("[targeted] FATAL:", err);
  process.exit(1);
});
