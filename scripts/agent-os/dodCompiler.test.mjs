/**
 * Canaries for apps/nickstire/scripts/dod-compiler.mjs — per-PR evidence
 * fragments (.completion/evidence.d/<branch-slug>.json), 2026-09-23.
 *
 * Every arm spawns the REAL compiler in a scratch git repo and asserts the exit
 * code AND the requirement id / status in the output (a nonzero exit alone could
 * be a crash). Arms are tagged:
 *   FAILS-ON-OLD — red against main's compiler before fragments existed
 *                  (it never read evidence.d/, so a fresh fragment was "missing");
 *   PINS         — same verdict on old and new; red under the named mutation.
 * DOD_COMPILER=<path to a copy> runs every arm against that copy, which is how
 * both claims were checked.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COMPILER = process.env.DOD_COMPILER ?? path.join(REPO, "apps/nickstire/scripts/dod-compiler.mjs");

// A hook-spawned canary inherits GIT_DIR/GIT_INDEX_FILE from the real commit;
// git in the scratch repo under those would write to the SHARED .git.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));

const git = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const write = (dir, rel, content) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
};

const CRON = "apps/nickstire/server/cron/someJob.ts";
const ADMIN = "apps/nickstire/client/src/pages/admin/Panel.tsx";
const LEGACY_CRON = { ref: "cron evidence written for an EARLIER PR" };
const OLD_FRAGMENT_WALKTHROUGH = { ref: "walkthrough written for an EARLIER PR's fragment" };
const SUPERSEDED = { ref: "an old cron note, kept under a superseded key" };

/**
 * main: a legacy manifest with a (stale-by-now) cron entry and a superseded
 * copy, plus one merged PR's fragment covering operator-walkthrough.
 * Then a `feature` branch off main, where each arm makes its change.
 */
function scratch(t, { legacy = true, baseFiles = {} } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "dod-compiler-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "canary@example.invalid");
  git(dir, "config", "user.name", "canary");
  git(dir, "config", "commit.gpgsign", "false");
  write(dir, "README.md", "scratch\n");
  if (legacy) {
    write(dir, ".completion/evidence.json", {
      evidence: { "cron-fail-closed": LEGACY_CRON, "cron-fail-closed-superseded-2026-09-01": SUPERSEDED },
    });
    write(dir, ".completion/evidence.d/earlier-pr.json", { evidence: { "operator-walkthrough": OLD_FRAGMENT_WALKTHROUGH } });
  }
  for (const [rel, content] of Object.entries(baseFiles)) write(dir, rel, content);
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "base");
  git(dir, "checkout", "-q", "-b", "feature");
  return dir;
}
const commit = (dir) => {
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "change");
};
const run = (dir, base = "main") => {
  const r = spawnSync(process.execPath, [COMPILER, "--base", base, "--enforce"], { cwd: dir, env, encoding: "utf8" });
  return { status: r.status, out: `${r.stdout}\n${r.stderr}` };
};
const line = (out, id) => out.split("\n").find((l) => l.includes(`[${id}]`)) ?? "";

test("PINS: rule path touched, no fragment, legacy entry untouched -> RED, cron-fail-closed STALE", (t) => {
  const dir = scratch(t);
  write(dir, CRON, "export {};\n");
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(line(r.out, "cron-fail-closed"), /STALE/);
});

test("FAILS-ON-OLD: a NEW fragment carrying the requirement -> GREEN, and it names the fragment", (t) => {
  const dir = scratch(t);
  write(dir, CRON, "export {};\n");
  write(dir, ".completion/evidence.d/chore-this-pr.json", { evidence: { "cron-fail-closed": { ref: "cron.test.ts: fail-closed for non-operator" } } });
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 0, r.out);
  assert.match(line(r.out, "cron-fail-closed"), /PASSED — \.completion\/evidence\.d\/chore-this-pr\.json: cron\.test\.ts/);
});

test("FAILS-ON-OLD: a fragment with an explicit deferral -> GREEN as DEFERRED, never silent", (t) => {
  const dir = scratch(t);
  write(dir, CRON, "export {};\n");
  write(dir, ".completion/evidence.d/chore-this-pr.json", { evidence: { "cron-fail-closed": { deferred: "operator-pending live run" } } });
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 0, r.out);
  assert.match(line(r.out, "cron-fail-closed"), /◐ .*DEFERRED/);
});

test("PINS (mutation: drop the base-value check): a fragment already on base, unchanged -> RED, STALE names that file", (t) => {
  const dir = scratch(t);
  write(dir, ADMIN, "export {};\n");
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(line(r.out, "operator-walkthrough"), /STALE|MISSING/);
  if (!process.env.DOD_COMPILER) assert.match(line(r.out, "operator-walkthrough"), /STALE — \.completion\/evidence\.d\/earlier-pr\.json/);
});

