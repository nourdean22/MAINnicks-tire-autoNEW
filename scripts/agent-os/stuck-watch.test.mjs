/**
 * Canaries for the loop watchdog (scripts/agent-os/stuck-watch.mjs, 2026-10-16).
 *
 * Drives the REAL hook script with real hook payloads on stdin, in both modes it is registered
 * in (.claude/settings.json: PreToolUse --pre, PostToolUse --post), against a scratch git repo.
 * Positive controls: a different call in between, or a changed tree, must reset the streak.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "stuck-watch.mjs");

// A hook inherits GIT_DIR / GIT_INDEX_FILE from a real commit; a fixture git init under those
// would touch the SHARED .git (guard-red-team rule 6). Strip them.
function cleanEnv(extra) {
  const e = { ...process.env, ...extra };
  for (const k of Object.keys(e)) if (k.startsWith("GIT_")) delete e[k];
  return e;
}

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "stuck-repo-"));
  const state = mkdtempSync(join(tmpdir(), "stuck-state-"));
  const env = cleanEnv({ STUCK_WATCH_DIR: state });
  spawnSync("git", ["init", "-q"], { cwd: repo, env });
  return { repo, env };
}

function hook(fx, mode, { tool = "Bash", input = { command: "pnpm test" }, response = { stdout: "1 failed" }, session = "s1", agent, error } = {}) {
  const payload = { session_id: session, cwd: fx.repo, tool_name: tool, tool_input: input };
  if (agent) payload.agent_id = agent;
  // A failed call fires PostToolUseFailure, whose payload carries `error` and no tool_response (hooks docs).
  if (mode === "--post" && error !== undefined) Object.assign(payload, { hook_event_name: "PostToolUseFailure", error });
  else if (mode === "--post") payload.tool_response = response;
  const r = spawnSync(process.execPath, [HOOK, mode], { input: JSON.stringify(payload), env: fx.env, encoding: "utf8" });
  return { code: r.status, err: r.stderr };
}

/** One full tool call: the pre check, then (if allowed) the post record. Returns the pre and post results. */
function call(fx, opts) {
  const pre = hook(fx, "--pre", opts);
  const post = pre.code === 0 ? hook(fx, "--post", opts) : null;
  return { pre, post };
}

test("5 identical calls with identical results on an unchanged tree: nudge on the 3rd, deny on the 5th", () => {
  const fx = fixture();
  const calls = [1, 2, 3, 4, 5].map(() => call(fx));
  assert.equal(calls[0].post.code, 0);
  assert.equal(calls[1].post.code, 0);
  assert.equal(calls[2].post.code, 2, "the 3rd repeat must nudge");
  assert.match(calls[2].post.err, /same action, same result 3 times/);
  assert.equal(calls[3].pre.code, 0, "the 4th call is still allowed");
  assert.equal(calls[4].pre.code, 2, "the 5th identical call must be denied");
  assert.match(calls[4].pre.err, /stuck-watch/);
  assert.match(calls[4].pre.err, /change approach/);
});

test("the key ignores model-written prose: 5 identical commands with 5 different descriptions are denied at the 5th (live bug 2026-10-17)", () => {
  // Live: 5 identical failing `node -e "process.exit(3)"` calls scored streak 1 each, because the
  // model writes a fresh `description` (and sometimes `timeout`) on every call and both were hashed.
  const fx = fixture();
  const input = (i) => ({ command: "node -e \"process.exit(3)\"", description: `Run the probe, try ${i}`, timeout: 1000 * (i + 1) });
  const calls = [0, 1, 2, 3, 4].map((i) => call(fx, { input: input(i), error: "Exit code 3" }));
  assert.equal(calls[2].post.code, 2, "the 3rd repeat must nudge despite a new description");
  assert.equal(calls[4].pre.code, 2, "the 5th identical command must be denied despite a new description");
  // Browser tools carry the same kind of prose in `action_summary`.
  const br = fixture();
  const click = (i) => ({ action: "left_click", coordinate: [10, 20], action_summary: `Clicks Save, attempt ${i}` });
  for (let i = 0; i < 4; i++) call(br, { tool: "mcp__Claude_Browser__computer", input: click(i), response: { ok: false } });
  assert.equal(call(br, { tool: "mcp__Claude_Browser__computer", input: click(9), response: { ok: false } }).pre.code, 2);
});

test("control: 5 different commands with the same description are not a loop", () => {
  const fx = fixture();
  const calls = [0, 1, 2, 3, 4].map((i) => call(fx, { input: { command: `node probe-${i}.mjs`, description: "Run the probe" }, error: "Exit code 3" }));
  assert.ok(calls.every((c) => c.pre.code === 0 && c.post.code === 0), "different commands must never nudge or deny");
  const bg = fixture(); // run_in_background changes what the call does, so it stays in the key
  for (let i = 0; i < 4; i++) call(bg, { input: { command: "pnpm test" } });
  assert.equal(call(bg, { input: { command: "pnpm test", run_in_background: true } }).pre.code, 0);
});

