/**
 * Canary for scripts/agent-os/merge-gate.mjs (2026-10-15).
 *
 * The merge protocol has failed three witnessed ways: a guessed PR number merged a sibling's PR (2026-08-07), a
 * `--delete-branch` failure after the remote merge had succeeded invited a retry (2026-08-07, 2026-08-08), and a
 * branch deleted before the PR read MERGED closed the PR (#2948, 2026-10-09). The gate's tests record every `gh`
 * call in order, so "the branch is deleted only after the PR reads MERGED" is asserted as behavior, not as prose.
 *
 * Shape (positive-control-first): the happy path first (so a red arm cannot be a broken harness), then one arm per
 * way to refuse, each asserting that no merge call was made.
 *
 * Run: node --test scripts/agent-os/mergeGate.test.mjs   (pnpm agent:verify discovers it)
 */
import assert from "node:assert/strict";
import test from "node:test";
import { blockers, busyChecks, holdWhileBusy, mergeGate } from "./merge-gate.mjs";

const SHA = "a".repeat(40);
const run = (name, conclusion = "SUCCESS", status = "COMPLETED") => ({ __typename: "CheckRun", name, status, conclusion });
const view = (over = {}) => ({ state: "OPEN", isDraft: false, mergeStateStatus: "CLEAN", headRefOid: SHA, headRefName: "chore/some-branch", statusCheckRollup: [run("node"), run("security"), run("railway-smoke", "SKIPPED")], ...over });

/** A fake gh: answers from `script`, records every call. */
function fakeGh({ pr = view(), others = [], afterMerge = { state: "MERGED", mergeCommit: { oid: "b".repeat(40) } } } = {}) {
  const calls = [];
  const gh = (args) => {
    calls.push(args.join(" "));
    if (args[0] === "pr" && args[1] === "list") return JSON.stringify(others);
    if (args[0] === "pr" && args[1] === "view") return JSON.stringify(args[4].includes("headRefOid") ? pr : afterMerge);
    if (args[0] === "repo") return "nourdean22/MAINnicks-tire-autoNEW\n";
    return "";
  };
  return { gh, calls };
}
const opts = (g, over = {}) => ({ gh: g.gh, pr: 3100, sha: SHA, wait: 30, merge: true, sleep: async () => {}, now: () => 0, log: () => {}, ...over });
const mergeCalls = (g) => g.calls.filter((c) => c.startsWith("pr merge"));
const deleteCalls = (g) => g.calls.filter((c) => c.startsWith("api -X DELETE"));

test("control: a clean PR merges pinned to the verified head, then reads MERGED, then the branch is deleted in that order", async () => {
  const g = fakeGh();
  assert.equal(await mergeGate(opts(g)), 0);
  const order = g.calls.map((c) => c.split(" ").slice(0, 2).join(" "));
  assert.deepEqual(order, ["pr list", "pr view", "pr merge", "pr view", "repo view", "api -X"]);
  assert.equal(mergeCalls(g)[0], `pr merge 3100 --squash --match-head-commit ${SHA}`);
  assert.equal(deleteCalls(g)[0], "api -X DELETE repos/nourdean22/MAINnicks-tire-autoNEW/git/refs/heads/chore/some-branch");
});

