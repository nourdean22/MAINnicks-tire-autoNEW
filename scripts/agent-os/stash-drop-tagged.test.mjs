// Canaries for stash-drop-tagged.mjs (2026-10-25, job no-permission-rules).
// The stash is shared by every worktree, so rule stash-pop denies a raw drop. The door drops ONE entry, found
// by its full tag (manager-* or session-*), never by an index a sibling's push can shift. Fixture repos only,
// GIT_* stripped, so no test can touch the shared stash.
import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(HERE, "stash-drop-tagged.mjs");
const ENV = { ...stripGitLocalEnv(process.env), GIT_CONFIG_NOSYSTEM: "1" };
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function ok(cwd, ...args) {
  const r = spawnSync("git", args, { cwd, env: ENV, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stdout}${r.stderr}`);
  return r.stdout;
}
function run(cwd, args, script = SCRIPT) {
  const r = spawnSync(process.execPath, [script, ...args], { cwd, env: ENV, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}
// One stash entry per message, oldest first.
function fixture(...messages) {
  const dir = mkdtempSync(join(tmpdir(), "stash-drop-"));
  dirs.push(dir);
  ok(dir, "init", "-q", "-b", "main");
  ok(dir, "config", "user.email", "t@example.invalid");
  ok(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "a.txt"), "0\n");
  ok(dir, "add", "a.txt");
  ok(dir, "commit", "-q", "-m", "base");
  messages.forEach((m, i) => {
    writeFileSync(join(dir, "a.txt"), `${i + 1}\n`);
    ok(dir, "stash", "push", "-q", "-m", m);
  });
  return dir;
}
const subjects = (dir) => ok(dir, "stash", "list", "--format=%gs").trim().split("\n").filter(Boolean);

test("drops exactly the entry carrying the tag, wherever it sits in the stack", () => {
  const dir = fixture("session-mine-1", "sibling work", "manager-other-2");
  const sha = ok(dir, "stash", "list", "--format=%H %gs").split("\n").find((l) => l.endsWith("session-mine-1")).split(" ")[0];
  const r = run(dir, ["session-mine-1"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, new RegExp(`dropped .* ${sha}`));
  assert.deepEqual(subjects(dir), ["On main: manager-other-2", "On main: sibling work"]);
});

test("CONTROL: a tag without the manager- or session- prefix is refused, nothing dropped", () => {
  const dir = fixture("sibling-work");
  const r = run(dir, ["sibling-work"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: .*manager- or session-/);
  assert.equal(subjects(dir).length, 1);
});

test("CONTROL: an unknown tag, an ambiguous tag and a prefix of a longer tag are refused", () => {
  const dir = fixture("session-dup", "session-dup", "session-long-tag");
  assert.equal(run(dir, ["session-missing"]).code, 2);
  const amb = run(dir, ["session-dup"]);
  assert.equal(amb.code, 2, amb.out);
  assert.match(amb.out, /REFUSED: 2 entries carry/);
  assert.equal(run(dir, ["session-long"]).code, 2, "exact tag only, never a prefix");
  assert.equal(subjects(dir).length, 3, "nothing dropped");
});

test("CONTROL: a sibling's message that merely ENDS with the tag is not the tag (whole message, one git prefix)", () => {
  const dir = fixture("sibling-note: session-x");
  const r = run(dir, ["session-x"]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /REFUSED: no stash entry carries the tag session-x/);
  assert.equal(subjects(dir).length, 1, "the sibling's entry survives");
});

test("CONTROL: no argument, an option-shaped argument and a tag with spaces are refused", () => {
  const dir = fixture("session-x");
  assert.equal(run(dir, []).code, 2);
  assert.equal(run(dir, ["--all"]).code, 2);
  assert.equal(run(dir, ["session-x extra"]).code, 2);
  assert.equal(subjects(dir).length, 1);
});

test("MUTATION: without the prefix check, an untagged sibling entry would be dropped", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const anchor = "if (!TAG.test(tag))";
  assert.equal(src.split(anchor).length - 1, 1, "mutation anchor must occur once");
  const mdir = mkdtempSync(join(tmpdir(), "stash-drop-mut-"));
  dirs.push(mdir);
  const p = join(mdir, "stash-drop-tagged.mjs");
  writeFileSync(p, src.replace(anchor, "if (false)"));
  const dir = fixture("sibling-work");
  assert.equal(run(dir, ["sibling-work"], p).code, 0, "the prefix check must be load-bearing");
});

test("MUTATION: matching by suffix (the round-1 code) drops the sibling's 'sibling-note: session-x'", () => {
  const src = readFileSync(SCRIPT, "utf8");
  const anchor = ".filter(([, , subject]) => message(subject) === tag);";
  assert.equal(src.split(anchor).length - 1, 1, "mutation anchor must occur once");
  const mdir = mkdtempSync(join(tmpdir(), "stash-drop-mut-"));
  dirs.push(mdir);
  const p = join(mdir, "stash-drop-tagged.mjs");
  writeFileSync(p, src.replace(anchor, ".filter(([, , subject]) => subject === tag || subject.endsWith(`: ${tag}`));"));
  const dir = fixture("sibling-note: session-x");
  assert.equal(run(dir, ["session-x"], p).code, 0, "whole-message matching must be load-bearing");
});
