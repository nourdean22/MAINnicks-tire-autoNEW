/**
 * tests/lib/services/brain-domain-maturity-degraded.test.ts · 2026-09-02.
 *
 * A TOTAL DB FAILURE USED TO SCORE 7, WITH CONTRADICTIONS IN GREEN.
 *
 * `buildBrainMaturity` fanned out ten loaders, each with a bare
 * `.catch(() => [])` / `.catch(() => null)` / `.catch(() => 0)` and no log.
 * Walk the scoring block with every one of them failed:
 *
 *     skills 0 + axes 0 + history 0 + qualitative 0 + beliefs 0
 *       + contradictions 7 + ghost 0 + chat_memory 0  =  7
 *
 * The 7 came from `if (allContradictions.length === 0) return 7` — an empty
 * list because the READ FAILED scored identically to an empty list because
 * the ledger is clean. The function then returned a fully-formed, non-error
 * payload, so BrainMaturityHeader's `if (!data)` guard never fired: it drew
 * "7", every counter at 0, and "contradictions 0" in EMERALD. The operator
 * read "almost no signal, but at least it's internally consistent" when the
 * truth was "the brain could not be read".
 *
 * The second defect is on the same card. `components.contradictions.open`
 * came from `countUnresolved(14)` — 14 days, unresolved only — while
 * `resolved` AND the resolve-rate denominator came from
 * `loadAllContradictions(90)`. Two windows, two status sets, presented as
 * one pair: an unresolved contradiction raised 20 days ago was invisible to
 * `open` (header: "0", emerald) while still dragging the resolve rate down.
 * The card showed green for a penalty it refused to display.
 *
 * WHAT THESE PIN — behaviour, not shape:
 *   1. every-read-fails ⇒ `score === null`, and specifically NOT 7
 *   2. every-read-fails ⇒ `contradictions.open === null`, the value the
 *      header paints amber; 0 is what it paints emerald
 *   3. a clean read still yields a real number (the control — without it a
 *      permanently-null score would score green here)
 *   4. one unresolved contradiction older than 14 days IS counted in `open`
 *   5. `open + resolved === list.length` — one population, by construction
 *   6. every swallowed failure is logged, named
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  brainMemory: { count: vi.fn() },
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  loadActiveSkills: vi.fn(),
  loadPendingSkills: vi.fn(),
  loadIdentitySnapshot: vi.fn(),
  loadIdentityHistory: vi.fn(),
  loadQualitativeIdentity: vi.fn(),
  loadActiveBeliefs: vi.fn(),
  loadBeliefCandidates: vi.fn(),
  countUnresolved: vi.fn(),
  loadAllContradictions: vi.fn(),
  loadGhostAccuracy: vi.fn(),
  getGhostPredictions: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({ prisma: { brainMemory: mocks.brainMemory } }));
vi.mock("@/lib/logger", () => ({
  logger: mocks.logger,
  redactSensitive: (o: unknown) => o,
}));
vi.mock("@/lib/brain/skill-extractor", () => ({
  loadActiveSkills: mocks.loadActiveSkills,
  loadPendingSkills: mocks.loadPendingSkills,
}));
vi.mock("@/lib/brain/identity-snapshot", () => ({
  loadIdentitySnapshot: mocks.loadIdentitySnapshot,
  loadIdentityHistory: mocks.loadIdentityHistory,
  invalidateIdentitySnapshotCache: vi.fn(),
}));
vi.mock("@/lib/brain/qualitative-identity", () => ({
  loadQualitativeIdentity: mocks.loadQualitativeIdentity,
  invalidateQualitativeIdentityCache: vi.fn(),
}));
vi.mock("@/lib/brain/belief-harvester", () => ({
  loadActiveBeliefs: mocks.loadActiveBeliefs,
  loadBeliefCandidates: mocks.loadBeliefCandidates,
}));
vi.mock("@/lib/brain/contradiction-surfacer", () => ({
  countUnresolved: mocks.countUnresolved,
  loadAllContradictions: mocks.loadAllContradictions,
}));
vi.mock("@/lib/brain/ghost-nick", () => ({
  loadGhostAccuracy: mocks.loadGhostAccuracy,
  getGhostPredictions: mocks.getGhostPredictions,
}));

import { buildBrainMaturity } from "@/lib/services/brain-domain";

const EMPTY_QUALITATIVE = {
  values: [],
  fears: [],
  operating_style: [],
  rhythms: [],
  red_lines: [],
  computed_at: "2026-09-01T00:00:00.000Z",
};

/** Every loader resolves — the healthy baseline. */
function allReadsSucceed(): void {
  mocks.brainMemory.count.mockResolvedValue(0);
  mocks.loadActiveSkills.mockResolvedValue([]);
  mocks.loadPendingSkills.mockResolvedValue([]);
  mocks.loadIdentitySnapshot.mockResolvedValue({ axes: {} });
  mocks.loadIdentityHistory.mockResolvedValue([]);
  mocks.loadQualitativeIdentity.mockResolvedValue(EMPTY_QUALITATIVE);
  mocks.loadActiveBeliefs.mockResolvedValue([]);
  mocks.loadBeliefCandidates.mockResolvedValue([]);
  // The 14-day counter is no longer consulted at all. It is left mocked so
  // a revert that re-introduces it reads a 0 here and fails test (4).
  mocks.countUnresolved.mockResolvedValue(0);
  mocks.loadAllContradictions.mockResolvedValue([]);
  mocks.loadGhostAccuracy.mockResolvedValue(null);
}

