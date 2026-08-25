#!/usr/bin/env node
/**
 * The Stop hook, canaried. It had none.
 *
 * WHY THIS FILE EXISTS. `stop-check.mjs` is the control that should notice a
 * session ending with work outstanding, and until now nothing proved it fires at
 * all. The coverage table recorded it as: canary ❌, wired ✅. A Stop gate
 * shipped without a canary is self-refuting given what this repo's canary rule
 * says, and this closes it.
 *
 * THE BUG THE SECOND INVARIANT CLOSES. A session stopping mid-queue was
 * indistinguishable from a session that had finished — both produce silence, and
 * the operator was catching it by polling. That is the blind-instrument shape:
 * an instrument that cannot separate two very different states.
 *
 * EVERY TEST HERE RUNS AGAINST A REAL THROWAWAY GIT REPO. The hook shells out to
 * git, so a mocked git would test the mock. Each case builds the exact repo
 * state, pipes a real payload, and asserts the exit code — the same contract
 * Claude Code uses (2 = interrupt with stderr shown, 0 = allow).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const HOOK = join(dirname(fileURLToPath(import.meta.url)), "stop-check.mjs");

function sh(args, cwd) {
  // 2026-08-25 · GIT-ENV HYGIENE, learned the hard way. Under a git hook
  // (lefthook pre-commit runs these canaries via agent-os-verify), git
  // exports GIT_DIR/GIT_INDEX_FILE/GIT_WORK_TREE to child processes —
  // and an inherited GIT_DIR makes the fixture's `git init --bare` RE-
  // INITIALIZE THE REAL REPO'S .git AS BARE instead of the tmpdir
  // remote. Every linked worktree then dies with "this operation must
  // be run in a work tree" until someone unsets core.bare. Reproduced
  // deterministically both ways (commit context and GIT_DIR-injected
  // standalone). Strip the git-context vars so fixture repos are always
  // resolved from cwd alone.
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith("GIT_")) delete env[k];
  return execFileSync("git", args, { cwd, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/** A repo with an `origin` it can actually push to, because the check reads refs/remotes. */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "stopcheck-"));
  const remote = join(root, "remote.git");
  const work = join(root, "work");
  mkdirSync(remote);
  sh(["init", "--bare", "-b", "main"], root === remote ? root : remote);
  sh(["init", "-b", "main", work], root);
  const g = (...a) => sh(a, work);
  g("config", "user.email", "canary@example.com");
  g("config", "user.name", "canary");
  g("remote", "add", "origin", remote);
  writeFileSync(join(work, "a.txt"), "one\n");
  g("add", "a.txt");
  g("commit", "-m", "base");
  g("push", "-u", "origin", "main");
  return { root, work, g };
}

/**
 * 2026-08-25 · spawnSync, not execFileSync. The previous version returned
 * execFileSync's value on success — which is STDOUT ONLY — so on every exit-0
 * path the hook's stderr was discarded before any test could look at it. The
 * two fail-open tests below could therefore assert the exit code and nothing
 * else, and that is precisely how they came to lock in SILENCE as the
 * contract. A harness that cannot see the signal cannot test for it.
 */
