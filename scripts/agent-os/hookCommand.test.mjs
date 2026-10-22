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
import { spawnSync, execSync } from "node:child_process";
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

// 2026-10-19: Windows PowerShell 5.1 on NATTYNOUR has every execution-policy scope Undefined (= Restricted), so a
// hook running a .ps1 without -ExecutionPolicy Bypass dies with "running scripts is disabled" and prints nothing the
// model sees: the graphify briefing was silently off in every session. Mention vs execution: only a command that
// LAUNCHES powershell on a script counts, so a node hook that merely names a .ps1 is not flagged. The predicate is
// session-health.mjs's own, imported, so the canary and the [health] line cannot disagree (review 2026-10-19).
const { hookNeedsBypass } = await import("./session-health.mjs");
const PS_SUBJECT = /powershell[^\n]*\.ps1/i;
const blockedPs = (commands) => commands.filter(hookNeedsBypass);

test("every PowerShell hook that runs a .ps1 carries -ExecutionPolicy Bypass (the scan found its subject)", () => {
  const ps = hooks.filter((h) => PS_SUBJECT.test(h.command));
  assert.ok(ps.length >= 1, "no PowerShell script hook found: the scan has no subject");
  assert.deepEqual(blockedPs(ps.map((h) => h.command)), []);
});

test("BREAKS: the Bypass check flags the 2026-10-19 hook string and passes its fixed form and a node hook", () => {
  const old = 'powershell -NoProfile -File "${CLAUDE_PROJECT_DIR}\\scripts\\graphify-session-context.ps1"';
  const fixed = 'powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PROJECT_DIR}\\scripts\\graphify-session-context.ps1"';
  assert.deepEqual(blockedPs([old]), [old], "the pre-fix string must be flagged");
  assert.deepEqual(blockedPs([fixed, 'node "x/check.mjs" --script a.ps1']), []);
  const after = 'powershell -NoProfile -File "C:/x/h.ps1" -ExecutionPolicy Bypass';
  assert.deepEqual(blockedPs([after]), [after], "a policy AFTER -File is a script argument and does not count");
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

test("Session Authority (2026-09-23): the configured lease-check.mjs BLOCKS on a foreign unexpired marker, via its exact command string", async (t) => {
  const check = nodeHooks.find((h) => h.event === "PreToolUse" && h.command.includes("lease-check.mjs"));
  if (!check) return t.skip("lease-check.mjs not yet configured in .claude/settings.json");

  // This runs against THIS repo's real .git directory (hookCommand.test.mjs's
  // whole point is proving the CONFIGURED command against CLAUDE_PROJECT_DIR=ROOT)
  // — so the fixture marker is written and ALWAYS removed via t.after(), restoring
  // whatever was there before, regardless of assertion outcome. Never leaves a
  // foreign marker behind to spuriously block a real later tool call this session.
  const { writeLocalMarker, readLocalMarker, clearLocalMarker } = await import("./local-lease-marker.mjs");
  const before = readLocalMarker(ROOT);
  t.after(() => {
    if (before) writeLocalMarker(ROOT, before);
    else clearLocalMarker(ROOT);
  });

  const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: ROOT, encoding: "utf8" }).trim();
  writeLocalMarker(ROOT, {
    branch,
    sessionId: "hookCommand-test-fixture-foreign-session",
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  });

  const r = runHook(check.command, JSON.stringify({ cwd: ROOT, tool_name: "Bash", tool_input: { command: "git status" } }));
  assert.equal(r.code, 2, `expected a block via the configured command; got exit ${r.code}\n${r.out}`);
  assert.match(r.out, /hookCommand-test-fixture-foreign-session/);
});