/** Every loader rejects — the total-outage case that used to score 7. */
function allReadsFail(): void {
  const down = () => Promise.reject(new Error("db down"));
  mocks.brainMemory.count.mockImplementation(down);
  mocks.loadActiveSkills.mockImplementation(down);
  mocks.loadPendingSkills.mockImplementation(down);
  mocks.loadIdentitySnapshot.mockImplementation(down);
  mocks.loadIdentityHistory.mockImplementation(down);
  mocks.loadQualitativeIdentity.mockImplementation(down);
  mocks.loadActiveBeliefs.mockImplementation(down);
  mocks.loadBeliefCandidates.mockImplementation(down);
  mocks.countUnresolved.mockImplementation(down);
  mocks.loadAllContradictions.mockImplementation(down);
  mocks.loadGhostAccuracy.mockImplementation(down);
}

function contradiction(
  key: string,
  status: string | undefined,
  daysAgo: number,
): Record<string, unknown> {
  return {
    key,
    status,
    similarity: 0.9,
    new_memory_id: `${key}-new`,
    old_memory_id: `${key}-old`,
    createdAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  allReadsSucceed();
});

describe("buildBrainMaturity · a failed read is not a zero", () => {
  it("every read failing yields score null — NOT the phantom 7", async () => {
    allReadsFail();

    const view = await buildBrainMaturity();

    // The exact number the old code produced. Pinned by value because the
    // defect was not "a slightly wrong score", it was "a plausible one".
    expect(view.score).not.toBe(7);
    expect(view.score).toBeNull();
  });

  it("every read failing yields NULL counters, never zeros", async () => {
    allReadsFail();

    const view = await buildBrainMaturity();
    const c = view.components;

    // `open === 0` is what BrainMaturityHeader paints emerald. It must not
    // be reachable from a read that never happened.
    expect(c.contradictions.open).toBeNull();
    expect(c.contradictions.resolved).toBeNull();
    expect(c.skills.active).toBeNull();
    expect(c.skills.graduated).toBeNull();
    expect(c.skills.pending).toBeNull();
    expect(c.identity.axes_filled).toBeNull();
    expect(c.identity.history_days).toBeNull();
    expect(c.qualitative.entries).toBeNull();
    expect(c.beliefs.active).toBeNull();
    expect(c.beliefs.candidates).toBeNull();
    expect(c.ghost.hits).toBeNull();
    expect(c.ghost.surprises).toBeNull();
    expect(c.chat_memory.importance_rows).toBeNull();
    expect(c.chat_memory.distilled_sessions).toBeNull();
  });

  it("names every failed read, and logs each one", async () => {
    allReadsFail();

    const view = await buildBrainMaturity();

    expect(view.failedReads).toEqual(
      expect.arrayContaining([
        "skills_active",
        "skills_pending",
        "identity_snapshot",
        "identity_history",
        "qualitative_identity",
        "beliefs_active",
        "belief_candidates",
        "contradictions",
        "ghost_accuracy",
        "chat_importance_rows",
        "chat_summary_rows",
      ]),
    );
    expect(view.failedReads).toHaveLength(11);
    // Ten of these logged NOTHING before this change.
    expect(mocks.logger.warn).toHaveBeenCalledTimes(11);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "brain_maturity_read_failed",
      expect.objectContaining({ read: "contradictions", error: "db down" }),
    );
  });

  it("CONTROL · a clean read still produces a real score and real zeros", async () => {
    // Without this, a `score: null` hard-coded for every call would pass
    // every assertion above while destroying the surface.
    const view = await buildBrainMaturity();

    expect(view.failedReads).toEqual([]);
    expect(typeof view.score).toBe("number");
    // 2026-09-02 self-audit · this asserted `toBe(7)` under the comment "A
    // measured empty ledger DOES still earn the 7". That was written by the
    // same commit as the fix above, and it pinned the half the fix did not
    // reach: an empty ledger is not a clean ledger either, and 7 of 100
    // points for a subsystem that has produced no data is the same
    // free-points-for-no-data shape learning-velocity.ts removed in this very
    // wave. Production has never recorded a contradiction, so this branch is
    // the one every render takes.
    //
    // The control still does its job — a `score: null` hardcoded for every
    // call would fail `typeof === "number"` — it simply no longer certifies
    // the defect. With every loader empty and contradictions unmeasurable,
    // every dimension contributes 0 and the ceiling drops to 90.
    expect(view.score).toBe(0);
    expect(view.scoreMax).toBe(90);
    expect(view.components.contradictions.open).toBe(0);
    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });

  it("one failed read is enough to withhold the score, and only its own counters", async () => {
    mocks.loadAllContradictions.mockRejectedValue(new Error("contradictions down"));
    mocks.loadActiveSkills.mockResolvedValue([
      { graduated: true },
      { graduated: false },
    ]);

    const view = await buildBrainMaturity();

    expect(view.score).toBeNull();
    expect(view.failedReads).toEqual(["contradictions"]);
    expect(view.components.contradictions.open).toBeNull();
    // The reads that DID land are still reported as measured numbers.
    expect(view.components.skills.active).toBe(2);
    expect(view.components.skills.graduated).toBe(1);
  });
});

