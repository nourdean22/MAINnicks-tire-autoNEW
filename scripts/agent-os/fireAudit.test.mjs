// Canaries for the fire audit's transcript scan (2026-10-16: the audit died in scan_usage with FileNotFoundError on a
// harness-worktree transcript path over 260 characters). Three tests, each naming the branch it covers:
//   (a) portable: the per-file try/except. One unreadable transcript among readable ones: the scan continues, counts
//       it as skipped, and still counts the Skill calls in the others.
//   (b) unit: long_path(). The Windows `\\?\` prefix branch on win32, identity elsewhere, from the real function.
//   (c) win32 only: the end-to-end long path (over 260 chars) is scanned, not skipped, through the real script.
// CI is Ubuntu, where (a) and (b) run; (c) is the operator-machine evidence. All skip when python is missing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPTS = join(ROOT, ".claude", "skills", "skill-fire-audit", "scripts");
const SCRIPT = join(SCRIPTS, "fire_audit.py");
const WIN = process.platform === "win32";

function python() {
  for (const bin of ["python", "python3"]) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`)) return bin;
  }
  return null;
}
const PY = python();
const skillCall = (skill) => JSON.stringify({ message: { content: [{ type: "tool_use", name: "Skill", input: { skill } }] } }) + "\n";

function runAudit(projects, out) {
  return spawnSync(PY, ["-I", SCRIPT, "--days", "1", "--json", out], {
    cwd: ROOT, encoding: "utf8", timeout: 120000, env: { ...process.env, FIRE_AUDIT_TRANSCRIPTS: projects },
  });
}

/** Make a file unreadable for the current user: ACL deny on Windows, mode 000 elsewhere. Returns false if that cannot work here. */
function makeUnreadable(file) {
  if (WIN) {
    const r = spawnSync("icacls", [file, "/deny", "*S-1-1-0:(R)"], { encoding: "utf8" });
    return r.status === 0;
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) return false; // root reads anything
  chmodSync(file, 0o000);
  return true;
}

test("(a) per-file try/except: an unreadable transcript is skipped and counted, the others are still scanned", { skip: PY ? false : "python not installed" }, (t) => {
  const base = mkdtempSync(join(tmpdir(), "fire-audit-a-"));
  const projects = join(base, "projects", "proj");
  mkdirSync(projects, { recursive: true });
  writeFileSync(join(projects, "one.jsonl"), skillCall("guard-red-team"));
  writeFileSync(join(projects, "two.jsonl"), skillCall("prod-db-guard"));
  const locked = join(projects, "locked.jsonl");
  writeFileSync(locked, skillCall("never-counted"));
  if (!makeUnreadable(locked)) return t.skip("cannot make a file unreadable here (root or no ACL support)");
  const out = join(base, "audit.json");
  const r = runAudit(join(base, "projects"), out);
  if (WIN) spawnSync("icacls", [locked, "/remove:d", "*S-1-1-0"], { encoding: "utf8" });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const j = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(j.skipped, 1, `transcripts skipped: ${j.skipped}`);
  assert.equal(j.transcripts, 2, `transcripts scanned: ${j.transcripts}`);
  assert.equal(j.fired["guard-red-team"], 1);
  assert.equal(j.fired["prod-db-guard"], 1);
  assert.equal(j.fired["never-counted"], undefined, "the unreadable transcript must not be counted");
  assert.match(r.stdout, /transcripts skipped : 1/);
});

test("(b) long_path(): adds the extended-length prefix on win32 for a path past 248 chars, identity elsewhere and for short paths", { skip: PY ? false : "python not installed" }, () => {
  const probe = [
    "import sys, os; sys.path.insert(0, sys.argv[1]); from fire_audit import long_path",
    "long = 'C:\\\\Users\\\\x\\\\' + 'a' * 300",
    "print(long_path(long).startswith('\\\\\\\\?\\\\'))",
    "print(long_path('C:\\\\short\\\\file.jsonl') == 'C:\\\\short\\\\file.jsonl')",
    "print(long_path(long_path(long)) == long_path(long))",
  ].join("; ");
  const r = spawnSync(PY, ["-c", probe, SCRIPTS], { cwd: ROOT, encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const [prefixed, shortIdentity, idempotent] = r.stdout.trim().split(/\r?\n/);
  assert.equal(prefixed, WIN ? "True" : "False", `prefix branch: ${r.stdout}`);
  assert.equal(shortIdentity, "True", "a short path must come back unchanged");
  assert.equal(idempotent, "True", "a prefixed path must not be prefixed twice");
});

test("(c) win32: a transcript path over 260 characters is scanned and counted end to end", { skip: !PY ? "python not installed" : !WIN ? "Windows MAX_PATH only" : false }, () => {
  const base = mkdtempSync(join(tmpdir(), "fire-audit-c-"));
  const projects = join(base, "projects");
  // A 242-char directory holding a file whose full path passes 260, whatever the temp dir's depth
  // (the test runners now nest it one level deeper). A directory itself past ~248 is not walked by
  // fire_audit.py at all: a separate, known gap, not what this arm pins.
  const head = "C--Users-nourd-AppData-Local-Temp-claude-", tail = "-workspac-hppf4t";
  const dir = join(projects, head + "x".repeat(Math.max(1, 242 - projects.length - 1 - head.length - tail.length)) + tail);
  assert.ok(dir.length < 248, `temp dir too deep for this fixture: directory is ${dir.length} chars`);
  mkdirSync(dir, { recursive: true });
  const transcript = join(dir, "19d3f1ef-0000-4000-8000-000000000000.jsonl");
  assert.ok(transcript.length > 260, `fixture path is only ${transcript.length} chars`);
  writeFileSync(transcript, skillCall("guard-red-team"));
  const out = join(base, "audit.json");
  const r = runAudit(projects, out);
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const j = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(j.transcripts, 1, `transcripts scanned: ${j.transcripts}`);
  assert.equal(j.skipped, 0, `transcripts skipped: ${j.skipped}`);
  assert.equal(j.fired["guard-red-team"], 1, "the Skill call inside the long-path transcript was not counted");
});
