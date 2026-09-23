/**
 * Canaries for lease-check.mjs (Session Authority · 2026-09-23).
 *
 * Two layers, per guard-red-team: the pure decide() function (fast, exhaustive over
 * all six cases) AND the real binary run end-to-end through stdin exactly as the
 * harness invokes it (spawnSync, real fixture repo, real marker files) — a
 * mock-only suite would prove the decision table, not that the actual process
 * wired to it produces the right exit code and stderr content.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { decide } from "./lease-check.mjs";
import { writeLocalMarker } from "./local-lease-marker.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// ── pure decide() — all six cases ────────────────────────────────────────────

const future = new Date(Date.now() + 3600000).toISOString();
const past = new Date(Date.now() - 3600000).toISOString();

test("decide: no marker -> warn/no-marker", () => {
  const r = decide({ marker: null, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "warn");
  assert.equal(r.key, "no-marker");
});

test("decide: marker for a different branch -> warn/wrong-branch", () => {
  const r = decide({ marker: { branch: "other", sessionId: "me", expiresAt: future }, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "warn");
  assert.equal(r.key, "wrong-branch");
});

test("decide: mine, unexpired -> silent allow", () => {
  const r = decide({ marker: { branch: "main", sessionId: "me", expiresAt: future }, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "allow");
});

test("decide: mine, expired -> warn/self-expired", () => {
  const r = decide({ marker: { branch: "main", sessionId: "me", expiresAt: past }, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "warn");
  assert.equal(r.key, "self-expired");
});

test("decide: foreign, expired -> warn/foreign-expired (low risk)", () => {
  const r = decide({ marker: { branch: "main", sessionId: "someone-else", expiresAt: past }, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "warn");
  assert.equal(r.key, "foreign-expired");
});

test("decide: foreign, UNEXPIRED -> block (the real collision case)", () => {
  const r = decide({ marker: { branch: "main", sessionId: "someone-else", expiresAt: future }, branch: "main", mySessionId: "me" });
  assert.equal(r.verdict, "block");
  assert.match(r.message, /someone-else/);
});

// ── real binary, end-to-end, exactly as the harness invokes it ──────────────

function cleanEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
}
function git(cwd, cmd) {
  return execSync(`git ${cmd}`, { cwd, encoding: "utf8", env: cleanEnv() }).trim();
}
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), "lease-check-fixture-"));
  git(dir, "init -q -b main");
  git(dir, 'config user.email "t@x.com"');
  git(dir, 'config user.name "t"');
  git(dir, "commit -q --allow-empty -m init");
  return dir;
}
function runHook(cwd, payload) {
  const env = { ...cleanEnv(), CLAUDE_CODE_SESSION_ID: "me" };
  const r = spawnSync(process.execPath, [join(HERE, "lease-check.mjs")], {
    cwd,
    input: JSON.stringify(payload),
    encoding: "utf8",
    env,
    timeout: 10000,
  });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

test("REAL BINARY: no marker at all -> exit 0, a warning printed", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } });
  assert.equal(r.code, 0);
  assert.match(r.out, /no Session Authority lease marker/);
});

test("REAL BINARY: my own valid marker -> exit 0, SILENT (no output at all)", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main", sessionId: "me", expiresAt: future });
  const r = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } });
  assert.equal(r.code, 0);
  assert.equal(r.out.trim(), "", `expected total silence for my own valid lease; got: ${r.out}`);
});

test("REAL BINARY: a foreign, UNEXPIRED marker -> BLOCKS with exit 2, names the holder", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeLocalMarker(dir, { branch: "main", sessionId: "some-other-session", expiresAt: future });
  const r = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } });
  assert.equal(r.code, 2, `expected a block; got exit ${r.code}: ${r.out}`);
  assert.match(r.out, /some-other-session/);
  assert.match(r.out, /REFUSED/);
});

test("REAL BINARY: throttling — a second call within the window prints nothing more", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } });
  assert.match(first.out, /no Session Authority lease marker/);
  const second = runHook(dir, { cwd: dir, tool_name: "Bash", tool_input: { command: "git status" } });
  assert.equal(second.code, 0);
  assert.equal(second.out.trim(), "", `expected the throttle to suppress a repeat warning; got: ${second.out}`);
});

test("REAL BINARY: no stdin at all (manual run) does not crash — resolves via process.cwd()", (t) => {
  const dir = makeRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const env = { ...cleanEnv(), CLAUDE_CODE_SESSION_ID: "me" };
  const r = spawnSync(process.execPath, [join(HERE, "lease-check.mjs")], { cwd: dir, input: "", encoding: "utf8", env, timeout: 10000 });
  assert.equal(r.status, 0);
});
