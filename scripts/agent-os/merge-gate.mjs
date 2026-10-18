#!/usr/bin/env node
/**
 * Merge protocol as one command (2026-10-15): the manager skill's step 13.
 *
 *   node scripts/agent-os/merge-gate.mjs <pr> --sha <head sha you verified> [--wait-minutes 30] [--codex-wait-minutes 25] [--merge]
 *
 * Without --merge it only judges and prints READY or the blockers. With --merge it:
 *   1. holds (ONE bounded wait, no model turns) while another open PR has a node or e2e check in flight: a merge
 *      redeploys and kills those runs (AGENTS.md > Branching);
 *   2. re-reads the PR and refuses unless it is open, not a draft, CLEAN, at exactly the SHA you verified, with every
 *      check finished and each one SUCCESS, SKIPPED or NEUTRAL (an allow-list: a conclusion GitHub adds next year blocks
 *      until someone reads it), in this same process as the merge, so nothing can change in between;
 *      and the Codex review (assessCodex) has completed on that SHA with no unresolved finding and no unresolved Codex
 *      thread; with no Codex marker for the SHA it waits --codex-wait-minutes from the push, then merges with a WARN line;
 *   3. merges with --match-head-commit, so GitHub itself refuses if the head moved after step 2;
 *   4. re-reads the PR and deletes the branch through the API ONLY once it reads MERGED. Deleting the head branch of an
 *      unmerged PR closes it (happened on #2948), and `--delete-branch` can fail locally after the remote merge succeeded.
 *   5. once MERGED, tears down the local worktree(s) holding the merged head that prove LANDED (repo-status.mjs
 *      sweepAfterMerge, through worktree-teardown.ps1) and prints what it removed or kept. A sweep failure is logged and
 *      never changes the exit code.
 *
 * Exit codes:
 *   0 ready (without --merge) or merged
 *   2 blocked: something is wrong (failed check, draft, behind, wrong head, not open, unresolved Codex finding or thread)
 *   3 held past the wait: another PR's node or e2e run is still in flight; nothing was merged
 *   4 the merge call returned but the PR does not read MERGED; the branch is kept
 *   5 a gh call failed BEFORE the merge call; nothing was merged, safe to re-run
 *   6 a gh call failed AT or AFTER the merge call; the merge may have happened (the message says which): read the PR before any retry
 *   7 not ready YET (CI has not started, a check is still running, GitHub is still computing, Codex has not reported); re-run in a minute
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

const isCodex = (login) => String(login ?? "").replace(/\[bot\]$/, "") === "chatgpt-codex-connector";
// Loose on purpose: truncated JSON or a new version must still be SEEN as a marker, so it holds instead of reading as absent.
const MARKER = /<!--\s*codex-review-state:(\S*)([\s\S]*?)-->/g;

/**
 * The newest Codex marker that decides `headSha`: `{ review }` for the head's own, `{ malformed: version }` for one that
 * does not parse (it could be the head's, so it holds), or null. Markers for an older sha are skipped. `comments` oldest first.
 */
function headMarker(comments, headSha) {
  const markers = (comments ?? []).filter((c) => isCodex(c.author?.login)).flatMap((c) => [...String(c.body ?? "").matchAll(MARKER)]);
  for (const [, version, text] of markers.reverse()) {
    let cr;
    try {
      if (version === "v1") cr = JSON.parse(text).code_review;
    } catch {}
    if (!cr || typeof cr !== "object") return { malformed: version };
    if (cr.commit_sha === headSha) return { review: cr };
  }
  return null;
}

/**
 * The Codex review's verdict on `headSha` (job 2026-10-18-merge-gate-codex-wait: #3134 and #3141 merged on green CI ~3
 * minutes before Codex posted P1 findings). `comments` (oldest first) come from readComments; Codex edits one summary comment
 * carrying a `codex-review-state:v1` JSON marker. `threads` are the PR's reviewThreads nodes. Returns soft (not yet),
 * hard (blocked) and warn (log only). Fail-closed: a malformed marker holds like running. The two fail-opens, each with a
 * warn line: no marker for this head `waitMinutes` after `headPushedAtMs`, or still running at 2 x `waitMinutes` (a
 * stall). Findings and unresolved Codex threads never time out. `merging` false (judge-only) words the warn "would merge".
 */
