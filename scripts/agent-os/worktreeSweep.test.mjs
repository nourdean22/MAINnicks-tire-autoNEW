/**
 * Canary for the worktree sweep in repo-status.mjs (job 2026-10-17-worktree-sweep).
 *
 * This deletes worktrees, so the fixtures are REAL git repos (a bare origin, a primary checkout, worktrees under
 * .claude/worktrees and .worktrees) and only `gh`, the lease read, the clock and (in most arms) the teardown are faked.
 * The fake gh holds the real contract: it answers only the exact argv the sweep may send and throws on anything else.
 *
 * Shape (positive-control-first): one arm classifies every class in a dry run and asserts nothing was touched; the canary
 * pair removes a LANDED worktree under --execute and keeps DIRTY, ACTIVE, OPEN_PR and gh-failure (UNKNOWN) ones;
 * bad-item-last removes exactly 10 of 10 LANDED + 1 DIRTY; one arm runs the REAL worktree-teardown.ps1.
 *
 * Run: node --test scripts/agent-os/worktreeSweep.test.mjs   (pnpm agent:verify discovers it)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stripGitLocalEnv } from "./gitLocalEnv.mjs";
import { WORKTREE_CLASSES as C, formatSweep, sweepAfterMerge, sweepWorktrees } from "./repo-status.mjs";

const ENV = { ...stripGitLocalEnv(), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const HOUR = 3_600_000;
const LATER = Date.now() + 3 * HOUR; // every fixture file is 3 h old on this clock, so nothing is ACTIVE by mtime unless an arm says so
const registered = (primary) => git(primary, "worktree", "list", "--porcelain").replace(/\\/g, "/").toLowerCase();
const isRegistered = (primary, path) => registered(primary).includes(`worktree ${path.replace(/\\/g, "/").toLowerCase()}\n`);

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wt-sweep-")));
  const origin = join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  const primary = join(root, "primary");
  git(root, "init", "-q", "-b", "main", primary);
  git(primary, "remote", "add", "origin", origin);
  writeFileSync(join(primary, "README.md"), "x\n");
  writeFileSync(join(primary, ".gitignore"), ".claude/\n.worktrees/\n");
  git(primary, "add", "README.md", ".gitignore");
  git(primary, "commit", "-q", "-m", "init");
  git(primary, "push", "-q", "origin", "main");
  const add = (name, { dir = ".claude/worktrees", dirty = false, detached = false } = {}) => {
    const path = join(primary, dir, name);
    const branch = detached ? null : `lane/${name}`;
    if (detached) git(primary, "worktree", "add", "-q", "--detach", path);
    else git(primary, "worktree", "add", "-q", "-b", branch, path);
    writeFileSync(join(path, `${name}.txt`), name);
    git(path, "add", `${name}.txt`);
    git(path, "commit", "-q", "-m", name);
    if (dirty) writeFileSync(join(path, "scratch.txt"), "uncommitted");
    return { name, path, branch, head: git(path, "rev-parse", "HEAD") };
  };
  return { root, primary, add };
}

/** gh with the real contract. `prs` maps branch -> [{number, state, headRefOid, commits?}] (or a function of the call count). */
function fakeGh(prs, { fail = new Set() } = {}) {
  const calls = [];
  const seen = {};
  const listFor = (branch) => {
    seen[branch] = (seen[branch] ?? 0) + 1;
    const v = prs[branch] ?? [];
    return typeof v === "function" ? v(seen[branch]) : v;
  };
  const gh = (args) => {
    calls.push(args.join(" "));
    const a = args.join(" ");
    let m = a.match(/^pr list --head (\S+) --state all --json number,state,headRefOid --limit 100$/);
    if (m) {
      if (fail.has(m[1])) throw new Error("gh: error connecting to api.github.com");
      return JSON.stringify(listFor(m[1]).map(({ number, state, headRefOid }) => ({ number, state, headRefOid })));
    }
    m = a.match(/^pr view (\d+) --json state,commits,headRefOid$/);
    if (m) {
      const all = Object.values(prs).flatMap((v) => (typeof v === "function" ? v(1) : v));
      const pr = all.find((p) => String(p.number) === m[1]);
      if (!pr) throw new Error(`no pull request #${m[1]}`);
      return JSON.stringify({ state: pr.state, headRefOid: pr.headRefOid, commits: (pr.commits ?? [pr.headRefOid]).map((oid) => ({ oid })) });
    }
    throw new Error(`fake gh: unexpected argv: ${a}`);
  };
  return { gh, calls };
}

