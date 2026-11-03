#!/usr/bin/env node
/**
 * mcp-adapters: generate the program-side MCP files from config/agent-os/local-services.json, and check they match.
 *
 *   node scripts/agent-os/mcp-adapters.mjs --write    (re)write the five files below
 *   node scripts/agent-os/mcp-adapters.mjs --check    exit 1 and name each file that is MISSING or has DRIFTed
 *   --root <dir>                                      another checkout or a fixture (tests)
 *
 * One source, five readers (job 2026-11-03-graphify-always-on, Nour: "make it global so no matter what account or
 * program i use no context is lost"). Each shape is the program's documented one, read on its primary docs page on
 * 2026-11-03 (URLs in the PR body of chore/graphify-always-on):
 *   .mcp.json             Claude Code project scope: {"mcpServers":{<name>:{"type":"http","url"}}}; approved once per
 *                         user in an interactive session (`claude mcp reset-project-choices` resets)
 *   .codex/config.toml    Codex: [mcp_servers.<name>] url = "..."; read for trusted projects only
 *   .cursor/mcp.json      Cursor: {"mcpServers":{<name>:{"url"}}} (a remote server has url, no type)
 *   .gemini/settings.json Gemini CLI: {"mcpServers":{<name>:{"httpUrl"}}} (httpUrl = streamable HTTP; url would mean SSE)
 *   .vscode/mcp.json      VS Code: {"servers":{<name>:{"type":"http","url"}}} (servers, not mcpServers)
 * The URL is http://127.0.0.1:<port><path>, so every program reaches the same shared server on this machine; on another
 * machine the file is harmless until that machine serves the graph (the [health] line says which). No token: the
 * server is loopback-only. check-adapters.mjs (pnpm agent:parity, lefthook pre-commit, CI) runs the drift check.
 * Canary: mcpAdapters.test.mjs.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const json = (o) => `${JSON.stringify(o, null, 2)}\n`;

/** A JSON object parsed from `text`, or {} when the text is missing or not an object (a broken file is regenerated). */
const objectOf = (text) => { try { const v = JSON.parse(text ?? ""); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };

/**
 * { "<relative path>": "<exact file text>" } for every server in the config, MERGED into `existing` (file -> current
 * text): only the MCP entries this config owns are written; a user's other keys (Gemini theme, Codex model, another
 * server) stay as they are (round-2 reader: the first draft owned the whole file and --write deleted them).
 */
export function renderAdapters(config, existing = {}) {
  const servers = (config.servers ?? []).filter((s) => Number.isInteger(s.port) && /^\//.test(s.path ?? ""));
  if (!servers.length) throw new Error("local-services.json: no servers");
  const url = (s) => `http://127.0.0.1:${s.port}${s.path}`;
  const mergeJson = (file, key, entry) => {
    const o = objectOf(existing[file]);
    const sub = o[key] && typeof o[key] === "object" && !Array.isArray(o[key]) ? o[key] : {};
    return json({ ...o, [key]: { ...sub, ...Object.fromEntries(servers.map((s) => [s.name, entry(url(s))])) } });
  };
  const toml = () => {
    let text = (existing[".codex/config.toml"] ?? "").replace(/\r\n/g, "\n");
    for (const s of servers) {
      const table = `[mcp_servers.${s.name}]\nurl = "${url(s)}"\n`;
      // Replace this server's table (header to the next header or EOF), else append it.
      const re = new RegExp(`^\\[mcp_servers\\.${s.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\n(?:(?!\\[)[^\\n]*\\n?)*`, "m");
      text = re.test(text) ? text.replace(re, table) : `${text}${text && !text.endsWith("\n") ? "\n" : ""}${text ? "\n" : ""}${table}`;
    }
    return text;
  };
  return {
    ".mcp.json": mergeJson(".mcp.json", "mcpServers", (u) => ({ type: "http", url: u })),
    ".codex/config.toml": toml(),
    ".cursor/mcp.json": mergeJson(".cursor/mcp.json", "mcpServers", (u) => ({ url: u })),
    ".gemini/settings.json": mergeJson(".gemini/settings.json", "mcpServers", (u) => ({ httpUrl: u })),
    ".vscode/mcp.json": mergeJson(".vscode/mcp.json", "servers", (u) => ({ type: "http", url: u })),
  };
}

const FILES = [".mcp.json", ".codex/config.toml", ".cursor/mcp.json", ".gemini/settings.json", ".vscode/mcp.json"];

/** [{ file, state: ok|MISSING|DRIFT, want }] for a checkout root; `want` is the merged text --write would put there. */
export function adapterDrift(root) {
  const config = JSON.parse(readFileSync(join(root, "config", "agent-os", "local-services.json"), "utf8"));
  const existing = Object.fromEntries(FILES.map((f) => [f, existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8").replace(/\r\n/g, "\n") : null]));
  return Object.entries(renderAdapters(config, existing)).map(([file, want]) => {
    if (existing[file] === null) return { file, state: "MISSING", want };
    return { file, state: existing[file] === want ? "ok" : "DRIFT", want };
  });
}

function main(argv) {
  const i = argv.indexOf("--root");
  const root = i >= 0 ? resolve(argv[i + 1]) : REPO;
  const items = adapterDrift(root);
  if (argv.includes("--write")) {
    for (const it of items) {
      if (it.state !== "ok") { mkdirSync(dirname(join(root, it.file)), { recursive: true }); writeFileSync(join(root, it.file), it.want); }
      process.stdout.write(`[mcp-adapters] ${it.state === "ok" ? "ok     " : "written"} ${it.file}\n`);
    }
    return 0;
  }
  for (const it of items) process.stdout.write(`[mcp-adapters] ${it.state.padEnd(7)} ${it.file}\n`);
  const bad = items.filter((it) => it.state !== "ok").length;
  if (bad) process.stdout.write(`[mcp-adapters] ${bad} file(s) out of step with config/agent-os/local-services.json: run node scripts/agent-os/mcp-adapters.mjs --write\n`);
  return bad ? 1 : 0;
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

if (isEntry()) process.exitCode = main(process.argv.slice(2));
