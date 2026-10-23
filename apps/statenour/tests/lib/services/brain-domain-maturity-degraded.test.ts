/**
 * tests/lib/services/brain-domain-maturity-degraded.test.ts · 2026-09-02, reworked 2026-10-23.
 *
 * A TOTAL DB FAILURE USED TO SCORE 7, WITH CONTRADICTIONS IN GREEN.
 *
 * `buildBrainMaturity` fanned out ten loaders, each with a bare
 * `.catch(() => [])` / `.catch(() => null)` / `.catch(() => 0)` and no log. A
 * read that FAILED scored like a read that returned an empty ledger, the
 * function returned a fully-formed, non-error payload, and BrainMaturityHeader
 * drew "7", every counter at 0, and "contradictions 0" in EMERALD.
 *
 * 2026-10-23: the contradictions counter now reads the `contradictions` TABLE
 * (the panel's own open total, lib/services/contradictions.ts), not the
 * BrainMemory set that never held a row. It carries no score points: the old
 * resolve-rate dimension was excluded on every render (max 90) and is gone.
 *
 * WHAT THESE PIN — behaviour, not shape:
 *   1. every-read-fails ⇒ `score === null`, and specifically NOT 7
 *   2. every-read-fails ⇒ `contradictions.open === null`, the value the
 *      header paints amber; 0 is what it paints emerald
 *   3. a clean read still yields a real number (the control — without it a
 *      permanently-null score would score green here)
 *   4. the open count is the table's count and does not move the score
 *   5. every swallowed failure is logged, named
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
  countUnresolvedContradictions: vi.fn(),
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
vi.mock("@/lib/services/contradictions", () => ({
  countUnresolvedContradictions: mocks.countUnresolvedContradictions,
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
  mocks.countUnresolvedContradictions.mockResolvedValue(0);
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
  mocks.countUnresolvedContradictions.mockImplementation(down);
  mocks.loadGhostAccuracy.mockImplementation(down);
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
    expect(mocks.logger.warn).toHaveBeenCalledTimes(11);
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "brain_maturity_read_failed",
      expect.objectContaining({ read: "contradictions", error: "db down" }),
    );
  });

  it("CONTROL · a clean read still produces a real score and real zeros", async () => {
    // Without this, a `score: null` hardcoded for every call would pass every
    // assertion above while destroying the surface.
    const view = await buildBrainMaturity();

    expect(view.failedReads).toEqual([]);
    expect(typeof view.score).toBe("number");
    // With every loader empty every dimension contributes 0; the ceiling is 90
    // because contradictions carry no points.
    expect(view.score).toBe(0);
    expect(view.scoreMax).toBe(90);
    expect(view.components.contradictions.open).toBe(0);
    expect(mocks.logger.warn).not.toHaveBeenCalled();
  });

  it("one failed read is enough to withhold the score, and only its own counters", async () => {
    mocks.countUnresolvedContradictions.mockRejectedValue(new Error("contradictions down"));
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

describe("buildBrainMaturity · contradictions · the table's open count", () => {
  it("reports the table count, and 80 open rows cost no points", async () => {
    mocks.countUnresolvedContradictions.mockResolvedValue(80);

    const view = await buildBrainMaturity();

    expect(view.components.contradictions.open).toBe(80);
    expect(view.failedReads).toEqual([]);
    expect(view.score).toBe(0);
    expect(view.scoreMax).toBe(90);
  });
});
