#!/usr/bin/env node
/**
 * graph-ensure-mcp: one SessionStart line that makes the graphify MCP reachable, or says exactly why it is not.
 *
 *   [graph] mcp up (12 ms)                                   a real MCP initialize answered as graphify
 *   [graph] mcp started (1840 ms)                            it was DOWN; the launcher brought it up and a probe answered
 *   [graph] mcp launch requested, not verified (2900 ms; graphify listens in about 20 s; the next SessionStart checks)
 *   [graph] mcp launch in progress (41 s ago), not verified  a launch from the last two minutes, port still closed
 *   [graph] mcp DOWN: launcher said "...", next: <command>   the last launch did not come up; its log's last line
 *   [graph] mcp DOWN: launcher exited 1, next: <command>     the launcher could not even be started
 *   [graph] mcp UNKNOWN (no answer within the probe window), next: <command>   something holds the port, no answer
 *   [graph] mcp: not expected on host X; fallback: graphify-out/GRAPH_REPORT.md + `graphify query`
 *
 * Why (Nour, 2026-11-03): "launch the mcp whenever working". The [health] line (session-health.mjs) reports the server;
 * this hook also STARTS it, through the existing launcher (scripts/local-mcp-servers.ps1 -Start, the NOURCITY-Local-MCP
 * task's own action), so a session never has to remember to. The probe is session-health's mcpProbe (a real initialize),
 * imported, not forked. Fails OPEN: every path exits 0; an own error prints `[graph] off: <reason>`.
 *
 * Launch mechanism (measured 2026-11-03): a powershell spawned with Node's `detached: true` reports exit 0 after 0.7 s
 * while its script is still running or dies, and a NON-detached child is killed by libuv when this hook exits (round-2
 * reader: killed at 0/300/600/1500 ms). So the hook runs a short non-detached wrapper that Start-Processes the launcher
 * hidden, with its own console and its stdout redirected to <state dir>/mcp-launch.log, and WAITS for that wrapper to
 * exit (about a second by hand, more under start-up load; up to 10 s) before the hook can end, probing meanwhile.
 * `started` is printed only when a probe answered; a launch
 * the probe did not confirm is `launch requested, not verified` with state `launching`, and the next SessionStart turns
 * a still-closed port into `DOWN: launcher said "<last log line>"` so the launcher's own reason is never lost.
 * Budget: BUDGET_MS from process start for the probes (the 8 s SessionStart budget of PR 3503 is shared by every hook
 * here) plus LAUNCH_WAIT_MS for the wrapper; the settings.json timeout is 15 s because node start-up beside 40+ other
 * starting processes alone took 7.2 s wall in a real session, with the probe itself at 35 ms.
 * The verdict goes to <state dir>/graph-mcp.json (machine-wide, last writer wins) so graph-recall.mjs can say "mcp down"
 * only after a real DOWN verdict, never while a launch is in flight.
 *
 * Flags (tests): --config <local-services.json>, --primary <dir> (skips git rev-parse). Env: GRAPH_LOCAL_SERVICES (the
 * config file when no flag can be passed, e.g. the configured command string under test), GRAPH_ENSURE_LAUNCHER (a
 * JSON argv to run instead of the PowerShell wrapper), NOURCITY_STATE_DIR (default %LOCALAPPDATA%/nourcity, the dir
 * heavy.mjs uses). `--scope global` (the ~/.claude/settings.json entry): silent in a project whose own settings run
 * this script, so the repo hook and the user hook never print twice. Canary: graphEnsureMcp.test.mjs.
 */
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpProbe } from "./session-health.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
// Every cap in one place. BUDGET_MS is the probe ceiling from process start; LAUNCH_WAIT_MS is how long the hook waits
// for the launch wrapper to exit (about 1 s in practice); REPROBE_EVERY_MS is how often it asks again after launching;
// LAUNCHING_FRESH_MS is how long a `launching` verdict counts as still in flight before a closed port reads DOWN.
const BUDGET_MS = 3000;
// How long the hook waits for the launch wrapper to EXIT. It is a PowerShell that only Start-Processes the launcher,
// about 1 s by hand; but PowerShell start-up beside 40+ starting processes took over 2 s in the live run (2026-11-03),
// and a child still running when this hook exits dies with it (round-2 reader), so the wait is generous and the
// settings.json timeout (15 s) leaves room: 10 s + node start-up stays under it.
const LAUNCH_WAIT_MS = 10_000;
// The process-level ceiling: a main() that has not settled by then prints `[graph] off: budget` and exits 0, under the
// 15 s hook timeout. Independent of the waits above on purpose (a widened wait must not move the guard with it).
const GUARD_MS = 13_000;
const REPROBE_EVERY_MS = 250;
const LAUNCHING_FRESH_MS = 120_000;
export const STATE_FILE = "graph-mcp.json";
export const LAUNCH_LOG = "mcp-launch.log";
// The wrapper's own stdout+stderr (a Start-Process error would otherwise vanish: round-3 live run, 2026-11-03).
export const WRAPPER_LOG = "mcp-launch.wrapper.log";
// One launch at a time across sessions: an exclusive-create lock file (round-3 reader: two SessionStarts at once both
// read DOWN and both launched). Honoured while younger than LOCK_FRESH_MS and its pid is alive.
export const LAUNCH_LOCK = "graph-mcp-launch.lock";
const LOCK_FRESH_MS = 60_000;
const PS = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"];