const merged = (n, wt, extra = {}) => ({ number: n, state: "MERGED", headRefOid: wt.head, ...extra });

/** A teardown that does what the real script does to git (deregister + delete), recording every call. */
function fakeTeardown(primary, script = []) {
  const calls = [];
  const teardown = (path) => {
    calls.push(path);
    const scripted = script.shift();
    if (scripted) return scripted;
    git(primary, "worktree", "remove", path);
    return { status: 0, output: "Worktree Teardown Complete!" };
  };
  return { teardown, calls };
}

const slash = (p) => p.replace(/\\/g, "/").toLowerCase();
const deps = (over) => ({ readLease: async () => null, now: () => LATER, ...over });
const byPath = (sweep) => Object.fromEntries(sweep.results.map((r) => [r.path.replace(/\\/g, "/").toLowerCase(), r]));
const resultOf = (sweep, wt) => byPath(sweep)[wt.path.replace(/\\/g, "/").toLowerCase()];

test("dry run: every class is assigned with a reason, the primary is never listed, and nothing is torn down", async () => {
  const f = fixture();
  const landed = f.add("landed");
  const landedViaCommits = f.add("landed-commits", { dir: ".worktrees" });
  const open = f.add("open");
  const none = f.add("none");
  const closedOnly = f.add("closed-only");
  const dirty = f.add("dirty", { dirty: true });
  const active = f.add("active");
  const leased = f.add("leased");
  const locked = f.add("locked");
  const detached = f.add("detached", { detached: true });
  const ghDown = f.add("gh-down");
  const postMerge = f.add("post-merge");
  utimesSync(join(active.path, "active.txt"), new Date(LATER - 10 * 60_000), new Date(LATER - 10 * 60_000));
  git(f.primary, "worktree", "lock", "--reason", "claude agent agent-x (pid 1)", locked.path);
  const g = fakeGh(
    {
      [landed.branch]: [merged(1, landed)],
      [landedViaCommits.branch]: [merged(2, landedViaCommits, { headRefOid: "f".repeat(40), commits: ["e".repeat(40), landedViaCommits.head] })],
      [open.branch]: [{ number: 3, state: "OPEN", headRefOid: open.head }],
      [closedOnly.branch]: [{ number: 4, state: "CLOSED", headRefOid: closedOnly.head }],
      [dirty.branch]: [merged(5, dirty)],
      [active.branch]: [merged(6, active)],
      [leased.branch]: [merged(7, leased)],
      [locked.branch]: [merged(8, locked)],
      [postMerge.branch]: [merged(9, postMerge, { headRefOid: "d".repeat(40), commits: ["d".repeat(40)] })],
    },
    { fail: new Set([ghDown.branch]) },
  );
  const td = fakeTeardown(f.primary);
  const readLease = async (b) => (b === leased.branch ? { status: "active", sessionId: "s-1", expiresAt: new Date(Date.now() + HOUR).toISOString() } : null);
  const sweep = await sweepWorktrees({ cwd: f.primary, execute: false, deps: deps({ gh: g.gh, teardown: td.teardown, readLease }) });

  const want = [
    [landed, C.LANDED, /PR #1 merged/],
    [landedViaCommits, C.LANDED, /PR #2 merged.*commits/],
    [open, C.OPEN_PR, /#3/],
    [none, C.NO_PR, /no PR/],
    [closedOnly, C.NO_PR, /#4 CLOSED/],
    [dirty, C.DIRTY, /scratch\.txt|uncommitted/],
    [active, C.ACTIVE, /active\.txt/],
    [leased, C.ACTIVE, /lease.*s-1/],
    [locked, C.ACTIVE, /locked/],
    [detached, C.DETACHED_UNKNOWN, /detached/],
    [ghDown, C.UNKNOWN, /gh/],
    [postMerge, C.UNKNOWN, /#9 merged.*not/],
  ];
  for (const [wt, cls, why] of want) {
    const r = resultOf(sweep, wt);
    assert.ok(r, `${wt.name} missing from the sweep`);
    assert.equal(r.cls, cls, `${wt.name}: ${r.cls} (${r.reason})`);
    assert.match(r.reason, why, `${wt.name}: ${r.reason}`);
    assert.equal(r.removed, false, wt.name);
  }
  assert.equal(sweep.results.length, want.length, "only .claude/worktrees and .worktrees entries; the primary is never a candidate");
  assert.deepEqual(td.calls, [], "a dry run tears nothing down");
  for (const [wt] of want) assert.ok(isRegistered(f.primary, wt.path) && existsSync(wt.path), wt.name);

  const text = formatSweep(sweep);
  assert.match(text, /DRY RUN/);
  for (const [cls, n] of [[C.LANDED, 2], [C.OPEN_PR, 1], [C.NO_PR, 2], [C.DIRTY, 1], [C.ACTIVE, 3], [C.DETACHED_UNKNOWN, 1], [C.UNKNOWN, 2]]) {
    assert.match(text, new RegExp(`\\b${cls} ${n}\\b`), `count line for ${cls}`);
  }
});

test("canary pair: --execute removes the LANDED worktree and never a DIRTY, ACTIVE, OPEN_PR or gh-failure one", async () => {
  const f = fixture();
  const landed = f.add("landed");
  const dirty = f.add("dirty", { dirty: true });
  const active = f.add("active");
  const open = f.add("open");
  const ghDown = f.add("gh-down");
  utimesSync(join(active.path, "active.txt"), new Date(LATER - 60_000), new Date(LATER - 60_000));
  const g = fakeGh(
    {
      [landed.branch]: [merged(1, landed)],
      [dirty.branch]: [merged(2, dirty)],
      [active.branch]: [merged(3, active)],
      [open.branch]: [{ number: 4, state: "OPEN", headRefOid: open.head }],
      [ghDown.branch]: [merged(5, ghDown)],
    },
    { fail: new Set([ghDown.branch]) },
  );
  const td = fakeTeardown(f.primary);
  const sweep = await sweepWorktrees({ cwd: f.primary, execute: true, deps: deps({ gh: g.gh, teardown: td.teardown }) });
  assert.deepEqual(td.calls.map(slash), [slash(landed.path)]);
  assert.equal(resultOf(sweep, landed).removed, true);
  assert.ok(!isRegistered(f.primary, landed.path), "LANDED worktree deregistered");
  for (const wt of [dirty, active, open, ghDown]) {
    assert.ok(isRegistered(f.primary, wt.path) && existsSync(wt.path), `${wt.name} must survive`);
    assert.equal(resultOf(sweep, wt).removed, false, wt.name);
  }
  assert.match(formatSweep(sweep), /EXECUTE/);
});

test("bad item last: 10 LANDED then 1 DIRTY removes exactly 10", async () => {
  const f = fixture();
  const lands = Array.from({ length: 10 }, (_, i) => f.add(`land-${String(i).padStart(2, "0")}`));
  const dirtyLast = f.add("zz-dirty-last", { dirty: true });
  const prs = Object.fromEntries([...lands, dirtyLast].map((wt, i) => [wt.branch, [merged(100 + i, wt)]]));
  const g = fakeGh(prs);
  const td = fakeTeardown(f.primary);
  const sweep = await sweepWorktrees({ cwd: f.primary, execute: true, deps: deps({ gh: g.gh, teardown: td.teardown }) });
  assert.equal(sweep.results.filter((r) => r.removed).length, 10);
  assert.equal(td.calls.length, 10);
  assert.equal(resultOf(sweep, dirtyLast).cls, C.DIRTY);
  assert.ok(isRegistered(f.primary, dirtyLast.path) && existsSync(join(dirtyLast.path, "scratch.txt")));
});

test("the caller's own worktree is never removed, even when its PR merged", async () => {
  const f = fixture();
  const self = f.add("self");
  const other = f.add("other");
  const g = fakeGh({ [self.branch]: [merged(1, self)], [other.branch]: [merged(2, other)] });
  const td = fakeTeardown(f.primary);
  const sweep = await sweepWorktrees({ cwd: self.path, execute: true, deps: deps({ gh: g.gh, teardown: td.teardown }) });
  assert.equal(resultOf(sweep, self).cls, C.ACTIVE);
  assert.match(resultOf(sweep, self).reason, /own worktree/);
  assert.ok(isRegistered(f.primary, self.path));
  assert.deepEqual(td.calls.map(slash), [slash(other.path)]);
});

test("re-checked right before teardown: a worktree that stops being LANDED mid-sweep is kept", async () => {
  const f = fixture();
  const flip = f.add("flip");
  // MERGED on the first read, a new OPEN PR on the re-check (someone pushed more work in between).
  const g = fakeGh({ [flip.branch]: (n) => (n === 1 ? [merged(1, flip)] : [merged(1, flip), { number: 2, state: "OPEN", headRefOid: flip.head }]) });
  const td = fakeTeardown(f.primary);
  const sweep = await sweepWorktrees({ cwd: f.primary, execute: true, deps: deps({ gh: g.gh, teardown: td.teardown }) });
  assert.deepEqual(td.calls, []);
  assert.equal(resultOf(sweep, flip).removed, false);
  assert.match(resultOf(sweep, flip).reason, /re-check/);
  assert.ok(isRegistered(f.primary, flip.path));
});

test("a lease read failure is UNKNOWN, never LANDED", async () => {
  const f = fixture();
  const wt = f.add("lease-down");
  const g = fakeGh({ [wt.branch]: [merged(1, wt)] });
  const td = fakeTeardown(f.primary);
  const readLease = async () => {
    throw new Error("lease service unreachable");
  };
  const sweep = await sweepWorktrees({ cwd: f.primary, execute: true, deps: deps({ gh: g.gh, teardown: td.teardown, readLease }) });
  assert.equal(resultOf(sweep, wt).cls, C.UNKNOWN);
  assert.deepEqual(td.calls, []);
});

test("the known libuv crash is retried once; any other teardown failure is not retried and the worktree is kept", async () => {
  const f = fixture();
  const crashy = f.add("crashy");
  const g = fakeGh({ [crashy.branch]: [merged(1, crashy)] });
  const libuv = { status: 1, output: "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file c:\\ws\\deps\\uv\\src\\win\\async.c, line 76\n[agent-finish] REFUSED" };
  const td = fakeTeardown(f.primary, [libuv]);
  const sweep = await sweepWorktrees({ cwd: f.primary, execute: true, deps: deps({ gh: g.gh, teardown: td.teardown }) });
  assert.equal(td.calls.length, 2, "one retry after the libuv crash");
  assert.equal(resultOf(sweep, crashy).removed, true);

  const f2 = fixture();
  const stuck = f2.add("stuck");
  const g2 = fakeGh({ [stuck.branch]: [merged(1, stuck)] });
  const td2 = fakeTeardown(f2.primary, [{ status: 1, output: "[X] ABORTING. 1 link target(s) lost entries." }]);
  const sweep2 = await sweepWorktrees({ cwd: f2.primary, execute: true, deps: deps({ gh: g2.gh, teardown: td2.teardown }) });
  assert.equal(td2.calls.length, 1, "no retry for a non-libuv failure");
  assert.equal(resultOf(sweep2, stuck).removed, false);
  assert.match(resultOf(sweep2, stuck).reason, /teardown failed/);
  assert.ok(isRegistered(f2.primary, stuck.path));
});

test("sweepAfterMerge touches only the worktree holding the merged head and logs what it removed", async () => {
  const f = fixture();
  const mergedWt = f.add("merged-one");
  const bystander = f.add("bystander");
  const g = fakeGh({ [mergedWt.branch]: [merged(1, mergedWt)], [bystander.branch]: [merged(2, bystander)] });
  const td = fakeTeardown(f.primary);
  const logs = [];
  await sweepAfterMerge({ branch: mergedWt.branch, headSha: mergedWt.head }, { cwd: f.primary, deps: deps({ gh: g.gh, teardown: td.teardown }), log: (m) => logs.push(m) });
  assert.deepEqual(td.calls.map(slash), [slash(mergedWt.path)]);
  assert.ok(isRegistered(f.primary, bystander.path), "a LANDED bystander is left for the full sweep");
  assert.ok(logs.some((l) => /SWEEP: removed/.test(l) && l.includes("merged-one")), JSON.stringify(logs));

  const quiet = [];
  await sweepAfterMerge({ branch: "lane/nowhere", headSha: "0".repeat(40) }, { cwd: f.primary, deps: deps({ gh: g.gh, teardown: td.teardown }), log: (m) => quiet.push(m) });
  assert.match(quiet.join("\n"), /no local worktree/);
});

const shell = process.platform === "win32" ? "powershell" : "pwsh";
const hasShell = spawnSync(shell, ["-NoProfile", "-Command", "exit 0"], { stdio: "ignore" }).status === 0;
test("end to end through the REAL worktree-teardown.ps1: the LANDED worktree goes, the DIRTY one stays", { skip: !hasShell && `${shell} not on PATH` }, async () => {
  const f = fixture();
  const landed = f.add("real-landed");
  const dirty = f.add("real-dirty", { dirty: true });
  const g = fakeGh({ [landed.branch]: [merged(1, landed)], [dirty.branch]: [merged(2, dirty)] });
  const sweep = await sweepWorktrees({ cwd: f.primary, execute: true, deps: deps({ gh: g.gh }) });
  const r = resultOf(sweep, landed);
  assert.equal(r.removed, true, `${r.reason}`);
  assert.ok(!isRegistered(f.primary, landed.path));
  assert.ok(isRegistered(f.primary, dirty.path) && existsSync(join(dirty.path, "scratch.txt")));
});
