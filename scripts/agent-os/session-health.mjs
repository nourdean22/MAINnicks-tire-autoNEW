#!/usr/bin/env node
/**
 * session-health: one SessionStart line naming every broken piece of the local code-intelligence setup, with its fix.
 *
 *   [health] graph ok (12 behind origin/main) | graphify DOWN | claude ok | codex MISSING graphify | vscode ok |
 *   hooks ok | task NOURCITY-Local-MCP MISSING | tailnet: not installed (...)
 *   | FIX FIRST: (1) <command> (2) <command>
 *
 * Source of truth: config/agent-os/local-services.json (hosts, servers, clients, tasks). Checks, each on its own:
 *   host     COMPUTERNAME / os.hostname() not in hosts -> "[health] local services: not expected on this host", exit 0
 *   graph    <primary>/graphify-out/graph.json present, build commit from GRAPH_REPORT.md, commits behind origin/main
 *            -> ok | STALE (> 50 behind, or the build commit is gone) | MISSING <file>
 *   servers  MCP initialize POST to 127.0.0.1:<port><path>, 1 s -> up (200 + serverInfo.name = kind) | DOWN (refused,
 *            no answer) | WRONG SERVICE (anything else answered); an empty list -> "servers: none configured" (FAIL)
 *   clients  ~/.claude.json mcpServers, ~/.codex/config.toml [mcp_servers.*], %APPDATA%/Code/User/mcp.json servers:
 *            each must list every server at http://127.0.0.1:<port><path> -> ok | MISSING <names> | WRONG URL <names>
 *   hooks    a powershell/pwsh hook running -File <x>.ps1 with no Bypass/Unrestricted/RemoteSigned policy BEFORE -File
 *            (user or project settings) -> BLOCKED <file>; see hookNeedsBypass
 *            (static: Windows PowerShell 5.1 here has every policy scope Undefined = Restricted)
 *   tasks    Windows only: schtasks /query per task -> ok | MISSING | DISABLED | WRONG ACTION (<full script path>) |
 *            FAILED <last result>
 *   tailnet  `tailscale serve status` (or --serve-status <file> in tests): serving <url><path> when a configured port is
 *            proxied tailnet-only | installed, not serving | not installed; FUNNEL ON <url> is the one FAIL (never public)
 * A failed read is UNKNOWN (<reason>), never ok, and carries no guessed fix. An absent client file (ENOENT) is a real
 * "nothing configured" and reads MISSING. Total budget 1.5 s; every probe has its own timeout.
 * Flags (tests): --home <dir> (also the base of AppData/Roaming), --config <file>, --primary <dir> (skips git rev-parse).
 * Project dir: CLAUDE_PROJECT_DIR, else cwd. Exit 0 always; an own error prints "[health] off: <reason>".
 * Canary: sessionHealth.test.mjs.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { request } from "node:http";
import { homedir, hostname } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const WIN = process.platform === "win32";
const T0 = Date.now();
const BUDGET_MS = 1500;
// A real MCP initialize, not a TCP connect: any program can hold the port. 1 s, inside the 1.5 s budget.
const PROBE_MS = 1000;
const STALE_AFTER = 50;
const PS = "powershell -NoProfile -ExecutionPolicy Bypass -File";

const short = (err) => String(err?.message || err).split(/\r?\n/)[0].slice(0, 60);
const msLeft = () => Math.max(50, BUDGET_MS - 150 - (Date.now() - T0));

function readText(file, { missingOk = false } = {}) {
  try {
    return readFileSync(file, "utf8");
  } catch (err) {
    if (missingOk && err.code === "ENOENT") return null;
    throw new Error(`${basename(file)}: ${err.code || "unreadable"}`);
  }
}

function readJson(file, opts) {
  const text = readText(file, opts);
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${basename(file)}: bad JSON`);
  }
}

function attempt(fn) {
  try {
    return { value: fn() };
  } catch (err) {
    return { err: short(err) };
  }
}

const okItem = (text) => ({ text });
const failItem = (text, fix) => ({ text, fix });
const unknownItem = (label, reason) => ({ text: `${label} UNKNOWN (${reason})` });

/** Resolve after a child exits or its timeout kills it; never rejects. */
function sh(cmd, args, cwd) {
  return new Promise((done) => {
    execFile(cmd, args, { cwd, timeout: msLeft(), windowsHide: true, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === "number" ? error.code : null) : 0;
      const why = error && code === null ? (error.killed ? "timeout" : error.code || "spawn error") : null;
      done({ code, out: stdout || "", err: stderr || "", why });
    });
  });
}

