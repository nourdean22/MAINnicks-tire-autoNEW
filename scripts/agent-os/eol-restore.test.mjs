// Canaries for eol-restore.mjs (2026-10-25, job no-permission-rules).
// The incident: a committed blob with one CRLF line under `text eol=lf` reads permanently dirty, and
// `git merge --ff-only` refuses because the incoming commit changes that path. The script must make the
// fast-forward possible AND refuse anything that is a real edit. Every fixture is a scratch repo with
// GIT_* stripped (a hook-inherited GIT_DIR would point the fixture at the shared .git: guard-red-team 6).
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "eol-restore.mjs");
const ENV = { ...stripGitLocalEnv(process.env), GIT_CONFIG_NOSYSTEM: "1" };
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function git(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, env: ENV, encoding: "utf8" });
  return { code: r.status, stdout: r.stdout, out: `${r.stdout}${r.stderr}` };
}
function ok(cwd, ...args) {
  const r = git(cwd, ...args);
  assert.equal(r.code, 0, `git ${args.join(" ")} failed: ${r.out}`);
  return r.stdout;
}
function run(cwd, args, script = SCRIPT) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, env: ENV, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const MIXED = "a\nb\r\nc\n"; // one CRLF line, as in pinned-context-panel.tsx (761 lines, 1 CRLF)

// main: a mixed blob committed BEFORE `text eol=lf` landed; upstream: the LF-clean fix that also changes content.
// filemode: true is the Linux CI shape (git tracks the worktree's executable bit); Windows defaults it to false.
function fixture({ exec = false, filemode } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "eol-restore-"));
  dirs.push(dir);
  ok(dir, "init", "-q", "-b", "main");
  ok(dir, "config", "user.email", "t@example.invalid");
  ok(dir, "config", "user.name", "t");
  ok(dir, "config", "core.autocrlf", "false");
  if (filemode !== undefined) ok(dir, "config", "core.filemode", String(filemode));
  writeFileSync(join(dir, "f.tsx"), MIXED);
  ok(dir, "add", "f.tsx");
  ok(dir, "commit", "-q", "-m", "mixed blob");
  writeFileSync(join(dir, ".gitattributes"), "*.tsx text eol=lf\n");
  ok(dir, "add", ".gitattributes");
  ok(dir, "commit", "-q", "-m", "attrs");
  ok(dir, "switch", "-q", "-c", "upstream");
  writeFileSync(join(dir, "f.tsx"), "a\nb\nc\nd\n");
  ok(dir, "add", "f.tsx");
  ok(dir, "commit", "-q", "-m", "lf clean + new line");
  ok(dir, "switch", "-q", "main");
  // The ref also changes the mode: built in a scratch index, so no worktree or index is ever mode-dirty (with
  // core.filemode=true an index-only chmod leaves the file dirty and the switch above aborts: CI, round 3).
  if (exec) {
    const env = { ...ENV, GIT_INDEX_FILE: join(dir, ".git", "exec-index") };
    const plumb = (...args) => {
      const r = spawnSync("git", args, { cwd: dir, env, encoding: "utf8" });
      assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
      return r.stdout.trim();
    };
    plumb("read-tree", "upstream");
    plumb("update-index", "--chmod=+x", "f.tsx");
    const tree = plumb("write-tree");
    plumb("update-ref", "refs/heads/upstream", plumb("commit-tree", tree, "-p", "upstream", "-m", "make it executable"));
  }
  // Same bytes, new mtime: git re-hashes through eol=lf and the file reads dirty for good.
  writeFileSync(join(dir, "f.tsx"), MIXED);
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(dir, "f.tsx"), later, later);
  return dir;
}
const status = (dir) => ok(dir, "status", "--porcelain").trim();

test("fixture reproduces the incident: dirty with no content change, and the fast-forward is refused", () => {
  const dir = fixture();
  assert.match(status(dir), /^ ?M f\.tsx$/m, "the mixed blob must read dirty");
  assert.equal(ok(dir, "diff", "--ignore-cr-at-eol", "--", "f.tsx").trim(), "", "the change is line endings only");
  const ff = git(dir, "merge", "--ff-only", "upstream");
  assert.notEqual(ff.code, 0, "ff must be refused while the file is dirty");
  assert.match(ff.out, /would be overwritten/);
});

