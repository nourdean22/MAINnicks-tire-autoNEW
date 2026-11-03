#!/usr/bin/env node
/**
 * graph-recall: for the symbols a prompt names, print where each one lives in the repo graph, the way skill-recall
 * names skills, tool-recall names tools and memory-recall names notes.
 *
 *   [graph-recall] fn relatedActivity() -> apps/statenour/lib/services/related-activity.ts:75 · community goal-pace.ts · callers: related-activity.test.ts
 *
 * UserPromptSubmit hook (stdin JSON with a `prompt` field) and a CLI, same input handling as skill-recall.mjs:
 *   node scripts/agent-os/graph-recall.mjs --text "<prompt>"     one-line prompt
 *   --config <local-services.json> (tests; or env GRAPH_LOCAL_SERVICES when no flag can be passed)   --scope global (the ~/.claude/settings.json entry: silent in a project
 *   whose own settings run this script, so the repo hook and the user hook never print twice)
 *
 * Candidates (1 to MAX_SYMBOLS, in order of appearance): backticked words, path-like tokens (a/b.ts), file names
 * (merge-gate.mjs), camelCase and snake_case identifiers. Plain words never qualify, so prose prints nothing.
 * Source: the graphify MCP over Streamable HTTP at the URL in config/agent-os/local-services.json (one initialize, then
 * get_node per candidate in parallel, then get_neighbors for the hits; measured 2026-11-03: 6-90 ms initialize, 10-30 ms
 * per call, against 14.3 s for `graphify query` on the CLI, which loads the 80k-node graph.json every time). Callers are
 * the incoming `calls` edges, then other incoming edges except `contains`, at most 3 names. Only real symbols print: see
 * MIN_DEGREE / TEST_PATH below (an ambiguous name, a degree-1 node, a test-file node the prompt did not name are dropped).
 * Caps, all here: MIN_PROMPT_CHARS (shorter prompts and bare slash commands print nothing), MAX_SYMBOLS (and so lines),
 * BUDGET_MS from the first request (anything the server has not answered by then is dropped: a 1.5 s hook on every
 * prompt is the price of context, so a slow graph costs silence, never a wait).
 * Silent when nothing resolves and when the port is closed; prints one `[graph-recall] mcp down, next: <command>` line
 * only when graph-ensure-mcp.mjs's machine-wide state file (last writer wins) holds a DOWN verdict under 24 h old, never
 * while a launch is in flight. Any other failure prints `[graph-recall] UNKNOWN (<reason>)` at most once per 30 min.
 * `--scope global` also stays silent in a project whose git common dir is not this repo's: the graph is this repo's, and
 * a file:line from it would be false context in another codebase (round-2 reader).
 * Fail OPEN: any own error prints one "[graph-recall] off: <reason>" line and exits 0 (exit 2 would veto the prompt).
 * Canary: graphRecall.test.mjs.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readInput } from "./skill-recall.mjs";
import { STATE_FILE, stateDir } from "./graph-ensure-mcp.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const MIN_PROMPT_CHARS = 12;
const MAX_SYMBOLS = 6; // candidates per prompt, and so the most lines a turn can carry
const BUDGET_MS = 1500;
const MAX_CALLERS = 3;
// Only the first MAX_SCAN_CHARS of a prompt are scanned for symbols: the path regex is quadratic on a pasted report, and
// the request usually sits at the start of a prompt (round-2 reader: 40k chars took 1.5-3 s before the clock started).
const MAX_SCAN_CHARS = 8000;
// A failure that is not "port closed" (a non-200 initialize, a reset, the budget, bad SSE) is said once per
// UNKNOWN_EVERY_MS via a timestamp file in the state dir, never on every prompt (silence would hide a broken graph).
const UNKNOWN_EVERY_MS = 30 * 60_000;
const UNKNOWN_STAMP = "graph-recall-unknown.at";
// A node is a real symbol when the graph itself is sure of it: not the MCP's own "Ambiguous: matches N nodes" answer
// (`status` matched 24), at least MIN_DEGREE edges (a property name like `updatedAt` resolved to a degree-1 node in a
// random test file, manager probe 2026-11-03), and not inside a test file unless the prompt named that file itself.
const MIN_DEGREE = 3;
const TEST_PATH = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\.[jt]sx?$|\.test\.mjs$/;
const DOWN_STATE_MAX_AGE_MS = 24 * 3600 * 1000;

/** Candidate symbols and paths in a prompt, deduped case-insensitively, in order of appearance. */
export function candidates(prompt) {
  const out = [];
  const seen = new Set();
  const add = (s) => {
    const k = s.toLowerCase();
    if (!k || seen.has(k) || out.length >= MAX_SYMBOLS) return;
    seen.add(k);
    out.push(s);
  };
  // Backticked words first: the author pointed at them.
  for (const m of prompt.matchAll(/`([^`\s]{2,80})`/g)) add(m[1].replace(/\(\)$/, ""));
  const rest = prompt.replace(/`[^`]*`/g, " ");
  let plain = rest;
  for (const m of rest.matchAll(/\b[\w.-]+(?:\/[\w.-]+)+\.\w{1,5}\b/g)) add(m[0]);            // a/b/c.ts
  // merge-gate.mjs: the whole file name is the candidate, and its text leaves the prompt so "mergeGate.test.mjs" is not
  // also read as the symbol mergeGate.
  for (const m of rest.matchAll(/\b[\w-]+(?:\.[\w-]+)*\.(?:mjs|cjs|js|ts|tsx|jsx|py|ps1|md|json|sql|toml|yml|yaml)\b/g)) { add(m[0]); plain = plain.replace(m[0], " "); }
  for (const m of plain.matchAll(/\b[a-z][a-z0-9]*[A-Z]\w*\b|\b[A-Z][a-z0-9]+[A-Z]\w*\b/g)) add(m[0]);   // camelCase, PascalCase
  for (const m of plain.matchAll(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g)) add(m[0]);                   // snake_case
  return out;
}

