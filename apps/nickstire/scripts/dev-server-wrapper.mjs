#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * NICKSTIRE DEV SERVER WRAPPER
 * ═══════════════════════════════════════════════════════════════
 *
 * Problem: Claude Preview MCP spawns the dev server and waits ~30s
 *   for port 3500 to be LISTENING. Nickstire's full boot (imports +
 *   Vite + schema migrations + crons + TiDB connection) takes ~50s,
 *   so Preview times out and re-spawns infinitely, creating zombies.
 *
 * Solution: This wrapper listens on 3500 IMMEDIATELY (< 100ms) with
 *   zero imports. Then it spawns the real tsx watch server as a child
 *   process bound to port 3501. Requests arriving before tsx is ready
 *   get a 503 "Still starting..." page that auto-refreshes. Once tsx
 *   is alive on 3501, the wrapper proxies every request through to it.
 *
 * Result: Claude Preview sees port 3500 listening immediately → never
 *   times out. User sees a friendly loading page until full boot.
 *   Once booted, everything is transparent.
 *
 * Clean shutdown: SIGTERM/SIGINT kills the tsx child and exits.
 * Crash recovery: if tsx dies, wrapper shows the error on 3500 until
 *   tsx watch auto-restarts (tsx watch handles file-change restarts).
 * ═══════════════════════════════════════════════════════════════
 */

import http from "node:http";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WRAPPER_PORT = parseInt(process.env.PORT || "3500", 10);
const CHILD_PORT = 3501;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let childReady = false;
let lastCheck = 0;
let childProcess = null;

// ─── 1. Start the wrapper HTTP server FIRST (zero-import, binds in <100ms) ───
const server = http.createServer(async (req, res) => {
  // Health check the child periodically (max once per 250ms)
  const now = Date.now();
  if (!childReady && now - lastCheck > 250) {
    lastCheck = now;
    childReady = await pingChild();
  }

  if (!childReady) {
    // Show a friendly loading page
    res.writeHead(503, {
      "Content-Type": "text/html",
      "Retry-After": "2",
      "Cache-Control": "no-store",
    });
    res.end(`<!doctype html><html><head>
<meta charset="utf-8">
<meta http-equiv="refresh" content="2">
<title>Nickstire dev — booting…</title>
<style>
  body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #eee; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
  .card { max-width: 420px; padding: 32px; border: 1px solid #333; border-radius: 12px; text-align: center; }
  h1 { margin: 0 0 12px; font-size: 20px; color: #fdb913; }
  p { margin: 8px 0; color: #aaa; font-size: 14px; line-height: 1.5; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #fdb913; animation: pulse 1.2s infinite; margin-right: 6px; }
  @keyframes pulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
  code { background: #1a1a1a; padding: 2px 6px; border-radius: 4px; font-size: 12px; color: #fdb913; }
</style></head><body>
<div class="card">
  <h1><span class="dot"></span>NICKSTIRE DEV BOOTING</span></h1>
  <p>tsx watch is compiling TypeScript, running schema migrations, initializing crons, and connecting to TiDB.</p>
  <p>Full boot takes ~50 seconds. This page auto-refreshes every 2s.</p>
  <p><code>${req.method} ${req.url}</code></p>
</div>
</body></html>`);
    return;
  }

  // Proxy to child
  const proxyReq = http.request(
    {
      hostname: "127.0.0.1",
      port: CHILD_PORT,
      path: req.url,
      method: req.method,
      headers: { ...req.headers, host: `127.0.0.1:${CHILD_PORT}` },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    // Child died — mark not ready and show loading page on next request
    childReady = false;
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "text/plain" });
      res.end(`Proxy error: ${err.message}\nChild may be restarting.`);
    }
  });

  req.pipe(proxyReq);
});

server.listen(WRAPPER_PORT, () => {
  console.log(`[wrapper] Listening on :${WRAPPER_PORT} — waiting for tsx on :${CHILD_PORT}`);
});

// ─── 2. Spawn the real tsx watch server as a child ────────────────
// Run tsx via node directly to avoid Windows shell=true quirks.
// tsx ships a CLI at dist/cli.mjs inside the .pnpm store.
const tsxCli = path.join(
  ROOT,
  "node_modules/.pnpm/tsx@4.20.6/node_modules/tsx/dist/cli.mjs"
);

console.log(`[wrapper] Spawning tsx watch child on port ${CHILD_PORT}...`);
childProcess = spawn(
  process.execPath, // absolute path to node.exe
  [tsxCli, "watch", "server/_core/index.ts"],
  {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(CHILD_PORT),
    },
    stdio: ["ignore", "pipe", "pipe"], // capture child stdio explicitly
  }
);

// Forward child output to wrapper's stdout/stderr so Claude Preview can see it
childProcess.stdout.on("data", (chunk) => {
  process.stdout.write(`[tsx] ${chunk.toString()}`);
});
childProcess.stderr.on("data", (chunk) => {
  process.stderr.write(`[tsx-err] ${chunk.toString()}`);
});

childProcess.on("exit", (code, signal) => {
  console.error(`[wrapper] tsx child exited code=${code} signal=${signal}`);
  childReady = false;
  if (code !== null && code !== 0) {
    // Non-zero exit, propagate up
    process.exit(code);
  }
});

childProcess.on("error", (err) => {
  console.error(`[wrapper] tsx child spawn error:`, err);
  process.exit(1);
});

// ─── 3. Health-check the child ─────────────────────────────────
async function pingChild() {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: "127.0.0.1", port: CHILD_PORT, path: "/api/ping", timeout: 500 },
      (res) => {
        resolve(res.statusCode === 200);
        res.resume();
      }
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

// ─── 4. Clean shutdown ─────────────────────────────────────────
function shutdown(signal) {
  console.log(`[wrapper] Received ${signal}, shutting down...`);
  if (childProcess && !childProcess.killed) {
    childProcess.kill("SIGTERM");
  }
  server.close(() => {
    process.exit(0);
  });
  // Force exit after 5s
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
