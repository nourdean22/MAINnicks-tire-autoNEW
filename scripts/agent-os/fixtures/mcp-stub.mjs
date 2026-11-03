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
 * Graph: relatedActivity (file:line, community, one caller), mergeGate, merge-gate.mjs, mergeGate.test.mjs (a test
 * file, degree 7), updatedAt (degree 1, in a test file: noise), status (the server's own "Ambiguous: matches 24 nodes"
 * answer); `slowSymbol` answers after 3 s (budget arm); anything else is "No node matching". `name` is the serverInfo
 * name (default graphify).
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { appendFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const NODES = {
  relatedactivity: { label: "relatedActivity()", id: "apps_statenour_lib_services_related_activity_relatedactivity", src: "apps/statenour/lib/services/related-activity.ts", line: 75, community: "goal-pace.ts",
    neighbors: ["  --> clip() [calls] [EXTRACTED] at=apps/statenour/lib/services/related-activity.ts:L100", "  <-- related-activity.test.ts [imports] [EXTRACTED] at=apps/statenour/tests/services/related-activity.test.ts:L33", "  <-- related-activity.ts [contains] [EXTRACTED] at=apps/statenour/lib/services/related-activity.ts:L75"] },
  mergegate: { label: "mergeGate()", id: "scripts_agent_os_merge_gate_mergegate", src: "scripts/agent-os/merge-gate.mjs", line: 338, community: "mergeGate.test.mjs",
    neighbors: ["  <-- retryGate() [calls] [EXTRACTED] at=scripts/agent-os/merge-gate.mjs:L470", "  <-- mergeGate.test.mjs [imports] [EXTRACTED] at=scripts/agent-os/mergeGate.test.mjs:L5", "  <-- merge-gate.mjs [contains] [EXTRACTED] at=scripts/agent-os/merge-gate.mjs:L338"] },
  "merge-gate.mjs": { label: "merge-gate.mjs", id: "scripts_agent_os_merge_gate", src: "scripts/agent-os/merge-gate.mjs", line: 1, community: "mergeGate.test.mjs", neighbors: [], degree: 42 },
  slowsymbol: { label: "slowSymbol()", id: "slow", src: "x/slow.ts", line: 9, community: "slow", neighbors: [], degree: 9, delayMs: 3000 },
  // The manager's 2026-11-03 probe: a property name that resolves to one degree-1 node in a random test file.
  updatedat: { label: "updatedAt", id: "apps_statenour_tests_trpc_approval_review_dismiss_test_updatedat", src: "apps/statenour/tests/trpc/approval-review-dismiss.test.ts", line: 36, community: "system-pages-b.ts", neighbors: [], degree: 1 },
  // A test FILE named as such in the prompt is a real target: degree 7, test path.
  "mergegate.test.mjs": { label: "mergeGate.test.mjs", id: "scripts_agent_os_mergegate_test", src: "scripts/agent-os/mergeGate.test.mjs", line: 1, community: "mergeGate.test.mjs", neighbors: [], degree: 7 },
  status: { ambiguous: 24 },
};
for (let i = 1; i <= 10; i++) NODES[`manysym${i}`] = { label: `manySym${i}()`, id: `many_${i}`, src: `x/many${i}.ts`, line: i, community: "many", neighbors: [], degree: 5 };

const sse = (res, payload, headers = {}) => {
  res.writeHead(200, { "content-type": "text/event-stream", ...headers });
  res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
};
const text = (id, t) => ({ jsonrpc: "2.0", id, result: { content: [{ text: t, type: "text" }], isError: false } });

export function startMcpStub({ port = 0, name = "graphify", mode = "" } = {}) {
  const calls = [];
  let sessions = 0;
  const server = createServer((req, res) => {
    if (mode === "hang") { req.resume(); return; } // a listener that never answers: the NO ANSWER arm
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
        if (n.ambiguous) return sse(res, text(msg.id, `Ambiguous: '${key}' matches ${n.ambiguous} nodes in different files.\n  a/b.ts\n    id: a_b_${key}\n  c/d.ts\n    id: c_d_${key}`));
        if (tool === "get_node") return sse(res, text(msg.id, `Node: ${n.label}\n  ID: ${n.id}\n  Source: ${n.src} L${n.line}\n  Type: code\n  Community: ${n.community}\n  Degree: ${n.degree ?? n.neighbors.length}`));
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
export function startMcpStubProcess({ name = "graphify", mode = "" } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "0", "", name, mode], { stdio: ["ignore", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (c) => {
      out += c;
      const m = /stub listening (\d+)/.exec(out);
      if (m) resolve({ port: Number(m[1]), pid: child.pid, close: () => { child.kill(); } });
    });
    child.on("exit", (code) => reject(new Error(`stub exited ${code} before listening`)));
  });
}

// argv: <port> [pidFile] [name] [mode] [counterFile]. mode "late": append one byte to counterFile, wait 1.5 s, then
// listen (the launcher stub of the concurrent-start arm: a server that is "coming up"). mode "hang": never answer.
if (process.argv[1] && /mcp-stub\.mjs$/.test(process.argv[1]) && process.argv[2] !== undefined) {
  const mode = process.argv[5] || "";
  if (mode === "late") {
    if (process.argv[6]) appendFileSync(process.argv[6], "x");
    await new Promise((r) => setTimeout(r, 1500));
  }
  const { port } = await startMcpStub({ port: Number(process.argv[2]), name: process.argv[4] || "graphify", mode: mode === "late" ? "" : mode });
  if (process.argv[3]) writeFileSync(process.argv[3], String(process.pid));
  process.stdout.write(`stub listening ${port}\n`);
}
