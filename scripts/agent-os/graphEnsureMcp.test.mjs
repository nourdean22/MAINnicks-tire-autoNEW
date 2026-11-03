// Canary for scripts/agent-os/graph-ensure-mcp.mjs (job 2026-11-03-graphify-always-on): the SessionStart hook that
// probes the graphify MCP with a real initialize and launches it through the existing launcher when it is DOWN. Every
// control runs the REAL script as a child process against a stub MCP and a stub launcher (never the live server), and
// the wiring arm runs the CONFIGURED command string verbatim through a shell (guard-red-team rule 5).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startMcpStub, startMcpStubProcess } from "./fixtures/mcp-stub.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "graph-ensure-mcp.mjs");
const STUB = join(HERE, "fixtures", "mcp-stub.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const HOST = (process.env.COMPUTERNAME || hostname()).toUpperCase();
const SCRATCH = mkdtempSync(join(tmpdir(), "graph-ensure-test-"));
const pids = [];
after(() => {
  for (const p of pids) { try { process.kill(p); } catch { /* gone */ } }
  rmSync(SCRATCH, { recursive: true, force: true });
});

const freePort = () => startMcpStub().then(async (s) => { const p = s.port; await s.close(); return p; });

function config(label, port, { hosts = [HOST] } = {}) {
  const dir = join(SCRATCH, label);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  const file = join(dir, "local-services.json");
  writeFileSync(file, JSON.stringify({ version: 1, hosts, servers: [{ name: "graphify", port, path: "/mcp", kind: "graphify" }], clients: ["claude"] }));
  return { dir, file };
}

/** launcher = JSON argv the hook runs instead of local-mcp-servers.ps1 -Start. */
function run(label, { port, hosts, launcher } = {}) {
  const { dir, file } = config(label, port, { hosts });
  const stateDir = join(dir, "state");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: ROOT, NOURCITY_STATE_DIR: stateDir };
  if (launcher) env.GRAPH_ENSURE_LAUNCHER = JSON.stringify(launcher);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [SCRIPT, "--config", file, "--primary", dir], { encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", ms: Date.now() - t0, stateDir };
}
const oneLine = (out) => { const l = out.split(/\r?\n/).filter(Boolean); assert.equal(l.length, 1, `expected one line:\n${out}`); return l[0]; };
const state = (dir) => JSON.parse(readFileSync(join(dir, "graph-mcp.json"), "utf8"));

test("MCP up: one `[graph] mcp up (<ms>)` line, exit 0, no launcher run, state file says up", async () => {
  const stub = await startMcpStubProcess();
  try {
    const r = run("up", { port: stub.port, launcher: [process.execPath, "-e", "process.exit(9)"] });
    assert.equal(r.code, 0, r.err);
    assert.match(oneLine(r.out), /^\[graph\] mcp up \(\d+ ms\)$/, r.out);
    assert.equal(state(r.stateDir).state, "up");
  } finally { stub.close(); }
});

test("a listener that answers as something else is DOWN with the port check, never up and never launched", async () => {
  const stub = await startMcpStubProcess({ name: "serena" });
  try {
    const r = run("wrong-service", { port: stub.port, launcher: [process.execPath, "-e", "process.exit(9)"] });
    assert.equal(r.code, 0, r.err);
    assert.match(oneLine(r.out), /^\[graph\] mcp DOWN: another program answers on port \d+, next: Get-NetTCPConnection/, r.out);
  } finally { stub.close(); }
});

test("MCP down, launcher brings it up inside the budget: `[graph] mcp started (<ms>)`, exit 0", async () => {
  const port = await freePort();
  const pidFile = join(SCRATCH, "started.pid");
  const r = run("started", { port, launcher: [process.execPath, STUB, String(port), pidFile] });
  if (existsSync(pidFile)) pids.push(Number(readFileSync(pidFile, "utf8")));
  assert.equal(r.code, 0, r.err);
  assert.match(oneLine(r.out), /^\[graph\] mcp started \(\d+ ms\)$/, r.out);
  assert.equal(state(r.stateDir).state, "started");
});

test("MCP down, launcher exits non-zero: `[graph] mcp DOWN: launcher exited 1, next: <one command>`, exit 0", async () => {
  const port = await freePort();
  const r = run("launcher-fails", { port, launcher: [process.execPath, "-e", "process.exit(1)"] });
  assert.equal(r.code, 0, r.err);
  const line = oneLine(r.out);
  assert.match(line, /^\[graph\] mcp DOWN: launcher exited 1, next: .*local-mcp-servers\.ps1 -Start$/, line);
  assert.equal(state(r.stateDir).state, "DOWN");
});

test("MCP down, launcher cannot be spawned (no such exe): DOWN with the spawn error and a next step, exit 0", async () => {
  const port = await freePort();
  const r = run("launcher-missing", { port, launcher: [join(SCRATCH, "no-such-exe"), "-Start"] });
  assert.equal(r.code, 0, r.err);
  assert.match(oneLine(r.out), /^\[graph\] mcp DOWN: launcher ENOENT[^\n]*, next: /, r.out);
});

test("budget: a launcher that never answers still prints `started` and returns inside 3 s + process start", async () => {
  const port = await freePort();
  const r = run("budget", { port, launcher: [process.execPath, "-e", "setTimeout(() => {}, 60000)"] });
  assert.equal(r.code, 0, r.err);
  assert.match(oneLine(r.out), /^\[graph\] mcp started \(not answering yet after \d+ ms; graphify listens in about 20 s\)$/, r.out);
  assert.ok(r.ms < 6000, `took ${r.ms} ms`);
});

test("host gate: a host not in the config says so and points at the report + CLI fallback, never launches", async () => {
  const port = await freePort();
  const r = run("host", { port, hosts: ["SOME-OTHER-HOST"], launcher: [process.execPath, STUB, String(port)] });
  assert.equal(r.code, 0, r.err);
  assert.match(oneLine(r.out), /^\[graph\] mcp: not expected on host .*; fallback: graphify-out\/GRAPH_REPORT\.md \+ `graphify query`$/, r.out);
});

test("fail open: a broken config prints one `[graph] off:` line and exits 0", () => {
  const dir = join(SCRATCH, "broken");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "bad.json"), "{nope");
  const r = spawnSync(process.execPath, [SCRIPT, "--config", join(dir, "bad.json")], { encoding: "utf8", cwd: ROOT, env: { ...process.env, NOURCITY_STATE_DIR: dir }, timeout: 20000 });
  assert.equal(r.status, 0);
  assert.match(oneLine(r.stdout), /^\[graph\] off: /);
});

