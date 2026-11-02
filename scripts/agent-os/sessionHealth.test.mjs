// Canary for session-health.mjs, the SessionStart hook that prints one [health] line for the local code-intelligence
// setup in config/agent-os/local-services.json: graph freshness, the shared MCP servers, the three clients' MCP entries, PowerShell hooks that execution policy would block, and the scheduled tasks.
// Every FAIL carries its fix; a failed read is UNKNOWN, never ok (empty-vs-error). Controls run the REAL script
// against fixtures (--home, --config, --primary) and real sockets; the wiring test runs the CONFIGURED command verbatim.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "session-health.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const SCRATCH = mkdtempSync(join(tmpdir(), "session-health-test-"));
const WIN = process.platform === "win32";
const HOST = (process.env.COMPUTERNAME || hostname()).toUpperCase();
const GIT_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

// Two live listeners stand in for the MCP servers; a third port is opened then closed, so nothing answers on it.
const listeners = [];
/** An HTTP stand-in for the MCP server: answers initialize with serverInfo.name = `name` (graphify's real shape). */
async function listen(name = "graphify", status = 200) {
  const s = createHttpServer((req, res) => {
    req.resume();
    req.on("end", () => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name, version: "0.9.80" } } }));
    });
  });
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  listeners.push(s);
  return s.address().port;
}
/** A raw TCP listener that is not HTTP at all: it accepts and hangs up. */
async function rawTcp() {
  const s = createServer((c) => c.destroy());
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  listeners.push(s);
  return s.address().port;
}
/** An HTTP listener that takes the request and never answers: a server too busy (or hung) to reply in time. */
async function silent() {
  const s = createHttpServer((req) => req.resume());
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  listeners.push(s);
  return s.address().port;
}
async function closedPort() {
  const s = createServer();
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  const { port } = s.address();
  await new Promise((r) => s.close(r));
  return port;
}
after(() => {
  for (const s of listeners) s.close();
  rmSync(SCRATCH, { recursive: true, force: true });
});

const git = (cwd, args, input) => {
  const r = spawnSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", input });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A git repo with 55 commits on main and origin/main at the tip, built in one fast-import (no 55 spawns). */
const REPO = (() => {
  const dir = join(SCRATCH, "repo");
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q"]);
  let stream = "";
  for (let i = 1; i <= 55; i++) stream += `commit refs/heads/main\ncommitter T <t@t> ${1700000000 + i} +0000\ndata ${String(i).length}\n${i}\n\n`;
  git(dir, ["fast-import", "--quiet"], stream);
  git(dir, ["update-ref", "refs/remotes/origin/main", "refs/heads/main"]);
  // One commit on a side branch off main~5: built there, `built..origin/main` counts 5, yet it is not on main.
  const fork = git(dir, ["rev-parse", "main~5"]);
  git(dir, ["fast-import", "--quiet"], `commit refs/heads/side\ncommitter T <t@t> 1800000000 +0000\ndata 4\nside\nfrom ${fork}\n\n`);
  return { dir, tip: git(dir, ["rev-parse", "main"]), root: git(dir, ["rev-list", "--max-parents=0", "main"]), side: git(dir, ["rev-parse", "side"]) };
})();

const url = (port) => `http://127.0.0.1:${port}/mcp`;

/** A primary checkout whose .git file points at the fixture repo, so git commands in it see the 55 commits. */
function primary(label, { graph = true, report = REPO.tip } = {}) {
  const dir = join(SCRATCH, label, "primary");
  mkdirSync(join(dir, "graphify-out"), { recursive: true });
  // The graph check runs git in the primary; point it at the fixture repo's object store.
  writeFileSync(join(dir, ".git"), `gitdir: ${join(REPO.dir, ".git").replace(/\\/g, "/")}\n`);
  if (graph) writeFileSync(join(dir, "graphify-out", "graph.json"), "{}");
  if (report) writeFileSync(join(dir, "graphify-out", "GRAPH_REPORT.md"), `# Graph Report\n\n- Built from commit: \`${report.slice(0, 8)}\`\n`);
  return dir;
}

/** A home whose three clients list both servers at the given ports, and a user PowerShell hook carrying Bypass. */
function home(label, ports, { codexSkip = [], claudeJson, userHook = "powershell -NoProfile -ExecutionPolicy Bypass -File x.ps1" } = {}) {
  const dir = join(SCRATCH, label, "home");
  const names = ["graphify", "spare"];
  mkdirSync(join(dir, ".claude"), { recursive: true });
  mkdirSync(join(dir, ".codex"), { recursive: true });
  mkdirSync(join(dir, "AppData", "Roaming", "Code", "User"), { recursive: true });
  const mcp = Object.fromEntries(names.map((n, i) => [n, { type: "http", url: url(ports[i]) }]));
  writeFileSync(join(dir, ".claude.json"), claudeJson ?? JSON.stringify({ mcpServers: mcp }));
  writeFileSync(join(dir, ".codex", "config.toml"), names.filter((n) => !codexSkip.includes(n))
    .map((n) => `[mcp_servers.${n}]\nurl = "${url(ports[names.indexOf(n)])}"\n`).join("\n"));
  writeFileSync(join(dir, "AppData", "Roaming", "Code", "User", "mcp.json"), JSON.stringify({ servers: mcp }));
  writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: userHook }] }] } }));
  return dir;
}