const INIT = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "health", version: "1" } } });

/**
 * POST an MCP initialize to http://127.0.0.1:<port><path>. up = HTTP 200 whose body (JSON or one SSE event) carries
 * serverInfo with "name":"<kind>"; refused or no answer in time = DOWN; anything else that answered = WRONG SERVICE.
 */
export function mcpProbe(port, path, kind) {
  return new Promise((resolveProbe) => {
    let settled = false;
    let body = "";
    let status = 0;
    const named = new RegExp(`"serverInfo"\\s*:\\s*\\{[^}]*"name"\\s*:\\s*"${kind.replace(/[^\w-]/g, "")}"`);
    const req = request({ host: "127.0.0.1", port, path, method: "POST", timeout: Math.max(50, Math.min(PROBE_MS, msLeft() - 100)), headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": Buffer.byteLength(INIT),
    } }, (res) => {
      status = res.statusCode;
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        body += chunk;
        if (named.test(body) || body.length > 65536) done(verdict());
      });
      res.on("end", () => done(verdict()));
    });
    const verdict = () => (status === 200 && named.test(body) ? "up" : "WRONG SERVICE");
    const done = (state) => {
      if (settled) return;
      settled = true;
      req.destroy();
      resolveProbe(state);
    };
    req.on("timeout", () => done(status ? verdict() : "DOWN"));
    req.on("error", (e) => done(e.code === "ECONNREFUSED" ? "DOWN" : "WRONG SERVICE"));
    req.end(INIT);
  });
}
/** Give up on a check that outlives the budget: it reads UNKNOWN (timeout), never ok. */
function within(promise, label) {
  return Promise.race([promise, new Promise((r) => setTimeout(() => r(unknownItem(label, "timeout")), msLeft()).unref())]);
}

function loadConfig(file) {
  const c = readJson(file);
  const bad = (what) => new Error(`${basename(file)}: ${what}`);
  if (c?.version !== 1) throw bad("version is not 1");
  if (!Array.isArray(c.hosts) || !Array.isArray(c.servers) || !Array.isArray(c.clients)) throw bad("hosts, servers or clients is not a list");
  for (const s of c.servers) {
    if (typeof s?.name !== "string" || !Number.isInteger(s.port) || s.port < 1 || s.port > 65535 || !/^\//.test(s.path ?? "")) {
      throw bad(`bad server ${JSON.stringify(s?.name ?? s)}`);
    }
  }
  if (c.tasks !== undefined && !Array.isArray(c.tasks)) throw bad("tasks is not a list");
  return c;
}

async function primaryRoot(projectDir, override) {
  if (override) return { value: override };
  const r = await sh("git", ["-C", projectDir, "rev-parse", "--path-format=absolute", "--git-common-dir"], projectDir);
  if (r.code !== 0 || !r.out.trim()) return { err: `git rev-parse ${r.why || `exit ${r.code}`}` };
  return { value: dirname(resolve(r.out.trim())) };
}

async function graphItem(primary, fix) {
  if (primary.err) return unknownItem("graph", primary.err);
  const out = join(primary.value, "graphify-out");
  if (!existsSync(join(out, "graph.json"))) return failItem("graph MISSING graph.json", fix);
  const report = attempt(() => readText(join(out, "GRAPH_REPORT.md"), { missingOk: true }));
  if (report.err) return unknownItem("graph", report.err);
  if (report.value === null) return failItem("graph MISSING GRAPH_REPORT.md", fix);
  const m = report.value.match(/Built from commit:\s*`([0-9a-f]{7,40})`/);
  if (!m) return unknownItem("graph", "no build commit in GRAPH_REPORT.md");
  // One git call answers both questions: "<off-main>\t<behind>". A build commit off main (a branch, a detached HEAD)
  // has off-main > 0 and can still count 0 behind, so ancestry is checked first (same answer as merge-base
  // --is-ancestor, one spawn instead of two inside the 1.5 s budget).
  const r = await sh("git", ["-C", primary.value, "rev-list", "--left-right", "--count", `${m[1]}...origin/main`], primary.value);
  if (r.code !== 0 && /unknown revision|bad revision|invalid revision|not a valid/i.test(r.err)) {
    return failItem(`graph STALE (built from ${m[1]}, not in this repo)`, fix);
  }
  const counts = r.out.trim().match(/^(\d+)\s+(\d+)$/);
  if (r.code !== 0 || !counts) return unknownItem("graph", `git rev-list ${r.why || `exit ${r.code}`}`);
  if (Number(counts[1]) > 0) return failItem(`graph STALE (built from ${m[1]}, not on main)`, fix);
  const n = Number(counts[2]);
  return n > STALE_AFTER ? failItem(`graph STALE (${n} behind origin/main)`, fix) : okItem(`graph ok (${n} behind origin/main)`);
}

