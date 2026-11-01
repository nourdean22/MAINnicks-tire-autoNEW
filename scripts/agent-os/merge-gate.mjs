#!/usr/bin/env node
/**
 * Merge protocol as one command (2026-10-15): the manager skill's step 15 (step 13 before the 2026-10-22 rewrite).
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
 *      and a PR touching apps/nickstire/{drizzle,server/cron,server/services}/ carries a DoD evidence fragment (missingDodFragment);
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
 *   7 not ready YET (CI has not started, a check is still running even if GitHub says UNSTABLE, GitHub is still computing, Codex has not reported); re-run in a minute
 *  64 bad usage
 */
import { execFileSync } from "node:child_process";
import { isMainModule } from "./cli-common.mjs";

const OK_CONCLUSIONS = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const IN_FLIGHT = /^(IN_PROGRESS|QUEUED|PENDING|WAITING|REQUESTED|EXPECTED)$/;
const WATCHED = /^(node|e2e)\b/i;
const nameOf = (c) => c.name ?? c.context ?? "(unnamed check)";
const firstLine = (e) => String(e?.message ?? e).split("\n")[0];

const startMs = (c) => {
  const t = Date.parse(c.startedAt);
  return Number.isFinite(t) && t > Date.UTC(2000, 0, 1) ? t : null;
};
/** The Actions run id in a check's detailsUrl (/actions/runs/<runId>/job/<jobId>), or null. */
export const runIdOf = (c) => /\/actions\/runs\/(\d+)(?:\/|$)/.exec(String(c.detailsUrl ?? ""))?.[1] ?? null;
const groupKey = (c) => `${c.workflowName ?? ""}\u0000${nameOf(c)}`;

/** Run ids that take part in a same-workflow, same-name duplicate: the only runs whose trigger event the gate needs to read. */
export function duplicateRunIds(rollup) {
  const groups = new Map();
  for (const c of rollup) groups.set(groupKey(c), [...(groups.get(groupKey(c)) ?? []), c]);
  const ids = new Set();
  for (const g of groups.values()) if (g.length > 1) for (const c of g) if (runIdOf(c)) ids.add(runIdOf(c));
  return [...ids];
}

/**
 * After a close and reopen (PR 3194, 2026-10-21) the rollup keeps the superseded run of a check beside its newer run on the same
 * head. A later entry replaces an earlier one of the SAME workflow + check name only when (a) both belong to one Actions run (a
 * re-run attempt) or (b) the later entry's run was triggered by `pull_request` (`events`: run id -> event, read by main()).
 * A manual `workflow_dispatch` pass must not hide a failed pull_request check (Codex P1 on PR 3195; no branch protection here).
 * FAIL CLOSED: no readable start time or run id, no known event, any event but pull_request, or a start-time tie keeps both entries.
 */
export function latestRuns(rollup, events = new Map()) {
  const supersedes = (later, earlier) => {
    const lt = startMs(later);
    const et = startMs(earlier);
    if (lt === null || et === null || lt <= et || groupKey(later) !== groupKey(earlier)) return false;
    const lr = runIdOf(later);
    if (lr === null) return false;
    return lr === runIdOf(earlier) || events.get(lr) === "pull_request";
  };
  return rollup.filter((c) => !rollup.some((o) => o !== c && supersedes(o, c)));
}

/**
 * Sorts the reasons this PR must not be merged right now. `hard` is something wrong; `soft` is "not yet" (CI not started,
 * a check running, GitHub computing). `view` is `gh pr view --json state,isDraft,mergeStateStatus,headRefOid,statusCheckRollup`.
 */
