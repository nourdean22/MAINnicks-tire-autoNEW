/**
 * Canary for scripts/agent-os/merge-gate.mjs (2026-10-15).
 *
 * The merge protocol has failed three witnessed ways: a guessed PR number merged a sibling's PR (2026-08-07), a
 * `--delete-branch` failure after the remote merge had succeeded invited a retry (2026-08-07, 2026-08-08), and a
 * branch deleted before the PR read MERGED closed the PR (#2948, 2026-10-09).
 *
 * The fake `gh` here holds the contract of the real one, because a lenient fake hid eleven fail-open mutants in the first
 * draft: it answers ONLY the exact argv the gate may send (anything else throws), returns only the --json keys that were
 * asked for, for the PR number that was asked for, and can be told to fail any one call. So a gate that stops asking for
 * isDraft, or views the wrong PR, or swallows a gh error, goes red here instead of merging.
 *
 * Shape (positive-control-first): the happy path first (so a red arm cannot be a broken harness), then one arm per way to
 * refuse, each asserting that no merge call was made.
 *
 * Run: node --test scripts/agent-os/mergeGate.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { blockers, busyChecks, holdWhileBusy, mergeGate } from "./merge-gate.mjs";
// Namespace import: a missing export reads as undefined in its own tests instead of failing the whole file at link time.
import * as gate from "./merge-gate.mjs";

const GATE = fileURLToPath(new URL("./merge-gate.mjs", import.meta.url));
const SHA = "a".repeat(40);
const FIELDS = "state,isDraft,mergeStateStatus,headRefOid,headRefName,isCrossRepository,statusCheckRollup";
const CODEX_FIELDS = "comments,commits,createdAt";
const THREADS_QUERY = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved path comments(first:1){nodes{author{login} url}}}}}}}";
const threadsArgv = (n) => ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-F", `number=${n}`, "-f", `query=${THREADS_QUERY}`];
const THREADS = threadsArgv(3100);
const LIST = ["pr", "list", "--state", "open", "--limit", "200", "--json", "number,statusCheckRollup"];
const MERGE = ["pr", "merge", "3100", "--squash", "--match-head-commit", SHA];
const REPO = ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Codex fixtures (job 2026-10-18-merge-gate-codex-wait). Shapes read from #3141 on 2026-10-18 with read-only gh: the
// summary comment's author.login is "chatgpt-codex-connector" (GraphQL drops the "[bot]" suffix REST shows), and the
// marker JSON below is #3141's real text with the head sha swapped for SHA.
const CODEX = "chatgpt-codex-connector";
const T0 = Date.parse("2026-10-18T10:31:43Z"); // the fixture PR's createdAt
const MIN = 60_000;
const SEC = `"security_review":{"commit_sha":null,"has_any_findings":null,"has_unresolved_findings":null,"status":null}`;
const STATE = {
  running: `{"code_review":{"commit_sha":"${SHA}","has_any_findings":null,"has_unresolved_findings":null,"status":"running"},${SEC}}`,
  findings: `{"code_review":{"commit_sha":"${SHA}","has_any_findings":true,"has_unresolved_findings":true,"status":"completed"},${SEC}}`,
  clean: `{"code_review":{"commit_sha":"${SHA}","has_any_findings":false,"has_unresolved_findings":false,"status":"completed"},${SEC}}`,
  stale: `{"code_review":{"commit_sha":"${"d".repeat(40)}","has_any_findings":false,"has_unresolved_findings":false,"status":"completed"},${SEC}}`,
};
const codexComment = (state, login = CODEX) => ({ author: { login }, body: `### Codex Review\n\nSummary.\n\n<!-- codex-review-state:v1 ${state} -->`, createdAt: "2026-10-18T10:31:59Z" });
const thread = (isResolved, login = CODEX, n = 1) => ({ isResolved, path: "apps/x.ts", comments: { nodes: [{ author: { login }, url: `https://github.com/o/r/pull/3100#discussion_r${n}` }] } });

const run = (name, conclusion = "SUCCESS", status = "COMPLETED") => ({ __typename: "CheckRun", name, status, conclusion });
const view = (over = {}) => ({ state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN", headRefOid: SHA, headRefName: "chore/some-branch", isCrossRepository: false, statusCheckRollup: [run("node"), run("security"), run("railway-smoke", "SKIPPED")], mergeCommit: { oid: "b".repeat(40) }, comments: [codexComment(STATE.clean)], commits: [{ oid: "e".repeat(40), committedDate: "2026-10-18T09:00:00Z" }, { oid: SHA, committedDate: "2026-10-18T10:30:21Z" }], createdAt: "2026-10-18T10:31:43Z", ...over });

/** A gh with the real contract. `prs` is keyed by PR number; `fail` names calls that throw (list, view, codex, threads, after, merge, repo, delete). */
function fakeGh({ prs = { 3100: view() }, others = [], afterMerge = { state: "MERGED" }, threads = [], hasNextPage = false, fail = {} } = {}) {
  const calls = [];
  const pick = (obj, keys) => Object.fromEntries(keys.split(",").filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
  const boom = (what) => {
    throw new Error(`gh ${what} exploded`);
  };
  const gh = (args) => {
    calls.push(args.join(" "));
    if (same(args, LIST)) return fail.list ? boom("list") : JSON.stringify(others.map((o) => pick(o, "number,statusCheckRollup")));
    if (args[0] === "pr" && args[1] === "view" && args[3] === "--json") {
      const n = Number(args[2]);
      const pr = prs[n];
      if (!pr) throw new Error(`no pull request #${n}`);
      if (args[4] === FIELDS) return fail.view ? boom("view") : JSON.stringify(pick(pr, FIELDS));
      if (args[4] === CODEX_FIELDS) return fail.codex ? boom("codex view") : JSON.stringify(pick(pr, CODEX_FIELDS));
      if (args[4] === "state,mergeCommit") return fail.after ? boom("view after") : JSON.stringify(pick({ ...pr, ...afterMerge }, "state,mergeCommit"));
    }
    if (args[0] === "pr" && args[1] === "merge") {
      if (!same(args, MERGE)) throw new Error(`unexpected merge argv: ${args.join(" ")}`);
      return fail.merge ? boom("merge") : "";
    }
    if (args[0] === "api" && args[1] === "graphql") {
      const n = Number(String(args[7]).replace("number=", ""));
      if (!prs[n] || !same(args, threadsArgv(n))) throw new Error(`unexpected graphql argv: ${args.join(" ")}`);
      return fail.threads ? boom("threads") : JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage }, nodes: threads } } } } });
    }
    if (same(args, REPO)) return fail.repo ? boom("repo view") : "o/r\n";
    if (args[0] === "api" && args[1] === "-X" && args[2] === "DELETE" && args.length === 4) return fail.delete ? boom("delete") : "";
    throw new Error(`unexpected gh call: ${args.join(" ")}`);
  };
  return { gh, calls };
}
const opts = (g, over = {}) => ({ gh: g.gh, pr: 3100, sha: SHA, wait: 30, merge: true, sleep: async () => {}, now: () => 0, log: () => {}, ...over });
const mergeCalls = (g) => g.calls.filter((c) => c.startsWith("pr merge"));
const deleteCalls = (g) => g.calls.filter((c) => c.startsWith("api -X DELETE"));
const logsOf = async (g, over) => {
  const logs = [];
  const code = await mergeGate(opts(g, { ...over, log: (m) => logs.push(m) }));
  return { code, logs };
};

