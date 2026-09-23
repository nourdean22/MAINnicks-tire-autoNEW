#!/usr/bin/env node
/**
 * agent-start — acquire a Session Authority lease before working on a branch
 * (2026-09-23). See lease.mjs for the CAS design.
 *
 * FAILURE POSTURE — deliberately asymmetric, matching pretool.mjs (root AGENTS.md
 * enforcement map): a REAL conflict (someone else actively holds this branch) fails
 * CLOSED (exit 1, loud, names the holder). An INFRASTRUCTURE failure (no network, no
 * token, GitHub down, owner/repo unparseable) fails OPEN (exit 0, loud warning) —
 * bricking every worktree creation because the lease service hiccuped is a worse
 * outcome than occasionally proceeding unleased.
 *
 * Usage:
 *   node scripts/agent-os/agent-start.mjs [--branch <name>] [--worktree <path>]
 *     [--session-kind bridge|cloud] [--claimed-by "<one-line task summary>"]
 * Defaults: --branch from `git rev-parse --abbrev-ref HEAD` in --worktree (or cwd);
 * --worktree from cwd.
 */
import { ensureProxyEnv } from "./github-client.mjs";
import { createGitHubLeaseStore, acquireLease } from "./lease.mjs";
import { arg, originOwnerRepo, resolveBranch, resolveSessionId, resolveSessionKind } from "./cli-common.mjs";
import { writeLocalMarker } from "./local-lease-marker.mjs";

async function main() {
  ensureProxyEnv();

  const worktree = arg("worktree", process.cwd());
  let branch;
  try {
    branch = resolveBranch(worktree);
  } catch (e) {
    process.stderr.write(`[agent-start] could not resolve current branch in ${worktree} (${e.message}) — failing OPEN\n`);
    process.exit(0);
  }

  const sessionKind = resolveSessionKind();
  const sessionId = resolveSessionId();
  const claimedBy = arg("claimed-by", "");

  let owner, repo;
  try {
    ({ owner, repo } = originOwnerRepo(worktree));
  } catch (e) {
    process.stderr.write(`[agent-start] could not resolve owner/repo from origin (${e.message}) — failing OPEN\n`);
    process.exit(0);
  }

  const store = createGitHubLeaseStore(owner, repo);
  let result;
  try {
    result = await acquireLease(branch, { sessionKind, sessionId, worktree, claimedBy }, { store });
  } catch (e) {
    process.stderr.write(`[agent-start] lease service unreachable (${e.message}) — failing OPEN, proceeding WITHOUT a lease\n`);
    process.exit(0);
  }

  if (result.ok) {
    try {
      writeLocalMarker(worktree, {
        branch,
        sessionId,
        sessionKind,
        claimedAt: result.lease.claimedAt,
        expiresAt: result.lease.expiresAt,
      });
    } catch (e) {
      // The marker is a best-effort local nudge, not the authoritative guarantee
      // (that's the ref CAS above, already succeeded) — never fail the acquire
      // over a local filesystem hiccup, but say so.
      process.stderr.write(`[agent-start] leased ${branch}, but could not write the local marker (${e.message})\n`);
    }
    console.log(`[agent-start] leased ${branch} for session ${sessionId} (${sessionKind}) until ${result.lease.expiresAt}`);
    process.exit(0);
  }

  if (result.reason === "held") {
    const h = result.holder;
    process.stderr.write(
      `[agent-start] REFUSED: ${branch} is already leased by session ${h.sessionId} (${h.sessionKind}), ` +
        `claimed ${h.claimedAt}${h.claimedBy ? ` for "${h.claimedBy}"` : ""}, expires ${h.expiresAt}. ` +
        `This branch's worktree may already have someone else's uncommitted work in it — confirm with the ` +
        `operator before proceeding on a shared checkout.\n`,
    );
    process.exit(1);
  }

  process.stderr.write(`[agent-start] lost a race acquiring the lease for ${branch} — safe to retry once\n`);
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