export const stateDir = () => process.env.NOURCITY_STATE_DIR || join(process.env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity");
const msLeft = () => Math.max(0, BUDGET_MS - Math.round(process.uptime() * 1000));
const short = (err) => String(err?.message || err).split(/\r?\n/)[0].slice(0, 80);

function writeState(state, extra = {}) {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(join(stateDir(), STATE_FILE), JSON.stringify({ state, at: new Date().toISOString(), ...extra }));
  } catch (err) {
    // A courtesy to graph-recall, so it never blocks the session; but a lost write is said, not swallowed.
    process.stderr.write(`[graph] state not written (${short(err)})\n`);
  }
}
/**
 * Take the launch lock: null when taken, else why it is held ("pid N, M s ago", or "unreadable, written M s ago").
 * The pid goes in through the same fd that created the file, so the lock is never an empty file for long. A fresh lock
 * that cannot be read (yet) is HELD: its owner is between create and write. Only an old lock, or a fresh one whose pid
 * is dead, is replaced (CI run 41905313212, 2026-11-04: a loser read the empty file, deleted it, and both launched).
 */
function takeLaunchLock() {
  const file = join(stateDir(), LAUNCH_LOCK);
  mkdirSync(stateDir(), { recursive: true });
  const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = openSync(file, "wx");
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let holder = null;
      try { holder = JSON.parse(readFileSync(file, "utf8")); } catch { /* empty or half-written: its owner is mid-write */ }
      let ageMs;
      try { ageMs = Date.now() - statSync(file).mtimeMs; } catch (e) { if (e.code === "ENOENT") continue; throw e; } // released meanwhile
      const s = Math.round(ageMs / 1000);
      if (ageMs < LOCK_FRESH_MS && !Number.isInteger(holder?.pid)) return `unreadable, written ${s} s ago`;
      if (ageMs < LOCK_FRESH_MS && alive(holder.pid)) return `pid ${holder.pid}, ${s} s ago`;
      try { rmSync(file, { force: true }); } catch { /* the retry reports it */ }
      continue;
    }
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    } finally {
      closeSync(fd);
    }
    return null;
  }
  return "lock could not be taken";
}
const releaseLaunchLock = () => { try { rmSync(join(stateDir(), LAUNCH_LOCK), { force: true }); } catch { /* best effort */ } };

function readState() {
  try {
    return JSON.parse(readFileSync(join(stateDir(), STATE_FILE), "utf8"));
  } catch {
    return null;
  }
}
/** The launcher's last non-empty stdout line from the previous launch, or null. */
function lastLaunchLine() {
  try {
    return readFileSync(join(stateDir(), LAUNCH_LOG), "utf8").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? null;
  } catch {
    return null;
  }
}

