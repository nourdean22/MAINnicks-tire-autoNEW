#!/usr/bin/env node
/**
 * graph-recall: for the symbols a prompt names, print where each one lives in the repo graph, the way skill-recall
 * names skills, tool-recall names tools and memory-recall names notes.
 *
 *   [graph-recall] relatedActivity() -> apps/statenour/lib/services/related-activity.ts:75 · community goal-pace.ts · callers: related-activity.test.ts
 *
 * UserPromptSubmit hook (stdin JSON with a `prompt` field) and a CLI, same input handling as skill-recall.mjs:
 *   node scripts/agent-os/graph-recall.mjs --text "<prompt>"     one-line prompt
 *   --config <local-services.json> (tests)   --scope global (the ~/.claude/settings.json entry: silent in a project
 *   whose own settings run this script, so the repo hook and the user hook never print twice)
 *
 * Candidates (1 to MAX_SYMBOLS, in order of appearance): backticked words, path-like tokens (a/b.ts), file names
 * (merge-gate.mjs), camelCase and snake_case identifiers. Plain words never qualify, so prose prints nothing.
 * Source: the graphify MCP over Streamable HTTP at the URL in config/agent-os/local-services.json (one initialize, then
 * get_node per candidate in parallel, then get_neighbors for the hits; measured 2026-11-03: 6-90 ms initialize, 10-30 ms
 * per call, against 14.3 s for `graphify query` on the CLI, which loads the 80k-node graph.json every time). Callers are
 * the incoming `calls` edges, then other incoming edges except `contains`, at most 3 names.
 * Caps, all here: MIN_PROMPT_CHARS (shorter prompts and bare slash commands print nothing), MAX_SYMBOLS (and so lines),
 * BUDGET_MS from the first request (anything the server has not answered by then is dropped: a 1.5 s hook on every
 * prompt is the price of context, so a slow graph costs silence, never a wait).
 * Silent when nothing resolves and when the MCP is down; prints one `[graph-recall] mcp down, next: <command>` line
 * only when graph-ensure-mcp.mjs recorded a real DOWN verdict this session (its state file), never while it is starting.
 * Fail OPEN: any own error prints one "[graph-recall] off: <reason>" line and exits 0 (exit 2 would veto the prompt).
 * Canary: graphRecall.test.mjs.
 */
import { readFileSync } from "node:fs";
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
  for (const m of rest.matchAll(/\b[\w.-]+(?:\/[\w.-]+)+\.\w{1,5}\b/g)) add(m[0]);            // a/b/c.ts
  for (const m of rest.matchAll(/\b[\w-]+\.(?:mjs|cjs|js|ts|tsx|jsx|py|ps1|md|json|sql|toml|yml|yaml)\b/g)) add(m[0]); // merge-gate.mjs
  for (const m of rest.matchAll(/\b[a-z][a-z0-9]*[A-Z]\w*\b|\b[A-Z][a-z0-9]+[A-Z]\w*\b/g)) add(m[0]);   // camelCase, PascalCase
  for (const m of rest.matchAll(/\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g)) add(m[0]);                   // snake_case
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

/** "Node: x()\n  Source: a/b.ts L75\n  Community: c" -> { label, file, line, community } or null. */
export function parseNode(text) {
  const label = /^Node: (.+)$/m.exec(text)?.[1]?.trim();
  const src = /^\s*Source: (\S+) L(\d+)/m.exec(text);
  const community = /^\s*Community: (.+)$/m.exec(text)?.[1]?.trim();
  return label && src ? { label, file: src[1], line: Number(src[2]), community: community ?? "?" } : null;
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
  const nodes = await Promise.all(symbols.map((s, i) => quiet(rpc(target, { jsonrpc: "2.0", id: 10 + i, method: "tools/call", params: { name: "get_node", arguments: { label: s } } }, deadline, sid)).then((r) => parseNode(resultText(r)))));
  const hits = nodes.filter(Boolean);
  const neighbors = await Promise.all(hits.map((n, i) => quiet(rpc(target, { jsonrpc: "2.0", id: 100 + i, method: "tools/call", params: { name: "get_neighbors", arguments: { label: n.label } } }, deadline, sid)).then((r) => parseCallers(resultText(r)))));
  return hits.map((n, i) => `[graph-recall] ${n.label} -> ${n.file}:${n.line} · community ${n.community}${neighbors[i]?.length ? ` · callers: ${neighbors[i].join(", ")}` : ""}`);
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
  if (scope >= 0 && argv[scope + 1] === "global" && projectAlreadyRuns(root)) return;
  const { prompt } = readInput(argv, root);
  const text = String(prompt).trim();
  if (text.length < MIN_PROMPT_CHARS || /^\/\S+(\s|$)/.test(text) && text.split(/\s+/).length <= 2) return;
  const symbols = candidates(text);
  if (!symbols.length) return;
  const cfg = argv.indexOf("--config");
  const target = loadUrl(cfg >= 0 ? resolve(argv[cfg + 1]) : join(REPO, "config", "agent-os", "local-services.json"));
  let lines;
  try {
    lines = await recall(target, symbols);
  } catch (err) {
    const down = err?.code === "ECONNREFUSED" ? downVerdict() : null;
    if (down) process.stdout.write(`[graph-recall] mcp down, next: ${down.next ?? "node scripts/agent-os/graph-ensure-mcp.mjs"}\n`);
    return;
  }
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
}

main()
  .catch((err) => process.stdout.write(`[graph-recall] off: ${String(err?.message || err).split(/\r?\n/)[0]}\n`))
  .then(() => process.exit(0));
