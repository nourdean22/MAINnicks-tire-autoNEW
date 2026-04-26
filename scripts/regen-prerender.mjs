/**
 * regen-prerender — one-command prerender regeneration.
 *
 * Handles the full pipeline that was previously 5 manual steps:
 *   1. Rebuild vite + server bundle so dist/ is fresh
 *   2. Start the prod server on a free port
 *   3. Run scripts/prerender.mjs against it (Puppeteer)
 *   4. Swap dist/prerendered → prerendered (the git-tracked location)
 *   5. Print an audit summary of what changed
 *
 * The server is killed cleanly at the end even if Puppeteer errors.
 * Run with: pnpm run regen
 *
 * Expect ~3-5 minutes total for 240 routes.
 */

import { spawn, execSync } from "child_process";
import fs from "fs";
import path from "path";
import net from "net";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRERENDER_DIR_FINAL = path.join(ROOT, "prerendered");
const PRERENDER_DIR_TMP = path.join(ROOT, "dist", "prerendered");

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
  const { default: httpOrFetch } = await import("http").catch(() => ({ default: null }));
  const start = Date.now();
  while (Date.now() - start < maxSec * 1000) {
    try {
      const res = await fetch(`http://localhost:${port}/api/health`);
      if (res.ok) return true;
    } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// ─── Step 1: build ────────────────────────────────────
console.log("[regen] Step 1/4 — rebuilding client + server…");
execSync("pnpm run build", { cwd: ROOT, stdio: "inherit" });

// ─── Step 2: launch server ────────────────────────────
const port = await findFreePort();
console.log(`\n[regen] Step 2/4 — launching server on :${port}…`);
const serverProc = spawn("node", ["dist/index.js"], {
  cwd: ROOT,
  env: { ...process.env, NODE_ENV: "production", PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
const serverLog = path.join(ROOT, "tmp", "regen-server.log");
if (!fs.existsSync(path.dirname(serverLog))) fs.mkdirSync(path.dirname(serverLog), { recursive: true });
const logStream = fs.createWriteStream(serverLog);
serverProc.stdout.pipe(logStream);
serverProc.stderr.pipe(logStream);

const healthy = await waitForHealth(port);
if (!healthy) {
  console.error("[regen] Server failed to start. Check tmp/regen-server.log");
  serverProc.kill();
  process.exit(1);
}
console.log(`[regen] Server ready`);

// ─── Step 3: prerender ────────────────────────────────
try {
  console.log(`\n[regen] Step 3/4 — running prerender…`);
  execSync(`node scripts/prerender.mjs --port ${port}`, { cwd: ROOT, stdio: "inherit" });
} finally {
  console.log(`\n[regen] Killing server…`);
  serverProc.kill();
}

// ─── Step 4: swap into git-tracked dir ────────────────
console.log(`\n[regen] Step 4/4 — swapping dist/prerendered → prerendered/…`);
if (!fs.existsSync(PRERENDER_DIR_TMP)) {
  console.error(`[regen] dist/prerendered not found — prerender didn't complete`);
  process.exit(1);
}

// Count before + after for a tiny audit
const countHtml = (dir) => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".html")) n++;
    }
  };
  walk(dir);
  return n;
};
const before = fs.existsSync(PRERENDER_DIR_FINAL) ? countHtml(PRERENDER_DIR_FINAL) : 0;
const fresh = countHtml(PRERENDER_DIR_TMP);

// Check for the "NOUR OS" regression — anything sneaking through
const brokenCount = (() => {
  let n = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && e.name.endsWith(".html")) {
        const head = fs.readFileSync(p, "utf8").slice(0, 2000);
        if (/<title>NOUR OS/.test(head)) n++;
      }
    }
  };
  walk(PRERENDER_DIR_TMP);
  return n;
})();

if (brokenCount > 0) {
  console.error(`\n[regen] ⚠️  WARNING: ${brokenCount} files still have 'NOUR OS' title. Not swapping.`);
  console.error(`  Inspect dist/prerendered/ to diagnose before manually swapping.`);
  process.exit(1);
}

fs.rmSync(PRERENDER_DIR_FINAL, { recursive: true, force: true });
fs.renameSync(PRERENDER_DIR_TMP, PRERENDER_DIR_FINAL);

console.log(`\n[regen] ✓ Complete.`);
console.log(`  Before: ${before} files`);
console.log(`  After:  ${fresh} files`);
console.log(`  Broken: ${brokenCount}`);
console.log(`\n  Next: git add prerendered/ && git commit && git push`);
console.log(`  Then Railway will serve the fresh HTML to Googlebot.`);
