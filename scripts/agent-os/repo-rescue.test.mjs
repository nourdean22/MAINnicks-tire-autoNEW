/**
 * Canaries for repo-rescue.mjs (Session Authority · 2026-09-23).
 *
 * The most important assertion in this file is the never-merges source-grep — a
 * structural guarantee this script cannot silently grow a merge call later without
 * a test noticing, the same spirit as the Night Shift "propose, never merge" policy
 * rule (config/agent-os/policy.json), just expressed as a unit assertion since this
 * file isn't a shell command pretool.mjs would ever see.
 *
 * Live fixture tests use THIS session's own real audit findings (real branch names
 * in nourdean22/MAINnicks-tire-autoNEW) to prove the gating logic against actual
 * GitHub state — but every live call here is read-only or explicit --dry-run,
 * never a real PR open, per guard-red-team's "probe the real binary" balanced
 * against "protected operations, never on agent initiative."
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hasLocalWorktree, provenanceNote, rescueBranch } from "./repo-rescue.mjs";
import { resolveToken } from "./github-client.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OWNER = "nourdean22";
const REPO = "MAINnicks-tire-autoNEW";
const auth = resolveToken();

test("STRUCTURAL: repo-rescue.mjs's own source never calls the pulls merge endpoint", () => {
  const src = readFileSync(join(HERE, "repo-rescue.mjs"), "utf8");
  assert.doesNotMatch(src, /\/merge["'`]/, "found a call shaped like POST .../pulls/{n}/merge — this script must NEVER merge");
  assert.doesNotMatch(src, /merge_method/, "found merge_method — a merge-endpoint parameter has no reason to exist here");
});

function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
}
function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf8", env: cleanEnv() }).trim();
}

test("hasLocalWorktree: true when a worktree IS checked out to that branch, false when not, null when git itself fails", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "repo-rescue-fixture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init -q -b main");
  git(dir, 'config user.email "t@x.com"');
  git(dir, 'config user.name "t"');
  git(dir, "commit -q --allow-empty -m init");

  assert.equal(hasLocalWorktree(dir, "main"), true);
  assert.equal(hasLocalWorktree(dir, "some/other-branch"), false);
  assert.equal(hasLocalWorktree("/nonexistent-not-a-repo", "main"), null);
});

test("provenanceNote: names the branch, tip SHA, classification, and the never-merged statement", () => {
  const note = provenanceNote({ branch: "claude/x", tipSha: "abc123", classification: "QUARANTINE", reason: "no merged PR found" });
  assert.match(note, /claude\/x/);
  assert.match(note, /abc123/);
  assert.match(note, /QUARANTINE/);
  assert.match(note, /never merged/i);
});

test("LIVE, real fixture: rescueBranch on an already-LANDED branch stops at the zombie rule, no PR touched", { skip: !auth }, async () => {
  const r = await rescueBranch("claude/nicks-eval-coverage-2026-09-18", { owner: OWNER, repo: REPO });
  assert.equal(r.rescued, false);
  assert.equal(r.reason, "zombie-rule");
  assert.equal(r.classification.classification, "LANDED");
});

test("LIVE, real fixture: rescueBranch on a genuinely-stranded (no ref, no PR) branch reports nothing to rescue", { skip: !auth }, async () => {
  const r = await rescueBranch("claude/nicks-tire-camera-gaps-36762d", { owner: OWNER, repo: REPO });
  assert.equal(r.rescued, false);
  assert.equal(r.reason, "no-remote-branch-to-rescue");
});

test("LIVE, real fixture, DRY-RUN ONLY: the messy reel-generate-schedule branch passes the early gates and reaches dry-run — never opens a real PR", { skip: !auth }, async () => {
  const r = await rescueBranch("nickstire/reel-generate-schedule", { owner: OWNER, repo: REPO, dryRun: true });
  assert.equal(r.reason, "dry-run", `expected to reach dry-run (this branch exists, has no merged PR of its own, no local worktree here); got: ${JSON.stringify(r)}`);
  assert.ok(r.wouldOpen.title.includes("reel-generate-schedule"));
  // classify-branch must flag this one (moved past its own merged PR #2184), not
  // silently call it ordinary SALVAGE material.
  assert.equal(r.classification.signals.hasMergedPrButStillAhead, true);
});