function loadUrl(file) {
  const c = JSON.parse(readFileSync(file, "utf8"));
  const s = (c.servers ?? []).find((x) => x.kind === "graphify") ?? c.servers?.[0];
  if (!s) throw new Error(`${file}: no graphify server`);
  return { port: s.port, path: s.path };
}

/** One JSON-RPC POST; the SSE or JSON body is parsed to the result. Rejects on transport errors; never resolves late. */
function rpc(target, body, deadline, sessionId) {
  return new Promise((res, rej) => {
    const data = JSON.stringify(body);
    const left = deadline - Date.now();
    if (left <= 0) return rej(new Error("budget"));
    const req = request({ host: "127.0.0.1", port: target.port, path: target.path, method: "POST", timeout: left, headers: {
      "content-type": "application/json", accept: "application/json, text/event-stream", "content-length": Buffer.byteLength(data), ...(sessionId ? { "mcp-session-id": sessionId } : {}),
    } }, (r) => {
      let text = "";
      r.setEncoding("utf8");
      r.on("data", (c) => { text += c; });
      r.on("end", () => {
        const json = text.replace(/^(?:event: \w+\s*)?data: /m, "").trim();
        try { res({ status: r.statusCode, sessionId: r.headers["mcp-session-id"], json: json ? JSON.parse(json.split(/\n\n/)[0]) : null }); } catch { res({ status: r.statusCode, json: null }); }
      });
    });
    req.on("timeout", () => { req.destroy(new Error("budget")); });
    req.on("error", rej);
    req.end(data);
  });
}

const resultText = (r) => r?.json?.result?.content?.[0]?.text ?? "";

/** fn for `name()`, file for `name.ext`, sym otherwise: the graph's own label convention. */
export const kindOf = (label) => (/\(\)$/.test(label) ? "fn" : /\.[a-z0-9]{1,5}$/i.test(label) ? "file" : "sym");

/**
 * "Node: x()\n  Source: a/b.ts L75\n  Community: c\n  Degree: 5" -> { label, kind, file, line, community, degree }, or
 * null for a miss, an "Ambiguous: 'x' matches N nodes" answer, a degree under MIN_DEGREE, or a test-file node the prompt
 * did not name as a file (`asked` is the prompt's own token).
 */
export function parseNode(text, asked = "") {
  if (/^Ambiguous: /.test(text)) return null;
  const label = /^Node: (.+)$/m.exec(text)?.[1]?.trim();
  const src = /^\s*Source: (\S+) L(\d+)/m.exec(text);
  const community = /^\s*Community: (.+)$/m.exec(text)?.[1]?.trim();
  const degree = Number(/^\s*Degree: (\d+)/m.exec(text)?.[1] ?? 0);
  if (!label || !src || degree < MIN_DEGREE) return null;
  if (TEST_PATH.test(src[1]) && !/\./.test(asked)) return null;
  return { label, kind: kindOf(label), file: src[1], line: Number(src[2]), community: community ?? "?", degree };
}

/** Incoming edges: `<-- name [relation]`; `calls` first, `contains` never. */
export function parseCallers(text) {
  const calls = [];
  const other = [];
  for (const m of text.matchAll(/^\s*<-- (.+?) \[(\w+)\]/gm)) {
    if (m[2] === "contains") continue;
    (m[2] === "calls" ? calls : other).push(m[1].trim());
  }
  return [...calls, ...other].slice(0, MAX_CALLERS);
}

