/**
 * Canaries for github-client.mjs (Session Authority · 2026-09-23).
 *
 * Two live, real-network tests against the actual GitHub API — not mocked — because
 * the bug these guard against (a silent 401 from an unshimmed proxy) only exists in
 * the real HTTP path, per guard-red-team's "probe the real binary end-to-end."
 *
 * positive-control-first: the "broken" test below is run FIRST and must reproduce
 * the actual failure (a 401, on the real API, with a real token) before the "fixed"
 * test is trusted to mean anything.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveToken, ghJson, ghPaginate } from "./github-client.mjs";
import { liveDecision } from "./live-gate.mjs";

const REPO = "nourdean22/MAINnicks-tire-autoNEW";
const auth = resolveToken();
// The two real-API tests below run only when this diff touches the client (or on
// dispatch/schedule, or AGENT_OS_LIVE_GHCLIENT=1): ~2 requests, but on every PR,
// and a spent installation budget 403'd them into every PR's red — live-gate.mjs.
const ghclientGate = liveDecision("AGENT_OS_LIVE_GHCLIENT");
console.log(ghclientGate.reason);
const liveSkip = !ghclientGate.run ? ghclientGate.reason : !auth;

test("a GitHub token can be resolved in this environment (precondition for the rest)", () => {
  assert.ok(auth, "resolveToken() returned null — gh auth token failed AND GH_TOKEN/GITHUB_TOKEN are both unset");
});

test("BROKEN control: a raw fetch() with NODE_USE_ENV_PROXY unset 401s against the real API", { skip: !process.env.HTTPS_PROXY || !auth }, () => {
  // Runs in a CHILD process so this file's own (correctly shimmed) process env is
  // never mutated. Only meaningful when this container actually sits behind a proxy
  // (HTTPS_PROXY set) — otherwise there is nothing for the shim to fix, and the
  // "fixed" test below would pass trivially either way, which is why this control
  // is skipped rather than asserted in that case, not silently green.
  const env = { ...process.env, GH_TOKEN: auth.token };
  delete env.NODE_USE_ENV_PROXY;
  const r = spawnSync(
    process.execPath,
    ["-e", "fetch('https://api.github.com/repos/" + REPO + "',{headers:{Authorization:'Bearer '+process.env.GH_TOKEN,'User-Agent':'x','Accept':'application/vnd.github+json'}}).then(r=>{console.log(r.status);process.exit(0)}).catch(e=>{console.log('ERR '+e.message);process.exit(0)})"],
    { encoding: "utf8", env, timeout: 15000 },
  );
  assert.equal(r.stdout.trim(), "401", `expected the unshimmed control to 401; got: ${r.stdout}${r.stderr}`);
});

test("FIXED: ghJson() reaches the real API and returns this repo", { skip: liveSkip }, () => {
  // Mirrors the BROKEN control above exactly, but in a child with
  // NODE_USE_ENV_PROXY=1 set from process start (setting it mid-process, as this
  // test file's own process would be doing if it called ghJson() in-process, does
  // NOT work — verified: the defensive check in ghFetch caught exactly that gap on
  // this test's first draft). A real subprocess launch is the only faithful way to
  // prove the fix, matching how any actual CLI entry point will run it.
  const env = { ...process.env, NODE_USE_ENV_PROXY: "1", GH_TOKEN: auth.token };
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./github-client.mjs').then(m=>m.ghJson('/repos/" + REPO + "')).then(r=>{console.log(r.full_name);process.exit(0)}).catch(e=>{console.log('ERR '+e.message);process.exit(0)})"],
    { encoding: "utf8", env, cwd: import.meta.dirname, timeout: 15000 },
  );
  assert.equal(r.stdout.trim(), REPO, `expected the shimmed call to succeed; got: ${r.stdout}${r.stderr}`);
});

test("ghFetch throws its specific error when HTTPS_PROXY is set but the flag is not (defensive check)", { skip: !process.env.HTTPS_PROXY }, () => {
  const env = { ...process.env };
  delete env.NODE_USE_ENV_PROXY;
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./github-client.mjs').then(m=>m.ghFetch('/repos/" + REPO + "')).catch(e=>{console.log(e.message);process.exit(0)})"],
    { encoding: "utf8", env, cwd: import.meta.dirname, timeout: 15000 },
  );
  assert.match(r.stdout, /ensureProxyEnv\(\)/, `expected the specific guidance error; got: ${r.stdout}${r.stderr}`);
});

test("resolveToken prefers GH_TOKEN over GITHUB_TOKEN when gh is unavailable", () => {
  // Strip gh from PATH (a directory with none of the real PATH's binaries) so the
  // gh-auth-token branch cannot fire, isolating the env-var fallback order.
  const env = { ...process.env, PATH: "/nonexistent-empty-dir", GH_TOKEN: "token-a", GITHUB_TOKEN: "token-b" };
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./github-client.mjs').then(m=>console.log(JSON.stringify(m.resolveToken())))"],
    { encoding: "utf8", env, cwd: import.meta.dirname, timeout: 10000 },
  );
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.token, "token-a");
  assert.equal(out.source, "GH_TOKEN env");
});

test("resolveToken falls back to GITHUB_TOKEN when GH_TOKEN is absent and gh is unavailable", () => {
  const env = { ...process.env, PATH: "/nonexistent-empty-dir", GITHUB_TOKEN: "token-b" };
  delete env.GH_TOKEN;
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./github-client.mjs').then(m=>console.log(JSON.stringify(m.resolveToken())))"],
    { encoding: "utf8", env, cwd: import.meta.dirname, timeout: 10000 },
  );
  const out = JSON.parse(r.stdout.trim());
  assert.equal(out.token, "token-b");
  assert.equal(out.source, "GITHUB_TOKEN env");
});

test("LIVE: ghPaginate crosses a real page boundary without the numeric-ID proxy 403 (real regression)", { skip: liveSkip }, () => {
  // The repo's own /branches endpoint has 130+ branches (>100 = at least 2 pages)
  // at last count, and this environment's proxy previously 403'd the second page
  // because ghPaginate followed the Link header's numeric-ID URL verbatim. This
  // must be run in a properly-flagged child, same reasoning as the FIXED test above.
  const env = { ...process.env, NODE_USE_ENV_PROXY: "1", GH_TOKEN: auth.token };
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./github-client.mjs').then(m=>m.ghPaginate('/repos/" + REPO + "/branches')).then(b=>{console.log(b.length);process.exit(0)}).catch(e=>{console.log('ERR '+e.message);process.exit(0)})"],
    { encoding: "utf8", env, cwd: import.meta.dirname, timeout: 20000 },
  );
  const out = r.stdout.trim();
  assert.doesNotMatch(out, /^ERR/, `ghPaginate failed: ${out}${r.stderr}`);
  assert.ok(Number(out) > 100, `expected >100 branches (proof pagination actually crossed a page boundary), got ${out}`);
});

test("resolveToken returns null when nothing is available", () => {
  const env = { ...process.env, PATH: "/nonexistent-empty-dir" };
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  const r = spawnSync(
    process.execPath,
    ["-e", "import('./github-client.mjs').then(m=>console.log(JSON.stringify(m.resolveToken())))"],
    { encoding: "utf8", env, cwd: import.meta.dirname, timeout: 10000 },
  );
  assert.equal(r.stdout.trim(), "null");
});

test("API meter: with AGENT_OS_GH_CALL_LOG set, each request appends {script, method, path}; unset, nothing is written", (t) => {
  // No network: the request targets a closed local port, and the meter records
  // before fetch() runs, so the line is written even though the call fails.
  const dir = mkdtempSync(join(tmpdir(), "gh-meter-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const log = join(dir, "calls.jsonl");
  const script = "import('./github-client.mjs').then(m=>m.ghFetch('http://127.0.0.1:9/repos/o/r/pulls',{method:'GET'})).catch(()=>{}).finally(()=>process.exit(0))";
  const base = { ...process.env, PATH: "/nonexistent-empty-dir", GH_TOKEN: "t" };
  delete base.HTTPS_PROXY;
  delete base.AGENT_OS_GH_CALL_LOG;
  spawnSync(process.execPath, ["-e", script], { cwd: import.meta.dirname, encoding: "utf8", env: { ...base, AGENT_OS_GH_CALL_LOG: log }, timeout: 15000 });
  const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines, [{ script: "(eval)", method: "GET", path: "/repos/o/r/pulls" }]);
  spawnSync(process.execPath, ["-e", script], { cwd: import.meta.dirname, encoding: "utf8", env: base, timeout: 15000 });
  assert.equal(readFileSync(log, "utf8").trim().split("\n").length, 1, "a run without the env var must not write");
});
