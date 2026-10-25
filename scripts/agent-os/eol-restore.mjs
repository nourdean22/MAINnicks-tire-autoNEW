#!/usr/bin/env node
/**
 * eol-restore.mjs <path> [--ref origin/main]  (2026-10-25, job no-permission-rules)
 *
 * A line-ending-only restore the guard allows. A blob committed with a CRLF line under `text eol=lf` reads
 * permanently dirty, and `git merge --ff-only` then refuses whenever the incoming commit changes that path
 * (witnessed on apps/statenour/components/brain/pinned-context-panel.tsx). Rule destructive-restore denies
 * the raw discard forms because they would also throw away a REAL edit; this script refuses a real edit and
 * does the restore only when the difference is line endings.
 *
 * 1. Refuses (exit 2) unless the path is a tracked, unconflicted regular file (never a symlink: the write
 *    would follow it), present at <ref> as a regular file, the worktree differs from the index, and both the
 *    worktree and the index differ by CR-at-end-of-line only (git diff --ignore-cr-at-eol, worktree and
 *    --cached). Whitespace edits are real edits (strings, YAML, Markdown) and are refused. A clean path is
 *    refused too: there is nothing to restore, and writing the ref's copy would stage a change nobody asked for.
 * 2. Copies the worktree file to the temp directory with a timestamp and prints the path.
 * 3. Writes the ref's blob bytes into the file, gives it the ref's mode, and stages it (git add -- <path>).
 * 4. Prints the index entry and the ref entry (mode and blob); exit 0 only when both match, else exit 1.
 * Then `git merge --ff-only <ref>` goes through. Exit 0 ok, 1 restored but not clean, 2 refused.
 */
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, lstatSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

function git(args, cwd, buffer = false) {
  const r = spawnSync("git", args, { cwd, encoding: buffer ? "buffer" : "utf8", maxBuffer: 512 * 1024 * 1024 });
  return { code: r.status, out: r.stdout, err: String(r.stderr ?? "") };
}
function refuse(msg) {
  process.stderr.write(`[eol-restore] REFUSED: ${msg}\n`);
  process.exit(2);
}
const REGULAR = new Set(["100644", "100755"]);

const argv = process.argv.slice(2);
let ref = "origin/main";
const refAt = argv.indexOf("--ref");
if (refAt !== -1) {
  ref = argv[refAt + 1] ?? "";
  argv.splice(refAt, 2);
}
const target = argv[0];
if (argv.length !== 1 || !target || target.startsWith("-")) refuse("usage: eol-restore.mjs <path> [--ref <ref>]");
if (!ref || ref.startsWith("-")) refuse(`bad --ref "${ref}"`);

const top = git(["rev-parse", "--show-toplevel"], process.cwd());
if (top.code !== 0) refuse("not inside a git work tree");
const root = top.out.trim();
const abs = resolve(process.cwd(), target);
const rel = relative(root, abs).replace(/\\/g, "/");
if (!rel || rel.startsWith("..") || isAbsolute(rel)) refuse(`${target} is outside ${root}`);

if (git(["ls-files", "--error-unmatch", "--", rel], root).code !== 0) refuse(`${rel} is not tracked`);
if (git(["ls-files", "-u", "--", rel], root).out.trim()) refuse(`${rel} has merge conflicts`);
const indexMode = git(["ls-files", "-s", "--", rel], root).out.trim().split(/\s+/)[0] ?? "";
let isLink = false;
try {
  isLink = lstatSync(abs).isSymbolicLink();
} catch {} // a missing worktree file is caught by the diff checks below
if (indexMode === "120000" || isLink) refuse(`${rel} is a symlink; writing would follow the link; nothing was touched`);
if (!REGULAR.has(indexMode)) refuse(`${rel} is not a regular file (mode ${indexMode}); nothing was touched`);
const refLine = git(["ls-tree", ref, "--", rel], root);
const [refMode = "", refType = "", refId = ""] = refLine.code === 0 ? refLine.out.trim().split(/\s+/) : [];
if (!refId || refType !== "blob") refuse(`${rel} does not exist at ${ref}`);
if (!REGULAR.has(refMode)) refuse(`${rel} is not a regular file at ${ref} (mode ${refMode})`);

// Empty output = every difference was a CR before a line end. A diff that cannot run is not "no difference".
function lineEndingsOnly(args, path) {
  const r = git([...args, "--ignore-cr-at-eol", "--no-ext-diff", "--no-textconv", "--", path], root);
  return r.code === 0 && r.out.trim() === "";
}
if (!lineEndingsOnly(["diff", "--cached"], rel)) refuse(`${rel} has a real staged change (not line endings); commit or unstage it first`);
if (!lineEndingsOnly(["diff"], rel)) refuse(`${rel} has a real change in the worktree (not line endings); nothing was touched`);
const raw = git(["diff", "--name-only", "--no-ext-diff", "--", rel], root);
if (raw.code !== 0 || !raw.out.trim()) refuse(`${rel} has no line-ending difference to restore (the worktree matches the index); nothing was touched`);

if (existsSync(abs)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = join(tmpdir(), `eol-restore-${stamp}-${basename(rel)}`);
  copyFileSync(abs, backup);
  console.log(`backup: ${backup}`);
}

const blob = git(["cat-file", "blob", refId], root, true);
if (blob.code !== 0) refuse(`cannot read ${ref}:${rel}: ${blob.err.trim()}`);
writeFileSync(abs, blob.out);
if (process.platform !== "win32") chmodSync(abs, refMode === "100755" ? 0o755 : 0o644);
const add = git(["add", "--", rel], root);
if (add.code !== 0) {
  process.stderr.write(`[eol-restore] git add failed: ${add.err.trim()}\n`);
  process.exit(1);
}
// git add keeps the old index mode when core.filemode is false (Windows), so set the ref's mode explicitly.
const staged = () => git(["ls-files", "-s", "--", rel], root).out.trim().split(/\s+/);
if (staged()[0] !== refMode) git(["update-index", `--chmod=${refMode === "100755" ? "+x" : "-x"}`, "--", rel], root);
const [mode, indexId] = staged();
console.log(`index ${mode} ${indexId}`);
console.log(`ref ${refMode} ${refId}`);
if (indexId !== refId) {
  process.stderr.write(
    `[eol-restore] the index blob differs from the ref blob: ${ref}'s copy is not clean under this path's attributes, ` +
      `so the tree will still read dirty. Pick a ref with a clean blob (origin/main after the fix).\n`,
  );
  process.exit(1);
}
if (mode !== refMode) {
  process.stderr.write(`[eol-restore] the index mode ${mode} differs from the ref mode ${refMode}; the fast-forward will refuse.\n`);
  process.exit(1);
}
console.log(`[eol-restore] ${rel} now matches ${ref}; run: git merge --ff-only ${ref}`);
