/**
 * Canaries for local-lease-marker.mjs (Session Authority · 2026-09-23).
 * Real fixture git repos — guard-red-team rule 6: GIT_* stripped from every spawn.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeLocalMarker, readLocalMarker, clearLocalMarker, markerPath } from "./local-lease-marker.mjs";

function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
}
function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf8", env: cleanEnv() }).trim();
}
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "lease-marker-fixture-"));
  git(dir, "init -q -b main");
  git(dir, 'config user.email "t@x.com"');
  git(dir, 'config user.name "t"');
  git(dir, "commit -q --allow-empty -m init");
  return dir;
}

test("readLocalMarker: null when nothing has been written", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(readLocalMarker(dir), null);
});

test("write then read round-trips the record; the marker lives inside .git, not the tracked tree", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main", sessionId: "s1", sessionKind: "cloud" });
  const read = readLocalMarker(dir);
  assert.equal(read.branch, "main");
  assert.equal(read.sessionId, "s1");

  const p = markerPath(dir);
  assert.ok(p.includes(`${dir}/.git`) || p.startsWith(dir), `expected the marker inside .git, got ${p}`);
  // Never shows up as a tracked/untracked file — git doesn't see its own metadata dir.
  const status = git(dir, "status --porcelain");
  assert.equal(status, "");
});

test("clearLocalMarker: removes it; a second clear on an already-absent marker does not throw", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main", sessionId: "s1" });
  assert.equal(readLocalMarker(dir).sessionId, "s1");
  clearLocalMarker(dir);
  assert.equal(readLocalMarker(dir), null);
  assert.doesNotThrow(() => clearLocalMarker(dir));
});

test("readLocalMarker: a corrupt marker file reads as null, never throws", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main" });
  const p = markerPath(dir);
  execSync(`echo 'not json{{{' > ${JSON.stringify(p)}`, { shell: "/bin/sh" });
  assert.equal(readLocalMarker(dir), null);
  assert.ok(existsSync(p), "the corrupt file itself is untouched, just not trusted as valid");
});
