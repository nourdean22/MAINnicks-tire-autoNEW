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
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { localGitState, resolveReleaseCaller } from "./agent-finish.mjs";
import { readLocalMarker, writeLocalMarker } from "./local-lease-marker.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

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

// ── audit item O (2026-09-23): who is releasing, and the self-lock recovery ──

test("resolveReleaseCaller: a Claude session is its own id, never the marker's", () => {
  const marker = { branch: "main", sessionId: "manual-1-2" };
  assert.equal(resolveReleaseCaller(marker, "main", { CLAUDE_CODE_SESSION_ID: "sess-A" }), "sess-A");
});

test("resolveReleaseCaller: a manual run reuses its own worktree's MANUAL marker id (else it could never release)", () => {
  assert.equal(resolveReleaseCaller({ branch: "main", sessionId: "manual-1-2" }, "main", {}), "manual-1-2");
});

test("resolveReleaseCaller: a manual run never borrows a real session's id, or another branch's marker", () => {
  assert.match(resolveReleaseCaller({ branch: "main", sessionId: "sess-B" }, "main", {}), /^manual-\d+-\d+$/);
  assert.match(resolveReleaseCaller({ branch: "other", sessionId: "manual-1-2" }, "main", {}), /^manual-\d+-\d+$/);
});

function runFinish(cwd, args) {
  const env = { ...cleanEnv(), CLAUDE_CODE_SESSION_ID: "me" };
  for (const k of ["HTTPS_PROXY", "HTTP_PROXY", "GITHUB_TOKEN", "GH_TOKEN"]) delete env[k];
  return spawnSync(process.execPath, [join(HERE, "agent-finish.mjs"), ...args], { cwd, encoding: "utf8", env, timeout: 20000 });
}

test("REAL BINARY: --force-release-foreign clears a foreign live marker even when the lease service is unreachable (no origin)", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main", sessionId: "someone-else", expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const r = runFinish(dir, ["--force-release-foreign", "holder session died"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /failing OPEN/);
  assert.equal(readLocalMarker(dir), null, "the marker that self-locked the worktree must be gone");
});

test("REAL BINARY: --force-release-foreign rejects another option as the reason", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main", sessionId: "someone-else", expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const r = runFinish(dir, ["--force-release-foreign", "--branch", "main"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires a prose reason/);
  assert.equal(readLocalMarker(dir)?.sessionId, "someone-else", "an option token must never authorize a foreign release");
});

test("REAL BINARY: without --force-release-foreign an unreachable lease service leaves the marker alone", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main", sessionId: "someone-else", expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const r = runFinish(dir, []);
  assert.equal(r.status, 0);
  assert.equal(readLocalMarker(dir)?.sessionId, "someone-else");
});

test("REAL BINARY: --force-release-foreign with no reason is refused (exit 1) and touches nothing", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main", sessionId: "someone-else", expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const r = runFinish(dir, ["--force-release-foreign"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires a reason/);
  assert.equal(readLocalMarker(dir)?.sessionId, "someone-else");
});
