#!/usr/bin/env node
/**
 * graph-ensure-mcp: one SessionStart line that makes the graphify MCP reachable, or says exactly why it is not.
 *
 *   [graph] mcp up (12 ms)                                   a real MCP initialize answered as graphify
 *   [graph] mcp started (1840 ms)                            it was DOWN; the launcher brought it up inside the budget
 *   [graph] mcp started (not answering yet after 2900 ms; graphify listens in about 20 s)
 *   [graph] mcp DOWN: launcher exited 1, next: <command>     the launcher failed; the next step is one command
 *   [graph] mcp UNKNOWN (no answer in 1 s), next: <command>  something holds the port but did not answer in time
 *   [graph] mcp: not expected on host X; fallback: graphify-out/GRAPH_REPORT.md + `graphify query`
 *
 * Why (Nour, 2026-11-03): "launch the mcp whenever working". The [health] line (session-health.mjs) reports the server;
 * this hook also STARTS it, through the existing launcher (scripts/local-mcp-servers.ps1 -Start, the NOURCITY-Local-MCP
 * task's own action), detached, so a session never has to remember to. The probe is session-health's mcpProbe (a real
 * initialize, 1 s), imported, not forked. Fails OPEN: every path exits 0; an own error prints `[graph] off: <reason>`.
 * Budget: BUDGET_MS from process start (the 8 s SessionStart budget of PR 3503 is shared by every hook here); the
 * settings.json timeout is 15 s because node start-up beside 40+ other starting processes alone took 7.2 s wall in a
 * real session (2026-11-03), with the probe itself at 35 ms.
 * The verdict is written to <state dir>/graph-mcp.json so graph-recall.mjs can say "mcp down" only when this hook saw
 * a real failure (a server still starting is not down).
 *
 * Flags (tests): --config <local-services.json>, --primary <dir> (skips git rev-parse). Env: GRAPH_ENSURE_LAUNCHER (a
 * JSON argv to run instead of the PowerShell launcher), NOURCITY_STATE_DIR (default %LOCALAPPDATA%/nourcity, the dir
 * heavy.mjs uses). `--scope global` (the ~/.claude/settings.json entry): silent in a project whose own settings run
 * this script, so the repo hook and the user hook never print twice. Canary: graphEnsureMcp.test.mjs.
 */
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mcpProbe } from "./session-health.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
// Every cap in one place. BUDGET_MS is the hard ceiling from process start; PROBE_MS is one initialize (session-health
// uses the same 1 s); REPROBE_EVERY_MS is how often the hook asks again after launching.
const BUDGET_MS = 3000;
const PROBE_MS = 1000;
const REPROBE_EVERY_MS = 250;
export const STATE_FILE = "graph-mcp.json";
const PS = ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File"];

