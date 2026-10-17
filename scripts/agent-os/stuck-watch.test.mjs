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

function hook(fx, mode, { tool = "Bash", input = { command: "pnpm test" }, response = { stdout: "1 failed" }, session = "s1" } = {}) {
  const payload = { session_id: session, cwd: fx.repo, tool_name: tool, tool_input: input };
  if (mode === "--post") payload.tool_response = response;
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