async function recall(target, symbols) {
  const deadline = Date.now() + BUDGET_MS;
  const init = await rpc(target, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "graph-recall", version: "1" } } }, deadline);
  const sid = init.sessionId;
  if (init.status !== 200 || !sid) throw new Error(`initialize answered ${init.status}`);
  const quiet = (p) => p.catch(() => null);
  const nodes = await Promise.all(symbols.map((s, i) => quiet(rpc(target, { jsonrpc: "2.0", id: 10 + i, method: "tools/call", params: { name: "get_node", arguments: { label: s } } }, deadline, sid)).then((r) => parseNode(resultText(r), s))));
  const hits = nodes.filter(Boolean);
  const neighbors = await Promise.all(hits.map((n, i) => quiet(rpc(target, { jsonrpc: "2.0", id: 100 + i, method: "tools/call", params: { name: "get_neighbors", arguments: { label: n.label } } }, deadline, sid)).then((r) => parseCallers(resultText(r)))));
  return hits.map((n, i) => `[graph-recall] ${n.kind} ${n.label} -> ${n.file}:${n.line} · community ${n.community}${neighbors[i]?.length ? ` · callers: ${neighbors[i].join(", ")}` : ""}`);
}

/** The DOWN verdict graph-ensure-mcp.mjs left this session, if any (a server that is starting is not down). */
function downVerdict() {
  try {
    const s = JSON.parse(readFileSync(join(stateDir(), STATE_FILE), "utf8"));
    return s.state === "DOWN" && Date.now() - Date.parse(s.at) < DOWN_STATE_MAX_AGE_MS ? s : null;
  } catch {
    return null;
  }
}

/** The git common dir of `dir`, or null: the one thing two checkouts of the same repo share. */
function commonDir(dir) {
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    return resolve(execFileSync("git", ["-C", dir, "rev-parse", "--path-format=absolute", "--git-common-dir"], { encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"], timeout: 800 }).trim());
  } catch {
    return null;
  }
}
/** In global scope, only a checkout of THIS repo gets graph lines (the graph was built from it). */
export function sameRepo(root, repo = REPO) {
  const a = commonDir(root);
  return a !== null && a === commonDir(repo);
}

/** One UNKNOWN line per UNKNOWN_EVERY_MS, machine-wide. */
function unknownLine(reason) {
  const stamp = join(stateDir(), UNKNOWN_STAMP);
  try {
    if (Date.now() - statSync(stamp).mtimeMs < UNKNOWN_EVERY_MS) return;
  } catch {
    // no stamp yet: say it
  }
  try { mkdirSync(stateDir(), { recursive: true }); writeFileSync(stamp, new Date().toISOString()); } catch { /* the line still prints */ }
  process.stdout.write(`[graph-recall] UNKNOWN (${reason})\n`);
}

function projectAlreadyRuns(root) {
  if (resolve(root) === resolve(homedir())) return false;
  try {
    const s = JSON.parse(readFileSync(join(root, ".claude", "settings.json"), "utf8"));
    return (s.hooks?.UserPromptSubmit ?? []).some((g) => (g.hooks ?? []).some((h) => String(h.command || "").includes("graph-recall.mjs")));
  } catch {
    return false;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const scope = argv.indexOf("--scope");
  const global = scope >= 0 && argv[scope + 1] === "global";
  if (global && (projectAlreadyRuns(root) || !sameRepo(root))) return;
  const { prompt } = readInput(argv, root);
  const text = String(prompt).trim();
  if (text.length < MIN_PROMPT_CHARS || /^\/\S+(\s|$)/.test(text) && text.split(/\s+/).length <= 2) return;
  const symbols = candidates(text.slice(0, MAX_SCAN_CHARS));
  if (!symbols.length) return;
  const cfg = argv.indexOf("--config");
  const target = loadUrl(cfg >= 0 ? resolve(argv[cfg + 1]) : process.env.GRAPH_LOCAL_SERVICES ?? join(REPO, "config", "agent-os", "local-services.json"));
  let lines;
  try {
    lines = await recall(target, symbols);
  } catch (err) {
    if (err?.code === "ECONNREFUSED") {
      // Port closed: DOWN only when graph-ensure-mcp saw it too; a launch in flight stays quiet.
      const down = downVerdict();
      if (down) process.stdout.write(`[graph-recall] mcp down, next: ${down.next ?? "node scripts/agent-os/graph-ensure-mcp.mjs"}\n`);
      return;
    }
    unknownLine(err?.code || String(err?.message || err).split(/\r?\n/)[0].slice(0, 60));
    return;
  }
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
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
  // A process-level ceiling beside the request deadline: a hook that prints nothing on time beats one the harness kills.
  const guard = setTimeout(() => process.exit(0), BUDGET_MS + 2500);
  main()
    .catch((err) => process.stdout.write(`[graph-recall] off: ${String(err?.message || err).split(/\r?\n/)[0]}\n`))
    .then(() => { clearTimeout(guard); process.exit(0); });
}