/** [mcp_servers.<name>] url = "..." from a Codex config.toml; only the keys this check needs. */
export function codexServers(text) {
  const found = {};
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[\s*([^\]]+?)\s*\]\s*(?:#.*)?$/);
    if (header) {
      const m = header[1].match(/^mcp_servers\.(?:"([^"]+)"|([A-Za-z0-9_-]+))$/);
      current = m ? m[1] ?? m[2] : null;
      if (current) found[current] = found[current] ?? null;
      continue;
    }
    const url = current && line.match(/^\s*url\s*=\s*["']([^"']*)["']/);
    if (url) found[current] = url[1];
  }
  return found;
}

const urlMap = (servers) => Object.fromEntries(Object.entries(servers ?? {}).map(([k, v]) => [k, v?.url ?? null]));

function clientItem(client, read, expected) {
  const r = attempt(read);
  if (r.err) return unknownItem(client, r.err);
  const have = r.value ?? {};
  const missing = expected.filter((e) => !(e.name in have));
  const wrong = expected.filter((e) => e.name in have && have[e.name] !== e.url);
  if (!missing.length && !wrong.length) return okItem(`${client} ok`);
  const add = {
    claude: (e) => `claude mcp add --transport http --scope user ${e.name} ${e.url}`,
    codex: (e) => `codex mcp add ${e.name} --url ${e.url}`,
    vscode: (e) => `code --add-mcp '${JSON.stringify({ name: e.name, type: "http", url: e.url })}'`,
  }[client];
  const fixes = [
    ...wrong.map((e) => (client === "claude" ? `claude mcp remove --scope user ${e.name}; ${add(e)}` : add(e))),
    ...missing.map(add),
  ];
  const text = [missing.length && `MISSING ${missing.map((e) => e.name).join(",")}`, wrong.length && `WRONG URL ${wrong.map((e) => e.name).join(",")}`]
    .filter(Boolean).join(" ");
  return failItem(`${client} ${text}`, fixes.join("; "));
}

