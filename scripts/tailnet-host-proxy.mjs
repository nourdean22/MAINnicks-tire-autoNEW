#!/usr/bin/env node
/**
 * tailnet-host-proxy: a loopback pass-through in front of the graphify MCP server for `tailscale serve`.
 *
 * Why it exists (2026-10-19): graphify-mcp binds 127.0.0.1 and the MCP SDK's DNS-rebinding guard then accepts only
 * Host: 127.0.0.1 / localhost; `tailscale serve` forwards the caller's Host (nattynour-1.<tailnet>.ts.net), so every
 * tailnet request got HTTP 421. graphify has no allowed-hosts switch, and binding 0.0.0.0 would open the port to the
 * LAN. This forwards each request to the upstream with Host rewritten and streams the response (SSE included).
 *
 *   node scripts/tailnet-host-proxy.mjs --listen 8767 --upstream 8765 [--bind 127.0.0.1]
 *
 * It listens on loopback only; the tailnet reaches it through `tailscale serve --bg 8767` (docs/agent-os/TAILNET-MCP.md).
 * Started at logon by scripts/local-mcp-servers.ps1 (kind "host-rewrite" in config/agent-os/local-services.json);
 * the [health] probe sends an MCP initialize through it and expects graphify's serverInfo back. Canary: tailnetHostProxy.test.mjs.
 */
import { createServer, request } from "node:http";

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const listenPort = Number(flag("--listen", "8767"));
const upstreamPort = Number(flag("--upstream", "8765"));
const bind = flag("--bind", "127.0.0.1");
if (!Number.isInteger(listenPort) || !Number.isInteger(upstreamPort) || listenPort < 1 || upstreamPort < 1) {
  process.stderr.write("usage: tailnet-host-proxy.mjs --listen <port> --upstream <port> [--bind 127.0.0.1]\n");
  process.exit(64);
}

const server = createServer((req, res) => {
  const headers = { ...req.headers, host: `127.0.0.1:${upstreamPort}` };
  const up = request({ host: "127.0.0.1", port: upstreamPort, method: req.method, path: req.url, headers }, (upRes) => {
    res.writeHead(upRes.statusCode, upRes.headers);
    upRes.pipe(res);
  });
  up.on("error", (err) => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain" });
    res.end(`upstream 127.0.0.1:${upstreamPort} unreachable: ${err.code || err.message}\n`);
  });
  req.on("aborted", () => up.destroy());
  req.pipe(up);
});
server.keepAliveTimeout = 65_000;
server.listen(listenPort, bind, () => {
  process.stdout.write(`tailnet-host-proxy: ${bind}:${listenPort} -> 127.0.0.1:${upstreamPort}\n`);
});
server.on("error", (err) => {
  process.stderr.write(`tailnet-host-proxy: cannot listen on ${bind}:${listenPort}: ${err.code || err.message}\n`);
  process.exit(1);
});