test("control: a clean PR merges pinned to the verified head, then reads MERGED, then the branch is deleted; every call is the exact argv", async () => {
  const g = fakeGh();
  assert.equal(await mergeGate(opts(g)), 0);
  assert.deepEqual(g.calls, [LIST.join(" "), ["pr", "view", "3100", "--json", FIELDS].join(" "), `pr view 3100 --json ${CODEX_FIELDS}`, THREADS.join(" "), MERGE.join(" "), "pr view 3100 --json state,mergeCommit", REPO.join(" "), "api -X DELETE repos/o/r/git/refs/heads/chore/some-branch"]);
});

test("without --merge it judges only: READY (Codex included), and no list, no merge, no delete", async () => {
  const g = fakeGh();
  const { code, logs } = await logsOf(g, { merge: false });
  assert.equal(code, 0);
  assert.deepEqual(g.calls, [["pr", "view", "3100", "--json", FIELDS].join(" "), `pr view 3100 --json ${CODEX_FIELDS}`, THREADS.join(" ")]);
  assert.match(logs[0], /^READY: #3100/);
});

test("the gate views the PR number it was given, not another one: a failed PR next door cannot be merged by mistake", async () => {
  const g = fakeGh({ prs: { 3100: view(), 3200: view({ statusCheckRollup: [run("node", "FAILURE")] }) } });
  assert.equal(await mergeGate(opts(g, { pr: 3200, sha: SHA })), 2);
  assert.deepEqual(mergeCalls(g), []);
});

for (const [label, pr, want] of [
  ["the head moved after the one you verified", view({ headRefOid: "c".repeat(40) }), /not the a{40} you verified/],
  ["a draft", view({ isDraft: true }), /draft/],
  ["a PR that is already MERGED", view({ state: "MERGED" }), /MERGED, not OPEN/],
  ["a branch that is behind", view({ mergeStateStatus: "BEHIND" }), /BEHIND, not CLEAN/],
  ["a state GitHub is still computing", view({ mergeStateStatus: "UNKNOWN" }), /UNKNOWN: GitHub is still computing/],
  ["an empty check list (CI has not started yet)", view({ statusCheckRollup: [] }), /no checks have reported yet/],
  ["a failed check", view({ statusCheckRollup: [run("node"), run("completion-authority", "FAILURE")] }), /"completion-authority" FAILURE/],
  ["a cancelled check", view({ statusCheckRollup: [run("node", "CANCELLED")] }), /"node" CANCELLED/],
  ["a check still running", view({ statusCheckRollup: [run("node", null, "IN_PROGRESS")] }), /"node" has not finished \(IN_PROGRESS\)/],
  ["a commit status that failed", view({ statusCheckRollup: [{ __typename: "StatusContext", context: "ci/legacy", state: "FAILURE" }] }), /"ci\/legacy" FAILURE/],
  ["a commit status in ERROR", view({ statusCheckRollup: [{ __typename: "StatusContext", context: "ci/legacy", state: "ERROR" }] }), /"ci\/legacy" ERROR/],
  ["a commit status still pending", view({ statusCheckRollup: [{ __typename: "StatusContext", context: "ci/legacy", state: "PENDING" }] }), /"ci\/legacy" has not finished \(PENDING\)/],
]) {
  test(`refuses ${label}, and makes no merge call`, async () => {
    const g = fakeGh({ prs: { 3100: pr } });
    const { code, logs } = await logsOf(g);
    assert.ok(code === 2 || code === 7, `exit ${code}`);
    assert.deepEqual(mergeCalls(g), []);
    assert.deepEqual(deleteCalls(g), []);
    assert.ok(logs.some((l) => want.test(l)), `wanted ${want}; got ${JSON.stringify(logs)}`);
  });
}

test("every check conclusion that is not SUCCESS, SKIPPED or NEUTRAL blocks (an allow-list, not a deny-list), including empty and unknown ones", () => {
  for (const conclusion of ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "", null, undefined, "NEW_VALUE_GITHUB_ADDS_NEXT_YEAR"]) {
    // run("x", undefined) would take the default "SUCCESS", so the missing-key shape is built by hand.
    const check = conclusion === undefined ? { __typename: "CheckRun", name: "x", status: "COMPLETED" } : run("x", conclusion);
    const why = blockers(view({ statusCheckRollup: [check] }), SHA);
    assert.equal(why.length, 1, `conclusion ${JSON.stringify(conclusion)}`);
    assert.match(why[0], /"x" (\S+|has no conclusion)/);
  }
  for (const ok of ["SUCCESS", "SKIPPED", "NEUTRAL"]) assert.deepEqual(blockers(view({ statusCheckRollup: [run("x", ok)] }), SHA), [], ok);
});