describe("buildBrainMaturity · contradictions · one population, one window", () => {
  it("counts an unresolved contradiction older than the old 14-day window", async () => {
    // THE DEFECT, in one row. `countUnresolved(14)` cannot see this and
    // returned 0 — header "0", emerald — while the same row sat in the 90d
    // list dragging the resolve rate down.
    mocks.countUnresolved.mockResolvedValue(0);
    mocks.loadAllContradictions.mockResolvedValue([
      contradiction("old-open", "unresolved", 20),
    ]);

    const view = await buildBrainMaturity();

    expect(view.components.contradictions.open).toBe(1);
    expect(view.components.contradictions.resolved).toBe(0);
  });

  it("open + resolved partitions the list exactly", async () => {
    mocks.countUnresolved.mockResolvedValue(99);
    mocks.loadAllContradictions.mockResolvedValue([
      contradiction("a", "unresolved", 20),
      contradiction("b", "current_wins", 40),
      contradiction("c", "dismissed", 60),
      // A row whose status never made it into the blob — the pre-change
      // `resolved` predicate treated this as not-resolved, so `open` must
      // claim it or the two numbers stop summing.
      contradiction("d", undefined, 80),
    ]);

    const view = await buildBrainMaturity();
    const { open, resolved } = view.components.contradictions;

    expect(open).toBe(2);
    expect(resolved).toBe(2);
    expect((open ?? 0) + (resolved ?? 0)).toBe(4);
  });

  it("declares the sample truncated once the 40-row cap is hit", async () => {
    // lib/brain/contradiction-surfacer.ts:322 takes 40 rows BEFORE filtering
    // by status, so at the cap the resolve rate describes only the newest —
    // and the newest are the least likely to be resolved.
    mocks.loadAllContradictions.mockResolvedValue(
      Array.from({ length: 40 }, (_, i) =>
        contradiction(`c${i}`, "unresolved", i),
      ),
    );
    expect((await buildBrainMaturity()).components.contradictions.truncated).toBe(
      true,
    );
  });

  it("CONTROL · a sample under the cap is not declared truncated", async () => {
    mocks.loadAllContradictions.mockResolvedValue(
      Array.from({ length: 39 }, (_, i) =>
        contradiction(`c${i}`, "unresolved", i),
      ),
    );
    expect((await buildBrainMaturity()).components.contradictions.truncated).toBe(
      false,
    );
  });
});

