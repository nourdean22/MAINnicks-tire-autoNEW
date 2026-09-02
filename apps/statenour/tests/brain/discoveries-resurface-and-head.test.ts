/**
 * CANARIES for three defects in lib/brain/discoveries.ts, found in the
 * 2026-09-02 self-audit. Each one breaks its fix and asserts the break is
 * visible; a positive control beside it proves the fix did not simply disable
 * the feature it patched.
 *
 *  3 · THE ESCALATION BANNER COULD NEVER RENDER FOR A WHOLE CLASS OF SPOTS.
 *      persistBlindSpot clears a standing `noise` verdict on exactly ONE row
 *      (the stable-key `findUnique({ category_key })`), while
 *      rateDiscoveryCluster writes verdicts onto every sibling and the legacy
 *      inheritance bridge never clears the legacy row it copied from. The
 *      judged-identity filter here then re-suppressed the escalated row from
 *      a sibling that still carried the old verdict — clusterKey() strips the
 *      `[TIER]` prefix, so the escalation is invisible to the identity. Net
 *      effect: exactly the resurface-is-a-no-op defect blind-spot-identity.ts
 *      records catching once before, reintroduced one layer up, where that
 *      module's own tests could not see it.
 *
 *  4 · THE CLUSTER HEAD WAS ELECTED FROM AN UNORDERED QUERY. `findMany({ where:
 *      { id: { in: unique } } })` has no `orderBy`, so `live[0]` was whatever
 *      the plan returned. Members share a NORMALISED key (clusterKey collapses
 *      a leading digit run), so the head's `content` — used verbatim as the
 *      ledger summary and the spawned Inbox task title — could be a sibling's
 *      wording.
 *
 *  5 · TWO DOCSTRINGS TWELVE LINES APART CONTRADICTED EACH OTHER about whether
 *      `unrated` is a floor. Pinned here against the RUNTIME behaviour as well
 *      as the text, so the text cannot be "fixed" in the wrong direction.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  brainMemory: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  },
  queryRaw: vi.fn(),
  recordShown: vi.fn(),
  recordDecision: vi.fn(),
  recordOutcome: vi.fn(),
  createTask: vi.fn(),
  resolveInboxMissionId: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: { brainMemory: mocks.brainMemory, $queryRaw: mocks.queryRaw },
}));
vi.mock("@/lib/utils/error-log", () => ({ logError: vi.fn() }));
vi.mock("@/lib/services/outcome-ledger", () => ({
  recordShown: mocks.recordShown,
  recordDecision: mocks.recordDecision,
  recordOutcome: mocks.recordOutcome,
}));
vi.mock("@/lib/services/tasks", () => ({ createTask: mocks.createTask }));
vi.mock("@/lib/services/missions", () => ({
  resolveInboxMissionId: mocks.resolveInboxMissionId,
}));

import { listDiscoveries, rateDiscoveryCluster } from "@/lib/brain/discoveries";

/**
 * `mockReset`, NOT `vi.clearAllMocks()` — and this cost a red run before it
 * cost a wrong green.
 *
 * `clearAllMocks` clears recorded CALLS and leaves the `...Once` queue intact.
 * listDiscoveries skips its judged-set query entirely when nothing is unrated,
 * so a test that queues two `Once` values and only consumes one leaves the
 * second armed — and the NEXT test's first query silently receives another
 * test's fixture. Here that handed `rateDiscoveryCluster` a row with no
 * `category`, which it correctly rejected, so the canary failed for a reason
 * that had nothing to do with the code under test.
 */
function resetPrismaMocks(): void {
  for (const fn of [
    mocks.brainMemory.findMany,
    mocks.brainMemory.findUnique,
    mocks.brainMemory.update,
    mocks.brainMemory.count,
    mocks.queryRaw,
    mocks.recordShown,
    mocks.recordDecision,
    mocks.recordOutcome,
    mocks.createTask,
    mocks.resolveInboxMissionId,
  ]) {
    fn.mockReset();
  }
}

const scanRow = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  category: "blind_spot",
  key: "blindspot_general_abcd",
  content: "[CRITICAL] 9 decisions awaiting review: evidence. Action: triage",
  source: "blind-spot-detector",
  createdAt: new Date("2026-08-30T00:00:00Z"),
  lastSeen: new Date("2026-09-01T00:00:00Z"),
  metadata: {},
  discoveryVerdict: null,
  discoveryProvenance: null,
  ...over,
});

/**
 * What persistBlindSpot's escalation path leaves on the row: the verdict
 * cleared on BOTH the column and metadata, the prior verdict appended to the
 * history, and the resurface stamped. Modelled exactly, because a fake that
 * omits a field certifies its own blind spot (the lesson recorded in
 * tests/brain/blind-spot-identity.test.ts).
 */
