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

const GATE = fileURLToPath(new URL("./merge-gate.mjs", import.meta.url));
const SHA = "a".repeat(40);
const FIELDS = "state,isDraft,mergeStateStatus,headRefOid,headRefName,isCrossRepository,statusCheckRollup";
const LIST = ["pr", "list", "--state", "open", "--limit", "200", "--json", "number,statusCheckRollup"];
const MERGE = ["pr", "merge", "3100", "--squash", "--match-head-commit", SHA];
const REPO = ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const run = (name, conclusion = "SUCCESS", status = "COMPLETED") => ({ __typename: "CheckRun", name, status, conclusion });
const view = (over = {}) => ({ state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN", headRefOid: SHA, headRefName: "chore/some-branch", isCrossRepository: false, statusCheckRollup: [run("node"), run("security"), run("railway-smoke", "SKIPPED")], mergeCommit: { oid: "b".repeat(40) }, ...over });

/** A gh with the real contract. `prs` is keyed by PR number; `fail` names calls that throw (list, view, after, merge, repo, delete). */
function fakeGh({ prs = { 3100: view() }, others = [], afterMerge = { state: "MERGED" }, fail = {} } = {}) {
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
      if (args[4] === "state,mergeCommit") return fail.after ? boom("view after") : JSON.stringify(pick({ ...pr, ...afterMerge }, "state,mergeCommit"));
    }
    if (args[0] === "pr" && args[1] === "merge") {
      if (!same(args, MERGE)) throw new Error(`unexpected merge argv: ${args.join(" ")}`);
      return fail.merge ? boom("merge") : "";
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
  assert.deepEqual(g.calls, [LIST.join(" "), ["pr", "view", "3100", "--json", FIELDS].join(" "), MERGE.join(" "), "pr view 3100 --json state,mergeCommit", REPO.join(" "), "api -X DELETE repos/o/r/git/refs/heads/chore/some-branch"]);
});

test("without --merge it judges only: READY, and no list, no merge, no delete", async () => {
  const g = fakeGh();
  const { code, logs } = await logsOf(g, { merge: false });
  assert.equal(code, 0);
  assert.deepEqual(g.calls, [["pr", "view", "3100", "--json", FIELDS].join(" ")]);
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