function runHook(cwd, payload = {}, rawInput) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: rawInput ?? JSON.stringify({ cwd, ...payload }),
    encoding: "utf8",
  });
  return { code: r.status ?? 1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** The exact phrase every fail-open path must emit. */
const UNCHECKED = "NOT an all-clear";

test("POSITIVE CONTROL: a clean checkout on main is allowed", () => {
  const { root, work } = makeRepo();
  try {
    assert.equal(runHook(work).code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("INVARIANT 1 fires: uncommitted changes on main are blocked", () => {
  // The rule the hook already had, now proven to fire rather than assumed to.
  const { root, work } = makeRepo();
  try {
    writeFileSync(join(work, "a.txt"), "dirty\n");
    const r = runHook(work);
    assert.equal(r.code, 2, "dirty-on-main must block");
    assert.match(r.out, /uncommitted work on `main`/);
    assert.match(r.out, /NEVER commit to main/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("INVARIANT 1 does NOT fire on a feature branch — the tree is shared", () => {
  // Dirty files on a feature branch routinely belong to a SIBLING session in
  // this checkout. Blocking on them would fire constantly for someone else's
  // work, which is how a Stop hook gets disabled.
  const { root, work, g } = makeRepo();
  try {
    g("checkout", "-b", "statenour/thing");
    writeFileSync(join(work, "a.txt"), "dirty\n");
    assert.equal(runHook(work).code, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("INVARIANT 2 fires: unpushed commits on a pushed branch", () => {
  // The new one, and the whole point: stopping here is stopping with work
  // outstanding, and it used to look exactly like being finished.
  const { root, work, g } = makeRepo();
  try {
    g("checkout", "-b", "statenour/thing");
    g("push", "-u", "origin", "statenour/thing");
    writeFileSync(join(work, "b.txt"), "new\n");
    g("add", "b.txt");
    g("commit", "-m", "work the operator has not received");
    const r = runHook(work);
    assert.equal(r.code, 2, "unpushed commits must interrupt");
    assert.match(r.out, /STOPPING WITH 1 COMMIT\(S\) UNPUSHED/);
    assert.match(r.out, /work the operator has not received/, "must name what is unpushed");
    assert.match(r.out, /stopping with work outstanding/, "must tell the model what to do");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("INVARIANT 2 counts correctly with more than one commit", () => {
  const { root, work, g } = makeRepo();
  try {
    g("checkout", "-b", "statenour/thing");
    g("push", "-u", "origin", "statenour/thing");
    for (const n of ["b", "c", "d"]) {
      writeFileSync(join(work, `${n}.txt`), n);
      g("add", `${n}.txt`);
      g("commit", "-m", `commit ${n}`);
    }
    const r = runHook(work);
    assert.equal(r.code, 2);
    assert.match(r.out, /STOPPING WITH 3 COMMIT\(S\) UNPUSHED/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("POSITIVE CONTROL: a pushed branch with nothing ahead is allowed", () => {
  // Without this, an invariant that always returned 2 would satisfy every
  // firing test above while blocking the end of every turn in the repo.
  const { root, work, g } = makeRepo();
  try {
    g("checkout", "-b", "statenour/thing");
    writeFileSync(join(work, "b.txt"), "new\n");
    g("add", "b.txt");
    g("commit", "-m", "work");
    g("push", "-u", "origin", "statenour/thing");
    assert.equal(runHook(work).code, 0, "fully pushed work must not interrupt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("THE SQUASH-MERGE TRAP: a never-pushed branch is NOT reported", () => {
  // The first version of invariant 2 counted `origin/main..HEAD` when a branch
  // had no remote ref. It fired on its very first real run — against a branch
  // squash-merged weeks earlier, whose original commit is not an ancestor of
  // main and never will be. Every stale merged branch in a long-lived checkout
  // looked like outstanding work. Missing the never-pushed case is the correct
  // trade against a check that cries wolf and gets turned off.
  const { root, work, g } = makeRepo();
  try {
    g("checkout", "-b", "local/never-pushed");
    writeFileSync(join(work, "b.txt"), "new\n");
    g("add", "b.txt");
    g("commit", "-m", "local only");
    assert.equal(runHook(work).code, 0, "no remote ref means no opinion");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stop_hook_active short-circuits — this is a one-shot, not a trap", () => {
  // What makes exit 2 compatible with the file's own doctrine against blocking
  // routine turns: the interrupt fires once, then a second stop passes through.
  const { root, work, g } = makeRepo();
  try {
    g("checkout", "-b", "statenour/thing");
    g("push", "-u", "origin", "statenour/thing");
    writeFileSync(join(work, "b.txt"), "new\n");
    g("add", "b.txt");
    g("commit", "-m", "work");
    assert.equal(runHook(work).code, 2, "first attempt interrupts");
    assert.equal(runHook(work, { stop_hook_active: true }).code, 0, "second attempt must pass");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("own bugs FAIL OPEN — a non-git directory does not block the turn, and SAYS SO", () => {
  // The deliberate posture documented at the top of the hook: its own failures
  // must never strand a session.
  //
  // The exit code is only half the contract. Until 2026-08-25 this asserted
  // ONLY the 0 — so a hook that had gone completely inert passed this test
  // while emitting the same silence as a hook that checked and found nothing.
  // That is the blind-instrument shape living inside the canary for it.
  const dir = mkdtempSync(join(tmpdir(), "stopcheck-nogit-"));
  try {
    const r = runHook(dir);
    assert.equal(r.code, 0, "must not strand the session");
    assert.match(r.out, /not a git checkout, or git is unavailable/);
    assert.ok(r.out.includes(UNCHECKED), `fail-open must disclaim an all-clear, got: ${r.out}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a malformed payload fails open, and SAYS SO", () => {
  const r = runHook(null, {}, "not json");
  assert.equal(r.code, 0, `malformed payload should exit 0, got ${r.code}`);
  assert.match(r.out, /payload was not readable JSON/);
  assert.ok(r.out.includes(UNCHECKED), `fail-open must disclaim an all-clear, got: ${r.out}`);
});

test("POSITIVE CONTROL: a healthy run does NOT cry unchecked", () => {
  // Load-bearing. Without it, a hook that printed the fail-open warning on
  // EVERY run would satisfy both assertions above while making the warning
  // meaningless — the boy-who-cried-wolf failure that gets a hook disabled.
  const { root, work } = makeRepo();
  try {
    const r = runHook(work);
    assert.equal(r.code, 0, "a clean pushed checkout is allowed");
    assert.ok(
      !r.out.includes(UNCHECKED),
      `a healthy run must stay quiet, got: ${r.out}`,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