test("every unfinished state blocks, for a CheckRun and for a commit status (EXPECTED is unfinished too)", () => {
  for (const status of ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED"]) {
    const why = blockers(view({ statusCheckRollup: [run("x", null, status)] }), SHA);
    assert.match(why.join("\n"), new RegExp(`"x" has not finished \\(${status}\\)`), status);
  }
  for (const state of ["PENDING", "EXPECTED"]) assert.match(blockers(view({ statusCheckRollup: [{ context: "ci", state }] }), SHA).join("\n"), /has not finished/, state);
  assert.deepEqual(blockers(view({ statusCheckRollup: [{ context: "ci", state: "SUCCESS" }] }), SHA), []);
});

test("an empty, null or missing check list is a blocker, in all three shapes", () => {
  for (const rollup of [[], null, undefined]) {
    const v = view();
    if (rollup === undefined) delete v.statusCheckRollup;
    else v.statusCheckRollup = rollup;
    assert.match(blockers(v, SHA).join("\n"), /no checks have reported yet/, JSON.stringify(rollup));
  }
});

test("exit 7 means not ready YET (CI not started, still running, GitHub computing); exit 2 means something failed, and a failure outranks a pending check", async () => {
  for (const pr of [view({ statusCheckRollup: [] }), view({ statusCheckRollup: [run("node", null, "IN_PROGRESS")] }), view({ mergeStateStatus: "UNKNOWN" })]) assert.equal(await mergeGate(opts(fakeGh({ prs: { 3100: pr } }))), 7);
  assert.equal(await mergeGate(opts(fakeGh({ prs: { 3100: view({ statusCheckRollup: [run("a", "FAILURE"), run("b", null, "IN_PROGRESS")] }) } }))), 2);
  assert.equal(await mergeGate(opts(fakeGh({ prs: { 3100: view({ mergeStateStatus: "BEHIND" }) } }))), 2);
});

