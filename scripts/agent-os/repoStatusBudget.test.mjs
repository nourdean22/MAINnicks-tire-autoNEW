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
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
  // The counts are CELLS: one failed remote read shows in two cells (origin, PR/class), so it says so (round 1, P3).
  assert.match(r.stdout, /^receipt: 1 branch row\(s\) in [\d.]+ s \(budget \d+ s\) · \d+ cell\(s\) UNKNOWN \(timeout\) · \d+ cell\(s\) UNKNOWN \(error\)$/m, seen);
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

// Manager round 1 (P2): `git` here is C:\Program Files\Git\cmd\git.exe, a wrapper; killing it alone left the real git.exe
// (and its conhost) running, so every timeout orphaned a git and a truly hung one never died. The whole tree must go.
test("runBounded: a timeout kills the whole tree on Windows, so the grandchild behind a wrapper dies too", { timeout: 20_000, skip: process.platform !== "win32" && "the git.cmd wrapper tree is the Windows case" }, async (t) => {
  const { runBounded } = await import("./repo-status.mjs");
  const pidFile = join(mkdtempSync(join(tmpdir(), "rb-tree-")), "grandchild.pid");
  // detached: libuv puts a node child's own children in a kill-on-close job, so a plain node grandchild dies with its
  // parent and proves nothing (first draft of this arm was green on the old code). git.exe's children are not in that
  // job; a detached grandchild is outside it the same way.
  const child = `const g = require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", detached: true }); require("fs").writeFileSync(${JSON.stringify(pidFile)}, String(g.pid)); setInterval(() => {}, 1000)`;
  await assert.rejects(runBounded(process.execPath, ["-e", child], { timeoutMs: 2500 }), (e) => e.timedOut === true);
  assert.ok(existsSync(pidFile), "the child never started its grandchild inside the limit (harness, not the subject)");
  const gpid = Number(readFileSync(pidFile, "utf8"));
  t.after(() => { try { process.kill(gpid); } catch { /* gone */ } });
  const alive = () => { try { process.kill(gpid, 0); return true; } catch { return false; } };
  for (let i = 0; i < 30 && alive(); i++) await new Promise((r) => setTimeout(r, 100));
  assert.equal(alive(), false, `grandchild pid ${gpid} outlived its parent's timeout`);
});

// Codex on PR 3543 (P1): the budget's abort runs every listener synchronously, and each one blocked in a 5 s
// spawnSync("taskkill"), one after another: with 6 git children live, about 30 s before anything settled. The kill path
// is faked here (platform "win32", a blocking spawnSync like the real one, a non-blocking spawn) so it runs anywhere.
test("budget abort with 6 hanging children: every read settles timed-out at once, a slow tree-kill never holds the answer", { timeout: 30_000 }, async (t) => {
  const { budgetSignal, killDeps, runBounded } = await import("./repo-status.mjs");
  const real = { ...killDeps };
  t.after(() => Object.assign(killDeps, real));
  const SLOW_KILL_MS = 1500;
  killDeps.platform = "win32";
  // The old design's blocking call, shaped like the real spawnSync (red on d7810ff5d9: settled 9621 ms after start). The
  // fixed code never calls it; it stays so a regression that blocks through killDeps.spawnSync goes red here again.
  killDeps.spawnSync = () => { const until = Date.now() + SLOW_KILL_MS; while (Date.now() < until); return { status: 1 }; };
  killDeps.spawn = () => { const k = new EventEmitter(); setTimeout(() => k.emit("exit", 1), SLOW_KILL_MS); return k; };
  const BUDGET = 600;
  const { signal, stop } = budgetSignal(BUDGET);
  const started = Date.now();
  const reads = await Promise.allSettled(Array.from({ length: 6 }, () => runBounded(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 60_000, signal })));
  const ms = Date.now() - started;
  stop();
  assert.ok(reads.every((r) => r.status === "rejected" && r.reason?.timedOut === true), JSON.stringify(reads.map((r) => r.status)));
  assert.ok(ms < BUDGET + 1000, `settled ${ms} ms after start, budget ${BUDGET} ms (each slow kill blocked the next?)`);
  await new Promise((r) => setTimeout(r, SLOW_KILL_MS + 500)); // the fallback child.kill() runs when the fake taskkill "fails"
});

// Manager round 1 (P2): the compare read's empty catch turned a TIMEOUT into "ahead unknown", and a branch 0 commits
// ahead then classified with confidence. A timed-out read must leave the class UNKNOWN.
test("statusRow: a compare read that times out makes the PR/class cell UNKNOWN (timeout), not a class", async () => {
  const { statusRow } = await import("./repo-status.mjs");
  const json = async (path) => {
    if (path.includes("/compare/")) throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
    if (path.includes("/pulls?head=")) return [];
    throw new Error(`unexpected read ${path}`);
  };
  const row = await statusRow("feature/x", undefined, { owner: "o", repo: "r", git: null, json, onOrigin: new Set(["feature/x"]), store: { getRef: async () => null } });
  assert.equal(row[5], "UNKNOWN (timeout)", JSON.stringify(row));
});

test("runBounded: a fast child resolves its trimmed stdout; a failing one rejects without timedOut", { timeout: 10_000 }, async () => {
  const { runBounded } = await import("./repo-status.mjs");
  assert.equal(await runBounded(process.execPath, ["-e", "console.log('  ok  ')"]), "ok");
  await assert.rejects(runBounded(process.execPath, ["-e", "console.error('boom'); process.exit(3)"]), (e) => !e.timedOut && /boom/.test(e.message));
});
