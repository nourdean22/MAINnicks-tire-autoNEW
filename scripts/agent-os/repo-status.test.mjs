/**
 * Canaries for repo-status.mjs's pure parts (Session Authority · 2026-09-23).
 * No network — parseWorktreePorcelain and formatStatusTable are pure functions.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseWorktreePorcelain, formatStatusTable } from "./repo-status.mjs";

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
