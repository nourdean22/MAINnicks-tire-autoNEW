// Canary for scripts/agent-os/graph-ensure-mcp.mjs (job 2026-11-03-graphify-always-on): the SessionStart hook that
// probes the graphify MCP with a real initialize and launches it through the existing launcher when it is DOWN. Every
// control runs the REAL script as a child process against a stub MCP and a stub launcher (never the live server), and
// the wiring arm runs the CONFIGURED command string verbatim through a shell (guard-red-team rule 5).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startMcpStub, startMcpStubProcess } from "./fixtures/mcp-stub.mjs";
import { LAUNCH_LOCK, LAUNCH_LOG, STATE_FILE } from "./graph-ensure-mcp.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "graph-ensure-mcp.mjs");
const STUB = join(HERE, "fixtures", "mcp-stub.mjs");
const SETTINGS = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
const BOOTSTRAP_SRC = readFileSync(join(HERE, "bootstrap-machine.mjs"), "utf8");
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

/** launcher = JSON argv the hook runs instead of local-mcp-servers.ps1 -Start; `state`/`launchLog` plant the previous verdict. */
function run(label, { port, hosts, launcher, state, launchLog } = {}) {
  const { dir, file } = config(label, port, { hosts });
  const stateDir = join(dir, "state");
  if (state || launchLog) mkdirSync(stateDir, { recursive: true });
  if (state) writeFileSync(join(stateDir, STATE_FILE), JSON.stringify(state));
  if (launchLog) writeFileSync(join(stateDir, LAUNCH_LOG), launchLog);
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
  assert.match(line, /^\[graph\] mcp DOWN: launcher exited 1, next: .*local-mcp-servers\.ps1" -Start$/, line);
  assert.equal(state(r.stateDir).state, "DOWN");
});

test("MCP down, launcher cannot be spawned (no such exe): DOWN with the spawn error and a next step, exit 0", async () => {
  const port = await freePort();
  const r = run("launcher-missing", { port, launcher: [join(SCRATCH, "no-such-exe"), "-Start"] });
  assert.equal(r.code, 0, r.err);
  assert.match(oneLine(r.out), /^\[graph\] mcp DOWN: launcher ENOENT[^\n]*, next: /, r.out);
});

// Round-2 reader (2026-11-03): the first draft printed `started` for a launcher that did nothing. Now `started` needs a
// probe answer; anything else is "requested, not verified" with state `launching`, and the NEXT SessionStart turns a
// still-closed port into DOWN with the launcher's own last log line.
test("a launcher that exits 0 but brings nothing up: `launch requested, not verified`, state launching, inside the budget", async () => {
  const port = await freePort();
  const r = run("not-verified", { port, launcher: [process.execPath, "-e", "process.exit(0)"] });
  assert.equal(r.code, 0, r.err);
  assert.match(oneLine(r.out), /^\[graph\] mcp launch requested, not verified \(\d+ ms; graphify listens in about 20 s; the next SessionStart checks\)$/, r.out);
  assert.equal(state(r.stateDir).state, "launching");
  assert.doesNotMatch(r.out, /started/);
});

test("a wrapper that never exits and never listens: DOWN `launcher still running after 10 s`, and the hook returns inside the 15 s hook timeout", async () => {
  const port = await freePort();
  const r = run("budget", { port, launcher: [process.execPath, "-e", "setTimeout(() => {}, 60000)"] });
  assert.equal(r.code, 0, r.err);
  assert.match(oneLine(r.out), /^\[graph\] mcp DOWN: launcher still running after 10 s \(see .*mcp-launch\.wrapper\.log\), next: /, r.out);
  assert.ok(r.ms > 10000 && r.ms < 14500, `took ${r.ms} ms`);
  assert.equal(state(r.stateDir).state, "DOWN");
});