export function assess(view, expectedSha, events = new Map()) {
  const hard = [];
  const soft = [];
  if (view.state !== "OPEN") hard.push(`state is ${view.state}, not OPEN`);
  if (view.isDraft) hard.push("the PR is a draft");
  const rollup = latestRuns(view.statusCheckRollup ?? [], events);
  // A CheckRun has status + conclusion; a commit StatusContext has only state.
  const unfinished = (c) => (c.status !== undefined ? c.status !== "COMPLETED" : IN_FLIGHT.test(c.state ?? ""));
  if (view.mergeStateStatus === "UNKNOWN") soft.push("mergeStateStatus is UNKNOWN: GitHub is still computing, re-run in a minute");
  // GitHub says UNSTABLE for a pending check as well as a failed one (PR 3472). A failed check is hard in the loop below, so
  // UNSTABLE is "not yet" only while a check is unfinished; with every check finished (or none) it stays hard. Read on the
  // raw rollup, as GitHub computes UNSTABLE: a superseded run still in flight is pending to GitHub too.
  else if (view.mergeStateStatus === "UNSTABLE" && (view.statusCheckRollup ?? []).some(unfinished)) soft.push("mergeStateStatus is UNSTABLE while a check is still running: re-run once the checks finish");
  else if (view.mergeStateStatus !== "CLEAN") hard.push(`mergeStateStatus is ${view.mergeStateStatus}, not CLEAN (BEHIND or DIRTY: update the branch)`);
  if (view.headRefOid !== expectedSha) hard.push(`head is ${view.headRefOid}, not the ${expectedSha} you verified: re-verify the new head`);
  // An empty list is right after an open or a push, before Actions has created its runs: this repo has no branch protection, so nothing else stops a merge of a head that never ran CI.
  if (!rollup.length) soft.push("no checks have reported yet: wait for CI to start, a head that never ran CI must not merge");
  for (const c of rollup) {
    const isRun = c.status !== undefined;
    if (unfinished(c)) soft.push(`check "${nameOf(c)}" has not finished (${isRun ? c.status : c.state})`);
    else if (isRun ? !OK_CONCLUSIONS.has(c.conclusion) : c.state !== "SUCCESS") hard.push(`check "${nameOf(c)}" ${(isRun ? c.conclusion : c.state) || "has no conclusion"}`);
  }
  return { hard, soft };
}

