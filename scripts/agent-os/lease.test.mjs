/**
 * Canaries for lease.mjs's compare-and-swap (Session Authority · 2026-09-23).
 *
 * All against an in-memory mock store that enforces the SAME invariant real GitHub
 * enforces server-side: createRef fails if the ref already exists; updateRef fails
 * unless the published commit's parent is exactly the ref's current tip (the
 * fast-forward check). Neither mock method contains an `await` before its
 * check-and-set, matching GitHub's atomic, single-point-of-truth ref update — this
 * is what makes "exactly one of two concurrent racers wins" a real, reproducible
 * guarantee here rather than a timing accident. positive-control-first: the
 * concurrency test below is the one that matters — it must show a genuine race, not
 * two sequential calls that never actually contend.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { acquireLease, releaseLease, readLease, isExpired } from "./lease.mjs";

function createMockStore() {
  const refs = new Map();
  const commits = new Map();
  let seq = 0;
  return {
    async getRef(branch) {
      const r = refs.get(branch);
      return r ? { sha: r.sha } : null;
    },
    async getContent(sha) {
      const c = commits.get(sha);
      if (!c) throw new Error(`mock: no commit ${sha}`);
      return c.content;
    },
    async writeCommit(record, parentSha) {
      const sha = `sha-${++seq}`;
      commits.set(sha, { content: record, parent: parentSha });
      return sha;
    },
    async createRef(branch, sha) {
      if (refs.has(branch)) throw new Error("mock: Reference already exists (422)");
      refs.set(branch, { sha });
    },
    async updateRef(branch, sha) {
      const current = refs.get(branch);
      const commit = commits.get(sha);
      if (!current) throw new Error("mock: ref does not exist");
      if (commit.parent !== current.sha) throw new Error("mock: update is not a fast-forward (422)");
      refs.set(branch, { sha });
    },
    // test-only seam: seed an existing lease without going through acquireLease
    async _seed(branch, record) {
      const sha = await this.writeCommit(record, null);
      refs.set(branch, { sha });
      return sha;
    },
  };
}

test("isExpired: true for a past expiresAt, false for a future one, true when absent", () => {
  assert.equal(isExpired({ expiresAt: new Date(Date.now() - 1000).toISOString() }), true);
  assert.equal(isExpired({ expiresAt: new Date(Date.now() + 100000).toISOString() }), false);
  assert.equal(isExpired({}), true);
  assert.equal(isExpired(null), true);
});

test("acquireLease: fresh branch, no prior lease, succeeds", async () => {
  const store = createMockStore();
  const r = await acquireLease("nickstire/task", { sessionKind: "cloud", sessionId: "s1", worktree: "/x" }, { store });
  assert.equal(r.ok, true);
  assert.equal(r.lease.status, "active");
  assert.equal(r.lease.priorLeaseSha, null);
});

test("CONCURRENCY: exactly one of two racers for the SAME branch wins, the other gets reason:race", async () => {
  const store = createMockStore();
  const meta = (id) => ({ sessionKind: "cloud", sessionId: id, worktree: `/${id}` });
  const [a, b] = await Promise.all([
    acquireLease("statenour/contested", meta("session-A"), { store }),
    acquireLease("statenour/contested", meta("session-B"), { store }),
  ]);
  const results = [a, b];
  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);
  assert.equal(winners.length, 1, `expected exactly 1 winner, got ${winners.length}: ${JSON.stringify(results)}`);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason, "race");
  // The branch ends up leased by exactly the winner, never both, never neither.
  const finalLease = await readLease("statenour/contested", { store });
  assert.equal(finalLease.sessionId, winners[0].lease.sessionId);
});

test("CONCURRENCY (update path): two sessions racing to RECLAIM the same expired lease — exactly one wins", async () => {
  // The fresh-branch race above only exercises createRef's atomicity (priorSha is
  // null, so acquireLease never calls updateRef). This one seeds an existing,
  // expired lease first so both racers have a non-null priorSha and must go
  // through updateRef's fast-forward check — the path a mutation test caught this
  // suite's first draft never actually exercising.
  const store = createMockStore();
  await store._seed("worker/reclaim-race", {
    $schema: "agent-os/lease-v1", branch: "worker/reclaim-race", status: "active",
    sessionId: "long-gone", claimedAt: new Date(Date.now() - 86400000).toISOString(),
    expiresAt: new Date(Date.now() - 3600000).toISOString(), releasedAt: null, releaseReason: null, priorLeaseSha: null,
  });
  const meta = (id) => ({ sessionKind: "cloud", sessionId: id, worktree: `/${id}` });
  const [a, b] = await Promise.all([
    acquireLease("worker/reclaim-race", meta("session-C"), { store }),
    acquireLease("worker/reclaim-race", meta("session-D"), { store }),
  ]);
  const results = [a, b];
  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);
  assert.equal(winners.length, 1, `expected exactly 1 winner reclaiming, got ${winners.length}: ${JSON.stringify(results)}`);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].reason, "race");
});

test("acquireLease: refused with reason:held when an unexpired lease is held by a DIFFERENT session", async () => {
  const store = createMockStore();
  await store._seed("nickstire/busy", {
    $schema: "agent-os/lease-v1", branch: "nickstire/busy", status: "active",
    sessionId: "holder", claimedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), releasedAt: null, releaseReason: null, priorLeaseSha: null,
  });
  const r = await acquireLease("nickstire/busy", { sessionKind: "bridge", sessionId: "other" }, { store });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "held");
  assert.equal(r.holder.sessionId, "holder");
});

test("acquireLease: an EXPIRED lease auto-reclaims for a different session", async () => {
  const store = createMockStore();
  const staleSha = await store._seed("nickstire/stale", {
    $schema: "agent-os/lease-v1", branch: "nickstire/stale", status: "active",
    sessionId: "old-session", claimedAt: new Date(Date.now() - 86400000).toISOString(),
    expiresAt: new Date(Date.now() - 3600000).toISOString(), releasedAt: null, releaseReason: null, priorLeaseSha: null,
  });
  const r = await acquireLease("nickstire/stale", { sessionKind: "cloud", sessionId: "new-session" }, { store });
  assert.equal(r.ok, true);
  assert.equal(r.lease.sessionId, "new-session");
  assert.equal(r.lease.priorLeaseSha, staleSha, "the new lease must chain from the stale one for a walkable audit trail");
});

test("acquireLease: the SAME session re-acquiring its own active lease succeeds (idempotent)", async () => {
  const store = createMockStore();
  await store._seed("nickstire/mine", {
    $schema: "agent-os/lease-v1", branch: "nickstire/mine", status: "active",
    sessionId: "me", claimedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600000).toISOString(), releasedAt: null, releaseReason: null, priorLeaseSha: null,
  });
  const r = await acquireLease("nickstire/mine", { sessionKind: "cloud", sessionId: "me" }, { store });
  assert.equal(r.ok, true);
});

test("releaseLease: refuses on dirty/unpushed state unless force is set, and force records the reason permanently", async () => {
  const store = createMockStore();
  await acquireLease("nickstire/dirty-test", { sessionKind: "bridge", sessionId: "s1" }, { store });

  const refused = await releaseLease("nickstire/dirty-test", { dirty: true, unpushedCount: 3 }, { store });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, "dirty");

  const forced = await releaseLease(
    "nickstire/dirty-test",
    { dirty: true, unpushedCount: 3, force: true, reason: "operator confirmed local copy is stale, discarding" },
    { store },
  );
  assert.equal(forced.ok, true);
  assert.equal(forced.lease.status, "released");
  assert.equal(forced.lease.releaseReason, "operator confirmed local copy is stale, discarding");
});

test("releaseLease: a clean worktree releases without force", async () => {
  const store = createMockStore();
  await acquireLease("nickstire/clean-test", { sessionKind: "bridge", sessionId: "s1" }, { store });
  const r = await releaseLease("nickstire/clean-test", { dirty: false, unpushedCount: 0 }, { store });
  assert.equal(r.ok, true);
  assert.equal(r.lease.status, "released");
  assert.equal(r.lease.releaseReason, null);
});

test("releaseLease: no-op with reason:no-lease when nothing was ever leased", async () => {
  const store = createMockStore();
  const r = await releaseLease("nickstire/never-leased", {}, { store });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "no-lease");
});
