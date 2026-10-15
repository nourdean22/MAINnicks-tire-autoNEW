#!/usr/bin/env node
/**
 * Merge protocol as one command (2026-10-15): the manager skill's step 13.
 *
 *   node scripts/agent-os/merge-gate.mjs <pr> --sha <head sha you verified> [--wait-minutes 30] [--merge]
 *
 * Without --merge it only judges and prints READY or the blockers. With --merge it:
 *   1. holds (ONE bounded wait, no model turns) while another open PR has a node or e2e check in flight: a merge
 *      redeploys and kills those runs (AGENTS.md > Branching);
 *   2. re-reads the PR and refuses unless it is open, not a draft, CLEAN, at exactly the SHA you verified, with every
 *      check finished and each one SUCCESS, SKIPPED or NEUTRAL (an allow-list: a conclusion GitHub adds next year blocks
 *      until someone reads it), in this same process as the merge, so nothing can change in between;
 *   3. merges with --match-head-commit, so GitHub itself refuses if the head moved after step 2;
 *   4. re-reads the PR and deletes the branch through the API ONLY once it reads MERGED. Deleting the head branch of an
 *      unmerged PR closes it (happened on #2948), and `--delete-branch` can fail locally after the remote merge succeeded.
 *
 * Exit codes:
 *   0 ready (without --merge) or merged
 *   2 blocked: something is wrong (failed check, draft, behind, wrong head, not open)
 *   3 held past the wait: another PR's node or e2e run is still in flight; nothing was merged
 *   4 the merge call returned but the PR does not read MERGED; the branch is kept
 *   5 a gh call failed BEFORE the merge call; nothing was merged, safe to re-run
 *   6 a gh call failed AT or AFTER the merge call; the merge may have happened (the message says which): read the PR before any retry
 *   7 not ready YET (CI has not started, a check is still running, GitHub is still computing); re-run in a minute
 *  64 bad usage
 */
import { execFileSync } from "node:child_process";
import { isMainModule } from "./cli-common.mjs";

const OK_CONCLUSIONS = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const IN_FLIGHT = /^(IN_PROGRESS|QUEUED|PENDING|WAITING|REQUESTED|EXPECTED)$/;
const WATCHED = /^(node|e2e)\b/i;
const nameOf = (c) => c.name ?? c.context ?? "(unnamed check)";
const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

/**
 * Sorts the reasons this PR must not be merged right now. `hard` is something wrong; `soft` is "not yet" (CI not started,
 * a check running, GitHub computing). `view` is `gh pr view --json state,isDraft,mergeStateStatus,headRefOid,statusCheckRollup`.
 */
export function assess(view, expectedSha) {
  const hard = [];
  const soft = [];
  if (view.state !== "OPEN") hard.push(`state is ${view.state}, not OPEN`);
  if (view.isDraft) hard.push("the PR is a draft");
  if (view.mergeStateStatus === "UNKNOWN") soft.push("mergeStateStatus is UNKNOWN: GitHub is still computing, re-run in a minute");
  else if (view.mergeStateStatus !== "CLEAN") hard.push(`mergeStateStatus is ${view.mergeStateStatus}, not CLEAN (BEHIND or DIRTY: update the branch)`);
  if (view.headRefOid !== expectedSha) hard.push(`head is ${view.headRefOid}, not the ${expectedSha} you verified: re-verify the new head`);
  // An empty list is right after an open or a push, before Actions has created its runs: this repo has no branch protection, so nothing else stops a merge of a head that never ran CI.
  const rollup = view.statusCheckRollup ?? [];
  if (!rollup.length) soft.push("no checks have reported yet: wait for CI to start, a head that never ran CI must not merge");
  for (const c of rollup) {
    // A CheckRun has status + conclusion; a commit StatusContext has only state.
    const isRun = c.status !== undefined;
    const unfinished = isRun ? c.status !== "COMPLETED" : IN_FLIGHT.test(c.state ?? "");
    if (unfinished) soft.push(`check "${nameOf(c)}" has not finished (${isRun ? c.status : c.state})`);
    else if (isRun ? !OK_CONCLUSIONS.has(c.conclusion) : c.state !== "SUCCESS") hard.push(`check "${nameOf(c)}" ${(isRun ? c.conclusion : c.state) || "has no conclusion"}`);
  }
  return { hard, soft };
}

/** Reasons this PR must not be merged right now. Empty means READY. */
export const blockers = (view, expectedSha) => {
  const { hard, soft } = assess(view, expectedSha);
  return [...hard, ...soft];
};

