#!/usr/bin/env node
/**
 * repo:status — one screen: every local worktree's branch, dirty/unpushed state,
 * whether it exists on origin, its PR/classification, and its lease (2026-09-23).
 *
 * TWO INDEPENDENT DATA SOURCES, reported side by side, never conflated:
 *  - LOCAL (`git worktree list --porcelain` on THIS machine) — inherently
 *    machine-scoped. A run here shows only this container's one checkout, never
 *    the Windows bridge's worktrees, and vice versa. Said explicitly in the output,
 *    not implied as complete.
 *  - REMOTE (GitHub: branch existence, PR/merge state via classify-branch.mjs,
 *    lease state via lease.mjs) — reachable from anywhere.
 *
 * Usage:
 *   node scripts/agent-os/repo-status.mjs             # local worktrees + their remote state
 *   node scripts/agent-os/repo-status.mjs --all-branches  # + every branch on origin
 */
import { ensureProxyEnv, ghJson, ghPaginate } from "./github-client.mjs";
import { createGitHubLeaseStore, readLease, isExpired } from "./lease.mjs";
import { classifyBranch } from "./classify-branch.mjs";
import { localGitState } from "./agent-finish.mjs";
import { arg, flag, originOwnerRepo, sh } from "./cli-common.mjs";

/** Parse `git worktree list --porcelain` into [{path, branch, headSha, detached}]. */
export function parseWorktreePorcelain(text) {
  const blocks = text.split(/\n\n+/).map((b) => b.trim()).filter(Boolean);
  return blocks.map((block) => {
    const lines = block.split("\n");
    const entry = { path: null, headSha: null, branch: null, detached: false, bare: false };
    for (const line of lines) {
      if (line.startsWith("worktree ")) entry.path = line.slice("worktree ".length);
      else if (line.startsWith("HEAD ")) entry.headSha = line.slice("HEAD ".length);
      else if (line.startsWith("branch ")) entry.branch = line.slice("branch refs/heads/".length);
      else if (line === "detached") entry.detached = true;
      else if (line === "bare") entry.bare = true;
    }
    return entry;
  });
}

/** Gather remote evidence for one branch: existence, PR/merge state (per-PR reads
 * only), ahead/behind via the compare endpoint. Exported — repo-rescue.mjs and
 * branch-sweep.mjs reuse this exact gathering, not a second implementation. */
export async function gatherRemoteEvidence(owner, repo, branch) {
  const base = `/repos/${owner}/${repo}`;
  let existsOnOrigin = true;
  try {
    await ghJson(`${base}/branches/${encodeURIComponent(branch)}`);
  } catch (e) {
    if (/404/.test(e.message)) existsOnOrigin = false;
    else throw e;
  }

  const candidates = await ghJson(`${base}/pulls?head=${owner}:${encodeURIComponent(branch)}&state=all`);
  const prs = await Promise.all(
    candidates.map(async (c) => {
      const full = await ghJson(`${base}/pulls/${c.number}`); // authoritative merged field, never the list one
      return { number: full.number, merged: full.merged === true, mergedAt: full.merged_at ?? undefined };
    }),
  );

  let aheadOfMain, behindOfMain;
  if (existsOnOrigin) {
    try {
      const cmp = await ghJson(`${base}/compare/main...${encodeURIComponent(branch)}`);
      aheadOfMain = cmp.ahead_by;
      behindOfMain = cmp.behind_by;
    } catch {
      // compare can fail on an empty/orphan branch — leave undefined, not a false 0.
    }
  }

  return { branch, existsOnOrigin, prs, aheadOfMain, behindOfMain };
}

/** Pure formatter — one row per branch, one screen. */
export function formatStatusTable(rows) {
  const cols = ["branch", "local", "dirty", "unpushed", "origin", "PR/class", "lease"];
  const widths = cols.map((c, i) => Math.max(c.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const line = (cells) => cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  return [line(cols), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)].join("\n");
}

async function main() {
  ensureProxyEnv();
  const cwd = process.cwd();
  const { owner, repo } = originOwnerRepo(cwd);

  const porcelain = sh("git worktree list --porcelain", cwd);
  const worktrees = parseWorktreePorcelain(porcelain).filter((w) => !w.bare && w.branch);

  let branchesToReport = worktrees.map((w) => w.branch);
  if (flag("all-branches")) {
    const all = await ghPaginate(`/repos/${owner}/${repo}/branches`);
    branchesToReport = [...new Set([...branchesToReport, ...all.map((b) => b.name)])];
  }

  const store = createGitHubLeaseStore(owner, repo);
  const rows = [];
  for (const branch of branchesToReport) {
    const wt = worktrees.find((w) => w.branch === branch);
    const local = wt ? localGitState(wt.path, branch) : null;
    const evidence = await gatherRemoteEvidence(owner, repo, branch);
    const cls = classifyBranch(evidence);
    const lease = await readLease(branch, { store }).catch(() => null);
    const leaseCell = !lease
      ? "-"
      : lease.status !== "active"
        ? "released"
        : isExpired(lease)
          ? `expired (was ${lease.sessionId})`
          : `${lease.sessionId} (${lease.sessionKind})`;

    rows.push([
      branch,
      wt ? wt.path : "(not checked out here)",
      local ? (local.dirty ? "yes" : "no") : "-",
      local ? local.unpushedCount : "-",
      evidence.existsOnOrigin ? "yes" : "no",
      `${cls.classification}${evidence.prs.length ? ` (#${evidence.prs.map((p) => p.number).join(",")})` : ""}`,
      leaseCell,
    ]);
  }

  console.log(`repo:status · ${owner}/${repo} · local worktrees shown are THIS machine's only\n`);
  console.log(formatStatusTable(rows));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`[repo-status] ${e.message}`);
    process.exit(1);
  });
}
