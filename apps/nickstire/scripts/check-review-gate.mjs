#!/usr/bin/env node
/**
 * Review-aware Completion Authority — the gate #820 proved missing: a PR
 * merged while automated review was still running, and P1/P2 findings
 * surfaced post-merge with nothing forcing a response.
 *
 * Pre-merge mode (open PR): the release barrier FAILS while
 *   - CI checks are pending or failing
 *   - unresolved P0/P1/P2 review threads exist
 *   - a CHANGES_REQUESTED review is outstanding
 *   - the latest approval is STALE (head moved after it)
 * Post-merge mode (merged PR): unresolved P0/P1/P2 threads become a
 * remediation demand — the affected capabilities must be regressed via
 * scripts/regress-capability.mjs until the findings are resolved on main.
 *
 * Structured GitHub GraphQL only — no comment-text scraping beyond the
 * reviewer's own explicit "P<n> Badge" severity markers.
 *
 * Usage: node scripts/check-review-gate.mjs <prNumber> [--enforce]
 * (needs `gh` authenticated, or GH_TOKEN in CI)
 */
import { execFileSync } from "node:child_process";

export function classifyReviewState(pr, opts = {}) {
  const violations = [];
  const advisories = [];

  const threads = pr.reviewThreads?.nodes ?? [];
  for (const t of threads) {
    if (t.isResolved) continue;
    const body = t.comments?.nodes?.[0]?.body ?? "";
    const sev = body.match(/P([012]) Badge/)?.[1];
    if (sev !== undefined) {
      violations.push(`unresolved P${sev} review thread: ${body.replace(/\s+/g, " ").slice(0, 140)}`);
    } else {
      advisories.push(`unresolved informational thread (non-blocking): ${body.replace(/\s+/g, " ").slice(0, 100)}`);
    }
  }

  const reviews = pr.reviews?.nodes ?? [];
  const latestByAuthor = new Map();
  for (const r of reviews) {
    if (!r.author?.login) continue;
    latestByAuthor.set(r.author.login, r);
  }
  for (const r of latestByAuthor.values()) {
    if (r.state === "CHANGES_REQUESTED") {
      violations.push(`outstanding CHANGES_REQUESTED review from ${r.author.login}`);
    }
    if (r.state === "APPROVED" && pr.headRefOid && r.commit?.oid && r.commit.oid !== pr.headRefOid) {
      violations.push(`STALE approval from ${r.author.login}: approved ${r.commit.oid.slice(0, 8)}, head is ${pr.headRefOid.slice(0, 8)}`);
    }
  }

  if (!pr.merged && !opts.skipCiCheck) {
    const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
    if (rollup === "PENDING" || rollup === "EXPECTED") violations.push("CI checks still PENDING — the release barrier requires completed CI");
    if (rollup === "FAILURE" || rollup === "ERROR") violations.push(`CI checks ${rollup}`);
  }

  return { mode: pr.merged ? "post-merge" : "pre-merge", violations, advisories };
}

// statusCheckRollup requires checks:read on the token; a single forbidden
// field NULLS the whole pullRequest with FORBIDDEN (live-diagnosed on #828's
// first real PR-event run of this gate). In --skip-ci-check mode the rollup
// is unused — don't even request it, so the gate works with the minimal
// pull-requests:read grant.
const queryFor = (skipCiCheck) => `query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      merged headRefOid
      reviewThreads(first:50){nodes{isResolved comments(first:1){nodes{body}}}}
      reviews(first:50){nodes{state author{login} commit{oid}}}
      ${skipCiCheck ? "" : "commits(last:1){nodes{commit{statusCheckRollup{state}}}}"}
    }
  }
}`;

import { fileURLToPath } from "node:url";
import path from "node:path";
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const number = Number(process.argv[2]);
  const enforce = process.argv.includes("--enforce");
  const skipCiCheck = process.argv.includes("--skip-ci-check"); // in-CI: this job IS part of the rollup
  if (!Number.isInteger(number)) {
    console.error("usage: check-review-gate.mjs <prNumber> [--enforce]");
    process.exit(2);
  }
  const raw = execFileSync(
    "gh",
    ["api", "graphql", "-f", `query=${queryFor(skipCiCheck)}`, "-F", "owner=nourdean22", "-F", "name=MAINnicks-tire-autoNEW", "-F", `number=${number}`],
    { encoding: "utf8" },
  );
  const pr = JSON.parse(raw).data.repository.pullRequest;
  const result = classifyReviewState(pr, { skipCiCheck });

  console.log(`review gate — PR #${number} (${result.mode})`);
  for (const a of result.advisories) console.log(`  ℹ ${a}`);
  if (!result.violations.length) {
    console.log("  ✓ no blocking review conditions");
    process.exit(0);
  }
  for (const v of result.violations) console.error(`  ✗ ${v}`);
  if (result.mode === "post-merge") {
    console.error(`\nREMEDIATION DEMANDED: findings surfaced on a MERGED PR. Regress the affected capabilities`);
    console.error(`(node scripts/regress-capability.mjs <capabilityId> <P0|P1|P2> "<description>" "PR #${number} review")`);
    console.error(`and keep them regressed until the threads are resolved by a fix reachable from main.`);
  }
  process.exit(enforce ? 1 : 0);
}
