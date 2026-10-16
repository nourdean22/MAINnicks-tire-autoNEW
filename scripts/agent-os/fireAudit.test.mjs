// Canary for the fire audit's long-path fix: a transcript whose path is over 260 characters must be scanned, not
// skipped (2026-10-16: the audit died in scan_usage with FileNotFoundError on a harness-worktree transcript path).
// Runs the REAL script as a child process with the transcript root pointed at a temp tree. Skipped when python is absent.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, ".claude", "skills", "skill-fire-audit", "scripts", "fire_audit.py");

function python() {
  for (const bin of ["python", "python3"]) {
    const r = spawnSync(bin, ["--version"], { encoding: "utf8" });
    if (r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`)) return bin;
  }
  return null;
}

const PY = python();

test("a transcript path over 260 characters is scanned and counted, not skipped", { skip: PY ? false : "python not installed" }, () => {
  const base = mkdtempSync(join(tmpdir(), "fire-audit-"));
  // Mirror the real shape: projects/<very long project dir>/<uuid>.jsonl, total length past MAX_PATH.
  const projects = join(base, "projects");
  let dir = join(projects, "C--Users-nourd-AppData-Local-Temp-claude-" + "x".repeat(120) + "-workspac-hppf4t");
  while (dir.length + 42 < 270) dir = join(dir, "deeper-" + "y".repeat(40));
  mkdirSync(dir, { recursive: true });
  const transcript = join(dir, "19d3f1ef-0000-4000-8000-000000000000.jsonl");
  assert.ok(transcript.length > 260, `fixture path is only ${transcript.length} chars`);
  const line = JSON.stringify({ message: { content: [{ type: "tool_use", name: "Skill", input: { skill: "guard-red-team" } }] } });
  writeFileSync(transcript, line + "\n");
  const out = join(base, "audit.json");
  const r = spawnSync(PY, ["-I", SCRIPT, "--days", "1", "--json", out], {
    cwd: ROOT, encoding: "utf8", timeout: 120000, env: { ...process.env, FIRE_AUDIT_TRANSCRIPTS: projects },
  });
  assert.equal(r.status, 0, `${r.stdout}\n${r.stderr}`);
  const j = JSON.parse(readFileSync(out, "utf8"));
  assert.equal(j.transcripts, 1, `transcripts scanned: ${j.transcripts}`);
  assert.equal(j.skipped, 0, `transcripts skipped: ${j.skipped}`);
  assert.equal(j.fired["guard-red-team"], 1, "the Skill call inside the long-path transcript was not counted");
  assert.match(r.stdout, /transcripts skipped : 0/);
});
