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
 *     [--force-release-foreign "<reason, required with the flag>"]
 * Exit 0 = released (clean, or forced) — or fail-open (infra error). Exit 1 = refused.
 *
 * Only the lease HOLDER may release a live lease (audit item O). The caller is this
 * session's CLAUDE_CODE_SESSION_ID. --force-release-foreign "<why>" releases a live
 * lease held by another session (the recovery lease-check.mjs's block message
 * points at); the reason and the releasing session are recorded permanently.
 */
import { ensureProxyEnv } from "./github-client.mjs";
import { createGitHubLeaseStore, releaseLease } from "./lease.mjs";
import { arg, flag, originOwnerRepo, resolveBranch, resolveSessionId, sh, isMainModule } from "./cli-common.mjs";
import { clearLocalMarker, readLocalMarker } from "./local-lease-marker.mjs";

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

/**
 * Which session is releasing. A Claude session is its CLAUDE_CODE_SESSION_ID. A
 * bare manual run has no stable id (resolveSessionId() mints a fresh
 * `manual-<pid>-<ts>` per process), so a lease agent-start.mjs took manually could
 * never be released by the matching manual agent-finish.mjs; in that one case the
 * id is taken from THIS worktree's own marker, and only when that marker is itself
 * a manual one for this branch — a real session's lease is never borrowed this way.
 */
export function resolveReleaseCaller(marker, branch, env = process.env) {
  if (env.CLAUDE_CODE_SESSION_ID) return env.CLAUDE_CODE_SESSION_ID;
  if (marker?.branch === branch && typeof marker.sessionId === "string" && marker.sessionId.startsWith("manual-")) {
    return marker.sessionId;
  }
  return resolveSessionId(env);
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
  const foreignReason = arg("force-release-foreign", null);
  const forceForeign = flag("force-release-foreign") || foreignReason !== null;
  if (forceForeign && !(foreignReason && foreignReason.trim())) {
    process.stderr.write('[agent-finish] --force-release-foreign requires a reason: --force-release-foreign "why"\n');
    process.exit(1);
  }

  // Clears the local marker when the operator explicitly forced a foreign release
  // but the lease itself could not be reached: the marker is only a local nudge,
  // and leaving it would keep lease-check.mjs blocking this worktree with no way
  // out but hand-deleting it.
  const failOpen = (msg) => {
    process.stderr.write(`${msg}\n`);
    if (forceForeign) {
      try {
        clearLocalMarker(worktree);
        process.stderr.write(`[agent-finish] --force-release-foreign: cleared this worktree's local lease marker anyway (${foreignReason})\n`);
      } catch {
        // best-effort only
      }
    }
    process.exit(0);
  };

  let branch, state;
  try {
    branch = resolveBranch(worktree);
    state = localGitState(worktree, branch);
  } catch (e) {
    failOpen(`[agent-finish] could not read local git state in ${worktree} (${e.message}) — failing OPEN`);
  }

  let owner, repo;
  try {
    ({ owner, repo } = originOwnerRepo(worktree));
  } catch (e) {
    failOpen(`[agent-finish] could not resolve owner/repo from origin (${e.message}) — failing OPEN`);
  }

  let marker = null;
  try {
    marker = readLocalMarker(worktree);
  } catch {
    // no marker is fine — the caller is then just this session's id
  }
  const sessionId = resolveReleaseCaller(marker, branch);

  const store = createGitHubLeaseStore(owner, repo);
  let result;
  try {
    result = await releaseLease(
      branch,
      { sessionId, dirty: state.dirty, unpushedCount: state.unpushedCount, force, reason: forceReason, forceForeign, foreignReason },
      { store },
    );
  } catch (e) {
    failOpen(`[agent-finish] lease service unreachable (${e.message}) — failing OPEN`);
  }

  if (result.ok) {
    try {
      clearLocalMarker(worktree);
    } catch (e) {
      process.stderr.write(`[agent-finish] released ${branch}, but could not clear the local marker (${e.message})\n`);
    }
    const notes = [force ? `forced dirty: ${forceReason}` : "", result.lease.foreignReleaseReason ? `released another session's lease (${result.lease.sessionId}): ${foreignReason}` : ""].filter(Boolean);
    console.log(`[agent-finish] released ${branch}${notes.length ? ` (${notes.join("; ")})` : ""}`);
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

  if (result.reason === "not-holder") {
    const h = result.holder;
    process.stderr.write(
      `[agent-finish] REFUSED: ${branch}'s lease belongs to session ${h.sessionId} (${h.sessionKind}), not this one (${sessionId}), ` +
        `and is live until ${h.expiresAt}${h.claimedBy ? ` — claimed for "${h.claimedBy}"` : ""}. ` +
        `Only its holder releases it. If that session is gone, confirm with the operator and re-run with ` +
        `--force-release-foreign "<why>" (recorded permanently).\n`,
    );
    process.exit(1);
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
if (isMainModule(import.meta.url)) {
  main();
}
