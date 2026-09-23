#!/usr/bin/env node
/**
 * Session Authority: branch leasing via a git-ref compare-and-swap (2026-09-23).
 *
 * WHY A GIT REF, NOT A GITHUB ISSUE/LABEL. A lease is a mutual-exclusion primitive:
 * two racing acquires for the same branch must yield exactly one winner. An Issue
 * or label update (`PATCH`/`POST`) is an unconditional write — both racers can read
 * "unleased" and both write "leased by me," and the loser's write silently wins or
 * loses with no error. That is the exact anti-pattern this repo's `claim-before-act`
 * skill and `apps/statenour/lib/services/action-attempts.ts` already guard against
 * for DB rows; this is the same idea for git. `PATCH /git/refs/{ref}` with
 * `force:false` IS a real server-side CAS: GitHub rejects the update unless the new
 * commit is a fast-forward of the ref's CURRENT tip, checked atomically on GitHub's
 * side. Each lease commit's parent is the prior lease commit it was read from, so an
 * update only succeeds if the ref had not moved since the read — exactly a
 * check-and-set on the exact row (commit) that was read, never an unconditional
 * write by id. `refs/leases/*` also sits outside `refs/heads/*`, so it is invisible
 * to branch-protection rulesets and fires no `on: push: branches:` workflow, and its
 * commit chain (each parent = the prior state) is a free, walkable audit trail.
 *
 * WHY THIS IS ONLY A LEASE, NOT A FULL LOCK. It answers "who CLAIMS this branch,"
 * not "is their local working tree dirty right now" — that is inherently
 * machine-local (no shared filesystem between a Windows bridge session and an
 * ephemeral cloud container), which is why agent-finish.mjs's dirty/unpushed guard
 * runs on the machine holding the worktree, not here.
 *
 * TTL: a flat expiresAt, no heartbeat/renewal in v1 — deliberately YAGNI'd, same
 * trust model action-attempts.ts already uses for expired holds in this repo. An
 * expired lease auto-reclaims; an active, unexpired foreign lease does not.
 */
import { ghJson } from "./github-client.mjs";

const SCHEMA = "agent-os/lease-v1";
const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12h

/** True if a lease record is missing an expiry (invalid — treat as expired, the
 * safe default) or its expiry has passed. */
export function isExpired(lease) {
  if (!lease?.expiresAt) return true;
  return Date.parse(lease.expiresAt) <= Date.now();
}

/**
 * The real GitHub-backed ref store. Every method throws on transport/auth failure
 * (infrastructure errors) — callers decide fail-open/fail-closed, this layer never
 * silently swallows one.
 */
