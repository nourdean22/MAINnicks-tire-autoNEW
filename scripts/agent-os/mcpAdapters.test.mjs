// Canary for scripts/agent-os/mcp-adapters.mjs (job 2026-11-03-graphify-always-on): the five program-side MCP files
// (.mcp.json, .codex/config.toml, .cursor/mcp.json, .gemini/settings.json, .vscode/mcp.json) are GENERATED from
// config/agent-os/local-services.json, and --check goes red when one is edited by hand, so they cannot drift the way
// a hand-kept copy would. Shapes: each program's primary docs page, read 2026-11-03 (URLs in the PR body).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { codexServers } from "./session-health.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "mcp-adapters.mjs");
const SCRATCH = mkdtempSync(join(tmpdir(), "mcp-adapters-test-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

const FILES = [".mcp.json", ".codex/config.toml", ".cursor/mcp.json", ".gemini/settings.json", ".vscode/mcp.json"];
const run = (root, ...args) => {
  const r = spawnSync(process.execPath, [SCRIPT, "--root", root, ...args], { encoding: "utf8", cwd: ROOT, timeout: 20000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
function fixture(label, port = 8765) {
  const root = join(SCRATCH, label);
  mkdirSync(join(root, "config", "agent-os"), { recursive: true });
  writeFileSync(join(root, "config", "agent-os", "local-services.json"), JSON.stringify({ version: 1, hosts: ["X"], servers: [{ name: "graphify", port, path: "/mcp", kind: "graphify" }], clients: [] }));
  return root;
}
const read = (root, f) => readFileSync(join(root, f), "utf8");

test("--write generates the five files in each program's documented shape, all from the one URL in local-services.json", () => {
  const root = fixture("write", 8765);
  const r = run(root, "--write");
  assert.equal(r.code, 0, r.out);
  for (const f of FILES) assert.ok(existsSync(join(root, f)), `${f} not written`);
  const url = "http://127.0.0.1:8765/mcp";
  assert.deepEqual(JSON.parse(read(root, ".mcp.json")), { mcpServers: { graphify: { type: "http", url } } }, "Claude Code project scope");
  assert.deepEqual(JSON.parse(read(root, ".cursor/mcp.json")), { mcpServers: { graphify: { url } } }, "Cursor: url, no type");
  assert.deepEqual(JSON.parse(read(root, ".gemini/settings.json")), { mcpServers: { graphify: { httpUrl: url } } }, "Gemini CLI: httpUrl is the streamable-HTTP key");
  assert.deepEqual(JSON.parse(read(root, ".vscode/mcp.json")), { servers: { graphify: { type: "http", url } } }, "VS Code: servers, not mcpServers");
  const toml = read(root, ".codex/config.toml");
  assert.match(toml, /^\[mcp_servers\.graphify\]\nurl = "http:\/\/127\.0\.0\.1:8765\/mcp"\n/m, toml);
  // assert-the-consumer: the repo's own Codex reader (session-health.mjs) parses the generated TOML back to the same URL.
  assert.deepEqual(codexServers(toml), { graphify: url });
});

test("--check is clean right after --write, exits 0, and names the five files", () => {
  const root = fixture("clean");
  run(root, "--write");
  const r = run(root, "--check");
  assert.equal(r.code, 0, r.out);
  for (const f of FILES) assert.ok(r.out.includes(f), `${f} not named:\n${r.out}`);
});

test("a hand edit to one generated file turns --check red and names that file only; --write restores it", () => {
  const root = fixture("drift");
  run(root, "--write");
  writeFileSync(join(root, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { graphify: { url: "http://127.0.0.1:9999/mcp" } } }, null, 2) + "\n");
  const r = run(root, "--check");
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /DRIFT\s+\.cursor\/mcp\.json/);
  assert.doesNotMatch(r.out, /DRIFT\s+\.(mcp\.json|codex|gemini|vscode)/);
  assert.equal(run(root, "--write").code, 0);
  assert.equal(run(root, "--check").code, 0);
});

test("a missing generated file reads MISSING, exit 1", () => {
  const root = fixture("missing");
  run(root, "--write");
  rmSync(join(root, ".gemini"), { recursive: true });
  const r = run(root, "--check");
  assert.equal(r.code, 1);
  assert.match(r.out, /MISSING\s+\.gemini\/settings\.json/);
});

test("a port change in local-services.json makes every generated file drift until regenerated (one source)", () => {
  const root = fixture("port", 8765);
  run(root, "--write");
  writeFileSync(join(root, "config", "agent-os", "local-services.json"), JSON.stringify({ version: 1, hosts: ["X"], servers: [{ name: "graphify", port: 8766, path: "/mcp", kind: "graphify" }], clients: [] }));
  const r = run(root, "--check");
  assert.equal(r.code, 1);
  assert.equal((r.out.match(/DRIFT/g) ?? []).length, 5, r.out);
});

test("the REAL repo: the committed files match the generator (pnpm agent:parity would fail otherwise)", () => {
  const r = run(ROOT, "--check");
  assert.equal(r.code, 0, r.out);
  // The committed .mcp.json must carry the URL every other reader uses.
  const cfg = JSON.parse(readFileSync(join(ROOT, "config", "agent-os", "local-services.json"), "utf8"));
  const s = cfg.servers.find((x) => x.name === "graphify");
  assert.equal(JSON.parse(read(ROOT, ".mcp.json")).mcpServers.graphify.url, `http://127.0.0.1:${s.port}${s.path}`);
});

test("wiring: check-adapters.mjs (pnpm agent:parity) runs the drift check, so lefthook and CI carry it", () => {
  const src = readFileSync(join(HERE, "check-adapters.mjs"), "utf8");
  assert.match(src, /mcp-adapters\.mjs/, "check-adapters.mjs must import the generator's drift check");
  const r = spawnSync(process.execPath, [join(HERE, "check-adapters.mjs")], { encoding: "utf8", cwd: ROOT, timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
});