test("eol-restore makes the fast-forward succeed and leaves a clean tree", () => {
  const dir = fixture();
  const r = run(dir, ["f.tsx", "--ref", "upstream"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /backup: .*eol-restore-/);
  const blob = ok(dir, "rev-parse", "upstream:f.tsx").trim();
  assert.match(r.out, new RegExp(`index 100644 ${blob}`));
  assert.match(r.out, new RegExp(`ref 100644 ${blob}`));
  const ff = git(dir, "merge", "--ff-only", "upstream");
  assert.equal(ff.code, 0, ff.out);
  assert.equal(status(dir), "", "tree clean after the fast-forward");
});

test("the backup holds the worktree bytes as they were", () => {
  const dir = fixture();
  const r = run(dir, ["f.tsx", "--ref", "upstream"]);
  const backup = /backup: (.+)/.exec(r.out)?.[1]?.trim();
  assert.ok(backup, r.out);
  assert.equal(readFileSync(backup, "utf8"), MIXED);
  dirs.push(backup);
});

test("CONTROL: a real content edit in the worktree is refused, file untouched", () => {
  const dir = fixture();
  writeFileSync(join(dir, "f.tsx"), "a\nb\r\nEDIT\n");
  const r = run(dir, ["f.tsx", "--ref", "upstream"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: f\.tsx has a real change in the worktree/);
  assert.equal(readFileSync(join(dir, "f.tsx"), "utf8"), "a\nb\r\nEDIT\n");
});

test("CONTROL: a whitespace-only edit is a real edit too (strings and YAML care)", () => {
  const dir = fixture();
  writeFileSync(join(dir, "f.tsx"), "a\nb \r\nc\n");
  const r = run(dir, ["f.tsx", "--ref", "upstream"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: f\.tsx has a real change in the worktree/);
});

// A staged real edit whose index blob keeps a CR (no clean filter), so the worktree differs from the index by
// line endings only: the staged check is then the ONLY layer that can refuse it (pinned separately).
const STAGED = "a\nb\r\nSTAGED\n";
function stagedEditFixture() {
  const dir = fixture();
  writeFileSync(join(dir, "f.tsx"), STAGED);
  const sha = ok(dir, "hash-object", "-w", "--no-filters", "f.tsx").trim();
  ok(dir, "update-index", "--cacheinfo", `100644,${sha},f.tsx`);
  const later = new Date(Date.now() + 120_000);
  utimesSync(join(dir, "f.tsx"), later, later);
  return dir;
}

test("CONTROL: a staged real edit is refused even when the worktree differs from the index by line endings only", () => {
  const dir = stagedEditFixture();
  assert.equal(ok(dir, "diff", "--ignore-cr-at-eol", "--", "f.tsx").trim(), "", "fixture: worktree vs index is CR only");
  const r = run(dir, ["f.tsx", "--ref", "upstream"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: f\.tsx has a real staged change/);
  assert.equal(ok(dir, "show", ":f.tsx"), STAGED, "the staged edit survives");
});

test("CONTROL: an untracked path, a path missing from the ref, and an option-shaped argument are refused", () => {
  const dir = fixture();
  writeFileSync(join(dir, "new.tsx"), "x\n");
  assert.equal(run(dir, ["new.tsx", "--ref", "upstream"]).code, 2);
  assert.equal(run(dir, [".gitattributes", "--ref", "main~1"]).code, 2, "path absent at the ref");
  assert.equal(run(dir, ["f.tsx", "--ref", "no-such-ref"]).code, 2, "unknown ref");
  assert.equal(run(dir, ["--", "f.tsx"]).code, 2);
  assert.equal(run(dir, ["f.tsx", "--ref", "--output=x"]).code, 2);
  assert.equal(run(dir, []).code, 2);
});

test("a ref whose blob is not clean under the path's attributes exits 1 (no false success)", () => {
  const dir = fixture();
  const r = run(dir, ["f.tsx", "--ref", "HEAD"]); // HEAD holds the mixed blob; git add normalises it to a new id
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /index blob differs from the ref blob/);
});

// Round 2 (Codex P2s on PR 3285): a clean path, a symlink, and a ref that changes the mode.
test("CONTROL: a path with nothing to restore (clean, or a mistyped clean file) is refused, ref content not staged", () => {
  const dir = fixture();
  // The clean filter normalises the index, so the worktree and the index now agree. Not committed: HEAD must stay
  // an ancestor of upstream, so this arm is judged by the nothing-to-restore check alone (round 3).
  ok(dir, "add", "f.tsx");
  const before = ok(dir, "ls-files", "-s", "--", "f.tsx");
  const r = run(dir, ["f.tsx", "--ref", "upstream"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: f\.tsx has no line-ending difference to restore/);
  assert.equal(ok(dir, "ls-files", "-s", "--", "f.tsx"), before, "nothing written, nothing staged");
  assert.equal(readFileSync(join(dir, "f.tsx"), "utf8"), MIXED);
});

test("CONTROL: a tracked symlink is refused before anything is written (the write would follow the link)", () => {
  const dir = fixture();
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, env: ENV, input: "f.tsx", encoding: "utf8" }).stdout.trim();
  ok(dir, "update-index", "--add", "--cacheinfo", `120000,${blob},link.tsx`);
  ok(dir, "commit", "-q", "-m", "symlink entry");
  writeFileSync(join(dir, "link.tsx"), "f.tsx\r\n"); // what core.symlinks=false checks out, dirtied by a CR
  const r = run(dir, ["link.tsx", "--ref", "HEAD"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: link\.tsx is a symlink/);
});

test("CONTROL: a worktree symlink over a regular entry is refused and its target outside the repo is untouched", (t) => {
  const dir = fixture();
  const outside = mkdtempSync(join(tmpdir(), "eol-restore-outside-"));
  dirs.push(outside);
  writeFileSync(join(outside, "target.tsx"), "a\nb\r\nc\n");
  rmSync(join(dir, "f.tsx"));
  try {
    symlinkSync(join(outside, "target.tsx"), join(dir, "f.tsx"), "file");
  } catch (err) {
    if (err.code === "EPERM") return t.skip("no symlink privilege on this machine (Linux CI runs this arm)");
    throw err;
  }
  const r = run(dir, ["f.tsx", "--ref", "upstream"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: f\.tsx is a symlink/);
  assert.equal(readFileSync(join(outside, "target.tsx"), "utf8"), "a\nb\r\nc\n");
});

// Round 3 (Codex P2s): a ref that is not a fast-forward of HEAD, and a path that only matches as a glob.
test("CONTROL: a --ref that HEAD is not an ancestor of is refused (its blob would be staged, then no fast-forward)", () => {
  const dir = fixture();
  const env = { ...ENV, GIT_INDEX_FILE: join(dir, ".git", "side-index") };
  const plumb = (...args) => spawnSync("git", args, { cwd: dir, env, encoding: "utf8" }).stdout.trim();
  plumb("read-tree", "main");
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, env: ENV, input: "a\nb\nc\nSIDE\n", encoding: "utf8" }).stdout.trim();
  plumb("update-index", "--cacheinfo", `100644,${blob},f.tsx`);
  ok(dir, "update-ref", "refs/heads/side", plumb("commit-tree", plumb("write-tree"), "-p", "main~1", "-m", "divergent"));
  assert.notEqual(git(dir, "merge-base", "--is-ancestor", "HEAD", "side").code, 0, "fixture: side diverges from HEAD");
  const r = run(dir, ["f.tsx", "--ref", "side"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: side is not a fast-forward of HEAD/);
  assert.equal(ok(dir, "diff", "--cached", "--name-only").trim(), "", "nothing staged");
});

// The ref holds a LITERAL "[f].tsx", the worktree does not: as a pathspec glob, "[f].tsx" matches the tracked
// f.tsx, so every check but the ref lookup would be judging the wrong file.
test("CONTROL: a path that matches a tracked file only as a glob ([f].tsx) is refused, nothing written or staged", () => {
  const dir = fixture();
  const env = { ...ENV, GIT_INDEX_FILE: join(dir, ".git", "glob-index") };
  const plumb = (...args) => spawnSync("git", args, { cwd: dir, env, encoding: "utf8" }).stdout.trim();
  plumb("read-tree", "upstream");
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, env: ENV, input: "x\n", encoding: "utf8" }).stdout.trim();
  plumb("update-index", "--add", "--cacheinfo", `100644,${blob},[f].tsx`);
  ok(dir, "update-ref", "refs/heads/upstream", plumb("commit-tree", plumb("write-tree"), "-p", "upstream", "-m", "literal [f].tsx"));
  const r = run(dir, ["[f].tsx", "--ref", "upstream"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: \[f\]\.tsx (is not tracked|does not exist in the worktree)/);
  assert.equal(readFileSync(join(dir, "f.tsx"), "utf8"), MIXED);
  assert.equal(ok(dir, "diff", "--cached", "--name-only").trim(), "", "nothing staged");
});

test("the executable-ref fixture builds under core.filemode=true (the Linux CI shape that went red in round 3)", () => {
  const dir = fixture({ exec: true, filemode: true });
  assert.match(ok(dir, "ls-tree", "upstream", "--", "f.tsx"), /^100755 /);
  assert.match(status(dir), /^ ?M f\.tsx$/m, "main is dirty by the CR only, not by a mode");
});

test("a ref that also changes the mode: the index gets the ref's mode AND blob, and the fast-forward succeeds", () => {
  const dir = fixture({ exec: true });
  assert.match(ok(dir, "ls-tree", "upstream", "--", "f.tsx"), /^100755 /, "fixture: the ref is executable");
  const r = run(dir, ["f.tsx", "--ref", "upstream"]);
  assert.equal(r.code, 0, r.out);
  assert.match(ok(dir, "ls-files", "-s", "--", "f.tsx"), /^100755 /);
  assert.match(r.out, /index 100755 /);
  assert.match(r.out, /ref 100755 /);
  const ff = git(dir, "merge", "--ff-only", "upstream");
  assert.equal(ff.code, 0, ff.out);
});

// Mutation arms: each layer is pinned separately, anchored on a line that occurs exactly once.
function mutated(from, to) {
  const src = readFileSync(SCRIPT, "utf8");
  assert.equal(src.split(from).length - 1, 1, `mutation anchor must occur once: ${from}`);
  const dir = mkdtempSync(join(tmpdir(), "eol-restore-mut-"));
  dirs.push(dir);
  const p = join(dir, "eol-restore.mjs");
  writeFileSync(p, src.replace(from, to));
  return p;
}

test("MUTATION: without the worktree check, the content edit is no longer refused", () => {
  const p = mutated('if (!lineEndingsOnly(["diff"], rel))', 'if (false && !lineEndingsOnly(["diff"], rel))');
  const dir = fixture();
  writeFileSync(join(dir, "f.tsx"), "a\nb\r\nEDIT\n");
  assert.notEqual(run(dir, ["f.tsx", "--ref", "upstream"], p).code, 2, "the worktree check must be load-bearing");
});

test("MUTATION: without the staged check, the staged edit is no longer refused", () => {
  const p = mutated('if (!lineEndingsOnly(["diff", "--cached"], rel))', 'if (false && !lineEndingsOnly(["diff", "--cached"], rel))');
  const dir = stagedEditFixture();
  assert.notEqual(run(dir, ["f.tsx", "--ref", "upstream"], p).code, 2, "the staged check must be load-bearing");
});

test("MUTATION: without the nothing-to-restore check, a clean path gets the ref's content staged", () => {
  const p = mutated("if (raw.code !== 0 || !raw.out.trim())", "if (false)");
  const dir = fixture();
  ok(dir, "add", "f.tsx");
  assert.notEqual(run(dir, ["f.tsx", "--ref", "upstream"], p).code, 2, "the clean-path check must be load-bearing");
});

test("CONTROL + MUTATION: a tracked file missing from the worktree is refused by the lstat check, exit 2", () => {
  const dir = fixture();
  rmSync(join(dir, "f.tsx"));
  const r = run(dir, ["f.tsx", "--ref", "upstream"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: f\.tsx does not exist in the worktree/);
  const p = mutated("  refuse(`${rel} does not exist in the worktree; nothing was touched`);\n", "");
  assert.doesNotMatch(run(dir, ["f.tsx", "--ref", "upstream"], p).out, /does not exist in the worktree/, "the lstat refusal must be load-bearing");
});

test("MUTATION: without the fast-forward check, a divergent ref's blob is staged", () => {
  const p = mutated("if (ff.code !== 0)", "if (false)");
  const dir = fixture();
  const env = { ...ENV, GIT_INDEX_FILE: join(dir, ".git", "side-index") };
  const plumb = (...args) => spawnSync("git", args, { cwd: dir, env, encoding: "utf8" }).stdout.trim();
  plumb("read-tree", "main");
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, env: ENV, input: "a\nb\nc\nSIDE\n", encoding: "utf8" }).stdout.trim();
  plumb("update-index", "--cacheinfo", `100644,${blob},f.tsx`);
  ok(dir, "update-ref", "refs/heads/side", plumb("commit-tree", plumb("write-tree"), "-p", "main~1", "-m", "divergent"));
  assert.equal(run(dir, ["f.tsx", "--ref", "side"], p).code, 0, "the fast-forward check must be load-bearing");
});

test("MUTATION: with globbing pathspecs (no GIT_LITERAL_PATHSPECS), the [f].tsx case is no longer refused", () => {
  const p = mutated('GIT_LITERAL_PATHSPECS: "1"', 'GIT_LITERAL_PATHSPECS: "0"');
  const dir = fixture();
  const env = { ...ENV, GIT_INDEX_FILE: join(dir, ".git", "glob-index") };
  const plumb = (...args) => spawnSync("git", args, { cwd: dir, env, encoding: "utf8" }).stdout.trim();
  plumb("read-tree", "upstream");
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, env: ENV, input: "x\n", encoding: "utf8" }).stdout.trim();
  plumb("update-index", "--add", "--cacheinfo", `100644,${blob},[f].tsx`);
  ok(dir, "update-ref", "refs/heads/upstream", plumb("commit-tree", plumb("write-tree"), "-p", "upstream", "-m", "literal [f].tsx"));
  // the lstat refusal is the second layer and still holds (the literal file is absent), so assert the FIRST layer's
  // message is gone rather than the exit code: with globbing, ls-files matches f.tsx and "not tracked" never prints
  assert.doesNotMatch(run(dir, ["[f].tsx", "--ref", "upstream"], p).out, /is not tracked/, "literal pathspecs must be load-bearing");
});