/** Reasons this PR must not be merged right now. Empty means READY. */
export const blockers = (view, expectedSha, events) => {
  const { hard, soft } = assess(view, expectedSha, events);
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

// PR 3240 (2026-10-22) touched these with no evidence fragment and went red in CI on apps/nickstire/scripts/dod-compiler.mjs.
const DOD_PATHS = ["apps/nickstire/drizzle/", "apps/nickstire/server/cron/", "apps/nickstire/server/services/"];
const FRAGMENT_STATUSES = new Set(["added", "modified"]);

/**
 * The BLOCKED reason when the PR touches a DoD path (or renames a file out of one) and adds or modifies no evidence fragment
 * (.completion/evidence.d/*.json, or the legacy .completion/evidence.json); null otherwise. `files` is the REST
 * pulls/<n>/files list (filename, status, previous_filename). Paths only, never PR text. Does not run the compiler.
 */
export function missingDodFragment(files, branch) {
  const touched = files.some((f) => [f.filename, f.previous_filename].some((p) => DOD_PATHS.some((d) => String(p ?? "").startsWith(d))));
  const fragment = files.some((f) => FRAGMENT_STATUSES.has(f.status) && (/^\.completion\/evidence\.d\/[^/]+\.json$/.test(f.filename) || f.filename === ".completion/evidence.json"));
  if (!touched || fragment) return null;
  return `this PR touches a DoD path (${DOD_PATHS.join(", ")}) but adds no evidence fragment: add .completion/evidence.d/${String(branch).replace(/\//g, "-")}.json (see apps/nickstire/scripts/dod-compiler.mjs) and run the compiler before pushing`;
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
 * When the head reached GitHub, for the Codex wait: the EARLIEST CI start on the head (CI starts on the push), or PR open
 * if that is later (Codex starts on open). Only with no CI start does it fall back to the head commit's committedDate,
 * which can predate the push (#3142, 2026-10-18), and it says so in `warn`. A zero-time startedAt (0001-01-01, a check
 * not yet started) is no start. Returns { ms, warn }.
 */
const pushedAt = (view, codexView) => {
  const starts = (view.statusCheckRollup ?? []).map((c) => Date.parse(c.startedAt)).filter((t) => Number.isFinite(t) && t > Date.UTC(2000, 0, 1));
  const opened = Date.parse(codexView.createdAt);
  const latest = (...ts) => (ts.some(Number.isFinite) ? Math.max(...ts.filter(Number.isFinite)) : NaN);
  if (starts.length) return { ms: latest(Math.min(...starts), opened), warn: [] };
  const head = (codexView.commits ?? []).find((c) => c.oid === view.headRefOid);
  return { ms: latest(Date.parse(head?.committedDate), opened), warn: [`no CI start time on ${view.headRefOid}: timing the Codex wait from the head commit's committedDate, which can predate the push`] };
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
    const pushed = pushedAt(before, codexView);
    codex = codexCheck({ comments, threads: threads.nodes, headSha: sha, headPushedAtMs: pushed.ms, nowMs: now(), waitMinutes: codexWait, merging: Boolean(merge) });
    codex = { ...codex, warn: [...pushed.warn, ...codex.warn] };
    const extra = [];
    if (!complete) extra.push(`more than ${COMMENT_PAGES * 50} comments and no Codex marker for the head among them: this gate cannot prove Codex never reported; check by hand`);
    if (threads.pageInfo?.hasNextPage) extra.push("more than 100 review threads: this gate reads one page, so it cannot prove none is an open Codex finding; check by hand");
    // Paginated REST, not `gh pr view --json files`, which stops at 100 files (PR 3185: 100 of 149). REST itself stops at 3000;
    // per_page=100 is the documented maximum (the default is 30, so a 3000-file PR would take 100 requests instead of 30).
    const files = json(["api", "--paginate", "--slurp", `repos/{owner}/{repo}/pulls/${pr}/files?per_page=100`]).flat();
    const dod = files.length >= 3000 ? "3000 or more changed files: GitHub lists no more, so this gate cannot see every path; check the DoD fragment by hand" : missingDodFragment(files, before.headRefName);
    if (dod) extra.push(dod);
    if (extra.length) codex = { ...codex, hard: [...codex.hard, ...extra] };
  } catch (e) {
    log(`ERROR before any merge call, nothing was merged: ${firstLine(e)}`);
    return 5;
  }
  // Trigger events of the runs in a same-name duplicate only. A failed or empty read leaves the run out of the map, and the
  // gate then keeps both entries (fail closed); it never aborts the gate or counts as pull_request.
  const events = new Map();
  for (const id of duplicateRunIds(before.statusCheckRollup ?? [])) {
    try {
      const ev = String(gh(["api", `repos/{owner}/{repo}/actions/runs/${id}`, "--jq", ".event"])).trim();
      if (ev) events.set(id, ev);
    } catch {}
  }
  const { hard, soft } = assess(before, sha, events);
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

/**
 * The retry line for a short or upper-case --sha (2026-10-25: exit 64 twice in one day). The full lower-case SHA stays
 * required: it is the head you verified and the value --match-head-commit pins, so the gate never resolves a prefix on
 * its own. It only prints the PR's current head when the given SHA is a prefix of it. null = no hint to give.
 */
export function shaUsageHint(pr, sha, headOid) {
  const given = String(sha ?? "").toLowerCase();
  if (!/^[0-9a-f]{4,40}$/.test(given) || !/^[0-9a-f]{40}$/.test(headOid ?? "")) return null;
  if (!headOid.startsWith(given)) return `#${pr} head is ${headOid}, which does not start with ${sha}: re-verify the PR at its current head before merging`;
  return `#${pr} head is ${headOid}. If that is the head you verified, re-run: node scripts/agent-os/merge-gate.mjs ${pr} --sha ${headOid}`;
}

if (isMainModule(import.meta.url)) {
  const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : undefined);
  const pr = Number(process.argv[2]);
  const sha = arg("--sha");
  if (!Number.isInteger(pr) || !/^[0-9a-f]{40}$/.test(sha ?? "")) {
    console.error("usage: node scripts/agent-os/merge-gate.mjs <pr number> --sha <full 40-char head sha> [--wait-minutes 30] [--codex-wait-minutes 25] [--merge]");
    let head;
    try {
      if (Number.isInteger(pr)) head = execFileSync("gh", ["pr", "view", String(pr), "--json", "headRefOid", "--jq", ".headRefOid"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 15000 }).trim();
    } catch {
      /* gh unreachable: the plain usage line stands */
    }
    const hint = shaUsageHint(pr, sha, head);
    if (hint) console.error(hint);
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