export function createGitHubLeaseStore(owner, repo) {
  const base = `/repos/${owner}/${repo}`;
  const refPath = (branch) => `refs/leases/${branch}`;

  return {
    /** Current {sha, content} at refs/leases/<branch>, or null if it has never
     * existed. Uses matching-refs (array, prefix-safe) rather than the single-ref
     * endpoint, which has documented ambiguous prefix-matching for nested
     * namespaces on a slash-containing branch name. */
    async getRef(branch) {
      let matches;
      try {
        matches = await ghJson(`${base}/git/matching-refs/leases/${encodeURIComponent(branch)}`);
      } catch (e) {
        if (/404/.test(e.message)) return null;
        throw e;
      }
      const exact = matches.find((m) => m.ref === `refs/${refPath(branch)}`);
      return exact ? { sha: exact.object.sha } : null;
    },

    /** Parsed lease.json content at a given lease commit sha. */
    async getContent(commitSha) {
      const commit = await ghJson(`${base}/git/commits/${commitSha}`);
      const tree = await ghJson(`${base}/git/trees/${commit.tree.sha}`);
      const entry = tree.tree.find((e) => e.path === "lease.json");
      if (!entry) throw new Error(`lease commit ${commitSha} has no lease.json`);
      const blob = await ghJson(`${base}/git/blobs/${entry.sha}`);
      return JSON.parse(Buffer.from(blob.content, blob.encoding).toString("utf8"));
    },

    /** Build (but do not publish) a new lease commit. Returns its sha. */
    async writeCommit(record, parentSha) {
      const content = `${JSON.stringify(record, null, 2)}\n`;
      const blob = await ghJson(`${base}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content, encoding: "utf-8" }),
      });
      const tree = await ghJson(`${base}/git/trees`, {
        method: "POST",
        body: JSON.stringify({ tree: [{ path: "lease.json", mode: "100644", type: "blob", sha: blob.sha }] }),
      });
      const commit = await ghJson(`${base}/git/commits`, {
        method: "POST",
        body: JSON.stringify({
          message: `lease ${record.status}: ${record.branch}`,
          tree: tree.sha,
          parents: parentSha ? [parentSha] : [],
        }),
      });
      return commit.sha;
    },

    /** CAS create: fails if the ref already exists (someone else created it first). */
    async createRef(branch, sha) {
      await ghJson(`${base}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/${refPath(branch)}`, sha }),
      });
    },

    /** CAS update: `force:false` fails unless `sha` is a fast-forward of the ref's
     * CURRENT tip — atomic on GitHub's side, so this is the actual compare-and-swap. */
    async updateRef(branch, sha) {
      await ghJson(`${base}/git/refs/${refPath(branch)}`, {
        method: "PATCH",
        body: JSON.stringify({ sha, force: false }),
      });
    },
  };
}

/** Read the current lease for a branch, or null. Never throws on "no lease" —
 * only on a real transport/auth failure. */
export async function readLease(branch, { store }) {
  const ref = await store.getRef(branch);
  if (!ref) return null;
  const lease = await store.getContent(ref.sha);
  return { ...lease, _commitSha: ref.sha };
}

/**
 * Acquire a lease. Returns one of:
 *   { ok: true,  lease }                          — acquired (fresh, reclaimed-expired, or re-acquired by the same session)
 *   { ok: false, reason: "held", holder }          — an active, unexpired lease is held by someone else
 *   { ok: false, reason: "race" }                  — lost a genuine concurrent race (retry is safe)
 * Throws only on infrastructure failure (network/auth) — callers apply their own
 * fail-open/fail-closed posture around that, per pretool.mjs's documented asymmetry.
 */
export async function acquireLease(branch, meta, { store, ttlMs = DEFAULT_TTL_MS } = {}) {
  const ref = await store.getRef(branch);
  let priorSha = null;
  if (ref) {
    const current = await store.getContent(ref.sha);
    priorSha = ref.sha;
    if (current.status === "active" && !isExpired(current) && current.sessionId !== meta.sessionId) {
      return { ok: false, reason: "held", holder: current };
    }
  }

  const now = new Date();
  const record = {
    $schema: SCHEMA,
    branch,
    status: "active",
    sessionKind: meta.sessionKind,
    sessionId: meta.sessionId,
    worktree: meta.worktree,
    claimedBy: meta.claimedBy ?? "",
    claimedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    releasedAt: null,
    releaseReason: null,
    priorLeaseSha: priorSha,
  };

  const commitSha = await store.writeCommit(record, priorSha);
  try {
    if (priorSha) await store.updateRef(branch, commitSha);
    else await store.createRef(branch, commitSha);
  } catch {
    // The CAS itself rejected us — someone else's write landed first. Never
    // swallowed as "acquired"; the caller decides whether to retry.
    return { ok: false, reason: "race" };
  }
  return { ok: true, lease: { ...record, _commitSha: commitSha } };
}

/**
 * Release a lease. `dirty`/`unpushedCount` are the CALLER's already-gathered local
 * git state (this module has no filesystem access by design — see file header);
 * refuses unless `force` is set, in which case `reason` is written permanently into
 * the release record.
 */
export async function releaseLease(branch, { dirty = false, unpushedCount = 0, force = false, reason = null } = {}, { store }) {
  const ref = await store.getRef(branch);
  if (!ref) return { ok: false, reason: "no-lease" };
  const current = await store.getContent(ref.sha);
  if ((dirty || unpushedCount > 0) && !force) {
    return { ok: false, reason: "dirty", dirty, unpushedCount };
  }

  const record = {
    ...current,
    status: "released",
    releasedAt: new Date().toISOString(),
    releaseReason: dirty || unpushedCount > 0 ? reason : null,
    priorLeaseSha: ref.sha,
  };
  const commitSha = await store.writeCommit(record, ref.sha);
  try {
    await store.updateRef(branch, commitSha);
  } catch {
    return { ok: false, reason: "race" };
  }
  return { ok: true, lease: { ...record, _commitSha: commitSha } };
}
