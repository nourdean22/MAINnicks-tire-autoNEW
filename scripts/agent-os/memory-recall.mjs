#!/usr/bin/env node
/**
 * memory-recall: name the agent-memory notes a prompt should read first, the way skill-recall names skills and
 * tool-recall names tools. The index in MEMORY.md is a list of titles; this hook searches the notes themselves.
 *
 * UserPromptSubmit hook (stdin JSON with a `prompt` field) and a CLI, same input handling as skill-recall.mjs:
 *   node scripts/agent-os/memory-recall.mjs --text "<prompt>"     one-line prompt
 *   node scripts/agent-os/memory-recall.mjs --file <path>         a brief or any text file (template boilerplate dropped)
 *   add --json for the scores and the index size. MEMORY_RECALL_DIR=<dir> swaps the memory directory (tests, mutants).
 *
 * Index: every `<memory dir>/*.md` note that has a frontmatter `description`, read fresh each prompt (about seventy
 * small files, a few milliseconds: no cache, so a note saved a minute ago is searchable now). Skipped: MEMORY.md and
 * settled-index.md (the indexes), `_bak_*` copies, and any file without a description. The directory is the same one
 * check-memory-index.mjs guards: `~/.claude/projects/<slug of the PRIMARY checkout>/memory`, derived through
 * `git --git-common-dir` so a harness worktree finds it too.
 * Scoring: skill-recall.mjs's own score() and FLOOR (imported, not forked): the note's file name carries the name boost,
 * its description is the body, and the two-term minimum applies.
 * Output: at most MAX_LINES "[memory-recall] read: <file> (<matched words>) <description> [<N>d old]" lines. The age
 * is the file's modified time, so a stale note reads as stale (memory is a point-in-time observation: verify first).
 * No match prints NOTHING, and neither does a missing directory: the notes are machine-local, so a cloud session or a
 * second machine has none, and check-memory-index.mjs is what reports that on the machine that should have them.
 *
 * Fail OPEN: any error prints one "[memory-recall] off: <reason>" line and exits 0. Exit 2 would veto the prompt; this
 * file has no path to it. Canary: memoryRecall.test.mjs.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FLOOR, readInput, score, tokens } from "./skill-recall.mjs";

const MAX_LINES = 3;
const DESC_MAX = 110;
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The primary checkout's root: agent memory is keyed to it, not to a harness worktree (see check-memory-index.mjs). */
function primaryRoot(fallback) {
  try {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
    const out = execFileSync("git", ["-C", fallback, "rev-parse", "--path-format=absolute", "--git-common-dir"], {
      encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out) return dirname(out);
  } catch {
    // not a git checkout, or git missing: the fallback names a directory that may not exist, which is silent below
  }
  return fallback;
}

const memoryDir = () => process.env.MEMORY_RECALL_DIR || join(homedir(), ".claude", "projects", primaryRoot(REPO_ROOT).replace(/[\\/:]/g, "-"), "memory");

/** `name` and `description` from the leading `---` block; null when the note has no description. */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const field = (k) => {
    const v = new RegExp(`^${k}:[ \\t]*(.*)$`, "m").exec(m[1])?.[1].trim() ?? "";
    return v.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
  };
  const description = field("description");
  return description ? { description } : null;
}

function loadNotes(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "MEMORY.md" && f !== "settled-index.md" && !f.startsWith("_bak_"));
  const notes = [];
  for (const file of files) {
    const path = join(dir, file);
    const fm = frontmatter(readFileSync(path, "utf8"));
    if (fm) notes.push({ file, name: file.replace(/\.md$/, ""), description: fm.description, mtime: statSync(path).mtimeMs });
  }
  return notes;
}

/** The index shape score() reads, built the way tool-recall builds a registry entry. */
function buildIndex(notes) {
  const entries = notes.map((n) => {
    const realName = tokens(n.name.replace(/[:-]/g, " "));
    return { name: n.name, realName, nameTokens: realName, bodyTokens: tokens(n.description) };
  });
  const df = {};
  for (const e of entries) for (const t of new Set([...e.nameTokens, ...e.bodyTokens])) df[t] = (df[t] || 0) + 1;
  const avgLen = entries.reduce((n, e) => n + e.bodyTokens.length, 0) / Math.max(1, entries.length);
  return { entries, df, avgLen, N: entries.length };
}

const clip = (s) => (s.length <= DESC_MAX ? s : `${s.slice(0, s.lastIndexOf(" ", DESC_MAX) > 0 ? s.lastIndexOf(" ", DESC_MAX) : DESC_MAX)}...`);

function main() {
  const argv = process.argv.slice(2);
  const { prompt, json } = readInput(argv, resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd()));
  const dir = memoryDir();
  if (!existsSync(dir)) return;
  const notes = loadNotes(dir);
  const ranked = score(buildIndex(notes), prompt);
  const picked = ranked.filter((r) => r.score >= FLOOR).slice(0, MAX_LINES);
  if (json) {
    process.stdout.write(JSON.stringify({ dir, count: notes.length, floor: FLOOR, picked, ranked: ranked.slice(0, 10) }, null, 2) + "\n");
    return;
  }
  const byName = new Map(notes.map((n) => [n.name, n]));
  const lines = picked.map((r) => {
    const n = byName.get(r.name);
    const age = Math.max(0, Math.floor((Date.now() - n.mtime) / 86_400_000));
    return `[memory-recall] read: ${n.file} (${r.hits.slice(0, 4).join(", ")}) ${clip(n.description)} [${age}d old]`;
  });
  if (lines.length) process.stdout.write(lines.join("\n") + "\n");
}

try {
  main();
} catch (err) {
  process.stdout.write(`[memory-recall] off: ${String(err?.message || err).split(/\r?\n/)[0]}\n`);
}
process.exitCode = 0;
