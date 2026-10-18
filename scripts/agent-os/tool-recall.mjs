#!/usr/bin/env node
/**
 * tool-recall: name the MCP servers, plugins, lane agents and CLIs a prompt should use, the way skill-recall names skills.
 *
 * UserPromptSubmit hook (stdin JSON with a `prompt` field) and a CLI, same input handling as skill-recall.mjs:
 *   node scripts/agent-os/tool-recall.mjs --text "<prompt>"     one-line prompt
 *   node scripts/agent-os/tool-recall.mjs --file <path>         a brief or any text file (template boilerplate dropped)
 *   add --json for the scores. TOOL_RECALL_REGISTRY=<file> swaps the registry (tests, mutants).
 *
 * Registry: config/agent-os/tool-recall.json, resolved from this file's own location, read fresh every prompt (about
 * twenty entries: no cache, so an edit is never shadowed by a stale index).
 * Scoring: skill-recall.mjs's own score() and FLOOR (imported, not forked): `triggers` and the name carry the name
 * boost, `use` is the body, and the two-term minimum applies. Term statistics come from the registry itself.
 * Floor measured 2026-10-18 against this script (--json): the three positive controls score serena 36.2, perplexity-
 * in-chrome 26.4, context7 18.5; "asdf qwerty" scores nothing; the near miss "the root cause" (two sentry body words
 * only) scores 5.0, under FLOOR 7.5. skill-recall's floor fits as is.
 * Output: at most MAX_LINES "[tool-recall] use: <name> (<kind>; <matched words>) <use>" lines, " [native: <skill>]"
 * appended when a repo skill already does the job. No match prints NOTHING: the per-turn context stays small.
 *
 * Fail OPEN: any error prints one "[tool-recall] off: <reason>" line and exits 0. Exit 2 would veto the prompt; this
 * file has no path to it. Canary: toolRecall.test.mjs.
 */
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOOR, readInput, score, tokens } from "./skill-recall.mjs";

const MAX_LINES = 4;
const KINDS = new Set(["mcp", "plugin", "agent", "cli"]);
const REGISTRY = process.env.TOOL_RECALL_REGISTRY || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "config", "agent-os", "tool-recall.json");

function loadRegistry(file) {
  let list;
  try {
    list = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`registry ${basename(file)}: ${err.code || `bad JSON (${err.message})`}`);
  }
  if (!Array.isArray(list)) throw new Error("registry is not a JSON array");
  list.forEach((e, i) => {
    for (const k of ["name", "use", "triggers"]) if (typeof e?.[k] !== "string" || !e[k].trim()) throw new Error(`registry entry ${i}: no ${k}`);
    if (!KINDS.has(e.kind)) throw new Error(`registry entry ${i} (${e.name}): kind must be mcp, plugin, agent or cli`);
  });
  return list;
}

/** The index shape score() reads, built the way skill-recall builds a skill entry. */
function buildIndex(list) {
  const entries = list.map((e) => {
    const realName = tokens(e.name.replace(/[:-]/g, " "));
    return { name: e.name, kind: e.kind, realName, nameTokens: [...realName, ...tokens(e.triggers)], bodyTokens: tokens(e.use) };
  });
  const df = {};
  for (const e of entries) for (const t of new Set([...e.nameTokens, ...e.bodyTokens])) df[t] = (df[t] || 0) + 1;
  const avgLen = entries.reduce((n, e) => n + e.bodyTokens.length, 0) / Math.max(1, entries.length);
  return { entries, df, avgLen, N: entries.length };
}

function main() {
  const argv = process.argv.slice(2);
  const list = loadRegistry(REGISTRY);
  const { prompt, json } = readInput(argv, resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd()));
  const ranked = score(buildIndex(list), prompt);
  const picked = ranked.filter((r) => r.score >= FLOOR).slice(0, MAX_LINES);
  if (json) {
    process.stdout.write(JSON.stringify({ floor: FLOOR, picked, ranked: ranked.slice(0, 10) }, null, 2) + "\n");
    return;
  }
  const byName = new Map(list.map((e) => [e.name, e]));
  const lines = picked.map((r) => {
    const e = byName.get(r.name);
    return `[tool-recall] use: ${r.name} (${r.kind}; ${r.hits.slice(0, 4).join(", ")}) ${e.use}${e.native ? ` [native: ${e.native}]` : ""}`;
  });
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
}

try {
  main();
} catch (err) {
  process.stdout.write(`[tool-recall] off: ${String(err?.message || err).split(/\r?\n/)[0]}\n`);
}
process.exitCode = 0;
