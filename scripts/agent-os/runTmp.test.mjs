/**
 * Canary for runTmp.mjs: a test run gets its own temp root, and every fixture a test leaves
 * in os.tmpdir() goes away with it.
 *
 * Why (2026-10-21): tests create fixture repos with mkdtempSync(join(tmpdir(), "<prefix>"))
 * and almost none delete them. One machine held 8,728 leaked fixture repos after a week, and
 * 14,373 temp dirs two days later, nearly all fixtures (infra-approve-* alone 7,937). verify.mjs and both apps' vitest
 * configs now point TEMP/TMP/TMPDIR at a run-scoped dir and delete it when the run ends.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRunTmp, RUN_TMP_ENV } from "./runTmp.mjs";

// A child process that leaks a fixture the way the leaking tests do, and prints its path.
const LEAKER = [
  "const fs = require('node:fs'), os = require('node:os'), path = require('node:path');",
  "const d = fs.mkdtempSync(path.join(os.tmpdir(), 'leak-probe-'));",
  "fs.mkdirSync(path.join(d, '.git', 'objects'), { recursive: true });",
  "fs.writeFileSync(path.join(d, '.git', 'objects', 'pack'), 'x', { mode: 0o444 });",
  "console.log(d);",
].join(" ");

test("a fixture leaked by a child under the run env lands inside the run dir and is gone after cleanup", () => {
  const run = createRunTmp("runtmp-canary-");
  const r = spawnSync(process.execPath, ["-e", LEAKER], { env: { ...process.env, ...run.env }, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const leaked = r.stdout.trim();
  assert.ok(leaked.startsWith(run.dir), `fixture ${leaked} should be inside ${run.dir}`);
  assert.ok(existsSync(leaked), "the fixture exists while the run is live");
  assert.equal(run.env[RUN_TMP_ENV], run.dir);
  for (const k of ["TEMP", "TMP", "TMPDIR"]) assert.equal(run.env[k], run.dir, `${k} points at the run dir`);
  assert.equal(run.cleanup(), true);
  assert.equal(existsSync(run.dir), false, "the run dir is removed, read-only git objects included");
});

test("cleanup unlinks a junction or symlink inside the run dir without deleting what it points at", () => {
  const outside = mkdtempSync(join(tmpdir(), "runtmp-outside-"));
  try {
    mkdirSync(join(outside, "keep"));
    writeFileSync(join(outside, "keep", "file.txt"), "shared");
    const run = createRunTmp("runtmp-canary-");
    symlinkSync(outside, join(run.dir, "node_modules"), process.platform === "win32" ? "junction" : "dir");
    assert.equal(run.cleanup(), true);
    assert.equal(existsSync(run.dir), false);
    assert.ok(existsSync(join(outside, "keep", "file.txt")), "the link target survives");
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("cleanup of an already-removed run dir is a no-op, not a throw", () => {
  const run = createRunTmp("runtmp-canary-");
  rmSync(run.dir, { recursive: true, force: true });
  assert.doesNotThrow(() => run.cleanup());
});

test("the run dir is created under the caller's temp dir with the given prefix", () => {
  const run = createRunTmp("runtmp-canary-");
  try {
    assert.ok(readdirSync(tmpdir()).some((n) => join(tmpdir(), n) === run.dir));
    assert.match(run.dir, /runtmp-canary-/);
  } finally {
    run.cleanup();
  }
});

// Wiring: verify.mjs is the only launcher of this file in CI (agent-policy.yml), so there the
// run env must be present. A standalone `node --test` run has no run dir and skips.
test("under verify.mjs this test process's os.tmpdir() is the run dir", (t) => {
  const runDir = process.env[RUN_TMP_ENV];
  if (!runDir) {
    if (process.env.CI === "true") assert.fail(`${RUN_TMP_ENV} is unset in CI: verify.mjs no longer scopes TEMP for its tests`);
    t.skip("not launched by verify.mjs");
    return;
  }
  assert.ok(tmpdir().startsWith(runDir), `os.tmpdir() ${tmpdir()} should be inside ${runDir}`);
});
