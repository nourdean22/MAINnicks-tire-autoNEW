/**
 * The skills-first reminder must reach the model on every prompt, so it is a
 * UserPromptSubmit hook. This runs the CONFIGURED command verbatim through a
 * shell, the way the harness does (guard-red-team rule 5: the script alone is
 * not the wiring), and asserts on what the hook emits, not on its source.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));

function configuredReminder() {
  return (settings.hooks?.UserPromptSubmit ?? [])
    .flatMap((g) => g.hooks ?? [])
    .find((h) => h.type === "command" && h.command.includes("skills-first-reminder.mjs"));
}

/** Run a hook command as the harness does: shell, CLAUDE_PROJECT_DIR set, no GIT_* env. */
function runHook(command) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  env.CLAUDE_PROJECT_DIR = ROOT;
  const cmd = process.platform === "win32" ? command.replaceAll("${CLAUDE_PROJECT_DIR}", ROOT) : command;
  const r = spawnSync(cmd, {
    shell: process.platform === "win32" ? true : "/bin/sh",
    input: JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "probe" }),
    encoding: "utf8", cwd: ROOT, env, timeout: 15000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** The contract: one line, before any work, pointing at the [skill-recall] output (the matcher registered right after it). */
function assertReminds(r) {
  assert.equal(r.code, 0, `the hook must exit 0, it is advice and never a block:\n${r.out}`);
  assert.match(r.out, /\[skills-first\]/, "the reminder marker is missing");
  assert.match(r.out, /before any work/i, "the reminder must say when: before any work");
  assert.match(r.out, /invoke[\s\S]*\[skill-recall\]/, "the reminder must point at the [skill-recall] lines");
  assert.match(r.out, /\.claude\/skills\/.*account and plugin skills/i, "the reminder must still name the repo, account and plugin sources");
  assert.equal(r.out.trim().split(/\r?\n/).length, 1, "the reminder is one line; the matches come from skill-recall.mjs");
}

test("UserPromptSubmit registers the skills-first reminder", () => {
  assert.ok(configuredReminder(), "skills-first-reminder.mjs is not registered on UserPromptSubmit");
});

test("the configured path uses forward slashes and the project dir variable", () => {
  const hook = configuredReminder();
  assert.ok(hook, "skills-first-reminder.mjs is not registered on UserPromptSubmit");
  assert.doesNotMatch(hook.command, /\\/, "a backslash path does not resolve on Linux (cloud sessions)");
  assert.match(hook.command, /"\$\{CLAUDE_PROJECT_DIR\}\/scripts\/agent-os\/skills-first-reminder\.mjs"/);
});

test("the configured command runs verbatim and emits the reminder", () => {
  const hook = configuredReminder();
  assert.ok(hook, "skills-first-reminder.mjs is not registered on UserPromptSubmit");
  assertReminds(runHook(hook.command));
});

test("BREAKS: the same assertion fails for a missing script and for a silent hook", () => {
  const missing = runHook('node "${CLAUDE_PROJECT_DIR}/scripts/agent-os/no-such-reminder.mjs"');
  assert.throws(() => assertReminds(missing), /must exit 0/);
  const silent = runHook('node -e "process.exit(0)"');
  assert.throws(() => assertReminds(silent), /marker is missing/);
});