test("the open-PR list asks for up to 200 PRs with exactly the keys it reads", async () => {
  const g = fakeGh();
  await mergeGate(opts(g));
  assert.equal(g.calls[0], LIST.join(" "));
});

test("a cross-repository PR is merged but its branch is never deleted from the base repository", async () => {
  const g = fakeGh({ prs: { 3100: view({ isCrossRepository: true }) } });
  const { code, logs } = await logsOf(g);
  assert.equal(code, 0);
  assert.equal(mergeCalls(g).length, 1);
  assert.deepEqual(deleteCalls(g), []);
  assert.ok(logs.some((l) => /cross-repository.*left in the fork/.test(l)), JSON.stringify(logs));
});

test("an invalid --wait-minutes is refused before any gh call, in the function", async () => {
  for (const wait of [NaN, -1, Infinity]) {
    const g = fakeGh();
    await assert.rejects(() => mergeGate(opts(g, { wait })), /--wait-minutes must be a finite number/);
    assert.deepEqual(g.calls, []);
  }
});

test("holds while ANOTHER PR has node or e2e in flight, up to the wait, and then does not merge", async () => {
  const others = [{ number: 3101, statusCheckRollup: [run("node", null, "IN_PROGRESS")] }];
  const g = fakeGh({ others });
  let t = 0;
  const { code, logs } = await logsOf(g, { wait: 3, now: () => t, sleep: async (ms) => (t += ms) });
  assert.equal(code, 3);
  assert.deepEqual(mergeCalls(g), []);
  assert.ok(g.calls.filter((c) => c === LIST.join(" ")).length >= 3, "it polled more than once, inside one process");
  assert.match(logs[0], /HELD past 3 min: #3101 node \(IN_PROGRESS\)/);
});

test("the hold ends as soon as the other PR's run finishes, and then it merges", async () => {
  const g = fakeGh();
  let polls = 0;
  const busy = [{ number: 3101, statusCheckRollup: [run("e2e - statenour", null, "QUEUED")] }];
  const quiet = [{ number: 3101, statusCheckRollup: [run("e2e - statenour")] }];
  const inner = g.gh;
  g.gh = (args) => (same(args, LIST) ? (polls++, g.calls.push(args.join(" ")), JSON.stringify(polls < 3 ? busy : quiet)) : inner(args));
  let t = 0;
  assert.equal(await mergeGate(opts(g, { now: () => t, sleep: async (ms) => (t += ms) })), 0);
  assert.equal(polls, 3);
});

test("a merge that does not read MERGED afterwards keeps the branch and exits 4", async () => {
  const g = fakeGh({ afterMerge: { state: "OPEN" } });
  const { code, logs } = await logsOf(g);
  assert.equal(code, 4);
  assert.equal(mergeCalls(g).length, 1);
  assert.deepEqual(deleteCalls(g), []);
  assert.match(logs[0], /NOT MERGED: #3100 reads OPEN; the branch chore\/some-branch is kept/);
});

for (const [call, merge, want] of [
  ["list", true, /ERROR before any merge call, nothing was merged: gh list exploded/],
  ["view", true, /ERROR before any merge call, nothing was merged: gh view exploded/],
  ["view", false, /ERROR before any merge call, nothing was merged: gh view exploded/],
]) {
  test(`a gh failure on ${call}${merge ? "" : " (judge-only)"} exits 5, names the call, and makes no merge call`, async () => {
    const g = fakeGh({ fail: { [call]: true } });
    const { code, logs } = await logsOf(g, { merge });
    assert.equal(code, 5);
    assert.deepEqual(mergeCalls(g), []);
    assert.ok(logs.some((l) => want.test(l)), JSON.stringify(logs));
  });
}

for (const [call, want, deleted] of [
  ["merge", /gh pr merge failed.*The merge may still have happened: run gh pr view 3100 --json state before any retry/, false],
  ["after", /ERROR after the merge call.*The merge HAPPENED for #3100/, false],
  ["repo", /ERROR after the merge call.*The merge HAPPENED for #3100/, false],
  ["delete", /ERROR after the merge call.*The merge HAPPENED for #3100.*delete branch chore\/some-branch/, true],
]) {
  test(`a gh failure at "${call}" exits 6 and says the merge happened or may have`, async () => {
    const g = fakeGh({ fail: { [call]: true } });
    const { code, logs } = await logsOf(g);
    assert.equal(code, 6);
    assert.equal(mergeCalls(g).length, 1);
    assert.equal(deleteCalls(g).length, deleted ? 1 : 0);
    assert.ok(logs.some((l) => want.test(l)), JSON.stringify(logs));
  });
}

test("busyChecks ignores the PR being merged, finished runs, and checks that are not node or e2e; every unfinished state counts", () => {
  const prs = [
    { number: 3100, statusCheckRollup: [run("node", null, "IN_PROGRESS")] },
    { number: 3101, statusCheckRollup: [run("node"), run("security", null, "IN_PROGRESS"), run("notify", null, "QUEUED")] },
    { number: 3102, statusCheckRollup: [{ context: "e2e-legacy", state: "PENDING" }] },
  ];
  assert.deepEqual(busyChecks(prs, 3100), ["#3102 e2e-legacy (PENDING)"]);
  for (const status of ["IN_PROGRESS", "QUEUED", "PENDING", "WAITING", "REQUESTED"]) assert.equal(busyChecks([{ number: 1, statusCheckRollup: [run("node", null, status)] }], 2).length, 1, status);
  assert.equal(busyChecks([{ number: 1, statusCheckRollup: [{ context: "e2e", state: "EXPECTED" }] }], 2).length, 1);
});

test("holdWhileBusy returns the leftovers at the deadline instead of waiting forever", async () => {
  let t = 0;
  const list = () => [{ number: 1, statusCheckRollup: [run("node", null, "IN_PROGRESS")] }];
  const left = await holdWhileBusy({ list, self: 2, minutes: 2, now: () => t, sleep: async (ms) => (t += ms) });
  assert.deepEqual(left, ["#1 node (IN_PROGRESS)"]);
  assert.ok(t >= 120_000 && t <= 180_000, `slept ${t} ms`);
});

test("the CLI refuses a following flag taken as the wait value (exit 64), and bad usage exits 64", () => {
  const r = spawnSync(process.execPath, [GATE, "1", "--sha", "a".repeat(40), "--wait-minutes", "--merge"], { encoding: "utf8" });
  assert.equal(r.status, 64, r.stdout + r.stderr);
  assert.match(r.stderr, /--wait-minutes/);
  assert.equal(spawnSync(process.execPath, [GATE, "notanumber"], { encoding: "utf8" }).status, 64);
});

// Worktree sweep after a merge (job 2026-10-17-worktree-sweep): the sweep runs only once the PR reads MERGED, gets the
// merged head, and can never change the merge's exit code.
test("after MERGED, the sweep runs once for the merged head and its log lines are printed; exit stays 0", async () => {
  const g = fakeGh();
  const seen = [];
  const sweep = async (head, log) => {
    seen.push(head);
    log("SWEEP: removed /wt/x (PR #3100 merged)");
  };
  const { code, logs } = await logsOf(g, { sweep });
  assert.equal(code, 0);
  assert.deepEqual(seen, [{ branch: "chore/some-branch", headSha: SHA }]);
  assert.ok(logs.some((l) => l.startsWith("MERGED:")) && logs.includes("SWEEP: removed /wt/x (PR #3100 merged)"), JSON.stringify(logs));
});

test("a sweep that throws is logged and the merge still exits 0", async () => {
  const g = fakeGh();
  const { code, logs } = await logsOf(g, { sweep: async () => { throw new Error("teardown exploded"); } });
  assert.equal(code, 0);
  assert.ok(logs.some((l) => /SWEEP failed: teardown exploded.*merge is unaffected/.test(l)), JSON.stringify(logs));
});

test("no sweep when the PR does not read MERGED, when blocked, or without --merge", async () => {
  for (const over of [{ g: fakeGh({ afterMerge: { state: "OPEN" } }) }, { g: fakeGh({ prs: { 3100: view({ isDraft: true }) } }) }, { g: fakeGh(), merge: false }]) {
    let called = 0;
    await logsOf(over.g, { sweep: async () => called++, ...(over.merge === false ? { merge: false } : {}) });
    assert.equal(called, 0);
  }
});

// Codex wait (job 2026-10-18-merge-gate-codex-wait): #3134 (2026-10-17 22:00Z) and #3141 (2026-10-18 10:43:58Z) both
// merged the moment CI went green, about 3 minutes before Codex posted P1 findings.
const ac = (over = {}) => gate.assessCodex({ comments: [codexComment(STATE.clean)], threads: [], headSha: SHA, headPushedAtMs: T0, nowMs: T0 + MIN, waitMinutes: 25, ...over });
const NONE = { soft: [], hard: [], warn: [] };
const NEVER = `Codex never reported on ${SHA}; merging without its review`;

test("assessCodex control (c): a completed, clean marker for the head with no unresolved Codex thread proceeds", () => {
  assert.deepEqual(ac(), NONE);
  assert.deepEqual(ac({ threads: [thread(true)] }), NONE, "a RESOLVED Codex thread does not block");
});

test("assessCodex (a): a running marker for the head is soft, and stays soft past the wait (only a missing marker times out)", () => {
  for (const nowMs of [T0 + MIN, T0 + 60 * MIN]) {
    const r = ac({ comments: [codexComment(STATE.running)], nowMs });
    assert.deepEqual(r.hard, []);
    assert.equal(r.soft.length, 1);
    assert.match(r.soft[0], new RegExp(`Codex review is still running on ${SHA}`));
    assert.deepEqual(r.warn, []);
  }
});

test("assessCodex (b): unresolved findings in the marker, or any unresolved Codex thread, is hard whatever the marker says", () => {
  assert.match(ac({ comments: [codexComment(STATE.findings)] }).hard.join("\n"), new RegExp(`Codex reported unresolved findings on ${SHA}`));
  for (const comments of [[codexComment(STATE.clean)], [codexComment(STATE.running)], [codexComment(STATE.stale)], []]) {
    const r = ac({ comments, threads: [thread(true, CODEX, 1), thread(false, CODEX, 2)], nowMs: T0 + 60 * MIN });
    assert.equal(r.hard.length, 1, JSON.stringify(r));
    assert.match(r.hard[0], /1 unresolved Codex review thread.*discussion_r2/);
    assert.doesNotMatch(r.hard[0], /discussion_r1/);
  }
  assert.equal(ac({ threads: [thread(false, `${CODEX}[bot]`)] }).hard.length, 1, "the REST-style [bot] login counts as Codex too");
  assert.deepEqual(ac({ threads: [thread(false, "nourdean22")] }), NONE, "a human's open thread is not this gate's business");
});

test("assessCodex (d): no marker is soft until the wait has passed since the push, then a WARN and it proceeds", () => {
  const within = ac({ comments: [], nowMs: T0 + 24 * MIN });
  assert.deepEqual(within.hard, []);
  assert.match(within.soft.join("\n"), new RegExp(`no Codex review on ${SHA} yet`));
  assert.deepEqual(ac({ comments: [], nowMs: T0 + 25 * MIN }), { soft: [], hard: [], warn: [NEVER] });
  assert.deepEqual(ac({ comments: [], nowMs: T0 + 10 * MIN, waitMinutes: 5 }).warn, [NEVER], "the wait is the caller's");
});

test("assessCodex (e): a marker for an OLDER sha is no marker for this head", () => {
  assert.match(ac({ comments: [codexComment(STATE.stale)], nowMs: T0 + 24 * MIN }).soft.join("\n"), /no Codex review on a{40} yet/);
  assert.deepEqual(ac({ comments: [codexComment(STATE.stale)], nowMs: T0 + 25 * MIN }), { soft: [], hard: [], warn: [NEVER] });
  // An old running review must not hold the new head either; only the head's own state counts.
  assert.deepEqual(ac({ comments: [codexComment(STATE.running.replace(SHA, "d".repeat(40)))], nowMs: T0 + 25 * MIN }).soft, []);
});

test("assessCodex fails CLOSED on a malformed marker (soft, like running), even past the wait", () => {
  const asIs = (body) => ({ author: { login: CODEX }, body });
  for (const [bad, comment] of [
    ...["{not json", `{"code_review":null}`, `{"code_review":"completed"}`, `[]`, ""].map((s) => [s, codexComment(s)]),
    ["a v2 marker", asIs(`<!-- codex-review-state:v2 ${STATE.clean} -->`)],
    ["no version", asIs(`<!-- codex-review-state: ${STATE.clean} -->`)],
  ]) {
    const r = ac({ comments: [comment], nowMs: T0 + 60 * MIN });
    assert.equal(r.soft.length, 1, bad);
    assert.match(r.soft[0], /could not be read/, bad);
    assert.deepEqual(r.warn, [], bad);
  }
  const unsure = ac({ comments: [codexComment(STATE.clean.replace('"has_unresolved_findings":false', '"has_unresolved_findings":null'))] });
  assert.equal(unsure.soft.length, 1, "completed with has_unresolved_findings null is not a clean bill");
});

test("assessCodex reads the marker only from Codex's own comment: a quoted marker from anyone else is ignored", () => {
  const r = ac({ comments: [codexComment(STATE.clean, "nourdean22")], nowMs: T0 + MIN });
  assert.match(r.soft.join("\n"), /no Codex review on a{40} yet/);
  assert.deepEqual(ac({ comments: [codexComment(STATE.clean, `${CODEX}[bot]`)] }), NONE);
});

test("assessCodex takes the NEWEST marker for the head: a later running state outranks an earlier completed one", () => {
  assert.equal(ac({ comments: [codexComment(STATE.clean), codexComment(STATE.running)] }).soft.length, 1);
  assert.deepEqual(ac({ comments: [codexComment(STATE.running), codexComment(STATE.clean)] }), NONE);
});

test("assessCodex: a status other than running or completed is reported-with-no-findings plus a WARN naming it", () => {
  const r = ac({ comments: [codexComment(STATE.clean.replace('"completed"', '"skipped"'))] });
  assert.deepEqual(r.soft, []);
  assert.deepEqual(r.hard, []);
  assert.equal(r.warn.length, 1);
  assert.match(r.warn[0], /status "skipped"/);
});

test("assessCodex never times out on an unknown push time", () => {
  assert.equal(ac({ comments: [], headPushedAtMs: NaN, nowMs: T0 + 600 * MIN }).soft.length, 1);
});

const noMarker = (over = {}) => view({ comments: [], ...over });
test("mergeGate: a running Codex review is NOT READY YET (exit 7) and makes no merge call", async () => {
  const g = fakeGh({ prs: { 3100: view({ comments: [codexComment(STATE.running)] }) } });
  const { code, logs } = await logsOf(g);
  assert.equal(code, 7);
  assert.deepEqual(mergeCalls(g), []);
  assert.ok(logs.some((l) => /^NOT READY YET: Codex review is still running/.test(l)), JSON.stringify(logs));
});

test("mergeGate: Codex findings or an unresolved Codex thread is BLOCKED (exit 2) and makes no merge call", async () => {
  for (const g of [fakeGh({ prs: { 3100: view({ comments: [codexComment(STATE.findings)] }) } }), fakeGh({ threads: [thread(false)] })]) {
    const { code, logs } = await logsOf(g);
    assert.equal(code, 2);
    assert.deepEqual(mergeCalls(g), []);
    assert.ok(logs.some((l) => /^BLOCKED: .*Codex/.test(l)), JSON.stringify(logs));
  }
});

test("mergeGate: more review threads than one page is BLOCKED, not assumed clean", async () => {
  const g = fakeGh({ hasNextPage: true });
  const { code, logs } = await logsOf(g);
  assert.equal(code, 2);
  assert.deepEqual(mergeCalls(g), []);
  assert.ok(logs.some((l) => /^BLOCKED: .*more than 100 review threads/.test(l)), JSON.stringify(logs));
});

test("mergeGate (d): no marker waits --codex-wait-minutes from the LATEST of PR open, head commit and first CI start, then merges with the WARN", async () => {
  const late = noMarker({ statusCheckRollup: [{ ...run("node"), startedAt: new Date(T0 + 10 * MIN).toISOString() }] });
  assert.equal(await mergeGate(opts(fakeGh({ prs: { 3100: late } }), { now: () => T0 + 30 * MIN })), 7, "CI started at T0+10, so 20 min have passed, not 30");
  assert.equal(await mergeGate(opts(fakeGh({ prs: { 3100: noMarker() } }), { now: () => T0 + 24 * MIN })), 7);
  const g = fakeGh({ prs: { 3100: noMarker() } });
  const { code, logs } = await logsOf(g, { now: () => T0 + 25 * MIN });
  assert.equal(code, 0);
  assert.equal(mergeCalls(g).length, 1);
  assert.ok(logs.includes(`WARN: ${NEVER}`), JSON.stringify(logs));
  assert.ok(logs.indexOf(`WARN: ${NEVER}`) < logs.findIndex((l) => l.startsWith("MERGED:")), "the WARN is printed before the merge");
  assert.equal(await mergeGate(opts(fakeGh({ prs: { 3100: noMarker() } }), { now: () => T0 + 6 * MIN, codexWait: 5 })), 0, "the flag sets the wait");
});

test("canary (f): with the Codex check stubbed out, a running review MERGES; with the real check it does not", async () => {
  const running = () => fakeGh({ prs: { 3100: view({ comments: [codexComment(STATE.running)] }) } });
  const off = running();
  assert.equal(await mergeGate(opts(off, { codexCheck: () => NONE })), 0, "the failure shape this job fixes: merged while Codex was still running");
  assert.equal(mergeCalls(off).length, 1);
  const on = running();
  assert.equal(await mergeGate(opts(on)), 7);
  assert.deepEqual(mergeCalls(on), []);
});

test("mergeGate: a gh failure reading the Codex comment or the review threads exits 5 and makes no merge call", async () => {
  for (const call of ["codex", "threads"]) {
    const g = fakeGh({ fail: { [call]: true } });
    const { code, logs } = await logsOf(g);
    assert.equal(code, 5, call);
    assert.deepEqual(mergeCalls(g), [], call);
    assert.ok(logs.some((l) => /ERROR before any merge call, nothing was merged/.test(l)), JSON.stringify(logs));
  }
});

test("an invalid codex wait is refused before any gh call, in the function and in the CLI", async () => {
  for (const codexWait of [NaN, -1, Infinity]) {
    const g = fakeGh();
    await assert.rejects(() => mergeGate(opts(g, { codexWait })), /--codex-wait-minutes must be a finite number/);
    assert.deepEqual(g.calls, []);
  }
  for (const bad of ["--merge", "", " ", "-1", "abc"]) {
    const r = spawnSync(process.execPath, [GATE, "1", "--sha", SHA, "--codex-wait-minutes", bad], { encoding: "utf8" });
    assert.equal(r.status, 64, `${JSON.stringify(bad)}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /--codex-wait-minutes/);
  }
});
