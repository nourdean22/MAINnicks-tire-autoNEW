#!/usr/bin/env node
/**
 * branch-sweep — discover -> snapshot -> classify -> report, for every branch on
 * origin (2026-09-23). NOT named "run-to-empty": that phrase already names an
 * unrelated 2026-08-27 "batch everything into one merge" event in this repo
 * (docs/RECONCILIATION.md, a lineage digest, cronWiringGate.test.ts). NOT
 * "worktree-drain" either — branches, not worktrees, are the one unit both a
 * Windows bridge session and an ephemeral cloud container can always see; a
 * worktree is inherently per-machine.
 *
 * The snapshot (docs/agent-os/branch-sweep-ledger.json +
 * docs/agent-os/BRANCH-SWEEP.md) is written BEFORE anything else and is the whole
 * output of this script — salvage/land are separate, explicit, NEVER
 * auto-executed here, matching this repo's "protected operations, never on agent
 * initiative" rule and the Night Shift "propose, never merge" precedent.
 *
 * Only LANDED is ever auto-(re)computed. A prior human override
 * (SALVAGE/OBSOLETE/NEEDS_SPECIAL_HANDLING/QUARANTINE) on a branch survives across
 * re-runs UNLESS fresh evidence now proves LANDED, which always wins — a stale
 * "needs review" override should never outrank provable proof the branch is safe.
 *
 * Usage:
 *   node scripts/agent-os/branch-sweep.mjs                 # sweep + write the ledger
 *   node scripts/agent-os/branch-sweep.mjs --report-only    # sweep, print, don't write
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ensureProxyEnv } from "./github-client.mjs";
import { gatherRemoteEvidence } from "./repo-status.mjs";
import { classifyBranch, applyOverride, CLASSIFICATIONS } from "./classify-branch.mjs";
import { originOwnerRepo, flag, isMainModule } from "./cli-common.mjs";

const LEDGER_JSON = "docs/agent-os/branch-sweep-ledger.json";
const LEDGER_MD = "docs/agent-os/BRANCH-SWEEP.md";

/** Re-apply a prior human override onto a fresh auto-classification, UNLESS the
 * fresh result is now provably LANDED (which always wins over a stale override). */
export function mergeWithPriorOverrides(freshResults, priorLedger) {
  const priorByBranch = new Map((priorLedger?.branches ?? []).map((b) => [b.branch, b]));
  return freshResults.map((fresh) => {
    const prior = priorByBranch.get(fresh.branch);
    if (prior?.override && fresh.classification !== CLASSIFICATIONS.LANDED) {
      return applyOverride(fresh, prior.classification, {
        reason: prior.override.reason ?? prior.reason,
        by: prior.override.by,
      });
    }
    return fresh;
  });
}

/** Pure renderer: the ledger data -> a human-readable Markdown table, grouped by
 * classification so the branches needing attention are not buried among LANDED
 * ones. */
export function renderLedgerMarkdown(ledger) {
  const groups = {};
  for (const b of ledger.branches) (groups[b.classification] ??= []).push(b);
  const order = [
    CLASSIFICATIONS.NEEDS_SPECIAL_HANDLING,
    CLASSIFICATIONS.QUARANTINE,
    CLASSIFICATIONS.SALVAGE,
    CLASSIFICATIONS.OBSOLETE,
    CLASSIFICATIONS.LANDED,
  ];
  const lines = [
    "# Branch sweep",
    "",
    `Generated ${ledger.generatedAt} · ${ledger.owner}/${ledger.repo} · ${ledger.branches.length} branch(es) on origin.`,
    "",
    "Machine-derived every run — this file and its JSON twin are overwritten wholesale, never hand-edited. To change a",
    "branch's classification, use `--classify-override`, which survives the next sweep until proven LANDED.",
    "",
  ];
  for (const cls of order) {
    const rows = groups[cls];
    if (!rows?.length) continue;
    lines.push(`## ${cls} (${rows.length})`, "", "| branch | reason |", "|---|---|");
    for (const b of rows) lines.push(`| \`${b.branch}\` | ${b.reason.replace(/\|/g, "\\|")} |`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Run `worker(item)` over `items` with at most `limit` in flight at once. Each
 * branch needs several sequential API calls (existence, PR list, per-PR reads,
 * compare) — at 130+ branches on this repo, doing that fully sequentially is slow
 * enough to matter (measured: timed out a 60s test run). GitHub's per-token rate
 * limit (5000/h) has ample headroom at this concurrency; this is about wall-clock
 * time, not rate-limit risk. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runNext() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runNext));
  return results;
}

/** Discover every branch on origin, gather evidence, classify. The one place this
 * repo asks "what state is EVERY branch in," reusing gatherRemoteEvidence /
 * classifyBranch rather than a fourth implementation. */
export async function sweepBranches(owner, repo, { ghPaginate, concurrency = 8 }) {
  const branches = await ghPaginate(`/repos/${owner}/${repo}/branches`);
  return mapWithConcurrency(branches, concurrency, async (b) => {
    // The branches listing itself proves this ref exists; do not spend one
    // extra /branches/<name> request per branch rediscovering that fact.
    const evidence = await gatherRemoteEvidence(owner, repo, b.name, { knownExistsOnOrigin: true });
    const result = classifyBranch(evidence);
    return { branch: b.name, ...evidence, ...result };
  });
}

async function main() {
  ensureProxyEnv();
  const { ghPaginate } = await import("./github-client.mjs");
  const cwd = process.cwd();
  const { owner, repo } = originOwnerRepo(cwd);

  const fresh = await sweepBranches(owner, repo, { ghPaginate });

  const ledgerPath = join(cwd, LEDGER_JSON);
  const prior = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, "utf8")) : null;
  const merged = mergeWithPriorOverrides(fresh, prior);

  const ledger = { generatedAt: new Date().toISOString(), owner, repo, branches: merged };
  const md = renderLedgerMarkdown(ledger);

  if (flag("report-only")) {
    console.log(md);
    return;
  }
  mkdirSync(join(cwd, "docs", "agent-os"), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
  writeFileSync(join(cwd, LEDGER_MD), md);
  console.log(`[branch-sweep] wrote ${LEDGER_JSON} and ${LEDGER_MD} (${merged.length} branches)`);
}

if (isMainModule(import.meta.url)) {
  main().catch((e) => {
    console.error(`[branch-sweep] ${e.message}`);
    process.exit(1);
  });
}
