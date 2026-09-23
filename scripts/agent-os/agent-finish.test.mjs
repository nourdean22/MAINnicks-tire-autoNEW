/**
 * Canaries for agent-finish.mjs's localGitState() (Session Authority · 2026-09-23).
 *
 * Real fixture git repos, not mocks — the thing under test IS git plumbing
 * (status/rev-parse/rev-list), so a mock would just re-assert my own beliefs about
 * git's behavior. guard-red-team rule 6: every command here strips GIT_* env vars,
 * since this process may have inherited GIT_DIR/GIT_INDEX_FILE from whatever
 * invoked it, and an uncleaned spawn would operate on the REAL repo's .git, not the
 * scratch fixture.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localGitState } from "./agent-finish.mjs";

function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
}
function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf8", env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "agent-finish-fixture-"));
  git(dir, "init -q -b main");
  git(dir, 'config user.email "test@example.com"');
  git(dir, 'config user.name "test"');
  writeFileSync(join(dir, "a.txt"), "one\n");
  git(dir, "add a.txt");
  git(dir, 'commit -q -m "initial"');
  return dir;
}

function makeBareRemoteAndPush(dir) {
  const bare = mkdtempSync(join(tmpdir(), "agent-finish-bare-"));
  git(bare, "init -q --bare");
  git(dir, `remote add origin ${bare}`);
  git(dir, "push -q origin main");
  return bare;
}

test("no remote at all: hasUpstream:false, unpushedCount = local commit count, not dirty", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = localGitState(dir, "main");
  assert.equal(s.hasUpstream, false);
  assert.equal(s.unpushedCount, 1); // the one "initial" commit
  assert.equal(s.dirty, false);
});

test("pushed and clean: hasUpstream:true, unpushedCount:0, not dirty", (t) => {
  const dir = makeRepo();
  const bare = makeBareRemoteAndPush(dir);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });
  const s = localGitState(dir, "main");
  assert.equal(s.hasUpstream, true);
  assert.equal(s.unpushedCount, 0);
  assert.equal(s.dirty, false);
});

test("pushed, then N local commits ahead: unpushedCount == N", (t) => {
  const dir = makeRepo();
  const bare = makeBareRemoteAndPush(dir);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });
  for (let i = 0; i < 3; i++) {
    appendFileSync(join(dir, "a.txt"), `line ${i}\n`);
    git(dir, "add a.txt");
    git(dir, `commit -q -m "commit ${i}"`);
  }
  const s = localGitState(dir, "main");
  assert.equal(s.hasUpstream, true);
  assert.equal(s.unpushedCount, 3);
  assert.equal(s.dirty, false);
});

test("modified tracked file (uncommitted): dirty:true", (t) => {
  const dir = makeRepo();
  const bare = makeBareRemoteAndPush(dir);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });
  appendFileSync(join(dir, "a.txt"), "uncommitted change\n");
  const s = localGitState(dir, "main");
  assert.equal(s.dirty, true);
  assert.equal(s.unpushedCount, 0, "an uncommitted change is not an unpushed COMMIT");
});

test("untracked file: dirty:true", (t) => {
  const dir = makeRepo();
  const bare = makeBareRemoteAndPush(dir);
  t.after(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(bare, { recursive: true, force: true });
  });
  writeFileSync(join(dir, "new-file.txt"), "untracked\n");
  const s = localGitState(dir, "main");
  assert.equal(s.dirty, true);
});