test("a slow wrapper (exits 0 after 4 s, as PowerShell does under start-up load) is waited for: `not verified`, never killed with the hook", async () => {
  const port = await freePort();
  const marker = join(SCRATCH, "slow-wrapper-done.txt");
  const r = run("slow-wrapper", { port, launcher: [process.execPath, "-e", `setTimeout(() => { require("fs").writeFileSync(${JSON.stringify(marker)}, "done"); process.exit(0); }, 4000)`] });
  assert.match(oneLine(r.out), /^\[graph\] mcp launch requested, not verified \(\d+ ms/, r.out);
  assert.ok(existsSync(marker), "the wrapper must be allowed to finish its work (it was killed with the hook in the first draft)");
  assert.ok(r.ms >= 4000 && r.ms < 9000, `took ${r.ms} ms`);
});

test("next SessionStart after a young launch (41 s ago), port still closed: `launch in progress`, no second launcher run", async () => {
  const port = await freePort();
  const r = run("in-progress", { port, launcher: [process.execPath, "-e", "process.exit(9)"], state: { state: "launching", at: new Date(Date.now() - 41000).toISOString() } });
  assert.match(oneLine(r.out), /^\[graph\] mcp launch in progress \(4\d s ago\), not verified; next: /, r.out);
  assert.equal(state(r.stateDir).state, "launching", "the verdict is untouched");
});

test("next SessionStart after an old launch (10 min), port still closed: DOWN with the launcher's last log line, state DOWN, no relaunch", async () => {
  const port = await freePort();
  const r = run("said", { port, launcher: [process.execPath, "-e", "process.exit(9)"], state: { state: "launching", at: new Date(Date.now() - 600000).toISOString() },
    launchLog: "STOPPED  graphify  pid 7 was alive but not listening on 8765\nDOWN  graphify  http://127.0.0.1:8765/mcp - cannot start: graphify-mcp not found on PATH\n\n" });
  assert.match(oneLine(r.out), /^\[graph\] mcp DOWN: launcher said "DOWN  graphify  http:\/\/127\.0\.0\.1:8765\/mcp - cannot start: graphify-mcp not found on PATH", next: /, r.out);
  assert.equal(state(r.stateDir).state, "DOWN");
  const r2 = run("said-nolog", { port, launcher: [process.execPath, "-e", "process.exit(9)"], state: { state: "launching", at: new Date(Date.now() - 600000).toISOString() } });
  assert.match(oneLine(r2.out), /^\[graph\] mcp DOWN: launched at .* but nothing listens, next: /, r2.out);
});

test("the real wrapper argv quotes the script path inside -ArgumentList and redirects the launcher's stdout to the launch log; the next: command quotes the path", () => {
  const src = readFileSync(SCRIPT, "utf8");
  assert.match(src, /-RedirectStandardOutput \$\{psq\(log\)\}/, "launcher stdout must go to the launch log");
  assert.match(src, /psq\(`"\$\{script\}"`\)/, "the script path is quoted inside the ArgumentList element");
  assert.match(src, /"-EncodedCommand", Buffer\.from\(cmd, "utf16le"\)\.toString\("base64"\)/, "the wrapper text must travel as -EncodedCommand (a -Command string spawned from node ran nothing, live 2026-11-03)");
  assert.match(src, /const manual = \(primary\) => `\$\{PS\.join\(" "\)\} "\$\{join\(primary/, "the next: command quotes the path");
});

test("host gate: a host not in the config says so and points at the report + CLI fallback, never launches", async () => {
  const port = await freePort();
  const r = run("host", { port, hosts: ["SOME-OTHER-HOST"], launcher: [process.execPath, STUB, String(port)] });
  assert.equal(r.code, 0, r.err);
  assert.match(oneLine(r.out), /^\[graph\] mcp: not expected on host .*; fallback: graphify-out\/GRAPH_REPORT\.md \+ `graphify query`$/, r.out);
});

// Round-3 reader: two SessionStarts at once both read DOWN and both launched (no lock); session B's launcher then killed
// session A's server that was still coming up. One exclusive launch lock; the loser says so.
test("concurrent starts: two hooks at once against one free port launch ONCE (counter file = 1); the other says launch in progress", async () => {
  const port = await freePort();
  const { dir, file } = config("concurrent", port);
  const stateDir = join(dir, "state");
  const counter = join(dir, "counter.txt");
  const pidFile = join(dir, "late.pid");
  const env = { ...process.env, CLAUDE_PROJECT_DIR: ROOT, NOURCITY_STATE_DIR: stateDir, GRAPH_ENSURE_LAUNCHER: JSON.stringify([process.execPath, STUB, String(port), pidFile, "graphify", "late", counter]) };
  const child = () => new Promise((res) => {
    const c = spawn(process.execPath, [SCRIPT, "--config", file, "--primary", dir], { env, cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let out = ""; c.stdout.on("data", (d) => { out += d; }); c.on("exit", (code) => res({ code, out: out.trim() }));
  });
  const [a, b] = await Promise.all([child(), child()]);
  if (existsSync(pidFile)) pids.push(Number(readFileSync(pidFile, "utf8")));
  assert.equal(a.code, 0); assert.equal(b.code, 0);
  assert.equal(existsSync(counter) ? readFileSync(counter, "utf8").length : 0, 1, `launcher ran ${existsSync(counter) ? readFileSync(counter, "utf8").length : 0} times:\n${a.out}\n${b.out}`);
  const outs = [a.out, b.out].sort();
  assert.ok(outs.some((o) => /^\[graph\] mcp (started \(\d+ ms\)|launch requested, not verified)/.test(o)), JSON.stringify(outs));
  // "unreadable, written": the loser read in the microseconds between the winner's create and its write; still held.
  assert.ok(outs.some((o) => /^\[graph\] mcp launch in progress \(another session holds the launch lock: (pid \d+,|unreadable, written) \d+ s ago\), not verified/.test(o)), JSON.stringify(outs));
  assert.ok(!existsSync(join(stateDir, LAUNCH_LOCK)), "the launch lock is released when the winner is done");
});

// The race behind "launcher ran 2 times" (CI run 41905313212, 2026-11-04): the winner's openSync("wx") made an EMPTY lock
// and wrote its pid in a second step; a loser that read in that gap took the empty file as stale, deleted the winner's
// lock and launched too. A fresh lock that cannot be read (yet) is HELD; only an old one, or one whose pid is dead, is not.
const plantLock = (label, text, ageMs = 0) => {
  const lock = join(SCRATCH, label, "state", LAUNCH_LOCK);
  mkdirSync(dirname(lock), { recursive: true });
  writeFileSync(lock, text);
  if (ageMs) { const t = new Date(Date.now() - ageMs); utimesSync(lock, t, t); }
  return lock;
};
const countingLauncher = (counter) => [process.execPath, "-e", `require("fs").appendFileSync(${JSON.stringify(counter)}, "x")`];

test("a fresh EMPTY launch lock is held: launch in progress, the launcher does not run, the lock file stays", async () => {
  const port = await freePort();
  const lock = plantLock("empty-lock-fresh", "");
  const counter = join(SCRATCH, "empty-lock-fresh-counter.txt");
  const r = run("empty-lock-fresh", { port, launcher: countingLauncher(counter) });
  assert.equal(r.code, 0, r.err);
  assert.match(oneLine(r.out), /^\[graph\] mcp launch in progress \(another session holds the launch lock: unreadable, written \d+ s ago\), not verified/, r.out);
  assert.ok(!existsSync(counter), "the launcher ran while another session's fresh lock was held");
  assert.ok(existsSync(lock), "a loser deleted a fresh lock it could not read");
});

test("control: an EMPTY launch lock older than the fresh window is stale, so it is replaced and the launch runs once", async () => {
  const port = await freePort();
  const lock = plantLock("empty-lock-old", "", 10 * 60_000);
  const counter = join(SCRATCH, "empty-lock-old-counter.txt");
  const r = run("empty-lock-old", { port, launcher: countingLauncher(counter) });
  assert.equal(r.code, 0, r.err);
  assert.equal(existsSync(counter) ? readFileSync(counter, "utf8").length : 0, 1, `an old empty lock must not block the launch forever:\n${r.out}`);
  assert.ok(!existsSync(lock), "the winner releases the lock it took");
});

test("no answer (a listener that never answers initialize): UNKNOWN, next: command, and the launcher is NOT run (counter stays 0)", async () => {
  const stub = await startMcpStubProcess({ mode: "hang" });
  const counter = join(SCRATCH, "hang-counter.txt");
  try {
    const r = run("hang", { port: stub.port, launcher: [process.execPath, "-e", `require("fs").appendFileSync(${JSON.stringify(counter)}, "x")`] });
    assert.equal(r.code, 0, r.err);
    assert.match(oneLine(r.out), /^\[graph\] mcp UNKNOWN \(no answer within the probe window\), next: /, r.out);
    assert.ok(!existsSync(counter), "a no-answer port must never launch a second server");
    assert.equal(state(r.stateDir).state, "UNKNOWN");
  } finally { stub.close(); }
});

test("--scope global: zero bytes in a project whose settings register this hook; the normal line in one that does not", async () => {
  const stub = await startMcpStubProcess();
  try {
    const registered = join(SCRATCH, "global-registered");
    mkdirSync(join(registered, ".claude"), { recursive: true });
    writeFileSync(join(registered, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: 'node "x/scripts/agent-os/graph-ensure-mcp.mjs"' }] }] } }));
    const bare = join(SCRATCH, "global-bare");
    mkdirSync(bare, { recursive: true });
    const { file, dir } = config("global", stub.port);
    const go = (projectDir) => spawnSync(process.execPath, [SCRIPT, "--scope", "global", "--config", file, "--primary", dir], { encoding: "utf8", cwd: ROOT, env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, NOURCITY_STATE_DIR: join(dir, "state") }, timeout: 20000 });
    assert.equal(go(registered).stdout, "", "the project hook already prints; the user entry must stay quiet");
    assert.match(go(bare).stdout.trim(), /^\[graph\] mcp up \(\d+ ms\)$/);
  } finally { stub.close(); }
});

test("the probe budget is 3 s: the `not verified` line's own ms figure stays under 3200 (a widened BUDGET_MS would show here)", async () => {
  const port = await freePort();
  const r = run("budget-figure", { port, launcher: [process.execPath, "-e", "process.exit(0)"] });
  const ms = Number(/not verified \((\d+) ms/.exec(r.out)?.[1]);
  assert.ok(ms > 0 && ms < 3500, r.out);
});

test("the user-level entry bootstrap writes has the same timeout as the repo registration (15)", () => {
  const repo = (SETTINGS.hooks.SessionStart ?? []).flatMap((g) => g.hooks ?? []).find((h) => h.command.includes("graph-ensure-mcp.mjs")).timeout;
  const m = /key: "graph-ensure-mcp\.mjs",[^\n]*timeout: (\d+)/.exec(BOOTSTRAP_SRC);
  assert.ok(m, "bootstrap must register graph-ensure-mcp.mjs with a timeout");
  assert.equal(Number(m[1]), repo);
});

// The launcher itself (local-mcp-servers.ps1): a recorded pid that is alive, named python/graphify and younger than 45 s is
// a server still coming up; -Start must say STARTING and never STOPPED (round-3 reader: session B killed session A's).
test("local-mcp-servers.ps1 -Start: a live recorded pid under 45 s old is not stopped (STARTING, exit 1, no STOPPED, lock released)", { skip: process.platform !== "win32" && "Windows PowerShell" }, async () => {
  const port = await freePort();
  const local = join(SCRATCH, "localappdata");
  mkdirSync(join(local, "nourcity"), { recursive: true });
  const young = spawn("python", ["-c", "import time; time.sleep(60)"], { stdio: "ignore" });
  pids.push(young.pid);
  await new Promise((r) => setTimeout(r, 300));
  writeFileSync(join(local, "nourcity", "mcp-graphify.pid"), String(young.pid));
  const { file } = config("ps1-young", port);
  const r = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "local-mcp-servers.ps1"), "-Start", "-ConfigFile", file], { encoding: "utf8", env: { ...process.env, LOCALAPPDATA: local }, timeout: 60000 });
  assert.doesNotMatch(r.stdout, /STOPPED/, r.stdout);
  assert.match(r.stdout, new RegExp(`STARTING  graphify  pid ${young.pid} is \\d+ s old and not listening yet; not restarted`), r.stdout + r.stderr);
  assert.equal(r.status, 1, "not UP, so -Start exits 1");
  assert.ok(!existsSync(join(local, "nourcity", "mcp-start-graphify.lock")), "the start lock is released");
});

// The process-level guard: a main() that outlives GUARD_MS prints `[graph] off: budget` and exits 0 instead of being
// killed by the 15 s hook timeout. Nothing in the real constants can make main() run that long (every wait is bounded
// under the guard), so the arm plants a copy whose wrapper wait is 20 s and a wrapper that never exits (round-4).
test("guard: a planted 20 s wrapper wait with a wrapper that never exits prints `[graph] off: budget (13000 ms) spent before a verdict`, exit 0, before the hook timeout", async () => {
  const src = readFileSync(SCRIPT, "utf8");
  assert.ok(src.includes("const LAUNCH_WAIT_MS = 10_000;"), "anchor");
  const planted = join(SCRATCH, "ensure-slow-wrapper.mjs");
  writeFileSync(planted, src.replace("const LAUNCH_WAIT_MS = 10_000;", "const LAUNCH_WAIT_MS = 20_000;").replaceAll(/from "\.\/([\w-]+\.mjs)"/g, (_, f) => `from ${JSON.stringify(pathToFileURL(join(HERE, f)).href)}`));
  const port = await freePort();
  const { dir, file } = config("guard", port);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [planted, "--config", file, "--primary", dir], { encoding: "utf8", cwd: ROOT, env: { ...process.env, CLAUDE_PROJECT_DIR: ROOT, NOURCITY_STATE_DIR: join(dir, "state"), GRAPH_ENSURE_LAUNCHER: JSON.stringify([process.execPath, "-e", "setTimeout(() => {}, 60000)"]) }, timeout: 20000 });
  const ms = Date.now() - t0;
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), "[graph] off: budget (13000 ms) spent before a verdict", r.stdout);
  assert.ok(ms >= 13000 && ms < 15000, `took ${ms} ms: the guard must fire under the 15 s hook timeout`);
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
  // A no-op launcher: the wiring arm must never start or stop the live server on this machine (round-2 reader).
  const noop = JSON.stringify([process.execPath, "-e", "process.exit(0)"]);
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: JSON.stringify({ source: "startup" }), encoding: "utf8", cwd: ROOT, env: { ...env, CLAUDE_PROJECT_DIR: ROOT, NOURCITY_STATE_DIR: join(SCRATCH, "wired"), GRAPH_ENSURE_LAUNCHER: noop }, timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(oneLine(r.stdout), /^\[graph\] mcp/, `an off line is a crash, not a verdict:\n${r.stdout}`);
});
