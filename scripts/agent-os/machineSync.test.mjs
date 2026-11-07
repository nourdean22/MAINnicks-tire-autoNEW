// Canary for scripts/agent-os/machine-sync.mjs (job 2026-11-07-machine-sync-task): the hourly task that keeps every PC at
// origin/main and repaired, without anyone typing "are we in sync". Every arm runs the REAL script as a child process
// against a throwaway origin + clone and a stub bootstrap script; nothing touches the real checkout or profile.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const SCRIPT = join(HERE, "machine-sync.mjs");
const SCRATCH = mkdtempSync(join(tmpdir(), "machine-sync-test-"));
after(() => rmSync(SCRATCH, { recursive: true, force: true }));

const ENV = { ...stripGitLocalEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", env: ENV, timeout: 20000 });
  assert.equal(r.status, 0, `git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};

/** A bare origin with one commit on main, a clone of it, and a second commit pushed to origin from elsewhere. */
function fixture(label) {
  const dir = join(SCRATCH, label);
  const origin = join(dir, "origin.git");
  const seed = join(dir, "seed");
  const clone = join(dir, "clone");
  mkdirSync(seed, { recursive: true });
  git(dir, "init", "--bare", "-b", "main", origin);
  git(seed, "init", "-b", "main");
  writeFileSync(join(seed, "a.txt"), "one\n");
  git(seed, "add", "a.txt");
  git(seed, "commit", "-q", "-m", "one");
  git(seed, "remote", "add", "origin", origin);
  git(seed, "push", "-q", "origin", "main");
  git(dir, "clone", "-q", origin, clone);
  writeFileSync(join(seed, "a.txt"), "two\n");
  git(seed, "commit", "-q", "-am", "two");
  git(seed, "push", "-q", "origin", "main");
  const originHead = git(seed, "rev-parse", "HEAD");
  // The stub stands in for bootstrap-machine.mjs: it records its argv and exits as told.
  const stub = join(dir, "bootstrap-stub.mjs");
  writeFileSync(stub, `import { writeFileSync } from "node:fs";
writeFileSync(${JSON.stringify(join(dir, "stub-argv.json"))}, JSON.stringify(process.argv.slice(2)));
process.stdout.write("[bootstrap] ok      ~/.claude/skills/x\\n[bootstrap] " + (process.env.STUB_EXIT === "1" ? "1 item(s) to fix: run without --check" : "clean") + "\\n");
process.exitCode = Number(process.env.STUB_EXIT || 0);
`);
  const state = join(dir, "state");
  return { dir, clone, originHead, stub, state, stubArgv: () => JSON.parse(readFileSync(join(dir, "stub-argv.json"), "utf8")) };
}

const run = (f, args = [], env = {}) => {
  const r = spawnSync(process.execPath, [SCRIPT, "--repo", f.clone, "--state-dir", f.state, "--bootstrap", f.stub, ...args], { encoding: "utf8", env: { ...ENV, ...env }, timeout: 60000 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const receipt = (f) => JSON.parse(readFileSync(join(f.state, "machine-sync.json"), "utf8"));

test("behind origin on a clean main: pulls to origin's head, repairs (no --check), writes the receipt, exits 0", () => {
  const f = fixture("behind");
  const r = run(f);
  assert.equal(r.code, 0, r.out);
  assert.equal(git(f.clone, "rev-parse", "HEAD"), f.originHead, "did not fast-forward to origin/main");
  const rec = receipt(f);
  assert.equal(rec.sha, f.originHead);
  assert.equal(rec.pulled, true);
  assert.equal(rec.bootstrap.state, "clean");
  assert.equal(rec.ok, true);
  assert.deepEqual(f.stubArgv(), [], "repair mode must run bootstrap without --check");
  assert.equal(typeof rec.versions.node, "string");
  assert.match(r.out, /\[machine-sync\] main [0-9a-f]{7} \(pulled\) \| bootstrap clean \| node v/);
});

test("a dirty tree is never pulled over: no pull, the reason in the receipt, exit 1, HEAD unchanged", () => {
  const f = fixture("dirty");
  const before = git(f.clone, "rev-parse", "HEAD");
  writeFileSync(join(f.clone, "a.txt"), "edited locally\n");
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.equal(git(f.clone, "rev-parse", "HEAD"), before);
  const rec = receipt(f);
  assert.equal(rec.pulled, false);
  assert.match(rec.pullSkipped, /uncommitted changes/);
  assert.equal(rec.ok, false);
  assert.match(r.out, /not pulled: uncommitted changes/);
});

test("a checkout on another branch is left alone: no pull, reason names the branch, exit 1", () => {
  const f = fixture("branch");
  git(f.clone, "checkout", "-q", "-b", "feature/x");
  const r = run(f);
  assert.equal(r.code, 1, r.out);
  assert.match(receipt(f).pullSkipped, /on feature\/x, not main/);
});

test("--check: no pull even when behind, bootstrap runs with --check, the receipt still lands", () => {
  const f = fixture("check");
  const before = git(f.clone, "rev-parse", "HEAD");
  const r = run(f, ["--check"]);
  assert.equal(r.code, 0, r.out);
  assert.equal(git(f.clone, "rev-parse", "HEAD"), before, "--check must not pull");
  assert.deepEqual(f.stubArgv(), ["--check"]);
  assert.equal(receipt(f).pulled, false);
});

test("bootstrap drift or failure makes the run FAILED (exit 1) so the scheduled task's Last Result shows it", () => {
  const f = fixture("drift");
  const r = run(f, [], { STUB_EXIT: "1" });
  assert.equal(r.code, 1, r.out);
  const rec = receipt(f);
  assert.equal(rec.bootstrap.state, "1 item(s) to fix");
  assert.equal(rec.ok, false);
});

test("--status prints the last receipt line without pulling or repairing", () => {
  const f = fixture("status");
  assert.equal(run(f).code, 0);
  rmSync(join(f.dir, "stub-argv.json"));
  const r = run(f, ["--status"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /\[machine-sync\] main [0-9a-f]{7}/);
  assert.equal(existsSync(join(f.dir, "stub-argv.json")), false, "--status must not run bootstrap");
});

test("--status with no receipt yet says so, exit 1", () => {
  const f = fixture("status-none");
  const r = run(f, ["--status"]);
  assert.equal(r.code, 1);
  assert.match(r.out, /never ran/);
});

test("the task is wired: local-services.json lists NOURCITY-Machine-Sync, its register script exists and names the task and the script", () => {
  const services = JSON.parse(readFileSync(join(ROOT, "config", "agent-os", "local-services.json"), "utf8"));
  const task = (services.tasks ?? []).find((t) => t.name === "NOURCITY-Machine-Sync");
  assert.ok(task, "NOURCITY-Machine-Sync missing from config/agent-os/local-services.json tasks");
  assert.equal(task.action, "scripts/agent-os/machine-sync.mjs");
  const ps1 = readFileSync(join(ROOT, task.register), "utf8");
  assert.match(ps1, /NOURCITY-Machine-Sync/);
  assert.match(ps1, /machine-sync\.mjs/);
  assert.match(ps1, /-AtLogOn/, "runs at logon");
  assert.match(ps1, /RepetitionInterval \(New-TimeSpan -Hours 1\)/, "and every hour");
  assert.match(ps1, /MultipleInstances IgnoreNew/);
});
