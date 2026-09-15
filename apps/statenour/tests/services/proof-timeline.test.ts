/**
 * Repo Time Machine — grouping the proof lane's events by the commit that was
 * actually judged (2026-09-15). Pure grouping first (every rule a canary can
 * break), then the ledger read with the not-migrated degradation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { eventsFindMany } = vi.hoisted(() => ({ eventsFindMany: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { realityEvent: { findMany: eventsFindMany } } }));

import { groupProofTimeline, judgedCommitOf, proofTimeline, PROOF_TIMELINE_EVENT_TYPES, type TimelineEventLike } from "@/lib/services/proof-timeline";

const T = (h: number) => new Date(Date.UTC(2026, 8, 15, h)).toISOString();
const run = (live: string | null, at: number, p: Record<string, unknown> = {}, uri = "https://ci/run/1"): TimelineEventLike => ({
  eventType: "proof.run",
  observedAt: T(at),
  payload: { outcome: "success", expected: 5, unexpected: 0, episodeFailures: [], liveCommit: live, ...p },
  sourceUri: uri,
});
const holdout = (live: string, at: number, p: Record<string, unknown>): TimelineEventLike => ({
  eventType: "proof.holdout",
  observedAt: T(at),
  payload: { liveCommit: live, ...p },
});
/**
 * The REAL producer shape (apps/nickstire/scripts/proof/post-run-evidence.mjs):
 * a failure event's payload is version / error / elapsedMs — the judged commit
 * travels ONLY as a commit object. A fixture with `payload.liveCommit` here
 * masked exactly that (Codex review of #2342).
 */
const failed = (live: string, at: number, id: string): TimelineEventLike => ({
  eventType: "proof.episode_failed",
  observedAt: T(at),
  payload: { version: 1, error: "visible text: …", elapsedMs: 1234 },
  objects: [{ type: "episode", id }, { type: "route", id: "/tires" }, { type: "commit", id: live, role: "judged" }],
});

describe("judgedCommitOf", () => {
  it("payload.liveCommit first, then the judged commit object, then any commit object, else null", () => {
    expect(judgedCommitOf({ payload: { liveCommit: "p" }, objects: [{ type: "commit", id: "o", role: "judged" }] })).toBe("p");
    expect(judgedCommitOf({ payload: {}, objects: [{ type: "commit", id: "x" }, { type: "commit", id: "j", role: "judged" }] })).toBe("j");
    expect(judgedCommitOf({ payload: {}, objects: [{ type: "site", id: "nickstire.org" }, { type: "commit", id: "only" }] })).toBe("only");
    expect(judgedCommitOf({ payload: { liveCommit: "" }, objects: [{ type: "site", id: "nickstire.org" }] })).toBeNull();
    expect(judgedCommitOf({ payload: null, objects: "nope" })).toBeNull();
  });
});

