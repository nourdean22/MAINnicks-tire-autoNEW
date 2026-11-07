// Canary for scripts/agent-os/graph-forward.mjs: the loopback forwarder that lets a PC without the graph server use
// NATTYNOUR's. Every arm runs the REAL script as a child process against the stub MCP (never the live server) and asks
// it the way the hooks do: session-health's own mcpProbe, then a real session (initialize, get_node) through it.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:http";
import { startMcpStub } from "./fixtures/mcp-stub.mjs";
import { mcpProbe } from "./session-health.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "graph-forward.mjs");
const HOST = (process.env.COMPUTERNAME || hostname()).toUpperCase();
const SCRATCH = mkdtempSync(join(tmpdir(), "graph-forward-test-"));
const children = [];
const stubs = [];
// Closed here, not at the end of each test: a failed assert would skip an inline close and leave the runner waiting on the listener.
after(async () => {
  for (const c of children) c.kill();
  await Promise.all(stubs.map((s) => s.close()));
  rmSync(SCRATCH, { recursive: true, force: true });
});
const stub = (opts) => startMcpStub(opts).then((s) => { stubs.push(s); return s; });

function config(hosts, remoteUrl) {
  const file = join(SCRATCH, `local-services-${hosts.join("-") || "none"}${remoteUrl ? "-remote" : ""}.json`);
  writeFileSync(file, JSON.stringify({ version: 1, hosts, servers: [{ name: "graphify", port: 8765, path: "/mcp", kind: "graphify", ...(remoteUrl && { remoteUrl }) }], clients: ["claude"] }));
  return file;
}

/** Run the script; resolves { port } once it prints its listening line, or { code, err } if it exits first. `remoteUrl` goes in the config instead of the flag. */
function forward(upstream, { hosts = ["NOT-THIS-PC"], args = ["--upstream", upstream], remoteUrl } = {}) {
  const child = spawn(process.execPath, [SCRIPT, "--config", config(hosts, remoteUrl), "--port", "0", ...args], { stdio: ["ignore", "pipe", "pipe"] });
  children.push(child);
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    child.stderr.on("data", (c) => { err += c; });
    child.stdout.on("data", (c) => {
      out += c;
      const m = /listening 127\.0\.0\.1:(\d+)/.exec(out);
      if (m) resolve({ port: Number(m[1]) });
    });
    child.on("exit", (code) => resolve({ code, err }));
  });
}

/** POST one JSON-RPC message through the forwarder; resolves { status, headers, body }. */
function post(port, msg, headers = {}) {
  const body = JSON.stringify(msg);
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/mcp", method: "POST", headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": Buffer.byteLength(body), ...headers,
    } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: text }));
    });
    req.on("error", reject);
    req.end(body);
  });
}

test("a healthy upstream reads up through the forwarder, and a full session works (SSE and session header pass)", async () => {
  const up = await stub();
  const f = await forward(`http://127.0.0.1:${up.port}/mcp`);
  assert.ok(f.port, `forwarder did not start: ${f.err}`);
  assert.equal(await mcpProbe(f.port, "/mcp", "graphify"), "up");

  const init = await post(f.port, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  const session = init.headers["mcp-session-id"];
  assert.match(session ?? "", /^s\d+$/, "the stub's mcp-session-id header must come back through the forwarder");
  const node = await post(f.port, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_node", arguments: { label: "mergeGate" } } }, { "mcp-session-id": session });
  assert.match(node.body, /Source: scripts\/agent-os\/merge-gate\.mjs L338/, "the request header must reach the upstream: without it the stub answers 400");
});

test("canary: a dead upstream is never reported up, and the failure is said, not swallowed", async () => {
  const dead = await stub();
  const deadPort = dead.port;
  await dead.close();
  const f = await forward(`http://127.0.0.1:${deadPort}/mcp`);
  assert.notEqual(await mcpProbe(f.port, "/mcp", "graphify"), "up");
  const r = await post(f.port, { jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(r.status, 502);
  assert.match(r.body, /graph-forward: 127\.0\.0\.1:\d+ ECONNREFUSED/);
});

test("canary: a different service behind the upstream is not passed off as graphify", async () => {
  const other = await stub({ name: "something-else" });
  const f = await forward(`http://127.0.0.1:${other.port}/mcp`);
  assert.equal(await mcpProbe(f.port, "/mcp", "graphify"), "WRONG SERVICE");
});

test("canary: a web page cannot use the forwarder (foreign Host or an Origin header is refused, the stub never sees it)", async () => {
  const up = await stub();
  const f = await forward(`http://127.0.0.1:${up.port}/mcp`);
  const init = { jsonrpc: "2.0", id: 1, method: "initialize" };
  assert.equal((await post(f.port, init, { origin: "http://evil.example" })).status, 403);
  assert.equal((await post(f.port, init, { host: "evil.example" })).status, 403);
  assert.deepEqual(up.calls, [], "a refused request must not reach the upstream");
  assert.equal((await post(f.port, init)).status, 200, "the same request from a local program still passes");
});

test("a PC that serves the graph itself refuses to forward, and nothing listens", async () => {
  const r = await forward("http://127.0.0.1:1/mcp", { hosts: [HOST] });
  assert.equal(r.code, 1);
  assert.match(r.err, /serves the graph itself/);
});

test("consumer: with no flag the upstream is the remoteUrl of local-services.json, and the committed one is a real https address", async () => {
  const up = await stub();
  const f = await forward(null, { args: [], remoteUrl: `http://127.0.0.1:${up.port}/mcp` });
  assert.equal(await mcpProbe(f.port, "/mcp", "graphify"), "up", "remoteUrl in the config must be what the forwarder talks to");

  const shipped = JSON.parse(readFileSync(join(dirname(SCRIPT), "..", "..", "config", "agent-os", "local-services.json"), "utf8"));
  const graphify = shipped.servers.find((s) => s.kind === "graphify");
  const u = new URL(graphify.remoteUrl);
  assert.equal(u.protocol, "https:");
  assert.equal(u.pathname, graphify.path, "the served path must match the path every program asks for");
  assert.ok(!shipped.hosts.includes("NICKSMAX") && !shipped.hosts.includes("MECHANICS"), "a client PC must not be listed as a serving host");
});

test("no upstream anywhere is a stated error, not a silent default", async () => {
  const r = await forward(null, { args: [] });
  assert.equal(r.code, 2);
  assert.match(r.err, /no upstream/);
});
