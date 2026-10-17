/**
 * Canaries for the cross-session board (scripts/agent-os/board.mjs, 2026-10-16, mechanism A).
 *
 * Drives the REAL CLI: `refresh` against a scratch git repo and a fixture PR list (BOARD_GH_JSON stands in for
 * `gh pr list`), then `hook` with a UserPromptSubmit payload. Positive controls: a planted event must print on
 * the next prompt; an unchanged board must print nothing; a stale board must say STALE, never stay quiet.
 */
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const BOARD = join(dirname(fileURLToPath(import.meta.url)), "board.mjs");

function cleanEnv(extra) {
  const e = { ...process.env, ...extra };
  for (const k of Object.keys(e)) if (k.startsWith("GIT_")) delete e[k];
  return e;
}

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "board-repo-"));
  const dir = mkdtempSync(join(tmpdir(), "board-state-"));
  const gh = join(dir, "prs.json");
  const env = cleanEnv({ BOARD_DIR: dir, BOARD_REPO: repo, BOARD_MAIN_REF: "main", BOARD_GH_JSON: gh, HEAVY_LOCK_DIR: join(dir, "locks") });
  const git = (...args) => spawnSync("git", args, { cwd: repo, env, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "first commit");
  writeFileSync(gh, JSON.stringify([{ number: 11, title: "green pr", headRefOid: "aaa", statusCheckRollup: [{ conclusion: "SUCCESS" }] }]));
  return { repo, dir, gh, env, git };
}

const run = (fx, args, input) => spawnSync(process.execPath, [BOARD, ...args], { env: fx.env, input, encoding: "utf8" });
const prompt = (fx, session = "s1") => {
  const t = Date.now();
  const r = run(fx, ["hook"], JSON.stringify({ session_id: session, prompt: "hi" }));
  return { code: r.status, out: r.stdout.trim(), ms: Date.now() - t };
};

test("a planted merge and a PR that went red print on the next prompt, in at most 3 lines", () => {
  const fx = fixture();
  assert.equal(run(fx, ["refresh"]).status, 0);
  prompt(fx); // first look: baseline
  fx.git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "fix · nickstire · planted merge (#3101)");
  writeFileSync(fx.gh, JSON.stringify([{ number: 11, title: "green pr", headRefOid: "bbb", statusCheckRollup: [{ conclusion: "FAILURE" }] }]));
  run(fx, ["refresh"]);
  const r = prompt(fx);
  assert.equal(r.code, 0);
  assert.match(r.out, /planted merge \(#3101\)/);
  assert.match(r.out, /went red: #11 green pr/);
  assert.ok(r.out.split("\n").length <= 3, r.out);
});

test("positive control: nothing changed since the last look prints nothing", () => {
  const fx = fixture();
  run(fx, ["refresh"]);
  prompt(fx);
  run(fx, ["refresh"]);
  assert.equal(prompt(fx).out, "");
});

test("the heavy lease holder is shown when it changes", () => {
  const fx = fixture();
  run(fx, ["refresh"]);
  prompt(fx);
  const locks = join(fx.dir, "locks");
  spawnSync("node", ["-e", `require('fs').mkdirSync(${JSON.stringify(locks)},{recursive:true})`]);
  writeFileSync(join(locks, "heavy.lock"), JSON.stringify({ token: "t1", pid: process.pid, session: "sib-session", command: "pnpm verify:nick", startedMs: Date.now() }));
  assert.match(prompt(fx).out, /heavy lease: pnpm verify:nick held by sib-session/);
});

test("a stale board says STALE instead of staying quiet", () => {
  const fx = fixture();
  run(fx, ["refresh"]);
  prompt(fx);
  const file = join(fx.dir, "board.json");
  const board = JSON.parse(readFileSync(file, "utf8"));
  board.updatedMs = Date.now() - 11 * 60_000;
  writeFileSync(file, JSON.stringify(board));
  writeFileSync(join(fx.dir, "refreshing"), String(Date.now())); // a refresh "in flight" must not hide the staleness
  assert.match(prompt(fx).out, /STALE/);
});

test("a failed gh read keeps the last PR list and marks it, never an empty 'no PRs'", () => {
  const fx = fixture();
  run(fx, ["refresh"]);
  writeFileSync(fx.gh, "{not json");
  run(fx, ["refresh"]);
  const board = JSON.parse(readFileSync(join(fx.dir, "board.json"), "utf8"));
  assert.equal(board.prs.length, 1, "the last good PR list must survive a failed read");
  assert.ok(board.prsError, "the failed read must be recorded");
});

test("the hook answers in under 1 s (kill criterion) and fails open on garbage input", () => {
  const fx = fixture();
  run(fx, ["refresh"]);
  const r = prompt(fx);
  assert.ok(r.ms < 1000, `hook took ${r.ms} ms`);
  const bad = run(fx, ["hook"], "{not json");
  assert.equal(bad.status, 0);
});
