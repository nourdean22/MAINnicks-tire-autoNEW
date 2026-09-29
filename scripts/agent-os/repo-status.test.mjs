/**
 * Canaries for repo-status.mjs's pure parts (Session Authority · 2026-09-23).
 * No network — parseWorktreePorcelain and formatStatusTable are pure functions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { gatherRemoteEvidence, parseWorktreePorcelain, formatStatusTable } from "./repo-status.mjs";

test("parseWorktreePorcelain: single worktree, real format from `git worktree list --porcelain`", () => {
  const text = "worktree /home/user/MAINnicks-tire-autoNEW\nHEAD f8e2b96089a2e8e8fff873dfacca9ccc2c91384b\nbranch refs/heads/claude/clever-franklin-kx3sci\n";
  const r = parseWorktreePorcelain(text);
  assert.equal(r.length, 1);
  assert.equal(r[0].path, "/home/user/MAINnicks-tire-autoNEW");
  assert.equal(r[0].branch, "claude/clever-franklin-kx3sci");
  assert.equal(r[0].headSha, "f8e2b96089a2e8e8fff873dfacca9ccc2c91384b");
  assert.equal(r[0].detached, false);
});

test("parseWorktreePorcelain: multiple worktrees separated by blank lines", () => {
  const text = [
    "worktree /repo",
    "HEAD aaa111",
    "branch refs/heads/main",
    "",
    "worktree /repo/.worktrees/task",
    "HEAD bbb222",
    "branch refs/heads/nickstire/some-task",
    "",
  ].join("\n");
  const r = parseWorktreePorcelain(text);
  assert.equal(r.length, 2);
  assert.equal(r[0].branch, "main");
  assert.equal(r[1].branch, "nickstire/some-task");
  assert.equal(r[1].path, "/repo/.worktrees/task");
});

test("parseWorktreePorcelain: detached HEAD has no branch line", () => {
  const text = "worktree /repo/.worktrees/detached\nHEAD ccc333\ndetached\n";
  const r = parseWorktreePorcelain(text);
  assert.equal(r[0].branch, null);
  assert.equal(r[0].detached, true);
});

test("parseWorktreePorcelain: branch names containing slashes parse in full (not truncated at the first slash)", () => {
  const text = "worktree /repo\nHEAD ddd444\nbranch refs/heads/claude/statenour-bdnick-research-4f6b70\n";
  const r = parseWorktreePorcelain(text);
  assert.equal(r[0].branch, "claude/statenour-bdnick-research-4f6b70");
});

test("formatStatusTable: header + separator + one row per branch, columns aligned by widest cell", () => {
  const rows = [["nickstire/x", "/a", "yes", 2, "yes", "LANDED (#10)", "-"]];
  const out = formatStatusTable(rows);
  const lines = out.split("\n");
  assert.equal(lines.length, 3); // header, separator, one data row
  assert.match(lines[0], /^branch\s+local\s+dirty\s+unpushed\s+origin\s+PR\/class\s+lease$/);
  assert.match(lines[1], /^-+\s+-+/);
  assert.match(lines[2], /nickstire\/x/);
});

test("formatStatusTable: an empty row set still prints the header (never crashes on zero branches)", () => {
  const out = formatStatusTable([]);
  assert.match(out, /^branch/);
});


test("gatherRemoteEvidence: known-origin landed branch skips redundant branch and PR reads", async () => {
  const calls = [];
  const ghJsonImpl = async (path) => {
    calls.push(path);
    if (path.includes("/compare/main...")) return { ahead_by: 0, behind_by: 4 };
    throw new Error(`unexpected API call: ${path}`);
  };
  const r = await gatherRemoteEvidence("o", "r", "feature/x", {
    knownExistsOnOrigin: true,
    ghJsonImpl,
  });
  assert.equal(r.existsOnOrigin, true);
  assert.equal(r.aheadOfMain, 0);
  assert.deepEqual(r.prs, []);
  assert.deepEqual(calls, ["/repos/o/r/compare/main...feature%2Fx"]);
});

test("gatherRemoteEvidence: known-origin ahead branch skips only the redundant branch-existence read", async () => {
  const calls = [];
  const ghJsonImpl = async (path) => {
    calls.push(path);
    if (path.includes("/compare/main...")) return { ahead_by: 2, behind_by: 7 };
    if (path.includes("/pulls?head=")) return [{ number: 42 }];
    if (path.endsWith("/pulls/42")) return { number: 42, merged: true, merged_at: "2026-09-23T00:00:00Z" };
    throw new Error(`unexpected API call: ${path}`);
  };
  const r = await gatherRemoteEvidence("o", "r", "feature/y", {
    knownExistsOnOrigin: true,
    ghJsonImpl,
  });
  assert.equal(r.existsOnOrigin, true);
  assert.equal(r.aheadOfMain, 2);
  assert.equal(r.prs[0].merged, true);
  assert.equal(calls.some((p) => p.includes("/branches/")), false);
  assert.deepEqual(calls, [
    "/repos/o/r/compare/main...feature%2Fy",
    "/repos/o/r/pulls?head=o:feature%2Fy&state=all",
    "/repos/o/r/pulls/42",
  ]);
});
