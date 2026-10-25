// Canaries for eol-restore.mjs (2026-10-25, job no-permission-rules).
// The incident: a committed blob with one CRLF line under `text eol=lf` reads permanently dirty, and
// `git merge --ff-only` refuses because the incoming commit changes that path. The script must make the
// fast-forward possible AND refuse anything that is a real edit. Every fixture is a scratch repo with
// GIT_* stripped (a hook-inherited GIT_DIR would point the fixture at the shared .git: guard-red-team 6).
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
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
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "eol-restore-"));
  dirs.push(dir);
  ok(dir, "init", "-q", "-b", "main");
  ok(dir, "config", "user.email", "t@example.invalid");
  ok(dir, "config", "user.name", "t");
  ok(dir, "config", "core.autocrlf", "false");
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
  assert.match(r.out, new RegExp(`index blob ${blob}`));
  assert.match(r.out, new RegExp(`ref blob ${blob}`));
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

test("CONTROL: a staged real edit is refused even when the worktree matches the index", () => {
  const dir = fixture();
  writeFileSync(join(dir, "f.tsx"), "a\nb\nSTAGED\n");
  ok(dir, "add", "f.tsx");
  const r = run(dir, ["f.tsx", "--ref", "upstream"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: f\.tsx has a real staged change/);
  assert.equal(ok(dir, "show", ":f.tsx"), "a\nb\nSTAGED\n", "the staged edit survives");
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
  const dir = fixture();
  writeFileSync(join(dir, "f.tsx"), "a\nb\nSTAGED\n");
  ok(dir, "add", "f.tsx");
  assert.notEqual(run(dir, ["f.tsx", "--ref", "upstream"], p).code, 2, "the staged check must be load-bearing");
});