test("MUTATION: without the symlink check, the symlink entry is written through", () => {
  const p = mutated('if (indexMode === "120000" || isLink)', "if (false)");
  const dir = fixture();
  const blob = spawnSync("git", ["hash-object", "-w", "--stdin"], { cwd: dir, env: ENV, input: "f.tsx", encoding: "utf8" }).stdout.trim();
  ok(dir, "update-index", "--add", "--cacheinfo", `120000,${blob},link.tsx`);
  ok(dir, "commit", "-q", "-m", "symlink entry");
  writeFileSync(join(dir, "link.tsx"), "f.tsx\r\n");
  assert.doesNotMatch(run(dir, ["link.tsx", "--ref", "HEAD"], p).out, /is a symlink/, "the symlink check must be load-bearing");
});

test("MUTATION: without the mode step, the index keeps 100644 and the script says so (exit 1, never a false 0)", () => {
  const p = mutated("if (staged()[0] !== refMode)", "if (false)");
  const dir = fixture({ exec: true });
  const r = run(dir, ["f.tsx", "--ref", "upstream"], p);
  if (process.platform === "win32") {
    assert.equal(r.code, 1, r.out); // core.filemode=false: git add keeps the old mode
    assert.match(r.out, /index mode 100644 differs from the ref mode 100755/);
  } else {
    assert.equal(r.code, 0, r.out); // the chmod before git add carries the bit on its own: a second layer, by design
  }
});