test("loop watchdog (2026-10-16): the configured stuck-watch hooks DENY the 5th identical call, via their exact command strings", async () => {
  const post = nodeHooks.find((h) => h.event === "PostToolUse" && h.command.includes("stuck-watch.mjs"));
  const pre = nodeHooks.find((h) => h.event === "PreToolUse" && h.command.includes("stuck-watch.mjs"));
  assert.ok(post && pre, "stuck-watch.mjs must be configured as both a PreToolUse and a PostToolUse hook");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  process.env.STUCK_WATCH_DIR = mkdtempSync(join(tmpdir(), "stuck-hookcmd-"));
  const call = { session_id: `hookcmd-${process.pid}`, cwd: ROOT, tool_name: "Bash", tool_input: { command: "pnpm test" } };
  for (let i = 0; i < 4; i++) runHook(post.command, JSON.stringify({ ...call, tool_input: { ...call.tool_input, description: `try ${i}` }, tool_response: { stdout: "1 failed" } }));
  const r = runHook(pre.command, JSON.stringify(call));
  delete process.env.STUCK_WATCH_DIR;
  assert.equal(r.code, 2, `expected a deny (exit 2), got ${r.code}\n${r.out}`);
  assert.match(r.out, /stuck-watch\] DENIED/);
});

test("operator asks (2026-10-17): UserPromptSubmit and PreCompact refresh, SessionStart compact|resume recalls, via the exact command strings", async () => {
  const find = (event) => nodeHooks.find((h) => h.event === event && h.command.includes("operator-asks.mjs"));
  const [submit, compact, start] = ["UserPromptSubmit", "PreCompact", "SessionStart"].map(find);
  assert.ok(submit && compact && start, "operator-asks.mjs must be configured on UserPromptSubmit, PreCompact and SessionStart");
  assert.match(submit.command, /--refresh/);
  assert.match(compact.command, /--refresh/);
  assert.match(start.command, /--recall/);
  const groups = settings.hooks.SessionStart.filter((g) => (g.hooks ?? []).some((h) => h.command?.includes("operator-asks.mjs")));
  const fires = (source) => groups.some((g) => new RegExp(`^(?:${g.matcher || ".*"})$`).test(source));
  for (const source of ["compact", "resume"]) assert.ok(fires(source), `the recall must fire on SessionStart source "${source}"`);
  for (const source of ["startup", "clear"]) assert.ok(!fires(source), `the recall must not fire on SessionStart source "${source}"`);

  const { appendFileSync, mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "asks-hookcmd-"));
  const transcript = join(dir, "t.jsonl");
  const line = (e) => `${JSON.stringify(e)}\n`;
  writeFileSync(transcript, line({ type: "user", origin: { kind: "human" }, timestamp: "2026-10-17T10:00:00.000Z", message: { role: "user", content: "typed ask one" } }));
  process.env.OPERATOR_ASKS_DIR = join(dir, "asks");
  try {
    const base = { session_id: `asks-${process.pid}`, transcript_path: transcript, cwd: ROOT };
    const s = runHook(submit.command, JSON.stringify({ ...base, hook_event_name: "UserPromptSubmit", prompt: "typed ask one" }));
    assert.equal(s.code, 0, s.out);
    assert.equal(s.out.trim(), "", "the refresh must print nothing: UserPromptSubmit output enters the model's context");
    appendFileSync(transcript, line({ type: "attachment", timestamp: "2026-10-17T10:05:00.000Z", attachment: { type: "queued_command", prompt: "mid-turn ask two", origin: { kind: "human" } } }));
    assert.equal(runHook(compact.command, JSON.stringify({ ...base, hook_event_name: "PreCompact", trigger: "auto" })).code, 0);
    appendFileSync(transcript, line({ type: "user", origin: { kind: "human" }, timestamp: "2026-10-17T10:09:00.000Z", message: { role: "user", content: "typed ask three" } }));
    const r = runHook(start.command, JSON.stringify({ ...base, hook_event_name: "SessionStart", source: "compact" }));
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Operator asks this session \(verbatim, oldest first; 3 total; full list: /);
    assert.match(r.out, /typed ask one[\s\S]*mid-turn ask two[\s\S]*typed ask three/);
  } finally {
    delete process.env.OPERATOR_ASKS_DIR;
  }
});

