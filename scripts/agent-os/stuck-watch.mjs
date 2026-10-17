#!/usr/bin/env node
/**
 * Loop watchdog (job 2026-10-16-session-workflow-upgrade; Deep scout v2 item 3, after OpenHands'
 * conversation/stuck_detector.py). Lanes looped on one failing action (identical command, identical
 * failure) until their tool budget ran out.
 *
 *   PostToolUse  node stuck-watch.mjs --post   records (tool + input, result) per agent, the input without its prose
 *                                              (`description`, `action_summary`) and `timeout`; when the same pair
 *                                              repeats on an unchanged tree, the 3rd and 4th time nudge (exit 2:
 *                                              stderr reaches the model, the tool has already run)
 *   PostToolUseFailure  (same --post)          a failed call (non-zero Bash exit) fires this event, not PostToolUse;
 *                                              its result is the payload's `error` string
 *   PreToolUse   node stuck-watch.mjs --pre    the 5th identical call on an unchanged tree is DENIED (exit 2), except
 *                                              read-only polling (Read, Grep, Glob, an unchained gh or curl): nudge only
 * A call denied before it runs (any PreToolUse deny) fires neither post event, so it is not counted.
 *
 * Any different call, a different result, or a changed tree (HEAD or `git status`) resets the streak.
 * The tree is read only for a repeat, so a normal call costs one small file read.
 * State is machine-local: %LOCALAPPDATA%/nourcity/stuck/<agent_id or session_id>.json (STUCK_WATCH_DIR overrides);
 * keyed on agent_id first so parallel lanes in one session do not reset each other.
 * FAILURE POSTURE: like pretool.mjs, a bug here fails OPEN (exit 0). Canary: stuck-watch.test.mjs.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const NUDGE_AT = 3;
const DENY_AT = 5;
// Repetition is the mechanism of these: polling, waiting, bookkeeping.
const EXEMPT = new Set(["Monitor", "TaskOutput", "BashOutput", "TaskStop", "ScheduleWakeup", "TodoWrite", "ToolSearch", "Skill"]);
const EXEMPT_RE = /^mcp__ccd_(turn|session)__/;
// Read-only polling (a CI check, a task output file): repeats are nudged but never denied.
const NUDGE_ONLY = new Set(["Read", "Grep", "Glob"]);
const isPolling = (tool, input) =>
  NUDGE_ONLY.has(tool) ||
  ((tool === "Bash" || tool === "PowerShell") && /^\s*(?:gh|curl)\s/.test(String(input?.command ?? "")) && !/[;&|\n]/.test(String(input?.command)));

const hash = (v) => createHash("sha1").update(typeof v === "string" ? v : JSON.stringify(v ?? null)).digest("hex").slice(0, 16);
const stateDir = () =>
  process.env.STUCK_WATCH_DIR || join(process.env.LOCALAPPDATA || join(homedir(), ".local", "state"), "nourcity", "stuck");

function treeState(cwd) {
  const git = (args) => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 4000 }).stdout ?? "";
  return hash(git(["rev-parse", "HEAD"]) + git(["status", "--porcelain"]));
}

function main(mode) {
  let payload;
  try {
    payload = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  const session = String(payload.agent_id ?? payload.session_id ?? "").replace(/[^\w.-]/g, "");
  const tool = payload.tool_name;
  if (!session || !tool || EXEMPT.has(tool) || EXEMPT_RE.test(tool)) return 0;
  const cwd = payload.cwd || process.cwd();
  const file = join(stateDir(), `${session}.json`);
  let last = {};
  try {
    last = JSON.parse(readFileSync(file, "utf8"));
  } catch {}
  // The key is what the call DOES. The model rewrites its prose (`description`, a browser tool's `action_summary`) and
  // `timeout` on every retry, so hashing them scored 5 identical failing commands as streak 1 each (live, 2026-10-17).
  const { description, action_summary, timeout, ...meaningful } = payload.tool_input ?? {};
  const key = hash([tool, meaningful]);

  if (mode === "--pre") {
    if (last.key !== key || last.streak < DENY_AT - 1 || isPolling(tool, payload.tool_input) || treeState(cwd) !== last.tree) return 0;
    process.stderr.write(
      `[stuck-watch] DENIED: this is the ${DENY_AT}th identical ${tool} call with the same result on an unchanged tree. ` +
        "Same action, same result: change approach (read the error, test a different hypothesis, or report the blocker). " +
        "Any edit, a different call, or a different result resets this.\n",
    );
    return 2;
  }

  // A failed call (PostToolUseFailure) has no tool_response; its result is the error. Neither present: not judged.
  const failed = payload.hook_event_name === "PostToolUseFailure" || (payload.tool_response === undefined && payload.error !== undefined);
  if (!failed && payload.tool_response === undefined) return 0;
  // Durations and timestamps change on every rerun of an identical failure (vitest's "Duration 3.21s"); drop them.
  const result = hash(
    JSON.stringify(failed ? { error: payload.error } : payload.tool_response)
      .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/g, "<ts>")
      .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s|sec|seconds)\b/g, "<dur>"),
  );
  let next = { key, result, streak: 1 };
  if (last.key === key && last.result === result) {
    const tree = treeState(cwd);
    next = { key, result, tree, streak: last.tree === undefined || last.tree === tree ? last.streak + 1 : 1 };
  }
  mkdirSync(stateDir(), { recursive: true });
  writeFileSync(file, JSON.stringify(next));
  if (next.streak >= NUDGE_AT) {
    process.stderr.write(
      `[stuck-watch] same action, same result ${next.streak} times on an unchanged tree: change approach. ` +
        (isPolling(tool, payload.tool_input) ? "Polling is never denied: wait with Monitor instead.\n" : `The ${DENY_AT}th identical call will be denied.\n`),
    );
    return 2;
  }
  return 0;
}

try {
  process.exitCode = main(process.argv[2]);
} catch (err) {
  process.stderr.write(`[agent-os] stuck-watch error (allowing call): ${err?.message ?? err}\n`);
  process.exitCode = 0;
}
