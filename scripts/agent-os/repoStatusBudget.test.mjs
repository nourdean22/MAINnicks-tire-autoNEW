/**
 * repo-status.mjs answers inside its budget when a child hangs (job 2026-11-03-platform-housekeeping).
 *
 * Witnessed 2026-11-03: the heartbeat's `timeout 90 node scripts/agent-os/repo-status.mjs` exited 124 with no output,
 * twice. Measured the same day: no child hung; 87 worktrees were read one after another (~0.55 s per GitHub call, each
 * call spawning `gh` twice) and the table printed only at the very end, so any time limit read nothing at all.
 *
 * The hang below is a REAL git child, not a stub of the script: the fixture repo's core.fsmonitor hook sleeps, so
 * `git status` (and only status) blocks, on Windows and Linux alike, whichever way the script spawns git. GitHub is
 * unreachable on purpose (a refused local proxy), so no request leaves the machine.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dirname, "repo-status.mjs");
const WALL_MS = 30_000; // the brief's acceptance: an answer under 30 s, whatever a child does
const HOOK_SLEEP_S = 40; // longer than WALL_MS, so only a bounded spawn can get past it

const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "repo-status-hang-"));
  // Best effort: on Windows the orphaned hook's sleep can hold the folder for up to HOOK_SLEEP_S.
  t.after(() => { try { rmSync(dir, { recursive: true, force: true, maxRetries: 2 }); } catch { /* temp dir, swept later */ } });
  const repo = join(dir, "repo");
  const hook = join(dir, "hang.sh").replace(/\\/g, "/");
  writeFileSync(hook, `#!/bin/sh\nsleep ${HOOK_SLEEP_S}\n`);
  chmodSync(hook, 0o755);
  const git = (args, cwd = repo) => execFileSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8" });
  git(["init", "-q", "-b", "main", repo], dir);
  git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"]);
  git(["remote", "add", "origin", "https://github.com/fixture-owner/fixture-repo.git"]);
  git(["config", "core.fsmonitor", hook]);
  return repo;
}

/** Run the real script; settle on exit (not on pipe close: an orphaned grandchild may hold a pipe), kill at WALL_MS. */
function runScript(cwd) {
  const env = { ...cleanEnv(), HTTPS_PROXY: "http://127.0.0.1:9", NODE_USE_ENV_PROXY: "1", GH_TOKEN: "offline-fixture" };
  for (const k of ["GITHUB_TOKEN", "NO_PROXY", "no_proxy", "AGENT_OS_GH_CALL_LOG"]) delete env[k];
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(process.execPath, [SCRIPT], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    const timer = setTimeout(() => child.kill(), WALL_MS);
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal, ms: Date.now() - started, stdout, stderr });
    });
  });
}

test("repo-status: a hanging git child gives UNKNOWN (timeout) and a receipt, exit 0, under 30 s", { timeout: WALL_MS + 15_000 }, async (t) => {
  const r = await runScript(fixture(t));
  const seen = `exit ${r.code} signal ${r.signal} after ${r.ms} ms\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`;
  assert.ok(r.ms < WALL_MS, `must answer before the ${WALL_MS} ms wall; ${seen}`);
  assert.equal(r.code, 0, `UNKNOWN is a reported state, not a crash; ${seen}`);
  assert.match(r.stdout, /UNKNOWN \(timeout\)/, `the hung status read must say so; ${seen}`);
  assert.match(r.stdout, /^receipt: 1 branch row\(s\) in [\d.]+ s \(budget \d+ s\) · \d+ UNKNOWN \(timeout\) · \d+ UNKNOWN \(error\)$/m, seen);
  // The refused GitHub reads are errors, never a confident "no" or "-": origin, PR/class and lease all say UNKNOWN.
  const row = r.stdout.split("\n").find((l) => l.startsWith("main "));
  assert.ok(row, `a row for branch main; ${seen}`);
  assert.equal((row.match(/UNKNOWN/g) ?? []).length, 4, `dirty + origin + PR/class + lease are UNKNOWN; ${row}`);
});

test("runBounded: a child that never exits is killed and rejected with timedOut inside its limit", { timeout: 10_000 }, async () => {
  const { runBounded } = await import("./repo-status.mjs");
  assert.equal(typeof runBounded, "function", "repo-status.mjs exports runBounded");
  const started = Date.now();
  await assert.rejects(runBounded(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 400 }), (e) => e.timedOut === true);
  assert.ok(Date.now() - started < 3000, `rejected after ${Date.now() - started} ms`);
});

test("runBounded: a grandchild holding the stdout pipe does not hold the caller past the limit", { timeout: 10_000 }, async () => {
  const { runBounded } = await import("./repo-status.mjs");
  // The child starts a grandchild that inherits its stdout and sleeps 4 s, then the child itself hangs.
  const child = "require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 4000)'], { stdio: 'inherit' }); setInterval(() => {}, 1000)";
  const started = Date.now();
  await assert.rejects(runBounded(process.execPath, ["-e", child], { timeoutMs: 400 }), (e) => e.timedOut === true);
  assert.ok(Date.now() - started < 3000, `settled after ${Date.now() - started} ms, not when the grandchild let go`);
});

test("budgetSignal: when the run budget ends, a child with a long limit of its own is stopped too", { timeout: 10_000 }, async () => {
  const { budgetSignal, runBounded } = await import("./repo-status.mjs");
  const { signal, stop } = budgetSignal(400);
  const started = Date.now();
  const e = await runBounded(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 60_000, signal }).catch((err) => err);
  stop();
  assert.equal(e?.timedOut, true, `expected a budget stop, got ${e}`);
  assert.ok(Date.now() - started < 3000, `stopped after ${Date.now() - started} ms`);
});

test("runBounded: a fast child resolves its trimmed stdout; a failing one rejects without timedOut", { timeout: 10_000 }, async () => {
  const { runBounded } = await import("./repo-status.mjs");
  assert.equal(await runBounded(process.execPath, ["-e", "console.log('  ok  ')"]), "ok");
  await assert.rejects(runBounded(process.execPath, ["-e", "console.error('boom'); process.exit(3)"]), (e) => !e.timedOut && /boom/.test(e.message));
});