describe("groupProofTimeline", () => {
  it("BREAKS (Codex, #2342): an episode failure carrying its commit ONLY as an object groups under that commit — never a duplicate 'unknown' row", () => {
    const rows = groupProofTimeline([
      run("aaa", 9, { outcome: "failure", unexpected: 1, episodeFailures: ["EP-002"] }),
      failed("aaa", 9, "EP-002"),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ liveCommit: "aaa", episodeFailures: ["EP-002"] });
    expect(rows.some((r) => r.liveCommit === null)).toBe(false);
  });

  it("POSITIVE CONTROL: groups on the JUDGED commit, newest first, latest run's verdict, failures unioned across runs", () => {
    const rows = groupProofTimeline([
      run("aaa", 9, { outcome: "failure", unexpected: 1, episodeFailures: ["EP-002"] }),
      run("bbb", 12, { outcome: "success", unexpected: 0 }),
      run("aaa", 10, { outcome: "failure", unexpected: 2, episodeFailures: ["EP-002", "EP-004"] }), // later run on the same commit
      failed("aaa", 10, "EP-004"),
    ]);
    expect(rows.map((r) => r.liveCommit)).toEqual(["bbb", "aaa"]);
    expect(rows[1]).toMatchObject({ runs: 2, runOutcome: "failure", unexpected: 2, episodeFailures: ["EP-002", "EP-004"], judgedAt: T(10) });
    expect(rows[0]).toMatchObject({ runs: 1, runOutcome: "success", unexpected: 0, episodeFailures: [] });
  });

  it("deltas are against the NEXT-OLDER judged commit: failures fixed and introduced are named", () => {
    const rows = groupProofTimeline([
      run("old", 1, { unexpected: 2, episodeFailures: ["EP-001", "EP-002"] }),
      run("mid", 2, { unexpected: 1, episodeFailures: ["EP-002"] }),
      run("new", 3, { unexpected: 2, episodeFailures: ["EP-002", "EP-005"] }),
    ]);
    expect(rows.map((r) => r.liveCommit)).toEqual(["new", "mid", "old"]);
    expect(rows[0].deltas).toEqual({ unexpected: 1, holdoutUnexpected: null, newFailures: ["EP-005"], fixedFailures: [] });
    expect(rows[1].deltas).toEqual({ unexpected: -1, holdoutUnexpected: null, newFailures: [], fixedFailures: ["EP-001"] });
    expect(rows[2].deltas).toEqual({ unexpected: null, holdoutUnexpected: null, newFailures: [], fixedFailures: [] }); // nothing older
  });

  it("BREAKS: an UNMEASURED holdout is never read as zero failures — no delta is computed through it", () => {
    const rows = groupProofTimeline([
      run("a", 1),
      holdout("a", 1, { outcome: "success", measured: true, unexpected: 0, total: 3, failedIds: [] }),
      run("b", 2),
      holdout("b", 2, { outcome: "unmeasured", measured: false, reason: "no holdout secret" }),
      run("c", 3),
      holdout("c", 3, { outcome: "failure", measured: true, unexpected: 1, total: 3, failedIds: ["HO-002"] }),
    ]);
    expect(rows[0].holdout).toEqual({ outcome: "failure", unexpected: 1, total: 3, failedIds: ["HO-002"] });
    expect(rows[1].holdout).toEqual({ outcome: "unmeasured", unexpected: null, total: null, failedIds: [] });
    expect(rows[0].deltas.holdoutUnexpected).toBeNull(); // previous was unmeasured
    expect(rows[1].deltas.holdoutUnexpected).toBeNull(); // itself unmeasured
    // a measured-to-measured pair does get a delta
    const pair = groupProofTimeline([
      run("a", 1), holdout("a", 1, { outcome: "success", unexpected: 0, total: 3 }),
      run("b", 2), holdout("b", 2, { outcome: "failure", unexpected: 2, total: 3 }),
    ]);
    expect(pair[0].deltas.holdoutUnexpected).toBe(2);
  });

  it("a run that never recorded its commit lands in the unknown bucket, and an older run without a holdout event says 'not run' (null), not unmeasured", () => {
    const rows = groupProofTimeline([run(null, 1), run("x", 2)]);
    expect(rows.map((r) => r.liveCommit)).toEqual(["x", null]);
    expect(rows[0].holdout).toBeNull();
  });

  it("limit applies AFTER grouping, and the event list is not assumed sorted", () => {
    const rows = groupProofTimeline([run("c", 3), run("a", 1), run("b", 2), run("a", 1.5)], 2);
    expect(rows.map((r) => r.liveCommit)).toEqual(["c", "b"]);
  });

  it("tolerates garbage payloads (a malformed event cannot take /proof down)", () => {
    const rows = groupProofTimeline([
      { eventType: "proof.run", observedAt: T(1), payload: "not an object" },
      { eventType: "proof.holdout", observedAt: T(2), payload: { liveCommit: 42, outcome: 7 } },
      { eventType: "proof.episode_failed", observedAt: T(3), payload: { liveCommit: "z" }, objects: "nope" },
    ]);
    expect(rows).toHaveLength(2); // the null bucket + "z"
    expect(rows.find((r) => r.liveCommit === null)?.holdout).toEqual({ outcome: "unknown", unexpected: null, total: null, failedIds: [] });
  });
});

describe("proofTimeline (ledger read)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads only the three proof event types and reports ledgerAvailable", async () => {
    eventsFindMany.mockResolvedValueOnce([run("a", 1)]);
    const t = await proofTimeline(5);
    expect(t.ledgerAvailable).toBe(true);
    expect(t.commits.map((c) => c.liveCommit)).toEqual(["a"]);
    expect(eventsFindMany.mock.calls[0][0].where).toEqual({ eventType: { in: [...PROOF_TIMELINE_EVENT_TYPES] } });
  });

  it("degrades to an empty, flagged timeline when the table is missing (P2021); any other error surfaces", async () => {
    eventsFindMany.mockRejectedValueOnce(Object.assign(new Error("relation does not exist"), { code: "P2021" }));
    const t = await proofTimeline();
    expect(t).toMatchObject({ ledgerAvailable: false, commits: [] });
    eventsFindMany.mockRejectedValueOnce(new Error("connection reset"));
    await expect(proofTimeline()).rejects.toThrow(/connection reset/);
  });
});