test("PINS (mutation: drop the base-value check): a base fragment RENAMED to this PR's slug -> RED", (t) => {
  const dir = scratch(t);
  write(dir, ADMIN, "export {};\n");
  renameSync(path.join(dir, ".completion/evidence.d/earlier-pr.json"), path.join(dir, ".completion/evidence.d/chore-this-pr.json"));
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(line(r.out, "operator-walkthrough"), /STALE|MISSING/);
});

test("PINS (mutation: drop the base-value check): a superseded legacy value pasted into a fragment under the live key -> RED", (t) => {
  const dir = scratch(t);
  write(dir, CRON, "export {};\n");
  write(dir, ".completion/evidence.d/chore-this-pr.json", { evidence: { "cron-fail-closed": SUPERSEDED } });
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(line(r.out, "cron-fail-closed"), /STALE/);
});

test("PINS: a fresh fragment naming a DIFFERENT requirement -> still RED for the missing one", (t) => {
  const dir = scratch(t);
  write(dir, CRON, "export {};\n");
  write(dir, ".completion/evidence.d/chore-this-pr.json", { evidence: { "policy-matrix": { ref: "matrix.test.ts" } } });
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(line(r.out, "cron-fail-closed"), /STALE/);
});

test("PINS: legacy path still works — rewriting the manifest entry -> GREEN (open PRs keep passing)", (t) => {
  const dir = scratch(t);
  write(dir, CRON, "export {};\n");
  write(dir, ".completion/evidence.json", {
    evidence: { "cron-fail-closed": { ref: "rewritten for THIS diff" }, "cron-fail-closed-superseded-2026-09-01": SUPERSEDED },
  });
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 0, r.out);
  assert.match(line(r.out, "cron-fail-closed"), /PASSED — rewritten for THIS diff/);
});

test("PINS: no evidence anywhere (no manifest, no fragments) -> RED MISSING — the gate is not weakened", (t) => {
  const dir = scratch(t, { legacy: false });
  write(dir, CRON, "export {};\n");
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(line(r.out, "cron-fail-closed"), /MISSING/);
});

test("PINS: an empty entry ({}) in a new fragment is not evidence -> RED", (t) => {
  const dir = scratch(t, { legacy: false });
  write(dir, CRON, "export {};\n");
  write(dir, ".completion/evidence.d/chore-this-pr.json", { evidence: { "cron-fail-closed": {} } });
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(line(r.out, "cron-fail-closed"), /MISSING|STALE/);
});

test("PINS: non-string or blank ref/deferred values are not evidence", (t) => {
  for (const ev of [{ ref: [] }, { ref: {} }, { deferred: [] }, { deferred: "   " }]) {
    const dir = scratch(t, { legacy: false });
    write(dir, CRON, "export {};\n");
    write(dir, ".completion/evidence.d/chore-this-pr.json", { evidence: { "cron-fail-closed": ev } });
    commit(dir);
    const r = run(dir);
    assert.equal(r.status, 1, r.out);
    assert.match(line(r.out, "cron-fail-closed"), /MISSING/);
  }
});

test("FAILS-ON-OLD: a malformed fragment fails --enforce loudly instead of being skipped", (t) => {
  const dir = scratch(t);
  write(dir, "docs/unrelated.md", "no rule path\n");
  write(dir, ".completion/evidence.d/chore-this-pr.json", "{ not json");
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(r.out, /evidence fragment unreadable — \.completion\/evidence\.d\/chore-this-pr\.json/);
});