export function assessCodex({ comments, threads, headSha, headPushedAtMs, nowMs, waitMinutes, merging = true }) {
  const soft = [];
  const hard = [];
  const warn = [];
  const open = (threads ?? []).filter((t) => !t.isResolved && isCodex(t.comments?.nodes?.[0]?.author?.login));
  if (open.length) hard.push(`${open.length} unresolved Codex review thread(s): fix them and resolve the threads (${open.map((t) => t.comments.nodes[0].url ?? t.path).join(", ")})`);
  const found = headMarker(comments, headSha);
  if (found && "malformed" in found) {
    soft.push(`the Codex review-state marker (${found.malformed || "no version"}) could not be read: treating it as still running`);
    return { soft, hard, warn };
  }
  const review = found?.review;
  const waited = (nowMs - headPushedAtMs) / 60_000;
  const verb = merging ? "merging" : "would merge";
  if (!review) {
    if (waited >= waitMinutes) warn.push(`Codex never reported on ${headSha}; ${verb} without its review`);
    else soft.push(`no Codex review on ${headSha} yet (${Number.isFinite(waited) ? Math.floor(waited) : "?"} of ${waitMinutes} min waited since the push)`);
  } else if (review.status === "running") {
    // Manager decision 2026-10-18: Codex finishes in 3 to 9 min here, so 2 x the wait means it stalled; a stalled reviewer must not hold forever.
    if (waited >= 2 * waitMinutes) warn.push(`Codex review still running on ${headSha} after ${Math.floor(waited)} min; ${verb} without its result`);
    else soft.push(`Codex review is still running on ${headSha}: wait for its findings`);
  }
  else if (review.status !== "completed") warn.push(`Codex review on ${headSha} reported status ${JSON.stringify(review.status)}, not completed: no findings to read`);
  else if (review.has_unresolved_findings === true) hard.push(`Codex reported unresolved findings on ${headSha}: fix them and resolve the threads`);
  else if (review.has_unresolved_findings !== false) soft.push(`Codex review on ${headSha} is completed but has_unresolved_findings is ${JSON.stringify(review.has_unresolved_findings)}: treating it as still running`);
  return { soft, hard, warn };
}

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
const THREADS_QUERY = "query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage} nodes{isResolved path comments(first:1){nodes{author{login} url}}}}}}}";
const COMMENTS_QUERY = "query($owner:String!,$name:String!,$number:Int!,$before:String){repository(owner:$owner,name:$name){pullRequest(number:$number){comments(last:50,before:$before){pageInfo{hasPreviousPage startCursor} nodes{author{login} body}}}}}";
const COMMENT_PAGES = 40; // 2,000 comments; past that the gate refuses rather than guess
// Calibrated 2026-10-18: Codex posted its review 3 to 9 minutes after PR open on #3139 and #3141; 25 leaves room for a slow run.
const CODEX_WAIT_MINUTES = 25;

/**
 * The PR's top-level comments, oldest first, read NEWEST page first and only as far back as needed: it stops at the
 * marker that decides the head, or when the comments run out. `gh pr view --json comments` returns only the first 100
 * (Codex P2 on #3144), which hid a marker posted after 100 comments and failed open. `complete` is false at the page cap.
 */
const readComments = (json, pr, headSha) => {
  let comments = [];
  let before;
  for (let page = 0; page < COMMENT_PAGES; page++) {
    const args = ["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-F", `number=${pr}`, ...(before === undefined ? [] : ["-f", `before=${before}`]), "-f", `query=${COMMENTS_QUERY}`];
    const { pageInfo, nodes } = json(args).data.repository.pullRequest.comments;
    comments = [...nodes, ...comments];
    if (headMarker(comments, headSha) || !pageInfo.hasPreviousPage) return { comments, complete: true };
    before = pageInfo.startCursor;
  }
  return { comments, complete: false };
};

/**
 * When the head reached GitHub, for the Codex wait: the LATEST of PR open, the head commit's committedDate (it can predate
 * the push by hours) and the first CI start on the head. Later means a longer wait, the fail-closed side.
 */
const pushedAtMs = (view, codexView) => {
  const head = (codexView.commits ?? []).find((c) => c.oid === view.headRefOid);
  const firstCi = Math.min(...(view.statusCheckRollup ?? []).map((c) => Date.parse(c.startedAt)).filter(Number.isFinite));
  const times = [Date.parse(codexView.createdAt), Date.parse(head?.committedDate), firstCi].filter(Number.isFinite);
  return times.length ? Math.max(...times) : NaN;
};

/**
 * The whole protocol. `gh(args)` returns stdout; injected so the order of calls can be proven. `codexCheck` exists only so
 * the canary can switch the Codex wait off and prove the tests see the difference; the CLI never passes it.
 */
