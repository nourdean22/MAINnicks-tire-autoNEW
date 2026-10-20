// Canary for scripts/tailnet-host-proxy.mjs: the loopback pass-through that lets `tailscale serve` reach the graphify MCP
// server past the MCP SDK's Host check. It must rewrite Host to the upstream, stream the body both ways (SSE included),
// keep the upstream's status and headers, and answer 502 (never hang) when the upstream is down.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer as createHttpServer, request } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROXY = resolve(HERE, "..", "tailnet-host-proxy.mjs");

const cleanup = [];
after(() => cleanup.forEach((f) => f()));

/** An upstream that echoes the Host header it saw, as graphify's SDK would judge it, and streams two SSE events. */
async function upstream() {
  const seen = [];
  const s = createHttpServer((req, res) => {
    seen.push(req.headers.host);
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host ?? "")) {
        res.writeHead(421, { "content-type": "text/plain" });
        return res.end("Invalid Host header");
      }
      res.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "abc" });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "graphify" }, echo: body.length } })}\n\n`);
      setTimeout(() => res.end("event: message\ndata: {\"done\":true}\n\n"), 30);
    });
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  cleanup.push(() => s.close());
  return { port: s.address().port, seen };
}

function startProxy(listen, up) {
  const child = spawn(process.execPath, [PROXY, "--listen", String(listen), "--upstream", String(up)], { stdio: ["ignore", "pipe", "pipe"] });
  cleanup.push(() => child.kill());
  return new Promise((done, fail) => {
    child.stdout.once("data", () => done(child));
    child.stderr.once("data", (d) => fail(new Error(String(d))));
    child.once("exit", (code) => fail(new Error(`proxy exited ${code}`)));
  });
}

function post(port, body, host) {
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, method: "POST", path: "/mcp", headers: { host, "content-type": "application/json", accept: "application/json, text/event-stream" } }, (res) => {
      let text = "";
      res.on("data", (d) => (text += d));
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", fail);
    req.end(body);
  });
}

async function freePort() {
  const s = createHttpServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}

test("rewrites Host to the upstream, keeps status and headers, streams the whole SSE body", async () => {
  const up = await upstream();
  const listen = await freePort();
  await startProxy(listen, up.port);
  const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" });
  const r = await post(listen, body, "nattynour-1.tailae7855.ts.net");
  assert.equal(r.status, 200, r.text);
  assert.equal(up.seen.at(-1), `127.0.0.1:${up.port}`, "upstream must see the loopback Host, not the tailnet name");
  assert.equal(r.headers["mcp-session-id"], "abc");
  assert.match(r.text, /"name":"graphify"/);
  assert.match(r.text, /"echo":\d+/);
  assert.match(r.text, /"done":true/);
});

test("control: the same request straight at the upstream with the tailnet Host is refused with 421", async () => {
  const up = await upstream();
  const r = await post(up.port, "{}", "nattynour-1.tailae7855.ts.net");
  assert.equal(r.status, 421);
});

test("a dead upstream answers 502 at once, never a hang", async () => {
  const dead = await freePort();
  const listen = await freePort();
  await startProxy(listen, dead);
  const started = Date.now();
  const r = await post(listen, "{}", "nattynour-1.tailae7855.ts.net");
  assert.equal(r.status, 502);
  assert.match(r.text, /unreachable/);
  assert.ok(Date.now() - started < 5000);
});
