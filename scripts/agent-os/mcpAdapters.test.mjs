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

test("a user's other keys survive: Gemini theme + another server, a Codex [model] table; only the graphify entry is owned (round-2 reader)", () => {
  const root = fixture("merge", 8765);
  mkdirSync(join(root, ".gemini"), { recursive: true });
  writeFileSync(join(root, ".gemini", "settings.json"), JSON.stringify({ theme: "dark", mcpServers: { other: { httpUrl: "http://x/mcp" } } }, null, 2) + "\n");
  mkdirSync(join(root, ".codex"), { recursive: true });
  writeFileSync(join(root, ".codex", "config.toml"), `[model]\nname = "o4"\n\n[mcp_servers.graphify]\nurl = "http://127.0.0.1:9/mcp"\nextra = 1\n\n[mcp_servers.other]\nurl = "http://x/mcp"\n`);
  const c = run(root, "--check");
  assert.equal(c.code, 1);
  assert.match(c.out, /MISSING\s+\.gemini\/settings\.json|DRIFT\s+\.gemini\/settings\.json/, c.out);
  assert.match(c.out, /DRIFT\s+\.codex\/config\.toml/, c.out);
  assert.equal(run(root, "--write").code, 0);
  const g = JSON.parse(read(root, ".gemini/settings.json"));
  assert.equal(g.theme, "dark");
  assert.deepEqual(g.mcpServers.other, { httpUrl: "http://x/mcp" });
  assert.deepEqual(g.mcpServers.graphify, { httpUrl: "http://127.0.0.1:8765/mcp" });
  const t = read(root, ".codex/config.toml");
  assert.match(t, /^\[model\]\nname = "o4"\n/, t);
  assert.match(t, /\[mcp_servers\.graphify\]\nurl = "http:\/\/127\.0\.0\.1:8765\/mcp"\n/, t);
  assert.doesNotMatch(t, /extra = 1/, "the owned table is replaced whole");
  assert.match(t, /\[mcp_servers\.other\]\nurl = "http:\/\/x\/mcp"\n/, "another server's table survives");
  assert.deepEqual(codexServers(t), { graphify: "http://127.0.0.1:8765/mcp", other: "http://x/mcp" });
  assert.equal(run(root, "--check").code, 0, run(root, "--check").out);
});

test("the REAL repo: the committed files match the generator (pnpm agent:parity would fail otherwise)", () => {
  const r = run(ROOT, "--check");
  assert.equal(r.code, 0, r.out);
  // The committed .mcp.json must carry the URL every other reader uses.
  const cfg = JSON.parse(readFileSync(join(ROOT, "config", "agent-os", "local-services.json"), "utf8"));
  const s = cfg.servers.find((x) => x.name === "graphify");
  assert.equal(JSON.parse(read(ROOT, ".mcp.json")).mcpServers.graphify.url, `http://127.0.0.1:${s.port}${s.path}`);
});

// Every file check-adapters.mjs reads, copied from the repo into a fixture root, so the gate can be run against a tree
// that differs from the repo in exactly one way (round-3 reader: a source grep matched a comment, mutant M7 survived).
const PARITY_FILES = [
  "AGENTS.md", "CLAUDE.md", "GEMINI.md", "NOUR-COMMAND.md", "AGENT-OPERATING-PROFILE.md", "CLAUDE-OPERATING-PROFILE.md", ".antigravityrules",
  ".github/copilot-instructions.md", ".cursor/rules/repo-core.mdc", ".cursor/rules/nickstire.mdc", ".cursor/rules/statenour.mdc",
  ".agents/core/CORE.md", ".agents/core/STANDING-ORDERS.md", ".agents/core/SOUL.md", ".agents/core/IDENTITY.md", ".agents/core/USER.md", ".agents/core/CONSTITUTION.md", ".agents/frameworks/ciitty/SKILL.md",
  "apps/nickstire/AGENTS.md", "apps/nickstire/CLAUDE.md", "apps/nickstire/DEPLOY.md", "apps/nickstire/docs/OPERATOR-DIRECTIVE.md", "apps/statenour/AGENTS.md", "apps/statenour/CLAUDE.md", "apps/worker/AGENTS.md", "apps/worker/CLAUDE.md",
  "config/agent-os/local-services.json", "config/agent-os/required-plugins.json", "docs/ANTIGRAVITY-RULES.md", "docs/agent-os/NOUR-RUNTIME-KERNEL.md", "docs/codebase-memory-mcp.md", "scripts/start-codebase-mcp.ps1",
  ...FILES,
];
function parityFixture(label) {
  const root = join(SCRATCH, label);
  for (const f of PARITY_FILES) {
    if (!existsSync(join(ROOT, f))) continue;
    mkdirSync(join(root, f, ".."), { recursive: true });
    writeFileSync(join(root, f), readFileSync(join(ROOT, f)));
  }
  return root;
}
const parity = (root) => spawnSync(process.execPath, [join(HERE, "check-adapters.mjs")], { encoding: "utf8", cwd: ROOT, env: { ...process.env, AGENT_OS_ROOT: root }, timeout: 60000 });

test("wiring: check-adapters.mjs (pnpm agent:parity) is green on the repo and on a faithful copy of it", () => {
  const r = spawnSync(process.execPath, [join(HERE, "check-adapters.mjs")], { encoding: "utf8", cwd: ROOT, timeout: 60000 });
  assert.equal(r.status, 0, r.stderr);
  const copy = parity(parityFixture("parity-clean"));
  assert.equal(copy.status, 0, `the fixture copy must pass before it can prove anything:\n${copy.stderr}`);
});

test("parity goes RED on a hand-edited .cursor/mcp.json and names it (the gate, not a grep of its source)", () => {
  const root = parityFixture("parity-drift");
  writeFileSync(join(root, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { graphify: { url: "http://127.0.0.1:9999/mcp" } } }, null, 2) + "\n");
  const r = parity(root);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /DRIFT\s+\.cursor\/mcp\.json/, r.stderr);
});
