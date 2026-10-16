#!/usr/bin/env node
/**
 * Persist before compaction, recall after it (PreCompact + SessionStart[compact]).
 *
 * WHY (2026-10-16, GitHub scout, mechanism taken from affaan-m/ECC: "Optimize the
 * context window. Persist everything else."). This repo re-arms the always-on skills
 * AFTER a compaction (the machine-local SessionStart hook), but nothing captured the
 * session's working state BEFORE it: branch, HEAD, lease, dirty files, recent
 * commits. After a compaction the model holds only a prose summary of those facts
 * and re-derives them with tool calls, or worse, remembers them wrong.
 *
 * Two modes, one script, both informational (a hook here never blocks):
 *
 *   node scripts/agent-os/precompact-handoff.mjs            # PreCompact: write the note
 *   node scripts/agent-os/precompact-handoff.mjs --recall   # SessionStart (matcher "compact"): print it
 *
 * The note is written OUTSIDE the repo (default ~/.claude/agent-os/handoffs/<cwd slug>/,
 * override with AGENT_OS_HANDOFF_DIR) so it never dirties the tree that
 * stop-check.mjs judges, and never rides into a commit. The newest 10 notes per
 * checkout are kept. Recall prints the newest note for this cwd, capped at
 * RECALL_CAP characters (ECC caps SessionStart context at 8,000; half of that is
 * plenty for facts), and prints nothing unless the SessionStart source is "compact".
 *
 * Canary: precompactHandoff.test.mjs (writes to a scratch repo, breaks each arm).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";
import { readLocalMarker } from "./local-lease-marker.mjs";

export const RECALL_CAP = 4000;
export const KEEP = 10;

export function handoffDir(cwd, env = process.env) {
  const base = env.AGENT_OS_HANDOFF_DIR || join(homedir(), ".claude", "agent-os", "handoffs");
  const slug = resolve(cwd).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return join(base, slug);
}

function git(args, cwd) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: stripGitLocalEnv(), timeout: 5000 });
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Build the note from git facts. Pure except for the git reads; never throws. */
export function buildNote({ cwd, sessionId = "unknown", trigger = "unknown", now = new Date() }) {
  const lines = [`# Handoff written before compaction · ${now.toISOString()} · session ${String(sessionId).slice(0, 8)} · trigger ${trigger}`, "", `- cwd: ${cwd}`];
  const inside = git(["rev-parse", "--is-inside-work-tree"], cwd);
  if (inside !== "true") {
    lines.push("- git: not a git checkout (nothing else to record)");
    return lines.join("\n") + "\n";
  }
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], cwd) ?? "unknown";
  const head = git(["log", "-1", "--format=%h %s"], cwd) ?? "unknown";
  lines.push(`- branch: ${branch}`, `- HEAD: ${head}`);
  const counts = git(["rev-list", "--left-right", "--count", "origin/main...HEAD"], cwd);
  if (counts) {
    const [behind, ahead] = counts.split(/\s+/);
    lines.push(`- vs origin/main: ${ahead} ahead, ${behind} behind (local ref; fetch before trusting)`);
  }
  let marker = null;
  try {
    marker = readLocalMarker(cwd);
  } catch {
    marker = null;
  }
  lines.push(marker ? `- lease: "${marker.branch}" until ${marker.expiresAt ?? "unknown"} (session ${String(marker.sessionId ?? "").slice(0, 8)})` : "- lease: none held for this worktree");
  const dirty = (git(["status", "--porcelain"], cwd) ?? "").split("\n").filter(Boolean);
  lines.push(`- uncommitted: ${dirty.length} path(s)${dirty.length ? ":" : ""}`);
  for (const d of dirty.slice(0, 30)) lines.push(`  ${d}`);
  if (dirty.length > 30) lines.push(`  ... ${dirty.length - 30} more`);
  const recent = (git(["log", "-5", "--format=%h %s"], cwd) ?? "").split("\n").filter(Boolean);
  lines.push("- last 5 commits:");
  for (const c of recent) lines.push(`  ${c}`);
  lines.push("", "Resume: re-read this note, confirm the branch and any open PR for it with git and gh, then continue the task list; the always-on skills are re-armed by the global SessionStart hook, not by this note.");
  return lines.join("\n") + "\n";
}

export function writeNote({ cwd, sessionId, trigger, env = process.env, now = new Date() }) {
  const dir = handoffDir(cwd, env);
  mkdirSync(dir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `${stamp}-${String(sessionId ?? "unknown").slice(0, 8).replace(/[^A-Za-z0-9]/g, "") || "unknown"}.md`);
  writeFileSync(file, buildNote({ cwd, sessionId, trigger, now }));
  prune(dir);
  return file;
}

export function prune(dir, keep = KEEP) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(dir, f));
}

export function newestNote(cwd, env = process.env) {
  const dir = handoffDir(cwd, env);
  if (!existsSync(dir)) return null;
  const files = readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  if (!files.length) return null;
  const file = join(dir, files[files.length - 1]);
  return { file, text: readFileSync(file, "utf8"), mtime: statSync(file).mtime };
}

export function recallText(cwd, env = process.env, cap = RECALL_CAP) {
  const note = newestNote(cwd, env);
  if (!note) return "[agent-os] no pre-compaction handoff for this checkout (the PreCompact hook did not run, or this is a fresh checkout).";
  const body = note.text.length > cap ? `${note.text.slice(0, cap)}\n... [truncated at ${cap} chars; full note at ${note.file}]` : note.text;
  return `[agent-os] handoff written before the last compaction (${note.file}):\n${body}`;
}

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

export function main(argv = process.argv.slice(2), stdinText = readStdin(), env = process.env, out = console.log) {
  let payload = {};
  try {
    payload = JSON.parse(stdinText || "{}") || {};
  } catch {
    payload = {};
  }
  const cwd = payload.cwd && existsSync(payload.cwd) ? payload.cwd : process.cwd();
  if (argv.includes("--recall")) {
    if ((payload.source ?? "compact") !== "compact") return 0; // other SessionStart sources: say nothing
    out(recallText(cwd, env));
    return 0;
  }
  try {
    const file = writeNote({ cwd, sessionId: payload.session_id, trigger: payload.trigger, env });
    out(`[agent-os] handoff written before compaction: ${file}`);
  } catch (err) {
    out(`[agent-os] handoff NOT written (${err.message}); compaction proceeds, resume from git state.`);
  }
  return 0; // a hook here informs, never blocks
}

if (process.argv[1] && /precompact-handoff\.mjs$/.test(process.argv[1].replace(/\\/g, "/"))) {
  process.exit(main());
}