export async function mergeGate({ gh, pr, sha, wait, merge, sleep, now, log, sweep, codexWait = CODEX_WAIT_MINUTES, codexCheck = assessCodex }) {
  // A NaN deadline never arrives, which would turn the bounded wait into an endless poll.
  if (!Number.isFinite(wait) || wait < 0) throw new Error("--wait-minutes must be a finite number of minutes, 0 or more");
  if (!Number.isFinite(codexWait) || codexWait < 0) throw new Error("--codex-wait-minutes must be a finite number of minutes, 0 or more");
  const json = (args) => JSON.parse(gh(args));
  let before;
  let codex;
  try {
    const busy = merge ? await holdWhileBusy({ list: () => json(["pr", "list", "--state", "open", "--limit", "200", "--json", "number,statusCheckRollup"]), self: pr, minutes: wait, sleep, now }) : [];
    if (busy.length) {
      log(`HELD past ${wait} min: ${busy.join(", ")}`);
      return 3;
    }
    before = json(["pr", "view", String(pr), "--json", VIEW_FIELDS]);
    const codexView = json(["pr", "view", String(pr), "--json", "commits,createdAt"]);
    const { comments, complete } = readComments(json, pr, sha);
    const threads = json(["api", "graphql", "-F", "owner={owner}", "-F", "name={repo}", "-F", `number=${pr}`, "-f", `query=${THREADS_QUERY}`]).data.repository.pullRequest.reviewThreads;
    codex = codexCheck({ comments, threads: threads.nodes, headSha: sha, headPushedAtMs: pushedAtMs(before, codexView), nowMs: now(), waitMinutes: codexWait, merging: Boolean(merge) });
    const extra = [];
    if (!complete) extra.push(`more than ${COMMENT_PAGES * 50} comments and no Codex marker for the head among them: this gate cannot prove Codex never reported; check by hand`);
    if (threads.pageInfo?.hasNextPage) extra.push("more than 100 review threads: this gate reads one page, so it cannot prove none is an open Codex finding; check by hand");
    if (extra.length) codex = { ...codex, hard: [...codex.hard, ...extra] };
  } catch (e) {
    log(`ERROR before any merge call, nothing was merged: ${firstLine(e)}`);
    return 5;
  }
  const { hard, soft } = assess(before, sha);
  hard.push(...codex.hard);
  soft.push(...codex.soft);
  hard.forEach((w) => log(`BLOCKED: ${w}`));
  soft.forEach((w) => log(`NOT READY YET: ${w}`));
  codex.warn.forEach((w) => log(`WARN: ${w}`));
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
  // Step 5: tear down the local worktree(s) holding the merged head when they prove LANDED (repo-status.mjs sweepAfterMerge).
  // Never fails the merge: anything it throws is logged and the exit code stays what the merge earned.
  const sweepMerged = async () => {
    if (!sweep) return;
    try {
      await sweep({ branch: before.headRefName, headSha: before.headRefOid }, log);
    } catch (e) {
      log(`SWEEP failed: ${firstLine(e)}; the merge is unaffected. Run node scripts/agent-os/repo-status.mjs --sweep to see why`);
    }
  };
  try {
    const after = json(["pr", "view", String(pr), "--json", "state,mergeCommit"]);
    if (after.state !== "MERGED") {
      log(`NOT MERGED: #${pr} reads ${after.state}; the branch ${before.headRefName} is kept`);
      return 4;
    }
    if (before.isCrossRepository) {
      // headRefName names a branch in the fork; deleting that name in the base repository could remove an unrelated branch.
      log(`MERGED: #${pr} as ${after.mergeCommit?.oid}; cross-repository PR, branch ${before.headRefName} left in the fork`);
      await sweepMerged();
      return 0;
    }
    const repo = gh(["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"]).trim();
    gh(["api", "-X", "DELETE", `repos/${repo}/git/refs/heads/${before.headRefName}`]);
    log(`MERGED: #${pr} as ${after.mergeCommit?.oid}; branch ${before.headRefName} deleted`);
    await sweepMerged();
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
    console.error("usage: node scripts/agent-os/merge-gate.mjs <pr number> --sha <full 40-char head sha> [--wait-minutes 30] [--codex-wait-minutes 25] [--merge]");
    process.exit(64);
  }
  const wait = Number(arg("--wait-minutes") ?? 30);
  if (!Number.isFinite(wait) || wait < 0) {
    console.error("--wait-minutes needs a number of minutes, 0 or more (a following flag is not a value). usage: node scripts/agent-os/merge-gate.mjs <pr> --sha <sha> [--wait-minutes 30] [--merge]");
    process.exit(64);
  }
  // Digits only: Number("") and Number(" ") are 0, which would skip the Codex wait without anyone typing a 0.
  const rawCodexWait = arg("--codex-wait-minutes");
  const codexWait = rawCodexWait === undefined ? CODEX_WAIT_MINUTES : /^\d+(\.\d+)?$/.test(rawCodexWait) ? Number(rawCodexWait) : NaN;
  if (!Number.isFinite(codexWait)) {
    console.error("--codex-wait-minutes needs a number of minutes, 0 or more (a following flag is not a value)");
    process.exit(64);
  }
  const code = await mergeGate({
    codexWait,
    gh: (args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }),
    pr,
    sha,
    wait,
    merge: process.argv.includes("--merge"),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    now: () => Date.now(),
    log: (m) => console.log(m),
    // Imported only after a merge, so a broken sweep module can never stop a merge (the throw lands in the SWEEP failed log).
    sweep: async (head, log) => (await import("./repo-status.mjs")).sweepAfterMerge(head, { cwd: process.cwd(), log }),
  });
  process.exit(code);
}