function loadConfig(file) {
  const c = JSON.parse(readFileSync(file, "utf8"));
  const s = (c.servers ?? []).find((x) => x.kind === "graphify") ?? c.servers?.[0];
  if (!c.hosts || !s || !Number.isInteger(s.port) || !/^\//.test(s.path ?? "")) throw new Error(`${file}: no graphify server entry`);
  return { hosts: c.hosts.map((h) => String(h).toUpperCase()), server: s };
}

function primaryRoot(override) {
  if (override) return Promise.resolve(override);
  return new Promise((res) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    execFile("git", ["-C", REPO, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", env, timeout: 800 }, (err, out) => res(!err && out.trim() ? dirname(resolve(out.trim())) : REPO));
  });
}

const psq = (s) => `'${String(s).replaceAll("'", "''")}'`; // a PowerShell single-quoted literal
/** The wrapper argv: the test override, else Start-Process of the repo launcher, hidden, stdout to the launch log. */
function launcherArgv(primary) {
  if (process.env.GRAPH_ENSURE_LAUNCHER) return JSON.parse(process.env.GRAPH_ENSURE_LAUNCHER);
  if (process.platform !== "win32") return null;
  const script = join(primary, "scripts", "local-mcp-servers.ps1");
  const log = join(stateDir(), LAUNCH_LOG);
  // The script path is quoted INSIDE the -ArgumentList element: Start-Process joins the list on spaces (local-mcp-servers.ps1:89).
  // -EncodedCommand: the same text through -Command ran by hand but did nothing when node spawned it (round-3 live run,
  // 2026-11-03: Windows argument quoting of the nested quotes), so the command travels as base64 UTF-16LE, untouched.
  const cmd = `$ErrorActionPreference = 'Stop'; New-Item -ItemType Directory -Force ${psq(dirname(log))} | Out-Null; $p = Start-Process -FilePath powershell -WindowStyle Hidden -PassThru -RedirectStandardOutput ${psq(log)} -RedirectStandardError ${psq(`${log}.err`)} -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',${psq(`"${script}"`)},'-Start'); if (-not $p) { exit 1 }; "launched pid=$($p.Id) at $(Get-Date -Format o)"`;
  return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(cmd, "utf16le").toString("base64")];
}
const manual = (primary) => `${PS.join(" ")} "${join(primary, "scripts", "local-mcp-servers.ps1").replaceAll("\\", "/")}" -Start`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start the wrapper. Returns { pid, result }: `result` holds { failure } once the wrapper has exited (null failure on exit 0,
 * the spawn error or `launcher exited N (<its last line>)` otherwise) and stays null while it runs; `unref()` lets the
 * hook exit without it. Its stdout+stderr go to <state dir>/mcp-launch.wrapper.log.
 */
function launch(argv) {
  const state = { pid: 0, result: null, unref() {} };
  let out = "ignore";
  try {
    mkdirSync(stateDir(), { recursive: true });
    out = openSync(join(stateDir(), WRAPPER_LOG), "w");
  } catch {
    // no wrapper log: the launch still runs
  }
  let child;
  try {
    child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", out, out], windowsHide: true });
  } catch (err) {
    state.result = { failure: `launcher ${err.code || short(err)}` };
    return state;
  }
  // PowerShell serialises progress records to a redirected stderr as CLIXML: those lines are not what the wrapper said.
  const wrapperSaid = () => { try { return readFileSync(join(stateDir(), WRAPPER_LOG), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^(#< CLIXML|<Objs )/.test(l)).at(-1) ?? ""; } catch { return ""; } };
  const settle = (failure) => { if (state.result) return; state.result = { failure }; if (out !== "ignore") { try { closeSync(out); } catch { /* closed */ } } };
  state.pid = child.pid ?? 0;
  state.unref = () => child.unref();
  child.on("error", (err) => settle(`launcher ${err.code || short(err)}`));
  child.on("exit", (code) => settle(code === 0 ? null : `launcher exited ${code}${wrapperSaid() ? ` (${wrapperSaid().slice(0, 100)})` : ""}`));
  return state;
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv.includes("--scope") && argv[argv.indexOf("--scope") + 1] === "global" && projectAlreadyRuns()) return null;
  // GRAPH_LOCAL_SERVICES: the config for a hook run from its CONFIGURED command string (hookCommand.test.mjs), where no flag can be added.
  const { hosts, server } = loadConfig(flag("--config") ?? process.env.GRAPH_LOCAL_SERVICES ?? join(REPO, "config", "agent-os", "local-services.json"));
  const host = (process.env.COMPUTERNAME || hostname()).toUpperCase();
  if (!hosts.includes(host)) return `[graph] mcp: not expected on host ${host}; fallback: graphify-out/GRAPH_REPORT.md + \`graphify query\``;

  const t0 = Date.now();
  const probe = () => mcpProbe(server.port, server.path, server.kind ?? server.name);
  const first = await probe();
  if (first === "up") { writeState("up"); return `[graph] mcp up (${Date.now() - t0} ms)`; }
  const primary = await primaryRoot(flag("--primary"));
  const next = manual(primary);
  if (first !== "DOWN") {
    // NO ANSWER or WRONG SERVICE: something holds the port. Starting a second server would not help and could not bind.
    writeState("UNKNOWN", { next });
    return first === "NO ANSWER"
      ? `[graph] mcp UNKNOWN (no answer within the probe window), next: ${next}`
      : `[graph] mcp DOWN: another program answers on port ${server.port}, next: Get-NetTCPConnection -LocalPort ${server.port} -State Listen`;
  }
  // DOWN. Was a launch already requested? Young: still in flight. Old: it did not come up; say what the launcher said.
  const prev = readState();
  if (prev?.state === "launching" && Date.parse(prev.at) > 0) {
    const ageMs = Date.now() - Date.parse(prev.at);
    if (ageMs < LAUNCHING_FRESH_MS) return `[graph] mcp launch in progress (${Math.round(ageMs / 1000)} s ago), not verified; next: ${next}`;
    const said = lastLaunchLine();
    writeState("DOWN", { next, said });
    return `[graph] mcp DOWN: ${said ? `launcher said "${said}"` : `launched at ${prev.at} but nothing listens`}, next: ${next}`;
  }
  const argv2 = launcherArgv(primary);
  if (!argv2) { writeState("DOWN", { next }); return `[graph] mcp DOWN: no launcher on ${process.platform}, next: start it on the host that serves it (${next})`; }
  const held = takeLaunchLock();
  if (held) return `[graph] mcp launch in progress (another session holds the launch lock: ${held}), not verified; next: ${next}`;
  try {
    const launched = launch(argv2);
    const launchStart = Date.now();
    // Probe while the wrapper runs: a server that answers ends the wait; a wrapper that fails ends it; a wrapper that
    // exited 0 is left to the probe budget; a wrapper still running past LAUNCH_WAIT_MS is a failure of its own.
    for (;;) {
      await sleep(REPROBE_EVERY_MS);
      if (launched.result?.failure) { writeState("DOWN", { next }); return `[graph] mcp DOWN: ${launched.result.failure}, next: ${next}`; }
      if ((await probe()) === "up") { launched.unref(); writeState("started"); return `[graph] mcp started (${Date.now() - t0} ms)`; }
      if (launched.result && msLeft() <= 0) break;
      if (!launched.result && Date.now() - launchStart > LAUNCH_WAIT_MS) {
        launched.unref();
        writeState("DOWN", { next });
        return `[graph] mcp DOWN: launcher still running after ${Math.round(LAUNCH_WAIT_MS / 1000)} s (see ${join(stateDir(), WRAPPER_LOG)}), next: ${next}`;
      }
    }
    writeState("launching", { pid: launched.pid, next });
    return `[graph] mcp launch requested, not verified (${Date.now() - t0} ms; graphify listens in about 20 s; the next SessionStart checks)`;
  } finally {
    releaseLaunchLock();
  }
}

/** `--scope global`: the project's own .claude/settings.json already runs this hook, so the user entry stays quiet. */
function projectAlreadyRuns() {
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  if (root === resolve(homedir())) return false;
  try {
    const s = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
    return (s.hooks?.SessionStart ?? []).some((g) => (g.hooks ?? []).some((h) => String(h.command || "").includes("graph-ensure-mcp.mjs")));
  } catch {
    return false;
  }
}

function isEntry() {
  try {
    const a = realpathSync(process.argv[1]);
    const b = realpathSync(fileURLToPath(import.meta.url));
    return process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isEntry()) {
  const guard = setTimeout(() => process.stdout.write(`[graph] off: budget (${GUARD_MS} ms) spent before a verdict\n`, () => process.exit(0)), GUARD_MS);
  main()
    .catch((err) => `[graph] off: ${short(err)}`)
    .then((line) => { clearTimeout(guard); process.stdout.write(line ? `${line}\n` : "", () => process.exit(0)); });
}