const resurfacedMetadata = {
  discoveryVerdict: null,
  discoveryVerdictSeverityRank: null,
  discoveryVerdictHistory: [
    { verdict: "noise", at: "2026-08-25T00:00:00.000Z", severityRank: 2 },
  ],
  discoveryResurfacedAt: "2026-09-01T00:00:00.000Z",
  discoveryResurfacedFromRank: 2,
  discoveryResurfacedToRank: 3,
};

/** The sibling / legacy row that never got its verdict cleared. */
const stillJudgedSibling = {
  // A tier LOWER than the resurfaced row's — the escalation itself. clusterKey
  // strips the prefix, so both normalise to the same identity.
  content: "[HIGH] 9 decisions awaiting review: evidence. Action: triage",
  metadata: { discoveryVerdict: "noise" },
  discoveryVerdict: "noise",
  discoveryProvenance: null,
};

describe("CANARY · a deliberately resurfaced spot is not a regenerated twin", () => {
  beforeEach(() => {
    resetPrismaMocks();
    mocks.queryRaw.mockResolvedValue([{ unrated: 1n, restored: 0n }]);
    mocks.brainMemory.findMany.mockResolvedValue([]);
  });

  it("BREAKS: the escalated row survives a sibling that still carries the old verdict", async () => {
    mocks.brainMemory.findMany
      .mockResolvedValueOnce([scanRow({ id: "escalated", metadata: resurfacedMetadata })])
      .mockResolvedValueOnce([stillJudgedSibling]);

    const res = await listDiscoveries();

    // The card reaches the operator...
    expect(res.items.map((i) => i.id)).toEqual(["escalated"]);
    // ...and is NOT described as a duplicate of something he already judged.
    expect(res.suppressedSimilar).toBe(0);
    // The banner's own precondition (discover-tab: history.length > 0 &&
    // !d.verdict) holds on the row that was delivered. Asserting the payload
    // rather than the copy: this is what makes the amber "it is back because
    // severity rose" line renderable at all.
    expect(res.items[0].verdict).toBeNull();
    expect(res.items[0].verdictHistory).toHaveLength(1);
    expect(res.items[0].verdictHistory[0].verdict).toBe("noise");
  });

  it("positive control: an ordinary twin with NO resurface history is still suppressed", async () => {
    // The exemption must be narrow. If it disabled judged-identity suppression
    // wholesale, the 2026-08-28 learning-loops fix would be gone and this test
    // is the only thing that would notice.
    mocks.brainMemory.findMany
      .mockResolvedValueOnce([scanRow({ id: "twin", metadata: {} })])
      .mockResolvedValueOnce([stillJudgedSibling]);

    const res = await listDiscoveries();

    expect(res.items).toHaveLength(0);
    expect(res.suppressedSimilar).toBe(1);
  });

  it("positive control: the exemption does not resurrect a row the operator RE-judged", async () => {
    // Resurfaced, then judged `known` again. History is still present, but the
    // row now carries a verdict of its own, so it is `rated` — it must not
    // appear in the unjudged feed by way of the exemption.
    mocks.brainMemory.findMany
      .mockResolvedValueOnce([
        scanRow({
          id: "rejudged",
          metadata: { ...resurfacedMetadata, discoveryVerdict: "known" },
          discoveryVerdict: "known",
        }),
      ])
      .mockResolvedValueOnce([stillJudgedSibling]);

    const res = await listDiscoveries();

    expect(res.items).toHaveLength(0);
    expect(res.suppressedSimilar).toBe(0);
  });
});