const PS_EXE = /(?:^|[\s"'\\/&|;(])(?:powershell|pwsh)(?:\.exe)?["']?(?=\s)/i;
const PS_FILE = /\s-(?:File|f)\s+("[^"]*"|'[^']*'|\S+)/i;
const LOADS_LOCAL_SCRIPTS = /\s-(?:ExecutionPolicy|ep|ex|exec)\s+["']?(?:Bypass|Unrestricted|RemoteSigned)\b/i;

/**
 * True when a hook command runs a .ps1 through PowerShell with no execution policy that lets a local script load.
 * Only a policy set BEFORE -File counts: everything after -File <script> is passed to the script as its arguments.
 * A -Command that merely mentions a .ps1 is not a script run (mention vs execution). Shared with hookCommand.test.mjs.
 */
export function hookNeedsBypass(command) {
  const exe = PS_EXE.exec(command);
  if (!exe) return false;
  const rest = command.slice(exe.index + exe[0].length);
  const file = PS_FILE.exec(rest);
  if (!file || !/\.ps1$/i.test(file[1].replace(/^["']|["']$/g, ""))) return false;
  return !LOADS_LOCAL_SCRIPTS.test(rest.slice(0, file.index));
}

function hookCommands(settings) {
  const out = [];
  for (const groups of Object.values(settings?.hooks ?? {})) {
    for (const g of Array.isArray(groups) ? groups : []) for (const h of g?.hooks ?? []) if (typeof h?.command === "string") out.push(h.command);
  }
  return out;
}

function hooksItem(files) {
  const blocked = [];
  const unreadable = [];
  for (const [label, file] of files) {
    const r = attempt(() => readJson(file, { missingOk: true }));
    if (r.err) unreadable.push(r.err);
    else if (hookCommands(r.value).some(hookNeedsBypass)) blocked.push(label);
  }
  if (blocked.length) return failItem(`hooks BLOCKED ${blocked.join(",")}`, `add -ExecutionPolicy Bypass after "powershell -NoProfile" in the hook commands of ${blocked.join(", ")}`);
  if (unreadable.length) return unknownItem("hooks", unreadable.join("; "));
  return okItem("hooks ok");
}

const NOT_RUN_YET = 267011; // SCHED_S_TASK_HAS_NOT_RUN
const RUNNING = 267009; // SCHED_S_TASK_RUNNING

/** One CSV row; a quote inside a field is doubled (""), as schtasks writes a quoted -File path. */
export function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Judge one `schtasks /query /tn <name> /fo CSV /v /nh` row. Columns read from the real header on NATTYNOUR
 * (2026-10-19): 6 "Last Result", 8 "Task To Run", 11 "Scheduled Task State"; CSV keeps that order on every UI language.
 * A task is matched by the FULL path of its -File script against <root>/<action>: a same-named task running another
 * script, or the right script in another clone or worktree, must not read ok. A disabled task keeps Last Result 0.
 */
export function taskFromCsv(task, line, fix, root) {
  const label = `task ${task.name}`;
  const fields = parseCsvLine(line);
  if (/^disabled$/i.test((fields[11] ?? "").trim())) return failItem(`${label} DISABLED`, fix);
  if (!/^-?\d+$/.test(fields[6] ?? "")) return unknownItem(label, "no Last Result");
  const norm = (p) => p.replace(/["']/g, "").replace(/\//g, "\\").trim().toLowerCase();
  if (task.action) {
    const file = (fields[8] ?? "").match(/-File\s+(?:"([^"]+)"|(\S+))/i);
    const found = file ? norm(file[1] ?? file[2]) : "?";
    if (found !== norm(join(root, task.action))) return failItem(`${label} WRONG ACTION (${found})`, fix);
  }
  const result = Number(fields[6]);
  if (result === 0 || result === NOT_RUN_YET || result === RUNNING) return okItem(`${label} ok`);
  return failItem(`${label} FAILED ${result}`, `${fix} (then check its log)`);
}

async function taskItem(task, root) {
  const label = `task ${task.name}`;
  const fix = `${PS} ${join(root, task.register ?? "")} -RepoRoot ${root}`;
  const r = await sh(join(process.env.SystemRoot || "C:\\Windows", "System32", "schtasks.exe"), ["/query", "/tn", task.name, "/fo", "CSV", "/v", "/nh"]);
  if (r.code === 1 && /cannot find|does not exist/i.test(r.err)) return failItem(`${label} MISSING`, fix);
  if (r.code !== 0) return unknownItem(label, `schtasks ${r.why || `exit ${r.code}`}`);
  return taskFromCsv(task, r.out.split(/\r?\n/).find((l) => l.trim()) ?? "", fix, root);
}

const TAILNET_DOC = "docs/agent-os/TAILNET-MCP.md";

function tailscaleExe() {
  const dirs = [...(process.env.PATH || process.env.Path || "").split(delimiter), join(process.env.ProgramFiles || "C:\\Program Files", "Tailscale")];
  const exe = WIN ? "tailscale.exe" : "tailscale";
  return dirs.map((d) => d && join(d, exe)).find((p) => p && existsSync(p)) ?? null;
}

/** `tailscale serve status` text -> one block per served URL: its Funnel flag and the local ports it proxies. */
export function parseServeStatus(text) {
  const blocks = [];
  for (const line of String(text).split(/\r?\n/)) {
    const head = line.match(/^(https?:\/\/\S+)\s*\((tailnet only|Funnel on)\)/i);
    if (head) {
      blocks.push({ url: head[1], funnel: /funnel/i.test(head[2]), ports: new Set() });
      continue;
    }
    const proxy = blocks.length && line.match(/proxy https?:\/\/(?:127\.0\.0\.1|localhost):(\d+)/i);
    if (proxy) blocks[blocks.length - 1].ports.add(Number(proxy[1]));
  }
  return blocks;
}

/** Informational unless Funnel is on: the runbook is tailnet-only, so a public route is the one FAIL here. */
async function tailnetItem(expected, statusFile) {
  const exe = tailscaleExe();
  if (!exe && !statusFile) return okItem(`tailnet: not installed (optional, ${TAILNET_DOC})`);
  let text;
  if (statusFile) {
    const r = attempt(() => readText(statusFile));
    if (r.err) return unknownItem("tailnet", r.err);
    text = r.value;
  } else {
    const r = await sh(exe, ["serve", "status"]);
    text = `${r.out}\n${r.err}`;
    if (r.code !== 0 && !/no serve config/i.test(text)) return unknownItem("tailnet", `serve status ${r.why || `exit ${r.code}`}`);
  }
  const blocks = parseServeStatus(text);
  const served = expected.map((s) => ({ s, block: blocks.find((b) => b.ports.has(s.port)) })).filter((x) => x.block);
  const funnel = served.find((x) => x.block.funnel);
  if (funnel) return failItem(`tailnet: FUNNEL ON ${funnel.block.url}`, `tailscale funnel reset (tailnet only, never public: ${TAILNET_DOC})`);
  if (served.length) return okItem(`tailnet: serving ${served.map((x) => `${x.block.url}${x.s.path}`).join(" ")}`);
  return okItem(`tailnet: installed, not serving (optional, ${TAILNET_DOC})`);
}

async function main() {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? resolve(argv[i + 1]) : null;
  };
  const homeFlag = flag("--home");
  const home = homeFlag ?? homedir();
  const appData = homeFlag ? join(homeFlag, "AppData", "Roaming") : process.env.APPDATA || join(home, "AppData", "Roaming");
  const config = loadConfig(flag("--config") ?? join(REPO, "config", "agent-os", "local-services.json"));
  const host = (process.env.COMPUTERNAME || hostname()).toUpperCase();
  if (!config.hosts.some((h) => String(h).toUpperCase() === host)) return "[health] local services: not expected on this host";

  const projectDir = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const primary = await within(primaryRoot(projectDir, flag("--primary")), "primary").then((p) => (p.text ? { err: "timeout" } : p));
  const root = primary.value ?? REPO;
  // `expect` is the serverInfo.name a pass-through relays from its upstream; every other server answers as its own kind.
  const expected = config.servers.map((s) => ({ name: s.name, port: s.port, path: s.path, kind: s.kind, expect: s.expect ?? s.kind ?? s.name, url: `http://127.0.0.1:${s.port}${s.path}` }));
  const serverFix = `${PS} ${join(root, "scripts", "local-mcp-servers.ps1")} -Start`;

  const readers = {
    claude: () => urlMap(objectOrEmpty(readJson(join(home, ".claude.json"), { missingOk: true }), "mcpServers")),
    codex: () => codexServers(readText(join(home, ".codex", "config.toml"), { missingOk: true }) ?? ""),
    vscode: () => urlMap(objectOrEmpty(readJson(join(appData, "Code", "User", "mcp.json"), { missingOk: true }), "servers")),
  };

  const checks = [
    within(graphItem(primary, `${PS} ${join(root, "scripts", "graphify-sync-launcher.ps1")}`), "graph"),
    ...expected.map((s) => within(mcpProbe(s.port, s.path, s.expect).then((st) => {
      if (st === "up") return okItem(`${s.name} up`);
      if (st === "DOWN") return failItem(`${s.name} DOWN`, serverFix);
      return failItem(`${s.name} WRONG SERVICE`, `find the program on port ${s.port}: Get-NetTCPConnection -LocalPort ${s.port} -State Listen; free the port or move ${s.name} in config/agent-os/local-services.json`);
    }), s.name)),
  ];
  // Tasks start with the other probes: schtasks is the slowest child (cold start measured near 1 s).
  const tasks = WIN ? Promise.all((config.tasks ?? []).map((t) => within(taskItem(t, root), `task ${t.name}`))) : Promise.resolve([]);
  const tailnet = within(tailnetItem(expected, flag("--serve-status")), "tailnet");
  const items = await Promise.all(checks);
  if (!expected.length) items.push(failItem("servers: none configured", "add the graphify entry to config/agent-os/local-services.json"));
  for (const c of config.clients) items.push(readers[c] ? clientItem(c, readers[c], expected) : unknownItem(c, "unknown client"));
  items.push(hooksItem([
    ["~/.claude/settings.json", join(home, ".claude", "settings.json")],
    [".claude/settings.json", join(projectDir, ".claude", "settings.json")],
    [".claude/settings.local.json", join(projectDir, ".claude", "settings.local.json")],
  ]));
  items.push(...(await tasks));
  items.push(await tailnet);

  const fixes = [...new Set(items.map((i) => i.fix).filter(Boolean))];
  return `[health] ${items.map((i) => i.text).join(" | ")}${fixes.length ? ` | FIX FIRST: ${fixes.map((f, n) => `(${n + 1}) ${f}`).join(" ")}` : ""}`;
}

function objectOrEmpty(json, key) {
  const v = json?.[key];
  if (v === undefined || v === null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${key} is not an object`);
  return v;
}

/** True when node was started on this file, so a test can import the parsers without printing a line. */
function isEntry() {
  try {
    const a = realpathSync(process.argv[1]);
    const b = realpathSync(fileURLToPath(import.meta.url));
    return WIN ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isEntry()) {
  main()
    .catch((err) => `[health] off: ${short(err)}`)
    .then((line) => process.stdout.write(`${line}\n`, () => process.exit(0)));
}