test("positive control: a different call in between resets the streak", () => {
  const fx = fixture();
  for (let i = 0; i < 4; i++) call(fx);
  call(fx, { input: { command: "git status" }, response: { stdout: "clean" } });
  const r = call(fx);
  assert.equal(r.pre.code, 0, "a reset streak must not deny");
  assert.equal(r.post.code, 0, "a reset streak must not nudge");
});

test("positive control: a changed tree resets the streak", () => {
  const fx = fixture();
  for (let i = 0; i < 4; i++) call(fx);
  writeFileSync(join(fx.repo, "edited.txt"), "a real change");
  const r = call(fx);
  assert.equal(r.pre.code, 0, "the 5th call after an edit must be allowed");
});

test("a different result resets the streak (the action is making progress)", () => {
  const fx = fixture();
  for (let i = 0; i < 4; i++) call(fx, { response: { stdout: `run ${i}` } });
  assert.equal(call(fx, { response: { stdout: "run 9" } }).pre.code, 0);
});

test("a rerun whose output differs only in durations and timestamps is still the same result", () => {
  const fx = fixture();
  const out = (i) => ({ stdout: `1 failed\nDuration ${i}.2${i}s (transform ${i}1ms)\nat 2026-10-17T03:0${i}:11.123Z` });
  for (let i = 0; i < 4; i++) call(fx, { response: out(i) });
  const r = call(fx, { response: out(7) });
  assert.equal(r.pre.code, 2, "timing noise must not hide an identical failure");
});

test("failed calls (PostToolUseFailure) streak on their error: identical errors deny, different errors do not", () => {
  const same = fixture();
  for (let i = 0; i < 4; i++) call(same, { error: "Exit code 1: 1 failed" });
  assert.equal(call(same, { error: "Exit code 1: 1 failed" }).pre.code, 2, "5 identical failures must be denied");
  const diff = fixture();
  for (let i = 0; i < 4; i++) call(diff, { error: `Exit code 1: failure ${i}` });
  assert.equal(call(diff, { error: "Exit code 1: failure 9" }).pre.code, 0, "different errors are progress, not a loop");
});

test("parallel agents in one session are tracked separately (agent_id)", () => {
  const fx = fixture();
  for (let i = 0; i < 4; i++) {
    call(fx, { session: "s", agent: "lane-a" });
    call(fx, { session: "s", agent: "lane-b", input: { command: `git log -${i}` }, response: { stdout: String(i) } });
  }
  assert.equal(call(fx, { session: "s", agent: "lane-a" }).pre.code, 2, "lane-b's calls must not reset lane-a's streak");
});

test("read-only polling nudges but is never denied: Read, Grep, Glob, gh and curl", () => {
  for (const opts of [
    { tool: "Read", input: { file_path: "C:/tmp/task.output" } },
    { tool: "Grep", input: { pattern: "x" } },
    { tool: "Glob", input: { pattern: "*.md" } },
    { tool: "Bash", input: { command: "gh pr checks 3100" } },
    { tool: "PowerShell", input: { command: "  curl -s https://nickstire.org/api/health" } },
  ]) {
    const fx = fixture();
    const calls = [1, 2, 3, 4, 5, 6].map(() => call(fx, opts));
    assert.equal(calls[2].post.code, 2, `${opts.tool}: the 3rd repeat still nudges`);
    assert.ok(calls.every((c) => c.pre.code === 0), `${opts.tool} ${JSON.stringify(opts.input)}: polling must never be denied`);
  }
  const fx = fixture(); // positive control: gh only as the FIRST word; a chained mutating command is not polling
  for (let i = 0; i < 4; i++) call(fx, { input: { command: "pnpm build; gh pr checks 1" } });
  assert.equal(call(fx, { input: { command: "pnpm build; gh pr checks 1" } }).pre.code, 2);
  const chained = fixture(); // a gh first word chained to a mutating command is not polling either
  for (let i = 0; i < 4; i++) call(chained, { input: { command: "gh pr checks 1 && pnpm build" } });
  assert.equal(call(chained, { input: { command: "gh pr checks 1 && pnpm build" } }).pre.code, 2);
});

test("sessions are tracked separately", () => {
  const fx = fixture();
  for (let i = 0; i < 4; i++) call(fx, { session: "a" });
  assert.equal(call(fx, { session: "b" }).pre.code, 0);
  assert.equal(call(fx, { session: "a" }).pre.code, 2);
});

test("polling tools are exempt", () => {
  const fx = fixture();
  const opts = { tool: "Monitor", input: { command: "gh pr checks 1" } };
  for (let i = 0; i < 6; i++) assert.equal(call(fx, opts).pre.code, 0);
});

test("fails OPEN on its own bugs: garbage stdin and a missing session id are allowed", () => {
  const fx = fixture();
  for (const mode of ["--pre", "--post"]) {
    const r = spawnSync(process.execPath, [HOOK, mode], { input: "{not json", env: fx.env, encoding: "utf8" });
    assert.equal(r.status, 0, mode);
    const r2 = spawnSync(process.execPath, [HOOK, mode], { input: JSON.stringify({ tool_name: "Bash" }), env: fx.env, encoding: "utf8" });
    assert.equal(r2.status, 0, mode);
  }
});