function config(label, ports, { hosts = [HOST], tasks = [], servers } = {}) {
  const file = join(SCRATCH, label, "local-services.json");
  writeFileSync(file, JSON.stringify({
    version: 1, hosts,
    servers: servers ?? [{ name: "graphify", port: ports[0], path: "/mcp", kind: "graphify" }, { name: "spare", port: ports[1], path: "/mcp", kind: "graphify" }],
    clients: ["claude", "codex", "vscode"], tasks,
  }));
  return file;
}

/** A project dir whose own settings hold only node hooks. */
function project(label) {
  const dir = join(SCRATCH, label, "project");
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node x.mjs" }] }] } }));
  return dir;
}

/**
 * A preload that plays a machine busy at SessionStart: node start-up takes STARTUP_DELAY_MS before the script loads, and
 * every execFile answer (git, schtasks) is held for SPAWN_DELAY_MS.
 */
const SLOW_SPAWN = join(SCRATCH, "slow-spawn.mjs");
writeFileSync(SLOW_SPAWN, `import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
const until = Date.now() + Number(process.env.STARTUP_DELAY_MS);
while (Date.now() < until);
const real = cp.execFile;
const ms = Number(process.env.SPAWN_DELAY_MS);
cp.execFile = (cmd, args, opts, cb) => real(cmd, args, opts, (...a) => setTimeout(() => cb(...a), ms));
syncBuiltinESMExports();
`);

function run({ homeDir, configFile, primaryDir, projectDir }, { script = SCRIPT, spawnDelayMs, startupDelayMs = 0 } = {}) {
  const args = [script, "--home", homeDir, "--config", configFile];
  if (primaryDir) args.push("--primary", primaryDir);
  if (spawnDelayMs !== undefined) args.unshift("--import", pathToFileURL(SLOW_SPAWN).href);
  const started = Date.now();
  const env = { ...GIT_ENV, CLAUDE_PROJECT_DIR: projectDir, SPAWN_DELAY_MS: String(spawnDelayMs ?? 0),
    STARTUP_DELAY_MS: String(startupDelayMs) };
  // Async on purpose: the fixture MCP servers live in THIS process, and spawnSync would block them from answering.
  const child = spawn(process.execPath, args, { cwd: projectDir, env });
  let out = "";
  let err = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (err += d));
  const timer = setTimeout(() => child.kill(), 20000);
  return new Promise((done) => child.on("close", (code) => {
    clearTimeout(timer);
    done({ code, out, err, ms: Date.now() - started });
  }));
}

const oneLine = (r) => {
  assert.equal(r.code, 0, r.err);
  const got = r.out.split(/\r?\n/).filter(Boolean);
  assert.equal(got.length, 1, `expected one line, got:\n${r.out}`);
  assert.match(got[0], /^\[health\] /);
  return got[0];
};

async function healthy(label, overrides = {}) {
  const ports = overrides.ports ?? [await listen(), await listen()];
  return {
    homeDir: home(label, ports, overrides.home),
    configFile: config(label, ports, overrides.config),
    primaryDir: primary(label, overrides.primary),
    projectDir: project(label),
  };
}