// Timeout 15, not 5: in a real headless session (2026-11-03, debug log) the hook printed `mcp up (35 ms)` and was still
// cancelled at 5000 ms, because node start-up and teardown beside 40+ other starting processes took 7.2 s wall; the hook's
// own 3 s budget bounds its work, the harness timeout only needs to outlast a slow start (session-health uses 15 too).
test("settings: registered on SessionStart for every source, forward slashes, timeout 15; the CONFIGURED command runs verbatim", () => {
  const groups = (SETTINGS.hooks?.SessionStart ?? []).filter((g) => (g.hooks ?? []).some((h) => h.command?.includes("graph-ensure-mcp.mjs")));
  assert.equal(groups.length, 1, "graph-ensure-mcp.mjs must be registered once on SessionStart");
  assert.equal(groups[0].matcher ?? "", "", "every source: the MCP can die between a compaction and the next turn");
  const hook = groups[0].hooks.find((h) => h.command.includes("graph-ensure-mcp.mjs"));
  assert.doesNotMatch(hook.command, /\\/, "backslashes do not resolve on Linux");
  assert.equal(hook.timeout, 15);
  const cmd = process.platform === "win32" ? hook.command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : hook.command;
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify({ source: "startup" }), encoding: "utf8", cwd: ROOT, env: { ...env, CLAUDE_PROJECT_DIR: ROOT, NOURCITY_STATE_DIR: join(SCRATCH, "wired") }, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(oneLine(r.stdout), /^\[graph\] (mcp|off)/, r.stdout);
});
