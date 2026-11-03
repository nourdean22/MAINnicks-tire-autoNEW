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

/** { "<relative path>": "<exact file text>" } for every server in the config. */
export function renderAdapters(config) {
  const servers = (config.servers ?? []).filter((s) => Number.isInteger(s.port) && /^\//.test(s.path ?? ""));
  if (!servers.length) throw new Error("local-services.json: no servers");
  const url = (s) => `http://127.0.0.1:${s.port}${s.path}`;
  const by = (fn) => Object.fromEntries(servers.map((s) => [s.name, fn(url(s))]));
  return {
    ".mcp.json": json({ mcpServers: by((u) => ({ type: "http", url: u })) }),
    ".codex/config.toml": `${servers.map((s) => `[mcp_servers.${s.name}]\nurl = "${url(s)}"\n`).join("\n")}`,
    ".cursor/mcp.json": json({ mcpServers: by((u) => ({ url: u })) }),
    ".gemini/settings.json": json({ mcpServers: by((u) => ({ httpUrl: u })) }),
    ".vscode/mcp.json": json({ servers: by((u) => ({ type: "http", url: u })) }),
  };
}

/** [{ file, state: ok|MISSING|DRIFT }] for a checkout root. */
export function adapterDrift(root) {
  const config = JSON.parse(readFileSync(join(root, "config", "agent-os", "local-services.json"), "utf8"));
  return Object.entries(renderAdapters(config)).map(([file, want]) => {
    const at = join(root, file);
    if (!existsSync(at)) return { file, state: "MISSING", want };
    return { file, state: readFileSync(at, "utf8").replace(/\r\n/g, "\n") === want ? "ok" : "DRIFT", want };
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
