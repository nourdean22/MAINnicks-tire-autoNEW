#!/usr/bin/env node
/**
 * graph-forward: on a PC that does not serve the code graph, listen where the graph server would (127.0.0.1:<port>)
 * and pass every request to NATTYNOUR's copy over the tailnet. Every program and hook that already talks to the
 * loopback URL (.mcp.json, the user MCP entry, graph-recall, the [health] probe) then works unchanged, with no per-host
 * URL anywhere. Nour, 2026-11-07: graphify "interconnected between all 3 comps".
 *
 *   node scripts/agent-os/graph-forward.mjs [--config <local-services.json>] [--upstream <url>] [--port <n>]
 *
 * Defaults come from the graphify entry of config/agent-os/local-services.json (port, remoteUrl). Binds loopback only;
 * the upstream is the `tailscale serve` HTTPS address, tailnet-only (docs/agent-os/TAILNET-MCP.md). Refuses to run on a
 * PC listed in `hosts`: that PC serves the graph itself and this would fight it for the port. Bytes pass through
 * untouched (SSE and the mcp-session-id header included), so it adds no auth and hides no error: an upstream that is
 * down answers 502. Canary: graphForward.test.mjs.
 */
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { readFileSync, realpathSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// shortcut: one idle limit for every request; a long-lived server-to-client stream idle past it is cut, upgrade when graphify uses one.
const UPSTREAM_IDLE_MS = 30_000;

/** Start the forwarder. Resolves { port, close }; rejects with the listen error (EADDRINUSE). */
export function startForward({ upstream, port = 0 }) {
  const base = new URL(upstream);
  const send = base.protocol === "https:" ? httpsRequest : httpRequest;
  const server = createServer((req, res) => {
    // Local programs only: a web page can POST to a loopback port (DNS rebinding sends a foreign Host, a cross-origin fetch sends Origin); the graph holds PR data from Nour's gh login.
    if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(req.headers.host ?? "") || req.headers.origin) {
      res.writeHead(403, { "content-type": "text/plain" });
      return res.end("graph-forward: local programs only\n");
    }
    const target = new URL(req.url, base);
    const up = send(target, { method: req.method, headers: { ...req.headers, host: target.host }, timeout: UPSTREAM_IDLE_MS }, (upRes) => {
      res.writeHead(upRes.statusCode, upRes.headers);
      upRes.pipe(res);
    });
    up.on("error", (err) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(502, { "content-type": "text/plain" });
      res.end(`graph-forward: ${base.host} ${err.code || err.message}\n`);
    });
    up.on("timeout", () => up.destroy(new Error("timed out")));
    res.on("close", () => up.destroy());
    req.pipe(up);
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => done({
      port: server.address().port,
      close: () => new Promise((r) => { server.closeAllConnections?.(); server.close(r); }),
    }));
  });
}

function readConfig(file) {
  const c = JSON.parse(readFileSync(file, "utf8"));
  const server = (c.servers ?? []).find((s) => s.kind === "graphify");
  if (!server) throw new Error(`${file}: no graphify server entry`);
  return { hosts: (c.hosts ?? []).map((h) => String(h).toUpperCase()), server };
}

/** Exit code to stop with, or null to keep serving. */
async function main(argv) {
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
  const { hosts, server } = readConfig(flag("--config") ?? join(HERE, "..", "..", "config", "agent-os", "local-services.json"));
  const host = (process.env.COMPUTERNAME || hostname()).toUpperCase();
  if (hosts.includes(host)) { process.stderr.write(`[graph-forward] ${host} serves the graph itself; nothing to forward\n`); return 1; }
  const upstream = flag("--upstream") ?? server.remoteUrl;
  if (!upstream) { process.stderr.write("[graph-forward] no upstream: set remoteUrl on the graphify entry of local-services.json or pass --upstream\n"); return 2; }
  try {
    const { port } = await startForward({ upstream, port: Number(flag("--port") ?? server.port) });
    process.stdout.write(`[graph-forward] listening 127.0.0.1:${port} -> ${upstream}\n`);
    return null;
  } catch (err) {
    process.stderr.write(`[graph-forward] cannot listen: ${err.code || err.message}${err.code === "EADDRINUSE" ? " (a forwarder or a graph server already holds the port)" : ""}\n`);
    return 1;
  }
}

function isEntry() {
  try {
    const a = realpathSync(process.argv[1]);
    const b = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isEntry()) {
  main(process.argv.slice(2))
    .then((code) => { if (code !== null) process.exit(code); })
    .catch((err) => { process.stderr.write(`[graph-forward] off: ${String(err?.message || err).split(/\r?\n/)[0]}\n`); process.exit(1); });
}