test("without --merge it judges only: READY, and no merge, no hold, no delete", async () => {
  const g = fakeGh();
  const logs = [];
  assert.equal(await mergeGate(opts(g, { merge: false, log: (m) => logs.push(m) })), 0);
  assert.deepEqual(mergeCalls(g), []);
  assert.deepEqual(g.calls.filter((c) => c.startsWith("pr list")), []);
  assert.match(logs[0], /^READY: #3100/);
});

for (const [label, pr, want] of [
  ["the head moved after the one you verified", view({ headRefOid: "c".repeat(40) }), /not the a{40} you verified/],
  ["a draft", view({ isDraft: true }), /draft/],
  ["a PR that is already MERGED", view({ state: "MERGED" }), /MERGED, not OPEN/],
  ["a branch that is behind", view({ mergeStateStatus: "BEHIND" }), /BEHIND, not CLEAN/],
  ["a state GitHub is still computing", view({ mergeStateStatus: "UNKNOWN" }), /UNKNOWN, not CLEAN/],
  ["a failed check", view({ statusCheckRollup: [run("node"), run("completion-authority", "FAILURE")] }), /"completion-authority" FAILURE/],
  ["a cancelled check", view({ statusCheckRollup: [run("node", "CANCELLED")] }), /"node" CANCELLED/],
  ["a check still running", view({ statusCheckRollup: [run("node", null, "IN_PROGRESS")] }), /"node" has not finished \(IN_PROGRESS\)/],
  ["a commit status that failed", view({ statusCheckRollup: [{ __typename: "StatusContext", context: "ci/legacy", state: "FAILURE" }] }), /"ci\/legacy" FAILURE/],
  ["a commit status in ERROR", view({ statusCheckRollup: [{ __typename: "StatusContext", context: "ci/legacy", state: "ERROR" }] }), /"ci\/legacy" ERROR/],
  ["a commit status still pending", view({ statusCheckRollup: [{ __typename: "StatusContext", context: "ci/legacy", state: "PENDING" }] }), /"ci\/legacy" has not finished \(PENDING\)/],
]) {
  test(`refuses ${label}, and makes no merge call`, async () => {
    const g = fakeGh({ pr });
    const logs = [];
    assert.equal(await mergeGate(opts(g, { log: (m) => logs.push(m) })), 2);
    assert.deepEqual(mergeCalls(g), []);
    assert.deepEqual(deleteCalls(g), []);
    assert.ok(logs.some((l) => want.test(l)), `wanted ${want}; got ${JSON.stringify(logs)}`);
  });
}

test("skipped and neutral checks are not blockers", () => {
  assert.deepEqual(blockers(view({ statusCheckRollup: [run("a", "SKIPPED"), run("b", "NEUTRAL")] }), SHA), []);
});

test("holds while ANOTHER PR has node or e2e in flight, up to the wait, and then does not merge", async () => {
  const others = [{ number: 3101, statusCheckRollup: [run("node", null, "IN_PROGRESS")] }];
  const g = fakeGh({ others });
  let t = 0;
  const logs = [];
  const code = await mergeGate(opts(g, { wait: 3, now: () => t, sleep: async (ms) => (t += ms), log: (m) => logs.push(m) }));
  assert.equal(code, 3);
  assert.deepEqual(mergeCalls(g), []);
  assert.ok(g.calls.filter((c) => c.startsWith("pr list")).length >= 3, "it polled more than once, inside one process");
  assert.match(logs[0], /HELD past 3 min: #3101 node \(IN_PROGRESS\)/);
});

test("the hold ends as soon as the other PR's run finishes, and then it merges", async () => {
  let polls = 0;
  const busy = [{ number: 3101, statusCheckRollup: [run("e2e - statenour", null, "QUEUED")] }];
  const quiet = [{ number: 3101, statusCheckRollup: [run("e2e - statenour")] }];
  const gh = (args) => {
    if (args[1] === "list") return JSON.stringify(++polls < 3 ? busy : quiet);
    if (args[1] === "view") return JSON.stringify(args[4].includes("headRefOid") ? view() : { state: "MERGED", mergeCommit: { oid: "d".repeat(40) } });
    return args[0] === "repo" ? "o/r\n" : "";
  };
  let t = 0;
  assert.equal(await mergeGate(opts({ gh }, { now: () => t, sleep: async (ms) => (t += ms) })), 0);
  assert.equal(polls, 3);
});

test("a merge that does not read MERGED afterwards keeps the branch and exits 4", async () => {
  const g = fakeGh({ afterMerge: { state: "OPEN" } });
  const logs = [];
  assert.equal(await mergeGate(opts(g, { log: (m) => logs.push(m) })), 4);
  assert.equal(mergeCalls(g).length, 1);
  assert.deepEqual(deleteCalls(g), []);
  assert.match(logs[0], /NOT MERGED: #3100 reads OPEN; the branch chore\/some-branch is kept/);
});

test("busyChecks ignores the PR being merged, finished runs, and checks that are not node or e2e", () => {
  const prs = [
    { number: 3100, statusCheckRollup: [run("node", null, "IN_PROGRESS")] },
    { number: 3101, statusCheckRollup: [run("node"), run("security", null, "IN_PROGRESS"), run("notify", null, "QUEUED")] },
    { number: 3102, statusCheckRollup: [{ context: "e2e-legacy", state: "PENDING" }] },
  ];
  assert.deepEqual(busyChecks(prs, 3100), ["#3102 e2e-legacy (PENDING)"]);
});

test("holdWhileBusy returns the leftovers at the deadline instead of waiting forever", async () => {
  let t = 0;
  const list = () => [{ number: 1, statusCheckRollup: [run("node", null, "IN_PROGRESS")] }];
  const left = await holdWhileBusy({ list, self: 2, minutes: 2, now: () => t, sleep: async (ms) => (t += ms) });
  assert.deepEqual(left, ["#1 node (IN_PROGRESS)"]);
  assert.ok(t >= 120_000 && t <= 180_000, `slept ${t} ms`);
});
