/**
 * The CONFIGURED hook commands must run on every platform sessions run on.
 *
 * WHY THIS FILE EXISTS (2026-09-23). `.claude/settings.json` invoked every node
 * hook as `node "${CLAUDE_PROJECT_DIR}\scripts\agent-os\<x>.mjs"`. On Windows
 * that resolves; on Linux (every Claude Code cloud session) it is one filename
 * containing backslashes, node exits 1 with MODULE_NOT_FOUND, and a hook that
 * errors fails OPEN. So all 13 PreToolUse rules were off in cloud sessions: a
 * `git stash pop` and a force-push ran there without a denial. The policy was
 * fine (`pretool.mjs` via a `/` path exits 2 on the same payload); the command
 * string that calls it was not.
 *
 * Nothing caught it because the canary that runs a configured hook command
 * (memoryHook.test.mjs) normalised the backslashes before running it. That
 * made the test green on Linux CI while the real command failed on Linux.
 *
 * So this file runs each node hook's command string VERBATIM through a shell,
 * with CLAUDE_PROJECT_DIR in the environment, the way the harness does, and
 * asserts on exit codes AND the rule id (guard-red-team: a nonzero exit alone
 * is not proof of a deny).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));

/** Every configured command hook, tagged with its event. */
const hooks = Object.entries(settings.hooks ?? {}).flatMap(([event, groups]) =>
  groups.flatMap((g) => (g.hooks ?? []).filter((h) => h.type === "command").map((h) => ({ event, command: h.command }))),
);
const nodeHooks = hooks.filter((h) => /^node\s/.test(h.command));

/** Run a configured command as the harness does. Hook env carries no GIT_* (guard-red-team rule 5). */
function runHook(command, stdin) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  env.CLAUDE_PROJECT_DIR = ROOT;
  // cmd.exe does not expand ${VAR}; on Windows expand it here and let node
  // resolve the path. POSIX shells expand it themselves, as the harness relies on.
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : command;
  const r = spawnSync(cmd, { shell: process.platform === "win32" ? true : "/bin/sh", input: stdin, encoding: "utf8", cwd: ROOT, env, timeout: 20000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("there are node hooks to check (the scan found its subject)", () => {
  for (const event of ["PreToolUse", "Stop"]) {
    assert.ok(nodeHooks.some((h) => h.event === event), `no node ${event} hook found in .claude/settings.json`);
  }
});

test("no node hook path uses a backslash separator (it does not resolve on Linux)", () => {
  const bad = nodeHooks.filter((h) => h.command.includes("\\"));
  assert.deepEqual(bad.map((h) => `${h.event}: ${h.command}`), []);
});

test("every node hook LAUNCHES as configured (no MODULE_NOT_FOUND)", () => {
  for (const h of nodeHooks) {
    const r = runHook(h.command, "{}");
    assert.doesNotMatch(r.out, /Cannot find module|MODULE_NOT_FOUND/, `${h.event} hook did not launch: ${h.command}\n${r.out}`);
  }
});

test("BREAKS: the configured PreToolUse hook DENIES a policy command, naming the rule", () => {
  const pre = nodeHooks.find((h) => h.event === "PreToolUse" && h.command.includes("pretool.mjs"));
  assert.ok(pre, "no pretool.mjs PreToolUse hook configured");
  const r = runHook(pre.command, JSON.stringify({ tool_name: "Bash", tool_input: { command: "git stash pop" } }));
  assert.equal(r.code, 2, `expected a deny (exit 2), got ${r.code}\n${r.out}`);
  assert.match(r.out, /stash-pop/, "the deny must name the rule, or it may be some other failure");
});

test("control: the same configured hook ALLOWS a harmless command", () => {
  const pre = nodeHooks.find((h) => h.event === "PreToolUse" && h.command.includes("pretool.mjs"));
  const r = runHook(pre.command, JSON.stringify({ tool_name: "Bash", tool_input: { command: "git status" } }));
  assert.equal(r.code, 0, `a harmless command was not allowed (exit ${r.code})\n${r.out}`);
});