/**
 * 2026-09-02 · SELF-AUDIT of the same day's fix, after the merge.
 *
 * The pass above split "the read FAILED" from "the table is empty" and stopped
 * there: a failed read scored 0, but an EMPTY contradiction ledger kept
 * returning a hardcoded 7 of 100 points.
 *
 * That is not hypothetical. Production has never recorded a single row in
 * `contradiction`, `wisdom_contradiction` or `research_contradiction` —
 * checked against the live database — so the empty branch is the one every
 * render takes. Seven fabricated points, permanently, for a capability that
 * has produced no data.
 *
 * It is the identical shape lib/brain/learning-velocity.ts removed in the same
 * wave: `resolutionRate = 1` on an empty table, where "never contradicted
 * myself" scored exactly like "found and resolved every contradiction". Fixed
 * there, missed here, by two different agents in one session — which is the
 * argument for auditing a fix as hostilely as the code it replaced.
 */
describe("brain-maturity · an unmeasurable dimension is not a good score", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allReadsSucceed();
  });

  it("an EMPTY contradiction ledger is unmeasurable, not a 7", async () => {
    // allReadsSucceed() already resolves loadAllContradictions to [] — the
    // exact state production is in.
    const r = await buildBrainMaturity();
    expect(r.score).not.toBeNull(); // the read succeeded; only the data is absent
    // The ceiling drops with the dimension, so the percentage is neither
    // inflated by a phantom 7 nor penalised for a subsystem with no data.
    expect(r.scoreMax).toBe(90);
  });

  it("PLANTED POSITIVE · a POPULATED ledger still scores, out of 100", async () => {
    // Without this, returning null unconditionally would satisfy the test
    // above while deleting a real measurement.
    mocks.loadAllContradictions.mockResolvedValue([
      { status: "resolved" },
      { status: "unresolved" },
    ]);
    const r = await buildBrainMaturity();
    expect(r.scoreMax).toBe(100);
  });

  it("an empty ledger and a FAILED read remain different", async () => {
    // The earlier fix's distinction must survive this one: a failed read
    // suppresses the score entirely, an empty table only shrinks the max.
    const empty = await buildBrainMaturity();
    expect(empty.score).not.toBeNull();
    expect(empty.scoreMax).toBe(90);

    vi.clearAllMocks();
    allReadsSucceed();
    mocks.loadAllContradictions.mockRejectedValue(new Error("db down"));
    const failed = await buildBrainMaturity();
    expect(failed.score).toBeNull();
    expect(failed.failedReads.length).toBeGreaterThan(0);
  });
});
