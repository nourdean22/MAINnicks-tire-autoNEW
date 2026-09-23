#!/usr/bin/env node
/**
 * agent-finish — release a Session Authority lease (2026-09-23).
 *
 * Refuses to release a DIRTY worktree or one with unpushed/unpublished commits —
 * this is the exact failure mode the investigation that produced this file started
 * from: a session "finishing" and silently abandoning local work with no trace
 * anywhere. Local git state is read HERE, in the worktree that is finishing,
 * because it cannot be seen any other way — no shared filesystem between a Windows
 * bridge session and an ephemeral cloud container (see lease.mjs's file header).
 *
 * Usage:
 *   node scripts/agent-os/agent-finish.mjs [--branch <name>] [--worktree <path>]
 *     [--force-release-dirty "<reason, required with the flag>"]
 * Exit 0 = released (clean, or forced) — or fail-open (infra error). Exit 1 = refused.
 */
import { ensureProxyEnv } from "./github-client.mjs";
import { createGitHubLeaseStore, releaseLease } from "./lease.mjs";
import { arg, flag, originOwnerRepo, resolveBranch, sh } from "./cli-common.mjs";
import { clearLocalMarker } from "./local-lease-marker.mjs";

/** {dirty, hasUpstream, unpushedCount} for `branch` in `cwd`. hasUpstream:false
 * (no origin/<branch> at all) is reported distinctly from "0 unpushed" — a branch
 * that was never pushed is a MORE dangerous case, not an equally-safe one
 * (empty-vs-error: a failed/absent read must never collapse into a confident zero). */
export function localGitState(cwd, branch) {
  const dirty = sh("git status --porcelain", cwd).length > 0;
  let hasUpstream = true;
  try {
    sh(`git rev-parse --verify origin/${branch}`, cwd);
  } catch {
    hasUpstream = false;
  }
  const unpushedCount = hasUpstream
    ? parseInt(sh(`git rev-list --count origin/${branch}..HEAD`, cwd) || "0", 10)
    : parseInt(sh("git rev-list --count HEAD", cwd) || "0", 10);
  return { dirty, hasUpstream, unpushedCount };
}

async function main() {
  // Called only here, not at module top-level — this file is imported by tests to
  // reuse localGitState() without triggering a proxy-shim re-exec as a side effect
  // of import.
  ensureProxyEnv();

  const worktree = arg("worktree", process.cwd());
  const forceReason = arg("force-release-dirty", null);
  const force = flag("force-release-dirty") || forceReason !== null;
  if (force && !forceReason) {
    process.stderr.write('[agent-finish] --force-release-dirty requires a reason: --force-release-dirty "why"\n');
    process.exit(1);
  }

  let branch, state;
  try {
    branch = resolveBranch(worktree);
    state = localGitState(worktree, branch);
  } catch (e) {
    process.stderr.write(`[agent-finish] could not read local git state in ${worktree} (${e.message}) — failing OPEN\n`);
    process.exit(0);
  }

  let owner, repo;
  try {
    ({ owner, repo } = originOwnerRepo(worktree));
  } catch (e) {
    process.stderr.write(`[agent-finish] could not resolve owner/repo from origin (${e.message}) — failing OPEN\n`);
    process.exit(0);
  }

  const store = createGitHubLeaseStore(owner, repo);
  let result;
  try {
    result = await releaseLease(
      branch,
      { dirty: state.dirty, unpushedCount: state.unpushedCount, force, reason: forceReason },
      { store },
    );
  } catch (e) {
    process.stderr.write(`[agent-finish] lease service unreachable (${e.message}) — failing OPEN\n`);
    process.exit(0);
  }

  if (result.ok) {
    try {
      clearLocalMarker(worktree);
    } catch (e) {
      process.stderr.write(`[agent-finish] released ${branch}, but could not clear the local marker (${e.message})\n`);
    }
    console.log(`[agent-finish] released ${branch}${force ? ` (forced: ${forceReason})` : ""}`);
    process.exit(0);
  }

  if (result.reason === "no-lease") {
    try {
      clearLocalMarker(worktree); // a stale marker with no real lease behind it is still worth clearing
    } catch {
      // best-effort only
    }
    console.log(`[agent-finish] ${branch} had no active lease — nothing to release`);
    process.exit(0);
  }

  if (result.reason === "dirty") {
    const upstreamNote = state.hasUpstream
      ? `${state.unpushedCount} commit(s) not on origin/${branch}`
      : `origin/${branch} does not exist — nothing has EVER been pushed for this branch`;
    process.stderr.write(
      `[agent-finish] REFUSED: ${branch}'s worktree is not safe to abandon — ` +
        `${state.dirty ? "uncommitted changes present" : ""}${state.dirty && state.unpushedCount > 0 ? "; " : ""}` +
        `${state.unpushedCount > 0 || !state.hasUpstream ? upstreamNote : ""}. ` +
        `Commit and push first, or re-run with --force-release-dirty "<reason>" to abandon it anyway.\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`[agent-finish] lost a race releasing the lease for ${branch} (reason: ${result.reason}) — retry\n`);
  process.exit(1);
}

// Guarded so localGitState is importable for tests without also running main().
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
