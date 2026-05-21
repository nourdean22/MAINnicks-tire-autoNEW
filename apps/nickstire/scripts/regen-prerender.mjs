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
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PRERENDER_DIR_FINAL = path.join(ROOT, "prerendered");
const PRERENDER_DIR_TMP = path.join(ROOT, "dist", "prerendered");
const PRERENDER_DIR_BACKUP = path.join(ROOT, "dist", "prerendered-prev");

// The populated .env lives at the monorepo root — apps/nickstire/ has none.
// Same resolution gsc-report.ts uses. Without this the prod server spawned
// in Step 2 dies with "Missing required env vars: DATABASE_URL, JWT_SECRET".
dotenv.config({ path: path.resolve(ROOT, "..", "..", ".env") });

// Safety net: Step 1.5 moves prerendered/ aside before launching the server,
// which can fail. If regen aborts for any reason before Step 4 puts a fresh
// tree in place, restore prerendered/ on exit — a failed regen must never
// leave the repo with the site's prerendered HTML wiped (a committed
// deletion would tank SEO).
process.on("exit", () => {
  if (fs.existsSync(PRERENDER_DIR_BACKUP) && !fs.existsSync(PRERENDER_DIR_FINAL)) {
    fs.renameSync(PRERENDER_DIR_BACKUP, PRERENDER_DIR_FINAL);
    console.error("[regen] aborted — restored prerendered/ from backup.");
  }
});

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
// Use `npm run build` instead of `pnpm run build` — npm is always on PATH on
// Windows where corepack's pnpm shim can be broken after Node upgrades.
execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

// ─── Step 1.7: ensure Puppeteer's Chrome is installed ──
// puppeteer downloads Chrome via a postinstall script, but pnpm blocks
// dependency postinstall scripts unless allowlisted — so on this repo
// Step 3's prerender otherwise dies with "Could not find Chrome". This
// command is idempotent (instant no-op once cached) and keeps regen
// self-sufficient on a fresh clone and in CI with no extra setup step.
console.log(`\n[regen] Step 1.7/4 — ensuring Puppeteer Chrome is installed…`);
execSync("npx --yes puppeteer browsers install chrome", { cwd: ROOT, stdio: "inherit" });

// ─── Step 1.5: move stale prerendered/ aside so middleware can't short-circuit ─
//
// The prerender-middleware serves prerendered/<route>/index.html to bot
// UAs. Puppeteer identifies as Googlebot to avoid the bare-SPA-shell
// path. If the OLD prerendered/ were still in place, Puppeteer would just
// receive it and copy it straight back, defeating the whole regen.
//
// We MOVE it to dist/prerendered-prev rather than delete it: the server
// finds no prerendered/ and the middleware's "no prerendered directory
// found" branch falls through to the SPA (which hydrates and renders the
// fresh DOM Puppeteer captures) — but the old tree stays recoverable. The
// process-exit handler above renames it back if regen aborts before
// Step 4 swaps a fresh tree into place.
console.log(`\n[regen] Step 1.5/4 — moving stale prerendered/ aside so middleware can't short-circuit…`);
if (fs.existsSync(PRERENDER_DIR_BACKUP)) {
  fs.rmSync(PRERENDER_DIR_BACKUP, { recursive: true, force: true });
}
if (fs.existsSync(PRERENDER_DIR_FINAL)) {
  fs.renameSync(PRERENDER_DIR_FINAL, PRERENDER_DIR_BACKUP);
  console.log(`[regen] Moved prerendered/ → dist/prerendered-prev (auto-restored if regen fails)`);
}

// ─── Step 2: launch server ────────────────────────────
const port = await findFreePort();
console.log(`\n[regen] Step 2/4 — launching server on :${port}…`);
const serverProc = spawn("node", ["dist/index.js"], {
  cwd: ROOT,
  // wave-181.3 · PRERENDER_MODE=true tells server/_core/index.ts to
  // skip cron scheduler + SMS queue + Telegram batch + NOUR OS bridge
  // so puppeteer can reach networkidle0 without competing background
  // network traffic. Critical — without this, prerender hangs after
  // ~50 routes when cron jobs start firing Twilio SMS attempts.
  env: { ...process.env, NODE_ENV: "production", PORT: String(port), PRERENDER_MODE: "true" },
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
const before = fs.existsSync(PRERENDER_DIR_BACKUP) ? countHtml(PRERENDER_DIR_BACKUP) : 0;
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

fs.renameSync(PRERENDER_DIR_TMP, PRERENDER_DIR_FINAL);
// Fresh prerendered/ is in place — drop the pre-regen backup.
fs.rmSync(PRERENDER_DIR_BACKUP, { recursive: true, force: true });

console.log(`\n[regen] ✓ Complete.`);
console.log(`  Before: ${before} files`);
console.log(`  After:  ${fresh} files`);
console.log(`  Broken: ${brokenCount}`);
console.log(`\n  Next: git add prerendered/ && git commit && git push`);
console.log(`  Then Railway will serve the fresh HTML to Googlebot.`);
