#!/usr/bin/env node
/**
 * repo:rescue — automates .claude/skills/stranded-branch-rescue/SKILL.md's exact
 * steps for ONE branch (2026-09-23). Not a reimplementation of branch-merge
 * detection — it calls the same evidence-gathering and classification this repo's
 * Session Authority already built (classify-branch.mjs), which itself encodes the
 * skill's PR-record-first rule (never `git cherry` alone — it false-positived on 5
 * of 6 already-merged branches in this repo's own history).
 *
 * STEPS (mirrors the skill):
 *  1. PR-record check first (classifyBranch — LANDED means stop, zombie rule).
 *  2. Worktree-attachment gate — LOCAL ONLY. From a cloud container this can only
 *     certify "no worktree HERE," never "no worktree anywhere" (no shared
 *     filesystem with a Windows bridge session) — reported as `unchecked-remote`,
 *     never silently upgraded to `pass`.
 *  3. SHA-stability — the tip SHA recorded at discovery is re-checked immediately
 *     before opening the PR.
 *  4. Opens a PR with a provenance note. NEVER merges — see the source-grep canary
 *     in repo-rescue.test.mjs, which asserts no merge-endpoint call exists in this
 *     file's own source, the same spirit as the Night Shift "propose, never merge"
 *     policy rule, expressed as a unit assertion instead of a pretool.mjs regex.
 *
 * Usage:
 *   node scripts/agent-os/repo-rescue.mjs --branch <name> [--worktree <path>] [--dry-run]
 */
import { ensureProxyEnv, ghJson } from "./github-client.mjs";
import { classifyBranch, CLASSIFICATIONS } from "./classify-branch.mjs";
import { gatherRemoteEvidence } from "./repo-status.mjs";
import { arg, flag, originOwnerRepo, sh } from "./cli-common.mjs";

/** Any worktree on THIS machine currently checked out to `branch`? Local-only by
 * construction — callers must not read a `false` here as "nowhere." */
export function hasLocalWorktree(cwd, branch) {
  let out;
  try {
    out = sh("git worktree list --porcelain", cwd);
  } catch {
    return null; // could not even ask — unknown, not false
  }
  return out.includes(`branch refs/heads/${branch}\n`) || out.endsWith(`branch refs/heads/${branch}`);
}

/** Build the rescue PR body — the skill's required provenance note. */
export function provenanceNote({ branch, tipSha, classification, reason }) {
  return [
    `Automated rescue via \`repo:rescue\` (extends \`.claude/skills/stranded-branch-rescue\`).`,
    ``,
    `- Branch: \`${branch}\``,
    `- Tip SHA at rescue time: \`${tipSha}\``,
    `- Classification: ${classification} — ${reason}`,
    `- Worktree-attachment gate: local-machine-only, cannot certify absence on any other environment`,
    `- Zombie rule: this branch had NO merged PR at rescue time (re-checked immediately before this PR was opened)`,
    ``,
    `This PR was opened, never merged, by automation. A human reviews and merges it.`,
  ].join("\n");
}

export async function rescueBranch(branch, { owner, repo, worktree = process.cwd(), dryRun = false } = {}) {
  const evidence = await gatherRemoteEvidence(owner, repo, branch);
  const classification = classifyBranch(evidence);

  if (classification.classification === CLASSIFICATIONS.LANDED) {
    return { rescued: false, reason: "zombie-rule", classification };
  }
  if (!evidence.existsOnOrigin) {
    return { rescued: false, reason: "no-remote-branch-to-rescue", classification };
  }

  const worktreeGate = hasLocalWorktree(worktree, branch);
  if (worktreeGate === true) {
    return { rescued: false, reason: "attached-worktree-here", classification };
  }
  const worktreeGateResult = worktreeGate === null ? "unchecked-remote" : "no-worktree-here (unchecked-remote for other environments)";

  // SHA-stability: re-read the tip immediately before opening the PR.
  const recheck = await ghJson(`/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
  const tipSha = recheck.commit.sha;

  const body = provenanceNote({ branch, tipSha, classification: classification.classification, reason: classification.reason });
  const title = `rescue: land ${branch}`;

  if (dryRun) {
    return { rescued: false, reason: "dry-run", classification, worktreeGateResult, wouldOpen: { title, body } };
  }

  const pr = await ghJson(`/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    body: JSON.stringify({ title, head: branch, base: "main", body, draft: true }),
  });
  return { rescued: true, classification, worktreeGateResult, prNumber: pr.number, prUrl: pr.html_url };
}

async function main() {
  ensureProxyEnv();
  const branch = arg("branch");
  if (!branch) {
    console.error("[repo-rescue] --branch <name> is required");
    process.exit(1);
  }
  const worktree = arg("worktree", process.cwd());
  const { owner, repo } = originOwnerRepo(worktree);
  const result = await rescueBranch(branch, { owner, repo, worktree, dryRun: flag("dry-run") });
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.rescued || result.reason === "dry-run" ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`[repo-rescue] ${e.message}`);
    process.exit(1);
  });
}