/** node or e2e checks in flight on open PRs other than `self`. `prs` is `gh pr list --state open --json number,statusCheckRollup`. */
export function busyChecks(prs, self) {
  const busy = [];
  for (const pr of prs) {
    if (pr.number === self) continue;
    for (const c of pr.statusCheckRollup ?? []) if (WATCHED.test(nameOf(c)) && IN_FLIGHT.test(c.status ?? c.state ?? "")) busy.push(`#${pr.number} ${nameOf(c)} (${c.status ?? c.state})`);
  }
  return busy;
}

/** One bounded wait. Returns [] when quiet, else the checks still busy at the deadline. */
export async function holdWhileBusy({ list, self, minutes, sleep, now, everyMs = 60_000 }) {
  const deadline = now() + minutes * 60_000;
  for (;;) {
    const busy = busyChecks(list(), self);
    if (!busy.length || now() >= deadline) return busy;
    await sleep(everyMs);
  }
}

const VIEW_FIELDS = "state,isDraft,mergeStateStatus,headRefOid,headRefName,isCrossRepository,statusCheckRollup";

/** The whole protocol. `gh(args)` returns stdout; injected so the order of calls can be proven. */
export async function mergeGate({ gh, pr, sha, wait, merge, sleep, now, log }) {
  // A NaN deadline never arrives, which would turn the bounded wait into an endless poll.
  if (!Number.isFinite(wait) || wait < 0) throw new Error("--wait-minutes must be a finite number of minutes, 0 or more");
  const json = (args) => JSON.parse(gh(args));
  let before;
  try {
    const busy = merge ? await holdWhileBusy({ list: () => json(["pr", "list", "--state", "open", "--limit", "200", "--json", "number,statusCheckRollup"]), self: pr, minutes: wait, sleep, now }) : [];
    if (busy.length) {
      log(`HELD past ${wait} min: ${busy.join(", ")}`);
      return 3;
    }
    before = json(["pr", "view", String(pr), "--json", VIEW_FIELDS]);
  } catch (e) {
    log(`ERROR before any merge call, nothing was merged: ${firstLine(e)}`);
    return 5;
  }
  const { hard, soft } = assess(before, sha);
  hard.forEach((w) => log(`BLOCKED: ${w}`));
  soft.forEach((w) => log(`NOT READY YET: ${w}`));
  if (hard.length) return 2;
  if (soft.length) return 7;
  if (!merge) {
    log(`READY: #${pr} at ${sha}`);
    return 0;
  }
  try {
    gh(["pr", "merge", String(pr), "--squash", "--match-head-commit", sha]);
  } catch (e) {
    log(`ERROR: gh pr merge failed (${firstLine(e)}). The merge may still have happened: run gh pr view ${pr} --json state before any retry`);
    return 6;
  }
  try {
    const after = json(["pr", "view", String(pr), "--json", "state,mergeCommit"]);
    if (after.state !== "MERGED") {
      log(`NOT MERGED: #${pr} reads ${after.state}; the branch ${before.headRefName} is kept`);
      return 4;
    }
    if (before.isCrossRepository) {
      // headRefName names a branch in the fork; deleting that name in the base repository could remove an unrelated branch.
      log(`MERGED: #${pr} as ${after.mergeCommit?.oid}; cross-repository PR, branch ${before.headRefName} left in the fork`);
      return 0;
    }
    const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
    gh(["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${before.headRefName}`]);
    log(`MERGED: #${pr} as ${after.mergeCommit?.oid}; branch ${before.headRefName} deleted`);
    return 0;
  } catch (e) {
    log(`ERROR after the merge call (${firstLine(e)}). The merge HAPPENED for #${pr}: do not retry it. Check gh pr view ${pr} --json state,mergeCommit; once it reads MERGED, delete branch ${before.headRefName} through the API if it is still there`);
    return 6;
  }
}

if (isMainModule(import.meta.url)) {
  const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  const pr = Number(process.argv[2]);
  const sha = arg("--sha");
  if (!Number.isInteger(pr) || !/^[0-9a-f]{40}$/.test(sha ?? "")) {
    console.error("usage: node scripts/agent-os/merge-gate.mjs <pr number> --sha <full 40-char head sha> [--wait-minutes 30] [--merge]");
    process.exit(64);
  }
  const wait = Number(arg("--wait-minutes") ?? 30);
  if (!Number.isFinite(wait) || wait < 0) {
    console.error("--wait-minutes needs a number of minutes, 0 or more (a following flag is not a value). usage: node scripts/agent-os/merge-gate.mjs <pr> --sha <sha> [--wait-minutes 30] [--merge]");
    process.exit(64);
  }
  const code = await mergeGate({
    gh: (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
    pr,
    sha,
    wait,
    merge: process.argv.includes("--merge"),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: (m) => console.log(m),
  });
  process.exit(code);
}
