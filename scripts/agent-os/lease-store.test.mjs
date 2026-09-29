/**
 * Canaries for the REAL GitHub lease store (createGitHubLeaseStore) — audit item O,
 * 2026-09-23.
 *
 * lease.test.mjs proves the CAS logic against an in-memory mock that is keyed by
 * branch name, so it could never see a ref-NAME bug. The shipped store had one: it
 * created `refs/refs/leases/<b>` but looked for it under `refs/leases/<b>`, so
 * getRef() always returned null — every acquire after the first was a "race"
 * forever and every release was "no-lease". Nothing had ever run against GitHub.
 *
 * These tests drive the real store through a fake of GitHub's git-data HTTP layer
 * that implements the ref semantics the store depends on, as documented:
 *   - GET  /git/matching-refs/{ref}  -> every ref whose full name starts with
 *                                       `refs/{ref}` (a PREFIX listing, [] if none)
 *   - POST /git/refs {ref, sha}      -> 422 if the ref already exists; `ref` must be
 *                                       fully qualified and have at least two slashes
 *   - PATCH /git/refs/{ref} {sha, force:false}
 *                                    -> {ref} is WITHOUT the leading `refs/`;
 *                                       422 if missing; 422 unless `sha` is a
 *                                       fast-forward of the current tip
 * Errors are thrown in ghJson's exact message shape (`GitHub API M /p -> 422 ...`).
 * No network, and never a real ref on origin.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGitHubLeaseStore, acquireLease, releaseLease, readLease } from "./lease.mjs";

const OWNER = "o";
const REPO = "r";
const BASE = `/repos/${OWNER}/${REPO}`;

function createFakeGitHub() {
  const refs = new Map(); // full ref name -> sha
  const objects = new Map(); // sha -> {type, ...}
  const calls = [];
  let seq = 0;
  const newSha = () => (++seq).toString(16).padStart(40, "0");
  const fail = (method, path, status, msg) => {
    throw new Error(`GitHub API ${method} ${path} -> ${status} ${msg}: {"message":"${msg}"}`);
  };
  const isAncestor = (ancestor, sha) => {
    for (let cur = sha; cur; ) {
      if (cur === ancestor) return true;
      cur = objects.get(cur)?.parents?.[0] ?? null;
    }
    return false;
  };
  let failNext = null; // {method, status} — one-shot infrastructure fault injection

  async function json(rawPath, opts = {}) {
    const method = opts.method ?? "GET";
    calls.push({ method, path: rawPath, body: opts.body ? JSON.parse(opts.body) : undefined });
    if (failNext && failNext.method === method) {
      const f = failNext;
      failNext = null;
      fail(method, rawPath, f.status, "Server Error");
    }
    assert.ok(rawPath.startsWith(`${BASE}/git/`), `unexpected path ${rawPath}`);
    const path = decodeURIComponent(rawPath.slice(BASE.length));
    const body = opts.body ? JSON.parse(opts.body) : {};

    if (method === "GET" && path.startsWith("/git/matching-refs/")) {
      const prefix = `refs/${path.slice("/git/matching-refs/".length)}`;
      return [...refs].filter(([name]) => name.startsWith(prefix)).sort().map(([ref, sha]) => ({ ref, object: { sha, type: "commit" } }));
    }
    if (method === "POST" && path === "/git/refs") {
      if (!/^refs\/[^/]+\/.+/.test(body.ref)) fail(method, rawPath, 422, "Reference name is not valid");
      if (refs.has(body.ref)) fail(method, rawPath, 422, "Reference already exists");
      refs.set(body.ref, body.sha);
      return { ref: body.ref, object: { sha: body.sha } };
    }
    if (method === "PATCH" && path.startsWith("/git/refs/")) {
      const name = `refs/${path.slice("/git/refs/".length)}`;
      if (!refs.has(name)) fail(method, rawPath, 422, "Reference does not exist");
      if (!body.force && !isAncestor(refs.get(name), body.sha)) fail(method, rawPath, 422, "Update is not a fast forward");
      refs.set(name, body.sha);
      return { ref: name, object: { sha: body.sha } };
    }
    if (method === "POST" && path === "/git/blobs") {
      const sha = newSha();
      objects.set(sha, { type: "blob", content: Buffer.from(body.content, "utf8").toString("base64") });
      return { sha };
    }
    if (method === "POST" && path === "/git/trees") {
      const sha = newSha();
      objects.set(sha, { type: "tree", tree: body.tree });
      return { sha };
    }
    if (method === "POST" && path === "/git/commits") {
      const sha = newSha();
      objects.set(sha, { type: "commit", tree: body.tree, parents: body.parents });
      return { sha };
    }
    const get = path.match(/^\/git\/(commits|trees|blobs)\/([0-9a-f]+)$/);
    if (method === "GET" && get) {
      const o = objects.get(get[2]);
      if (!o) fail(method, rawPath, 404, "Not Found");
      if (get[1] === "commits") return { sha: get[2], tree: { sha: o.tree }, parents: o.parents.map((sha) => ({ sha })) };
      if (get[1] === "trees") return { sha: get[2], tree: o.tree };
      return { sha: get[2], content: o.content, encoding: "base64" };
    }
    fail(method, rawPath, 404, "Not Found");
  }
  return { json, refs, calls, injectFailure: (m, status) => (failNext = { method: m, status }) };
}

const meta = (id) => ({ sessionKind: "cloud", sessionId: id, worktree: `/${id}` });
function setup() {
  const gh = createFakeGitHub();
  return { gh, store: createGitHubLeaseStore(OWNER, REPO, { json: gh.json }) };
}

test("REAL STORE: the lease ref is created at refs/leases/<branch> — never refs/refs/…", async () => {
  const { gh, store } = setup();
  const r = await acquireLease("chore/x", meta("s1"), { store });
  assert.equal(r.ok, true);
  assert.deepEqual([...gh.refs.keys()], ["refs/leases/chore/x"]);
});

test("REAL STORE: a lease that was acquired can be READ BACK", async () => {
  const { store } = setup();
  await acquireLease("chore/x", meta("s1"), { store });
  const lease = await readLease("chore/x", { store });
  assert.ok(lease, "readLease returned null for a lease that exists — getRef cannot find its own ref");
  assert.equal(lease.sessionId, "s1");
  assert.equal(lease.status, "active");
});

test("REAL STORE: the SAME session re-acquiring its own lease succeeds (fast-forward update)", async () => {
  const { store } = setup();
  const first = await acquireLease("chore/x", meta("s1"), { store });
  const again = await acquireLease("chore/x", meta("s1"), { store });
  assert.equal(again.ok, true, `re-acquire by the holder failed: ${JSON.stringify(again)}`);
  assert.equal(again.lease.priorLeaseSha, first.lease._commitSha);
});

test("REAL STORE: another session is refused with reason:held while the lease is live", async () => {
  const { store } = setup();
  await acquireLease("chore/x", meta("s1"), { store });
  const r = await acquireLease("chore/x", meta("s2"), { store });
  assert.equal(r.ok, false);
  assert.equal(r.reason, "held");
  assert.equal(r.holder.sessionId, "s1");
});

test("REAL STORE: the holder can release, and then another session can acquire", async () => {
  const { store } = setup();
  await acquireLease("chore/x", meta("s1"), { store });
  const rel = await releaseLease("chore/x", { sessionId: "s1" }, { store });
  assert.equal(rel.ok, true, `release failed: ${JSON.stringify(rel)}`);
  assert.equal((await readLease("chore/x", { store })).status, "released");
  const next = await acquireLease("chore/x", meta("s2"), { store });
  assert.equal(next.ok, true, `acquire after release failed: ${JSON.stringify(next)}`);
});

test("REAL STORE: two racers reclaiming the same released lease — exactly one wins", async () => {
  const { store } = setup();
  await acquireLease("chore/x", meta("s1"), { store });
  await releaseLease("chore/x", { sessionId: "s1" }, { store });
  const results = await Promise.all([acquireLease("chore/x", meta("A"), { store }), acquireLease("chore/x", meta("B"), { store })]);
  assert.equal(results.filter((r) => r.ok).length, 1, JSON.stringify(results));
  assert.equal(results.find((r) => !r.ok).reason, "race");
});

test("REAL STORE: matching-refs is a PREFIX listing — branch a/b is not confused with a/b-2", async () => {
  const { store } = setup();
  await acquireLease("nickstire/task-2", meta("other"), { store });
  assert.equal(await readLease("nickstire/task", { store }), null);
  const r = await acquireLease("nickstire/task", meta("s1"), { store });
  assert.equal(r.ok, true);
  assert.equal((await readLease("nickstire/task", { store })).sessionId, "s1");
  assert.equal((await readLease("nickstire/task-2", { store })).sessionId, "other");
});

test("REAL STORE: an infrastructure failure on the CAS write THROWS (fail-open is the caller's call), never 'race'", async () => {
  const { gh, store } = setup();
  await acquireLease("chore/x", meta("s1"), { store });
  gh.injectFailure("PATCH", 502);
  await assert.rejects(() => acquireLease("chore/x", meta("s1"), { store }), /502/);
});

test("REAL STORE: a 5xx on a branch whose NAME contains 422 is still an infrastructure error, not a race", async () => {
  const { gh, store } = setup();
  await acquireLease("fix-422", meta("s1"), { store });
  gh.injectFailure("PATCH", 502);
  await assert.rejects(() => acquireLease("fix-422", meta("s1"), { store }), /502/);
});
