/**
 * Canaries for live-gate.mjs (2026-09-23) — the decision that keeps the ~657-request
 * full-sweep canary off unrelated PRs. A gate that always says SKIP would silence a
 * canary forever and still go green, so every arm here asserts BOTH directions, and
 * the end-to-end arms run the real gated test file and read its real TAP output.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decide, importClosure, subjectFor, changedFilesSince, LIVE_CANARIES } from "./live-gate.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const NAME = "AGENT_OS_LIVE_SWEEP";
const subject = subjectFor(NAME);

test("changed subject -> RUN, naming the file that triggered it", () => {
  const d = decide({ name: NAME, changedFiles: ["README.md", "scripts/agent-os/repo-status.mjs"], subject });
  assert.equal(d.run, true);
  assert.match(d.reason, /scripts\/agent-os\/repo-status\.mjs/);
});

test("unrelated diff -> SKIP, with a printed reason that says how to force it", () => {
  const d = decide({ name: NAME, changedFiles: ["apps/nickstire/server/index.ts", "docs/x.md"], subject });
  assert.equal(d.run, false);
  assert.match(d.reason, /touches none of its \d+ subject files/);
  assert.match(d.reason, /AGENT_OS_LIVE_SWEEP=1 to force/);
});

test("env var forces both ways, and beats the diff", () => {
  assert.equal(decide({ name: NAME, envValue: "1", changedFiles: ["docs/x.md"], subject }).run, true);
  assert.equal(decide({ name: NAME, envValue: "0", changedFiles: ["scripts/agent-os/branch-sweep.mjs"], subject }).run, false);
});

test("workflow_dispatch and schedule run every live canary; pull_request and push do not by themselves", () => {
  for (const eventName of ["workflow_dispatch", "schedule"]) {
    assert.equal(decide({ name: NAME, eventName, changedFiles: [], subject }).run, true, eventName);
  }
  for (const eventName of ["pull_request", "push"]) {
    assert.equal(decide({ name: NAME, eventName, changedFiles: [], subject }).run, false, eventName);
  }
});

test("an uncomputable diff RUNS (fails toward coverage, never a blind skip)", () => {
  const d = decide({ name: NAME, changedFiles: null, subject });
  assert.equal(d.run, true);
  assert.match(d.reason, /could not be computed/);
});

test("the sweep subject is the real import closure: it reaches the modules the pipeline calls", () => {
  // If the import scan broke, the subject would shrink to the entry files and a
  // change to repo-status.mjs (where the API calls live) would silently skip.
  for (const f of ["branch-sweep.mjs", "repo-status.mjs", "classify-branch.mjs", "github-client.mjs", "lease.mjs", "live-gate.mjs"]) {
    assert.ok(subject.includes(`scripts/agent-os/${f}`), `sweep subject is missing ${f}`);
  }
  assert.ok(subject.includes(".github/workflows/branch-sweep.yml"));
  assert.ok(!subject.includes("scripts/agent-os/pretool.mjs"), "an unrelated script leaked into the subject");
  // Rescue has its own subject; the sweep's test file is not in it.
  const rescue = subjectFor("AGENT_OS_LIVE_RESCUE");
  assert.ok(rescue.includes("scripts/agent-os/repo-rescue.mjs"));
  assert.ok(!rescue.includes("scripts/agent-os/branch-sweep.test.mjs"));
});

test("importClosure follows static and dynamic relative imports transitively (planted fixture)", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "live-gate-closure-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "a.mjs"), 'import { b } from "./b.mjs";\n');
  writeFileSync(join(dir, "b.mjs"), 'export const b = () => import("./c.mjs");\n');
  writeFileSync(join(dir, "c.mjs"), 'import fs from "node:fs";\n');
  writeFileSync(join(dir, "unused.mjs"), "\n");
  const names = importClosure(["a.mjs"], dir).map((p) => p.split("/").pop());
  assert.deepEqual(names, ["a.mjs", "b.mjs", "c.mjs"]);
});

function gitEnv() {
  // Hooks inherit GIT_DIR/GIT_INDEX_FILE; a fixture git under them hits the real .git.
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
}

test("changedFilesSince: committed + uncommitted + untracked files since base; null on an unknown base", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "live-gate-diff-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (c) => execSync(`git ${c}`, { cwd: dir, encoding: "utf8", env: gitEnv() }).trim();
  git("init -q -b main");
  git('config user.email "t@x.com"');
  git('config user.name "t"');
  writeFileSync(join(dir, "base.txt"), "0");
  git("add base.txt");
  git("commit -q -m base");
  const base = git("rev-parse HEAD");
  writeFileSync(join(dir, "committed.txt"), "1");
  git("add committed.txt");
  git("commit -q -m next");
  writeFileSync(join(dir, "base.txt"), "edited");
  writeFileSync(join(dir, "untracked.txt"), "2");
  assert.deepEqual(changedFilesSince(base, dir), ["base.txt", "committed.txt", "untracked.txt"]);
  assert.deepEqual(changedFilesSince("HEAD", dir), ["base.txt", "untracked.txt"]);
  assert.equal(changedFilesSince("0000000000000000000000000000000000000bad", dir), null);
});

// End-to-end through the REAL gated test file. No GitHub request can happen in
// either arm: the first skips before the sweep, the second has no token or gh.
function runSweepTest(extraEnv) {
  const env = { ...gitEnv(), ...extraEnv };
  delete env.GITHUB_EVENT_NAME;
  delete env.NODE_TEST_CONTEXT; // else the nested runner speaks the parent-runner protocol, not TAP
  return spawnSync(process.execPath, ["--test", "--test-reporter=tap", join(HERE, "branch-sweep.test.mjs")], {
    encoding: "utf8",
    env,
    timeout: 60000,
  });
}

test("E2E: AGENT_OS_LIVE_SWEEP=0 -> the real LIVE sweep test is SKIPPED and prints why", () => {
  const r = runSweepTest({ AGENT_OS_LIVE_SWEEP: "0" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /LIVE, report-only[^\n]*# SKIP[^\n]*AGENT_OS_LIVE_SWEEP=0 forces a skip/);
  assert.match(r.stdout, /# skipped 1\b/);
});

test("E2E: AGENT_OS_LIVE_SWEEP=1 -> the gate lets it through to the token check (no token here, so no request)", () => {
  const r = runSweepTest({
    AGENT_OS_LIVE_SWEEP: "1",
    PATH: dirname(process.execPath), // node only: no gh, so resolveToken() has nothing
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /branch-sweep full pipeline: RUN — AGENT_OS_LIVE_SWEEP=1 forces a live run/);
  assert.match(r.stdout, /LIVE, report-only[^\n]*# SKIP no GitHub token/);
});

test("every governed canary name is wired into a test file (no orphan gate entries)", () => {
  const sources = readdirSync(HERE)
    .filter((f) => f.endsWith(".test.mjs") && f !== "live-gate.test.mjs")
    .map((f) => readFileSync(join(HERE, f), "utf8"))
    .join("\n");
  for (const name of Object.keys(LIVE_CANARIES)) {
    assert.match(sources, new RegExp(`liveDecision\\("${name}"\\)`), `${name} is declared in live-gate.mjs but no test consults it`);
  }
});