test("healthy fixture: one line, every item ok, no FIX FIRST", async () => {
  const line = oneLine(await run(await healthy("healthy")));
  assert.match(line, /graph ok \(0 behind origin\/main\)/);
  assert.match(line, /graphify up/);
  assert.match(line, /spare up/);
  assert.match(line, /claude ok/);
  assert.match(line, /codex ok/);
  assert.match(line, /vscode ok/);
  assert.match(line, /hooks ok/);
  assert.doesNotMatch(line, /FIX FIRST|UNKNOWN|DOWN|MISSING|BLOCKED|STALE/);
});

test("broken fixture: each broken piece is its own FAIL, and FIX FIRST names a fix for every one", async () => {
  const up = await listen();
  const down = await closedPort();
  const f = await healthy("broken", {
    ports: [up, down],
    home: { codexSkip: ["spare"], userHook: "powershell -NoProfile -File C:\\x\\hook.ps1" },
    primary: { graph: false },
  });
  const r = await run(f);
  const line = oneLine(r);
  assert.match(line, /graph MISSING graph\.json/);
  assert.match(line, /graphify up/);
  assert.match(line, /spare DOWN/);
  assert.match(line, /codex MISSING spare/);
  assert.match(line, /claude ok/);
  assert.match(line, /hooks BLOCKED [^|]*settings\.json/);
  const fixes = line.split(" | FIX FIRST: ")[1];
  assert.ok(fixes, `no FIX FIRST segment:\n${line}`);
  assert.match(fixes, /graphify-sync-launcher\.ps1/, "graph fix");
  assert.match(fixes, /local-mcp-servers\.ps1 -Start/, "server fix");
  assert.match(fixes, new RegExp(`codex mcp add spare --url http://127\\.0\\.0\\.1:${down}/mcp`), "client fix");
  assert.match(fixes, /-ExecutionPolicy Bypass/, "hook fix");
  assert.equal((fixes.match(/\(\d+\)/g) ?? []).length, 4, `four FAILs, four numbered fixes:\n${fixes}`);
  assert.ok(r.ms < 4000, `took ${r.ms} ms; the probes must stay inside their budget`);
});

test("a server that takes the request but does not answer in time reads UNKNOWN (no answer), not DOWN with a restart fix", async () => {
  // Under SessionStart load a healthy server can miss the deadline; only a refused connection proves it is down.
  // The broken fixture above keeps the true case: a closed port still reads DOWN with its fix.
  const f = await healthy("silent", { ports: [await listen(), await silent()] });
  const line = oneLine(await run(f));
  assert.match(line, /spare UNKNOWN \(no answer\)/);
  assert.doesNotMatch(line, /spare DOWN/);
  assert.doesNotMatch(line, /FIX FIRST/, "no answer is not proof of DOWN, so it must not order a server restart");
  assert.match(line, /graphify up/);
});

test("STALE: a graph built more than 50 commits behind origin/main is a FAIL with the sync fix", async () => {
  const line = oneLine(await run(await healthy("stale", { primary: { report: REPO.root } })));
  assert.match(line, /graph STALE \(54 behind origin\/main\)/);
  assert.match(line, /FIX FIRST: \(1\) [^|]*graphify-sync-launcher\.ps1/);
});

test("a wrong URL is not ok: a client entry pointing at another port reads WRONG URL", async () => {
  const ports = [await listen(), await listen()];
  const f = await healthy("wrong-url", { ports });
  const mcp = { graphify: { type: "http", url: url(ports[0]) }, spare: { type: "http", url: "http://127.0.0.1:1/mcp" } };
  writeFileSync(join(f.homeDir, ".claude.json"), JSON.stringify({ mcpServers: mcp }));
  const line = oneLine(await run(f));
  assert.match(line, /claude WRONG URL spare/);
  assert.match(line, /FIX FIRST: [^|]*claude mcp remove --scope user spare/);
});

test("a failed read is UNKNOWN, never ok or MISSING, and the other items still render", async () => {
  const line = oneLine(await run(await healthy("bad-json", { home: { claudeJson: "{ nope" } })));
  assert.match(line, /claude UNKNOWN \([^)]+\)/);
  assert.doesNotMatch(line, /claude (ok|MISSING)/);
  assert.match(line, /codex ok/);
  assert.match(line, /graph ok/);
  assert.doesNotMatch(line, /FIX FIRST/, "UNKNOWN is not a FAIL with a guessed fix");
});

