/**
 * A stand-in for the graphify MCP server over Streamable HTTP, for the graph-* canaries. Speaks the three calls the
 * hooks make (initialize, tools/call get_node, tools/call get_neighbors) in the real server's own text shapes
 * (graphify 0.9.80, read 2026-11-03 against 127.0.0.1:8765): SSE-framed JSON-RPC, an `mcp-session-id` header on
 * initialize, "Bad Request: Missing session ID" (400) without it. Never the real server: tests must not depend on it.
 *
 *   node scripts/agent-os/fixtures/mcp-stub.mjs <port> [pidFile]   run as a process (the launcher stub in tests)
 *   import { startMcpStub } from "./fixtures/mcp-stub.mjs"          in-process, returns { port, close, calls }
 *   import { startMcpStubProcess }                                  a child process, returns { port, close }: a test
 *   that drives the hook with spawnSync blocks its own event loop, so an in-process stub can never answer the child.
 *
 * Graph: relatedActivity (file:line, community, one caller), mergeGate, merge-gate.mjs; `slowSymbol` answers after
 * 3 s (budget arm); anything else is "No node matching". `name` is the serverInfo name (default graphify).
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NODES = {
  relatedactivity: { label: "relatedActivity()", id: "apps_statenour_lib_services_related_activity_relatedactivity", src: "apps/statenour/lib/services/related-activity.ts", line: 75, community: "goal-pace.ts",
    neighbors: ["  --> clip() [calls] [EXTRACTED] at=apps/statenour/lib/services/related-activity.ts:L100", "  <-- related-activity.test.ts [imports] [EXTRACTED] at=apps/statenour/tests/services/related-activity.test.ts:L33", "  <-- related-activity.ts [contains] [EXTRACTED] at=apps/statenour/lib/services/related-activity.ts:L75"] },
  mergegate: { label: "mergeGate()", id: "scripts_agent_os_merge_gate_mergegate", src: "scripts/agent-os/merge-gate.mjs", line: 338, community: "mergeGate.test.mjs",
    neighbors: ["  <-- retryGate() [calls] [EXTRACTED] at=scripts/agent-os/merge-gate.mjs:L470", "  <-- mergeGate.test.mjs [imports] [EXTRACTED] at=scripts/agent-os/mergeGate.test.mjs:L5", "  <-- merge-gate.mjs [contains] [EXTRACTED] at=scripts/agent-os/merge-gate.mjs:L338"] },
  "merge-gate.mjs": { label: "merge-gate.mjs", id: "scripts_agent_os_merge_gate", src: "scripts/agent-os/merge-gate.mjs", line: 1, community: "mergeGate.test.mjs", neighbors: [] },
  slowsymbol: { label: "slowSymbol()", id: "slow", src: "x/slow.ts", line: 9, community: "slow", neighbors: [], delayMs: 3000 },
};
for (let i = 1; i <= 10; i++) NODES[`manysym${i}`] = { label: `manySym${i}()`, id: `many_${i}`, src: `x/many${i}.ts`, line: i, community: "many", neighbors: [] };

const sse = (res, payload, headers = {}) => {
  res.writeHead(200, { "content-type": "text/event-stream", ...headers });
  res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
};
const text = (id, t) => ({ jsonrpc: "2.0", id, result: { content: [{ text: t, type: "text" }], isError: false } });

export function startMcpStub({ port = 0, name = "graphify" } = {}) {
  const calls = [];
  let sessions = 0;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      let msg;
      try { msg = JSON.parse(body); } catch { res.writeHead(400); return res.end("bad json"); }
      calls.push(msg.method);
      if (msg.method === "initialize") {
        return sse(res, { jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-06-18", capabilities: { tools: { listChanged: false } }, serverInfo: { name, version: "0.9.80" } } }, { "mcp-session-id": `s${++sessions}` });
      }
      if (!req.headers["mcp-session-id"]) { res.writeHead(400, { "content-type": "application/json" }); return res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Bad Request: Missing session ID" } })); }
      if (msg.method === "notifications/initialized") { res.writeHead(202); return res.end(); }
      if (msg.method !== "tools/call") return sse(res, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "unknown" } });
      const { name: tool, arguments: a = {} } = msg.params ?? {};
      const key = String(a.label ?? a.node_id ?? "").toLowerCase().replace(/\(\)$/, "");
      const n = NODES[key];
      const answer = () => {
        if (!n) return sse(res, text(msg.id, `No node matching '${key}' found.`));
        if (tool === "get_node") return sse(res, text(msg.id, `Node: ${n.label}\n  ID: ${n.id}\n  Source: ${n.src} L${n.line}\n  Type: code\n  Community: ${n.community}\n  Degree: ${n.neighbors.length}`));
        if (tool === "get_neighbors") return sse(res, text(msg.id, `Neighbors of ${n.label}:\n${n.neighbors.join("\n")}`));
        return sse(res, text(msg.id, `Error executing ${tool}: unknown tool`));
      };
      if (n?.delayMs) setTimeout(answer, n.delayMs);
      else answer();
    });
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ port: server.address().port, calls, close: () => new Promise((r) => server.close(r)) }));
  });
}

/** The stub in its own process, so a spawnSync in the test does not starve it. */
export function startMcpStubProcess({ name = "graphify" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "0", "", name], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (c) => {
      out += c;
      const m = /stub listening (\d+)/.exec(out);
      if (m) resolve({ port: Number(m[1]), pid: child.pid, close: () => { child.kill(); } });
    });
    child.on("exit", (code) => reject(new Error(`stub exited ${code} before listening`)));
  });
}

if (process.argv[1] && /mcp-stub\.mjs$/.test(process.argv[1]) && process.argv[2] !== undefined) {
  const { port } = await startMcpStub({ port: Number(process.argv[2]), name: process.argv[4] || "graphify" });
  if (process.argv[3]) writeFileSync(process.argv[3], String(process.pid));
  process.stdout.write(`stub listening ${port}\n`);
}