export const stateDir = () => process.env.NOURCITY_STATE_DIR || join(process.env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity");
const msLeft = () => Math.max(0, BUDGET_MS - Math.round(process.uptime() * 1000));
const short = (err) => String(err?.message || err).split(/\r?\n/)[0].slice(0, 80);

function writeState(state, extra = {}) {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(join(stateDir(), STATE_FILE), JSON.stringify({ state, at: new Date().toISOString(), ...extra }));
  } catch {
    // the state file is a courtesy to graph-recall; losing it costs one "mcp down" line, never the session
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

/**
 * The launcher argv: the test override, else a short PowerShell that Start-Processes the repo's launcher hidden with its
 * own console, and exits as soon as it has. Measured 2026-11-03: a powershell spawned with Node's `detached: true`
 * reports exit 0 after 0.7 s while its script is still running (or dies with the hook's console), so the launcher's
 * own exit code never reaches this hook that way; the sync launcher (graphify-sync-launcher.ps1) uses the same
 * Start-Process pattern for the same reason. The wrapper's exit code is then "could it be launched", and the probe
 * loop below is "did it come up".
 */
function launcherArgv(primary) {
  if (process.env.GRAPH_ENSURE_LAUNCHER) return JSON.parse(process.env.GRAPH_ENSURE_LAUNCHER);
  if (process.platform !== "win32") return null;
  const script = join(primary, "scripts", "local-mcp-servers.ps1").replaceAll("'", "''");
  return ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command",
    `$p = Start-Process -FilePath powershell -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','${script}','-Start'); if (-not $p) { exit 1 }`];
}
const manual = (primary) => `${PS.join(" ")} ${join(primary, "scripts", "local-mcp-servers.ps1").replaceAll("\\", "/")} -Start`;

/**
 * Start the launcher (stdio ignored, unreferenced, so the hook can exit while it works). Returns { pid, failed }: `failed`
 * settles with the spawn error or a non-zero exit code if either happens, and never otherwise. A clean exit 0 means
 * "launched" (the Start-Process wrapper returns at once); the probe loop decides whether the server came up.
 */
function launch(argv) {
  let child;
  try {
    child = spawn(argv[0], argv.slice(1), { stdio: "ignore", windowsHide: true });
  } catch (err) {
    return { pid: 0, failed: Promise.resolve(`launcher ${err.code || short(err)}`) };
  }
  const failed = new Promise((res) => {
    child.on("error", (err) => res(`launcher ${err.code || short(err)}`));
    child.on("exit", (code) => { if (code !== 0) res(`launcher exited ${code}`); });
  });
  child.unref();
  return { pid: child.pid, failed };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 && argv[i + 1] ? argv[i + 1] : null; };
  if (argv.includes("--scope") && argv[argv.indexOf("--scope") + 1] === "global" && projectAlreadyRuns()) return null;
  const { hosts, server } = loadConfig(flag("--config") ?? join(REPO, "config", "agent-os", "local-services.json"));
  const host = (process.env.COMPUTERNAME || hostname()).toUpperCase();
  if (!hosts.includes(host)) return `[graph] mcp: not expected on host ${host}; fallback: graphify-out/GRAPH_REPORT.md + \`graphify query\``;

  const t0 = Date.now();
  const first = await mcpProbe(server.port, server.path, server.kind ?? server.name);
  if (first === "up") { writeState("up"); return `[graph] mcp up (${Date.now() - t0} ms)`; }
  const primary = await primaryRoot(flag("--primary"));
  const next = manual(primary);
  if (first !== "DOWN") {
    // NO ANSWER or WRONG SERVICE: something holds the port. Starting a second server would not help and could not bind.
    writeState("UNKNOWN", { next });
    return first === "NO ANSWER"
      ? `[graph] mcp UNKNOWN (no answer in ${PROBE_MS / 1000} s), next: ${next}`
      : `[graph] mcp DOWN: another program answers on port ${server.port}, next: Get-NetTCPConnection -LocalPort ${server.port} -State Listen`;
  }
  const argv2 = launcherArgv(primary);
  if (!argv2) { writeState("DOWN", { next }); return `[graph] mcp DOWN: no launcher on ${process.platform}, next: start it on the host that serves it (${next})`; }
  const { pid, failed } = launch(argv2);
  let failure = null;
  failed.then((why) => { failure = why; });
  while (msLeft() > PROBE_MS / 4) {
    await sleep(Math.min(REPROBE_EVERY_MS, msLeft()));
    if (failure) { writeState("DOWN", { next }); return `[graph] mcp DOWN: ${failure}, next: ${next}`; }
    if ((await mcpProbe(server.port, server.path, server.kind ?? server.name)) === "up") { writeState("started"); return `[graph] mcp started (${Date.now() - t0} ms)`; }
  }
  if (failure) { writeState("DOWN", { next }); return `[graph] mcp DOWN: ${failure}, next: ${next}`; }
  writeState("started", { pid });
  return `[graph] mcp started (not answering yet after ${Date.now() - t0} ms; graphify listens in about 20 s)`;
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
  const guard = setTimeout(() => process.stdout.write(`[graph] off: budget (${BUDGET_MS} ms) spent before a verdict\n`, () => process.exit(0)), BUDGET_MS + 400);
  main()
    .catch((err) => `[graph] off: ${short(err)}`)
    .then((line) => { clearTimeout(guard); process.stdout.write(line ? `${line}\n` : "", () => process.exit(0)); });
}