test("no primary checkout (git cannot resolve it): graph reads UNKNOWN (git rev-parse ...), servers still probed", async () => {
  const f = await healthy("no-git");
  delete f.primaryDir;
  f.projectDir = join(SCRATCH, "no-git", "project");
  const line = oneLine(await run(f));
  assert.match(line, /graph UNKNOWN \(git rev-parse /);
  assert.match(line, /graphify up/);
});

test("--primary at a dir that is not a repo: the graph reads UNKNOWN, never ok, STALE or MISSING", async () => {
  const f = await healthy("non-repo");
  rmSync(join(f.primaryDir, ".git"));
  assert.match(oneLine(await run(f)), /graph UNKNOWN \(/);
});

// At SessionStart this hook shares the machine with every other hook and plugin starting up: a 48-process CPU load on
// NATTYNOUR (8 cores) made the whole hook take 6.4-8.6 s (node start-up ~2.5 s of it), and the old 1.5 s budget
// printed UNKNOWN (timeout) for healthy parts.
test("a slow machine is not a broken one: a git answer 2.5 s late still reads graph ok, not UNKNOWN (timeout)", async () => {
  const line = oneLine(await run(await healthy("slow-spawn"), { spawnDelayMs: 2500 }));
  assert.match(line, /graph ok \(0 behind origin\/main\)/);
});

test("slow start-up plus a hung probe still prints inside the hook timeout: graph UNKNOWN (timeout), never ok", async () => {
  const { hooks, at } = configured();
  const r = await run(await healthy("hung-spawn"), { spawnDelayMs: 60000, startupDelayMs: 2500 });
  const line = oneLine(r);
  assert.match(line, /graph UNKNOWN \(timeout\)/);
  assert.match(line, /graphify up/, "the other checks still render");
  // Claude kills the hook at its timeout and the line is lost; keep 1 s for the shell Claude starts it through.
  assert.ok(r.ms < hooks[at].timeout * 1000 - 1000, `took ${r.ms} ms against a ${hooks[at].timeout} s hook timeout`);
});

test("an empty servers list is a FAIL, not a vacuous all-clear", async () => {
  const f = await healthy("no-servers", { config: { servers: [] } });
  const line = oneLine(await run(f));
  assert.match(line, /servers: none configured/);
  assert.match(line, /FIX FIRST: \(1\) add the graphify entry to config\/agent-os\/local-services\.json/);
});

test("a user hook with -ExecutionPolicy Bypass AFTER -File is BLOCKED: PowerShell passes it to the script", async () => {
  const f = await healthy("bypass-after-file", { home: { userHook: 'powershell -NoProfile -File "C:/x/h.ps1" -ExecutionPolicy Bypass' } });
  assert.match(oneLine(await run(f)), /hooks BLOCKED ~\/\.claude\/settings\.json/);
});

test("hookNeedsBypass: flagged only for a script run without a policy that lets it load, set BEFORE -File", async () => {
  const { hookNeedsBypass } = await import("./session-health.mjs");
  const cases = [
    ['powershell -NoProfile -File "C:/x/h.ps1" -ExecutionPolicy Bypass', true],
    ['powershell -NoProfile -File "C:/x/h.ps1"', true],
    ['powershell -NoProfile -ExecutionPolicy Bypass -File "C:/x/h.ps1"', false],
    ['powershell -NoProfile -ExecutionPolicy RemoteSigned -File "C:/x/h.ps1"', false],
    ['powershell -ep Bypass -File C:/x/h.ps1', false],
    ['powershell -NoProfile -Command "Write-Output see h.ps1"', false],
    ['"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -File "C:\\x\\h.ps1"', true],
    ['"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -ExecutionPolicy Bypass -File "C:\\x\\h.ps1"', false],
    ['node "x/check.mjs" --script a.ps1', false],
  ];
  for (const [cmd, want] of cases) assert.equal(hookNeedsBypass(cmd), want, cmd);
});

test("taskFromCsv: the Task To Run must name the configured action, else WRONG ACTION with the register fix", async () => {
  const { taskFromCsv, parseCsvLine } = await import("./session-health.mjs");
  assert.deepEqual(parseCsvLine('"a -File ""C:\\x.ps1"" -Start","b",""'), ['a -File "C:\\x.ps1" -Start', "b", ""], "a doubled quote is one quote, not a field break");
  const task = { name: "NOURCITY-Local-MCP", register: "scripts/register-local-mcp-task.ps1", action: "scripts/local-mcp-servers.ps1" };
  // Rows shaped like the real `schtasks /query /tn <name> /fo CSV /v /nh` on NATTYNOUR (field 6 Last Result, 8 Task To Run).
  const root = "C:\\Users\\nourd\\NattyNour\\nicks-tire";
  const row = (run, last = "0", state = "Enabled") => `"NATTYNOUR","\\NOURCITY-Local-MCP","N/A","Running","Interactive only","10/19/2026 12:00:00 PM","${last}","NATTYNOUR\\nourd","${run}","N/A","N/A","${state}"`;
  const interim = row('C:\\Users\\nourd\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\\Users\\nourd\\AppData\\Local\\nourcity\\start-graphify-mcp.ps1""', "267009");
  const repo = row('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\\Users\\nourd\\NattyNour\\nicks-tire\\scripts\\local-mcp-servers.ps1"" -Start');
  const wrong = taskFromCsv(task, interim, "FIX", root);
  assert.equal(wrong.text, "task NOURCITY-Local-MCP WRONG ACTION (c:\\users\\nourd\\appdata\\local\\nourcity\\start-graphify-mcp.ps1)");
  assert.equal(wrong.fix, "FIX");
  assert.deepEqual(taskFromCsv(task, repo, "FIX", root), { text: "task NOURCITY-Local-MCP ok" });
  // Same basename, another clone: the full path decides, not the file name.
  const otherClone = repo.replace("NattyNour\\nicks-tire\\scripts", "NattyNour\\old-clone\\scripts");
  assert.equal(taskFromCsv(task, otherClone, "FIX", root).text, "task NOURCITY-Local-MCP WRONG ACTION (c:\\users\\nourd\\nattynour\\old-clone\\scripts\\local-mcp-servers.ps1)");
  // A disabled task keeps Last Result 0; it must not read ok.
  const disabled = taskFromCsv(task, row(repo.split('","')[8], "0", "Disabled"), "FIX", root);
  assert.equal(disabled.text, "task NOURCITY-Local-MCP DISABLED");
  assert.equal(disabled.fix, "FIX");
  assert.match(taskFromCsv(task, row("powershell -File x.ps1", ""), "FIX", root).text, /UNKNOWN \(no Last Result\)/, "an empty Last Result is not 0");
  assert.match(taskFromCsv(task, repo.replace('"0"', '"1"'), "FIX", root).text, /FAILED 1/);
});
test("C1: a graph built on a side branch (not an ancestor of origin/main) is STALE, not ok (0 behind)", async () => {
  const line = oneLine(await run(await healthy("side-build", { primary: { report: REPO.side } })));
  assert.match(line, new RegExp(`graph STALE \\(built from ${REPO.side.slice(0, 8)}, not on main\\)`));
  assert.match(line, /FIX FIRST: \(1\) [^|]*graphify-sync-launcher\.ps1/);
});

test("C3: a listener that answers 200 with another serverInfo name is WRONG SERVICE; a raw TCP listener too", async () => {
  const f = await healthy("wrong-service", { ports: [await listen("someone-else"), await rawTcp()] });
  const line = oneLine(await run(f));
  assert.match(line, /graphify WRONG SERVICE/);
  assert.match(line, /spare WRONG SERVICE/);
  assert.doesNotMatch(line, /graphify up|spare up/);
  assert.match(line, /FIX FIRST: [^|]*Get-NetTCPConnection -LocalPort/);
});

test("C3: a 500 from the port is WRONG SERVICE, never up", async () => {
  const f = await healthy("http-500", { ports: [await listen("graphify", 500), await listen()] });
  assert.match(oneLine(await run(f)), /graphify WRONG SERVICE \| spare up/);
});
test("host gate: a host not in the config prints the not-expected line and nothing else", async () => {
  const f = await healthy("other-host", { config: { hosts: ["SOME-OTHER-HOST"] } });
  assert.equal(oneLine(await run(f)), "[health] local services: not expected on this host");
});

test("own error: a missing config prints one [health] off: line, exit 0", async () => {
  const f = await healthy("no-config");
  f.configFile = join(SCRATCH, "no-config", "absent.json");
  assert.match(oneLine(await run(f)), /^\[health\] off: .*absent\.json/);
});

test("scheduled tasks (Windows): an unregistered task is MISSING with its register script as the fix", async (t) => {
  if (!WIN) return t.skip("schtasks is Windows-only; the check is skipped on other OS");
  const name = `NOURCITY-Health-Test-Absent-${process.pid}`;
  const line = oneLine(await run(await healthy("tasks", { config: { tasks: [{ name, register: "scripts/register-x.ps1" }] } })));
  assert.match(line, new RegExp(`task ${name} MISSING`));
  assert.match(line, /FIX FIRST: \(1\) [^|]*register-x\.ps1/);
});

test("scheduled tasks (Windows): schtasks starts beside git rev-parse, not after it, so slow spawns do not add up", async (t) => {
  if (!WIN) return t.skip("schtasks is Windows-only; the check is skipped on other OS");
  const name = `NOURCITY-Health-Test-Absent-${process.pid}`;
  const f = await healthy("tasks-parallel", { config: { tasks: [{ name, register: "scripts/register-x.ps1" }] } });
  delete f.primaryDir; // the real hook runs git rev-parse first; --primary would skip it
  // Every spawn answers 4 s late: in a row that is 8 s, past the budget; side by side it is 4 s.
  const line = oneLine(await run(f, { spawnDelayMs: 4000 }));
  assert.match(line, new RegExp(`task ${name} MISSING`));
});

function configured() {
  const group = (SETTINGS.hooks?.SessionStart ?? []).find((g) => !g.matcher || g.matcher === "*");
  const hooks = group?.hooks ?? [];
  return { hooks, at: hooks.findIndex((h) => h.command?.includes("session-health.mjs")), surface: hooks.findIndex((h) => h.command?.includes("session-surface.mjs")) };
}

test("settings: the SessionStart all-sources group runs session-health right after session-surface, forward slashes", () => {
  const { hooks, at, surface } = configured();
  assert.ok(at >= 0, "session-health.mjs is not registered in the SessionStart all-sources group");
  assert.equal(at, surface + 1);
  assert.match(hooks[at].command, /^node "\$\{CLAUDE_PROJECT_DIR\}\/scripts\/agent-os\/session-health\.mjs"$/);
});

test("the CONFIGURED command runs verbatim through a shell and prints one [health] line, exit 0", () => {
  const { hooks, at } = configured();
  assert.ok(at >= 0, "session-health.mjs is not registered");
  const env = { ...GIT_ENV, CLAUDE_PROJECT_DIR: ROOT };
  const cmd = WIN ? hooks[at].command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : hooks[at].command;
  const r = spawnSync(cmd, { shell: WIN ? true : "/bin/sh", input: "{}", encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, r.stdout);
  assert.match(lines[0], /^\[health\] /);
});

/** Run a copy of the script with one source edit; the anchor must exist, or the mutant tests nothing. */
function mutant(name, anchor, replacement) {
  const src = readFileSync(SCRIPT, "utf8");
  assert.ok(src.includes(anchor), `mutation anchor not found: ${anchor}`);
  const file = join(SCRATCH, `${name}.mjs`);
  writeFileSync(file, src.replace(anchor, replacement));
  return file;
}

test("MUTANT probe always up: the closed-port control catches it", async () => {
  const file = mutant("probe-up", 'req.on("error", (e) => done(e.code === "ECONNREFUSED" ? "DOWN" : "WRONG SERVICE"));', 'req.on("error", () => done("up"));');
  const f = await healthy("m-probe", { ports: [await listen(), await closedPort()] });
  assert.match(oneLine(await run(f)), /spare DOWN/, "real script reads DOWN");
  assert.match(oneLine(await run(f, { script: file })), /spare up/, "the mutant claims up, so the DOWN control can fail");
});

test("MUTANT a failed read rendered as ok: the bad-JSON control catches it", async () => {
  const file = mutant("err-ok", "if (r.err) return unknownItem(", "if (r.err) return okItem(");
  const f = await healthy("m-err", { home: { claudeJson: "{ nope" } });
  assert.match(oneLine(await run(f)), /claude UNKNOWN/);
  assert.doesNotMatch(oneLine(await run(f, { script: file })), /claude UNKNOWN/);
});