test("skills check (2026-10-17): the configured Stop string blocks a tool turn with no Skill call ONCE, then lets it stop", async () => {
  const hook = nodeHooks.find((h) => h.event === "Stop" && h.command.includes("skills-check.mjs"));
  assert.ok(hook, "skills-check.mjs must be configured as a Stop hook");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "skills-hookcmd-"));
  const transcript = join(dir, "t.jsonl");
  const entries = [
    { type: "user", origin: { kind: "human" }, promptId: "p1", message: { role: "user", content: "fix it" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "pnpm test" } }] } },
    { type: "user", toolUseResult: {}, message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } },
  ];
  writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  process.env.SKILLS_CHECK_DIR = join(dir, "state");
  try {
    const payload = JSON.stringify({ session_id: `skills-${process.pid}`, transcript_path: transcript, stop_hook_active: false, hook_event_name: "Stop" });
    const first = runHook(hook.command, payload);
    assert.equal(first.code, 2, `expected a block (exit 2), got ${first.code}\n${first.out}`);
    assert.match(first.out, /\[skills-check\][\s\S]*using-superpowers/, "the block must be the hook's own, naming the skills");
    const second = runHook(hook.command, payload);
    assert.equal(second.code, 0, `the second stop must go through\n${second.out}`);
  } finally {
    delete process.env.SKILLS_CHECK_DIR;
  }
});

test("health first (2026-10-22): the configured Stop string blocks an unhandled FIX FIRST line ONCE, then lets it stop", async () => {
  const hook = nodeHooks.find((h) => h.event === "Stop" && h.command.includes("health-first.mjs"));
  assert.ok(hook, "health-first.mjs must be configured as a Stop hook");
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(join(tmpdir(), "health-hookcmd-"));
  const transcript = join(dir, "t.jsonl");
  const line = "[health] graphify DOWN | FIX FIRST: (1) powershell -File C:/repo/scripts/local-mcp-servers.ps1 -Start";
  const entries = [
    { type: "attachment", attachment: { type: "hook_success", hookEvent: "SessionStart", content: line, stdout: `${line}\n` } },
    { type: "user", origin: { kind: "human" }, promptId: "p1", message: { role: "user", content: "status?" } },
    { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Two PRs open." }] } },
  ];
  writeFileSync(transcript, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  process.env.HEALTH_FIRST_DIR = join(dir, "state");
  try {
    const payload = JSON.stringify({ session_id: `health-${process.pid}`, transcript_path: transcript, stop_hook_active: false, hook_event_name: "Stop" });
    const first = runHook(hook.command, payload);
    assert.equal(first.code, 2, `expected a block (exit 2), got ${first.code}\n${first.out}`);
    assert.match(first.out, /\[health-first\][\s\S]*local-mcp-servers\.ps1/, "the block must be the hook's own, naming the fix");
    const second = runHook(hook.command, payload);
    assert.equal(second.code, 0, `the second stop must go through\n${second.out}`);
  } finally {
    delete process.env.HEALTH_FIRST_DIR;
  }
});

test("loop watchdog: the configured PostToolUseFailure string records failed calls (error payload), so 5 identical failures are denied", async () => {
  const fail = nodeHooks.find((h) => h.event === "PostToolUseFailure" && h.command.includes("stuck-watch.mjs"));
  const pre = nodeHooks.find((h) => h.event === "PreToolUse" && h.command.includes("stuck-watch.mjs"));
  assert.ok(fail, "stuck-watch.mjs must be configured as a PostToolUseFailure hook: a non-zero Bash exit never fires PostToolUse");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  process.env.STUCK_WATCH_DIR = mkdtempSync(join(tmpdir(), "stuck-hookfail-"));
  const call = { session_id: `hookfail-${process.pid}`, cwd: ROOT, tool_name: "Bash", tool_input: { command: "pnpm test" } };
  for (let i = 0; i < 4; i++) runHook(fail.command, JSON.stringify({ ...call, tool_input: { ...call.tool_input, description: `try ${i}` }, hook_event_name: "PostToolUseFailure", error: "Exit code 1: 1 failed" }));
  const r = runHook(pre.command, JSON.stringify(call));
  delete process.env.STUCK_WATCH_DIR;
  assert.equal(r.code, 2, `expected a deny (exit 2), got ${r.code}\n${r.out}`);
  assert.match(r.out, /stuck-watch\] DENIED/);
});