test("FAILS-ON-OLD + PINS (mutation: drop the base-value check): two concurrent PRs each adding a fragment merge WITHOUT conflict, and B passes on ITS fragment, not A's", (t) => {
  const dir = scratch(t);
  write(dir, CRON, "export {};\n");
  write(dir, ".completion/evidence.d/pr-a.json", { evidence: { "cron-fail-closed": { ref: "A's cron proof" } } });
  commit(dir);
  git(dir, "checkout", "-q", "-b", "pr-b", "main");
  write(dir, "apps/nickstire/server/cron/otherJob.ts", "export {};\n");
  write(dir, ".completion/evidence.d/pr-b.json", { evidence: { "cron-fail-closed": { ref: "B's cron proof" } } });
  commit(dir);
  git(dir, "checkout", "-q", "main");
  git(dir, "merge", "-q", "--no-ff", "-m", "merge A", "feature");
  git(dir, "checkout", "-q", "pr-b");
  const m = spawnSync("git", ["merge", "-q", "--no-edit", "main"], { cwd: dir, env, encoding: "utf8" });
  assert.equal(m.status, 0, `B merging main after A landed must not conflict: ${m.stdout}${m.stderr}`);
  // After the merge, A's fragment is on base: B stays green on its OWN fragment, not A's.
  const r = run(dir);
  assert.equal(r.status, 0, r.out);
  assert.match(line(r.out, "cron-fail-closed"), /pr-b\.json: B's cron proof/);
});

/**
 * Git-derived names are DATA, never shell (2026-09-29). The compiler built shell
 * strings from `git ls-tree` output (`git show "<merge-base>:<name>"`), so once a
 * fragment whose NAME carried $(...) or backticks reached main, the name ran as a
 * command on every later CI run and agent machine. The same string handling also
 * lost the value of any name git C-quotes (a double quote, non-ASCII), so that
 * untouched base fragment read FRESH: a false green. Each arm commits the name on
 * main and asserts that nothing ran AND the untouched value reads STALE.
 */
const markers = (dir) => readdirSync(dir).filter((n) => n.startsWith("PWNED"));
const HOSTILE_NAMES = [
  ["command substitution", ".completion/evidence.d/x$(touch PWNED-subst).json"],
  ["backticks", ".completion/evidence.d/y`touch PWNED-backtick`.json"],
  ["non-ASCII (git C-quotes it)", ".completion/evidence.d/caf\u00e9-pr.json"],
  // A double quote cannot appear in a Windows file name.
  ...(process.platform === "win32" ? [] : [["double quote", '.completion/evidence.d/z";touch PWNED-quote;".json']]),
];
for (const [label, name] of HOSTILE_NAMES) {
  test(`FAILS-ON-OLD: a base fragment named with ${label} is read as a file name, never run, and stays STALE`, (t) => {
    const dir = scratch(t, { baseFiles: { [name]: { evidence: { "cron-fail-closed": { ref: `cron proof merged under a ${label} name` } } } } });
    write(dir, CRON, "export {};\n");
    commit(dir);
    const r = run(dir);
    assert.deepEqual(markers(dir), [], `the fragment name was executed as shell:\n${r.out}`);
    assert.equal(r.status, 1, r.out);
    assert.match(line(r.out, "cron-fail-closed"), /STALE/);
  });
}

test("FAILS-ON-OLD: a CHANGED file git C-quotes still derives its requirement (migration-evidence is anchored on .sql$)", (t) => {
  const dir = scratch(t, { legacy: false });
  write(dir, "apps/nickstire/drizzle/0200_caf\u00e9_backfill.sql", "SELECT 1;\n");
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(line(r.out, "migration-evidence"), /MISSING/);
});

test("FAILS-ON-OLD: a --base starting with '-' is refused, never handed to git as an option", (t) => {
  const dir = scratch(t);
  write(dir, CRON, "export {};\n");
  commit(dir);
  const r = run(dir, "--output=PWNED-option");
  assert.deepEqual(markers(dir), [], `git treated --base as an option and wrote a file:\n${r.out}`);
  assert.equal(r.status, 2, r.out);
  assert.match(r.out, /--base must be a git revision/);
});

// ── A diff-satisfied pass never prints another PR's evidence (2026-10-08) ──────
// `capability-ledger-updated` passes when the ledger JSON is in the diff. The
// printed evidence used to be whatever the legacy manifest held, so a PR showed
// an unrelated earlier PR's ref beside its own pass.
const SERVICE = "apps/nickstire/server/services/someService.ts";
const LEDGER = "apps/nickstire/docs/operations/capability-ledger.json";
const LEGACY_LEDGER = { ref: "ledger evidence written for an EARLIER PR" };
const withLegacyLedger = {
  ".completion/evidence.json": { evidence: { "cron-fail-closed": LEGACY_CRON, "capability-ledger-updated": LEGACY_LEDGER } },
  [LEDGER]: { capabilities: [] },
};

test("FAILS-ON-OLD: ledger in the diff, legacy entry untouched -> GREEN, prints '(satisfied by diff)', never the earlier PR's text", (t) => {
  const dir = scratch(t, { baseFiles: withLegacyLedger });
  write(dir, SERVICE, "export {};\n");
  write(dir, LEDGER, { capabilities: [{ capabilityId: "x" }] });
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 0, r.out);
  const l = line(r.out, "capability-ledger-updated");
  assert.match(l, /PASSED — \(satisfied by diff\)/);
  assert.doesNotMatch(l, /EARLIER PR/);
});

test("PINS: ledger in the diff AND the legacy entry rewritten by this branch -> GREEN, prints this branch's text", (t) => {
  const dir = scratch(t, { baseFiles: withLegacyLedger });
  write(dir, SERVICE, "export {};\n");
  write(dir, LEDGER, { capabilities: [{ capabilityId: "x" }] });
  write(dir, ".completion/evidence.json", { evidence: { "cron-fail-closed": LEGACY_CRON, "capability-ledger-updated": { ref: "ledger rows for THIS change" } } });
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 0, r.out);
  assert.match(line(r.out, "capability-ledger-updated"), /PASSED — ledger rows for THIS change/);
});

test("PINS (control: the pass/fail rule is unchanged): service touched, ledger NOT in the diff, legacy entry untouched -> RED, STALE", (t) => {
  const dir = scratch(t, { baseFiles: withLegacyLedger });
  write(dir, SERVICE, "export {};\n");
  commit(dir);
  const r = run(dir);
  assert.equal(r.status, 1, r.out);
  assert.match(line(r.out, "capability-ledger-updated"), /STALE/);
});