describe("CANARY · the cluster head is the row the operator actually read", () => {
  const SHOWN = "9 decisions awaiting review";
  const SIBLING = "14 decisions awaiting review";

  beforeEach(() => {
    resetPrismaMocks();
    mocks.brainMemory.findMany.mockResolvedValue([]);
    mocks.recordShown.mockResolvedValue("ledger-1");
    mocks.recordDecision.mockResolvedValue(true);
    mocks.recordOutcome.mockResolvedValue(true);
    mocks.resolveInboxMissionId.mockResolvedValue("mission-inbox");
    mocks.createTask.mockResolvedValue({ id: "task-1" });
    mocks.brainMemory.update.mockResolvedValue({});
    mocks.brainMemory.findUnique.mockImplementation(async (args: { where: { id: string } }) => {
      const content = args.where.id === "shown" ? SHOWN : SIBLING;
      return {
        id: args.where.id,
        content,
        category: "blind_spot",
        metadata: {},
        deletedAt: null,
      };
    });
  });

  it("BREAKS: the spawned task and the ledger carry ids[0]'s text, not a sibling's", async () => {
    mocks.brainMemory.findMany
      // The candidate query has NO orderBy. Postgres is free to hand back the
      // sibling first, and did: this fixture is that plan.
      .mockResolvedValueOnce([
        { id: "sibling", content: SIBLING, category: "blind_spot", metadata: {}, deletedAt: null, discoveryVerdict: null, discoveryProvenance: null },
        { id: "shown", content: SHOWN, category: "blind_spot", metadata: {}, deletedAt: null, discoveryVerdict: null, discoveryProvenance: null },
      ])
      // Re-derived window membership: nothing extra.
      .mockResolvedValueOnce([]);

    // The client sends clusterIds with the DISPLAYED row first.
    const res = await rateDiscoveryCluster(["shown", "sibling"], "investigate");

    expect(res.rated).toBe(2);
    expect(mocks.recordShown).toHaveBeenCalledTimes(1);
    expect(mocks.recordShown.mock.calls[0][0].summary).toBe(SHOWN);
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
    expect(mocks.createTask.mock.calls[0][0].title).toBe(SHOWN);
  });

  it("positive control: a soft-deleted ids[0] still falls through to the next live row", async () => {
    // Review fix #1 (a dead head stranded every side effect) must survive the
    // ordering fix. The dead row is filtered out, so election skips to the one
    // that is alive rather than returning early.
    mocks.brainMemory.findMany
      .mockResolvedValueOnce([
        { id: "shown", content: SHOWN, category: "blind_spot", metadata: {}, deletedAt: new Date(), discoveryVerdict: null, discoveryProvenance: null },
        { id: "sibling", content: SIBLING, category: "blind_spot", metadata: {}, deletedAt: null, discoveryVerdict: null, discoveryProvenance: null },
      ])
      .mockResolvedValueOnce([]);

    const res = await rateDiscoveryCluster(["shown", "sibling"], "investigate");

    expect(mocks.recordShown).toHaveBeenCalledTimes(1);
    expect(mocks.recordShown.mock.calls[0][0].summary).toBe(SIBLING);
    expect(res.rated).toBe(1);
    expect(res.failed).toBe(1);
  });
});

describe("CANARY · `unrated` is an exact count, in behaviour AND in its docstring", () => {
  beforeEach(() => {
    resetPrismaMocks();
    mocks.brainMemory.findMany.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([{ unrated: 0n, restored: 0n }]);
  });

  it("BREAKS: a truncated card scan does not shrink `unrated`", async () => {
    // 60 rows = a full PAGE, and enough clusters to trip the early break, so
    // `truncated` is true while the SQL count says 242. If `unrated` were
    // derived from the scan it would read 60 — which is the 2026-08-22 defect
    // (56 rendered against a true 242) exactly.
    const page = Array.from({ length: 60 }, (_, i) =>
      scanRow({ id: `p${i}`, content: `finding number ${i} about domain ${i}` }),
    );
    mocks.brainMemory.findMany.mockResolvedValueOnce(page).mockResolvedValueOnce([]);
    mocks.queryRaw.mockResolvedValue([{ unrated: 242n, restored: 0n }]);

    const res = await listDiscoveries({ limit: 12 });

    expect(res.truncated).toBe(true);
    expect(res.unrated).toBe(242);
    expect(res.scanned).toBe(60);
  });

  it("BREAKS: the `unrated` docstring does not tell a consumer to treat it as a floor", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../../lib/brain/discoveries.ts"),
      "utf8",
    );
    // The docblock immediately above `unrated: number;` inside the result
    // interface — the thing a consumer reads on hover.
    const block = src.match(/\/\*\*(?:[^*]|\*(?!\/))*\*\/\s*\n\s*unrated: number;/)?.[0];
    expect(block).toBeDefined();

    // The stale claim, verbatim in shape: it instructed callers to append "+"
    // to an exact number.
    expect(block).not.toMatch(/this is a FLOOR/i);
    expect(block).toMatch(/exact/i);

    // And the two docstrings must AGREE. `truncated`'s block has said since
    // 2026-08-22 that `unrated` is exact; a "fix" that flipped THAT one
    // instead would restore the contradiction from the other side.
    const truncatedBlock = src.match(/\/\*\*(?:[^*]|\*(?!\/))*\*\/\s*\n\s*truncated: boolean;/)?.[0];
    expect(truncatedBlock).toBeDefined();
    expect(truncatedBlock).toMatch(/`unrated` and `restoredHidden` are\s*\n?\s*\*?\s*exact SQL counts/);
  });
});
