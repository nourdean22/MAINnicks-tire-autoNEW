/**
 * Discoveries service · lib/brain/discoveries.ts (2026-08-16).
 *
 * Pins the two invariants that make this surface worth having:
 *   1. It orders by RECENCY, never confidence. Ordering by confidence is the
 *      exact bias it exists to undo — confidence is a re-sighting count, and
 *      a one-off surprising finding is never re-sighted.
 *   2. Rating writes to the outcome ledger, not just the row. That ledger
 *      write is the only thing that ever populates `decision`, which is what
 *      `outcomesNeedingReview()` harvests into recall-eval cases.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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

import { blindSpotIdentity } from "@/lib/brain/blind-spot-identity";
import {
  listDiscoveries,
  rateDiscovery,
  rateDiscoveryCluster,
  clusterKey,
  severityRankOf,
  DISCOVERY_CATEGORIES,
} from "@/lib/brain/discoveries";

const row = (over: Partial<Record<string, unknown>> = {}) => ({
  id: "d1",
  category: "hidden_correlation",
  key: "corr_a_b",
  content: "A moves with B",
  source: "correlation-finder",
  createdAt: new Date("2026-08-15T00:00:00Z"),
  lastSeen: new Date("2026-08-15T00:00:00Z"),
  metadata: {},
  ...over,
});

describe("listDiscoveries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brainMemory.count.mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValue([{ unrated: 0n, restored: 0n }]);
    mocks.recordShown.mockResolvedValue("ledger-1");
    mocks.recordDecision.mockResolvedValue(true);
  });

  it("covers exactly the four nightly creative engines", () => {
    expect([...DISCOVERY_CATEGORIES].sort()).toEqual([
      "blind_spot",
      "counter_intuitive",
      "hidden_correlation",
      "teaching_moment",
    ]);
  });

  it("orders by recency, NOT confidence — the bias it exists to undo", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([row()]);
    await listDiscoveries();
    const args = mocks.brainMemory.findMany.mock.calls[0][0];
    // lastSeen, not createdAt: two of the four engines write STABLE keys, so a
    // nightly re-run reinforces the original row and never touches createdAt.
    expect(args.orderBy).toEqual({ lastSeen: "desc" });
    expect(JSON.stringify(args.orderBy)).not.toContain("confidence");
    expect(args.where.lastSeen.gte).toBeInstanceOf(Date);
    expect(args.where.createdAt).toBeUndefined();
  });

  it("excludes soft-deleted rows — the nightly consolidate merge produces them", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([]);
    await listDiscoveries();
    expect(mocks.brainMemory.findMany.mock.calls[0][0].where.deletedAt).toBeNull();
  });

  it("hides already-judged discoveries by default and counts the unrated", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "unjudged" }),
      row({ id: "judged", metadata: { discoveryVerdict: "known" } }),
    ]);
    mocks.queryRaw.mockResolvedValue([{ unrated: 1n, restored: 0n }]);
    const res = await listDiscoveries();
    expect(res.items.map((d) => d.id)).toEqual(["unjudged"]);
    // EXACT, from SQL. Derived from the scan it would be a floor — on prod
    // that floor rendered 56 against a true 242.
    expect(res.unrated).toBe(1);
  });

  it("includes judged ones on request, unjudged first", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "judged", metadata: { discoveryVerdict: "noise" } }),
      row({ id: "unjudged" }),
    ]);
    const res = await listDiscoveries({ includeRated: true });
    expect(res.items.map((d) => d.id)).toEqual(["unjudged", "judged"]);
  });

  it("ignores a garbage verdict in metadata rather than trusting it", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ metadata: { discoveryVerdict: "lol" } }),
    ]);
    const res = await listDiscoveries();
    expect(res.items[0].verdict).toBeNull();
  });

  it("pages past judged rows instead of reporting a false 'nothing new'", async () => {
    // The regression: a single `take: limit * 3` filtered AFTER the fetch meant
    // that once enough NEWER discoveries were judged, older unjudged ones fell
    // outside the window entirely and the feed rendered "Nothing new to judge"
    // with unrated: 0 — while pending work sat one row past the cut.
    const judgedPage = Array.from({ length: 60 }, (_, i) =>
      row({ id: `judged-${i}`, metadata: { discoveryVerdict: "known" } }),
    );
    mocks.brainMemory.findMany
      .mockResolvedValueOnce(judgedPage)
      .mockResolvedValueOnce([row({ id: "old-but-unjudged" })]);

    const res = await listDiscoveries({ limit: 5 });

    expect(mocks.brainMemory.findMany).toHaveBeenCalledTimes(2);
    expect(mocks.brainMemory.findMany.mock.calls[1][0].skip).toBe(60);
    expect(res.items.map((d) => d.id)).toEqual(["old-but-unjudged"]);
  });

  it("reports when the scan stopped early rather than capping silently", async () => {
    // Contents must DIFFER: since 2026-08-22 the early break counts distinct
    // questions, not rows, so 60 identical rows are one card and would
    // correctly keep scanning (pinned in the next test).
    const full = Array.from({ length: 60 }, (_, i) =>
      row({ id: `u-${i}`, content: `finding ${String.fromCharCode(97 + i)}` }),
    );
    mocks.brainMemory.findMany.mockResolvedValueOnce(full);
    const res = await listDiscoveries({ limit: 5 });
    expect(res.truncated).toBe(true);
    expect(res.scanned).toBe(60);
  });

  it("keeps scanning when a full page collapses to fewer cards than asked for", async () => {
    // The failure this prevents: breaking at `unrated.length >= limit` handed
    // the UI ONE card when it asked for five, because all 60 rows asked the
    // same question. Measured on prod, 242 unrated rows carried only 191
    // distinct contents, so this is the normal case, not a corner.
    const identical = Array.from({ length: 60 }, (_, i) => row({ id: `same-${i}` }));
    mocks.brainMemory.findMany.mockResolvedValue(identical);
    const res = await listDiscoveries({ limit: 5 });
    expect(mocks.brainMemory.findMany.mock.calls.length).toBeGreaterThan(1);
    expect(res.items).toHaveLength(1);
    expect(res.unratedClusters).toBe(1);
  });

  it("does not page forever when every row is judged", async () => {
    const judged = Array.from({ length: 60 }, (_, i) =>
      row({ id: `j-${i}`, metadata: { discoveryVerdict: "noise" } }),
    );
    mocks.brainMemory.findMany.mockResolvedValue(judged);
    const res = await listDiscoveries({ limit: 5 });
    // MAX_SCAN 300 / PAGE 60 = 5 pages, then stop.
    expect(mocks.brainMemory.findMany).toHaveBeenCalledTimes(5);
    expect(res.items).toEqual([]);
    expect(res.truncated).toBe(true);
  });
});

describe("rateDiscovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brainMemory.count.mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValue([{ unrated: 0n, restored: 0n }]);
    mocks.recordShown.mockResolvedValue("ledger-1");
    mocks.recordDecision.mockResolvedValue(true);
    mocks.recordOutcome.mockResolvedValue(true);
    mocks.createTask.mockResolvedValue({ id: "t-spawned" });
    mocks.resolveInboxMissionId.mockResolvedValue("m-inbox");
  });

  // ── 2026-08-19 · outcome-loop wave · the usefulness half ──────────
  // `noise` is the operator saying "not useful" — the first real writer
  // of outcomeUseful. `known` and `investigate` must NOT write it:
  // known is a novelty defect (outcomeUseful:false would poison the
  // accuracy-correction harvest with a claim the operator confirmed
  // TRUE), and investigate leaves usefulness honestly open.

  it('"noise" also records outcomeUseful:false — the first real usefulness writer', async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "noise");
    expect(mocks.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ledger-1", useful: false }),
    );
  });

  it('"known" records NO outcome — novelty defects stay out of the accuracy harvest', async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "known");
    expect(mocks.recordOutcome).not.toHaveBeenCalled();
  });

  it('"investigate" records NO outcome — usefulness stays honestly open', async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "investigate");
    expect(mocks.recordOutcome).not.toHaveBeenCalled();
  });

  it('maps "known" to IGNORED, never dismissed — it is a novelty signal, not an error', async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});

    const res = await rateDiscovery("d1", "known");

    expect(res.ok).toBe(true);
    expect(mocks.brainMemory.update.mock.calls[0][0].data.metadata.discoveryVerdict).toBe("known");
    // NOT "dismissed": every harvester treats a dismissed row as a wrong
    // recommendation, and "already knew" means the claim was RIGHT.
    expect(mocks.recordDecision).toHaveBeenCalledWith(
      expect.objectContaining({ id: "ledger-1", decision: "ignored" }),
    );
    // The verdict itself must also survive verbatim, so a future novelty
    // consumer can tell "already knew" from any other ignored row.
    expect(mocks.recordDecision.mock.calls[0][0].resultRef).toBe("discovery_verdict:known");
  });

  it('maps "investigate" to an acceptance', async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "investigate");
    expect(mocks.recordDecision.mock.calls[0][0].decision).toBe("accepted");
  });

  // ── 2026-08-19 · round-3 · "investigate" spawns the follow-up task ──
  // The end-to-end audit proved the checkTask→recordOutcomeByContent
  // title-hash bridge had ZERO matching producers: no surface created a
  // task from a recordShown-ledgered string. This is that producer — the
  // VERBATIM title is the join key, so any truncation breaks the loop.

  it('"investigate" spawns a follow-up task titled VERBATIM with the ledgered content', async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "investigate");
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "A moves with B",
        missionId: "m-inbox",
        status: "READY",
        originSource: "discovery:investigate",
      }),
    );
  });

  it("re-rating investigate does NOT duplicate the task (first flip only)", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(
      row({ metadata: { discoveryVerdict: "investigate" } }),
    );
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "investigate");
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it('"noise" and "known" spawn nothing', async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "noise");
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "known");
    expect(mocks.createTask).not.toHaveBeenCalled();
  });

  it("a task-spawn failure never breaks the operator's verdict", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    mocks.createTask.mockRejectedValueOnce(new Error("db down"));
    const res = await rateDiscovery("d1", "investigate");
    expect(res.ok).toBe(true);
  });

  it("refuses to rate a row outside the discovery categories", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row({ category: "wisdom" }));
    const res = await rateDiscovery("d1", "noise");
    expect(res.ok).toBe(false);
    expect(mocks.brainMemory.update).not.toHaveBeenCalled();
  });

  it("refuses a soft-deleted row", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row({ deletedAt: new Date() }));
    expect((await rateDiscovery("d1", "noise")).ok).toBe(false);
  });

  it("keeps the operator's verdict even when the ledger write fails", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(row());
    mocks.brainMemory.update.mockResolvedValueOnce({});
    mocks.recordShown.mockRejectedValueOnce(new Error("ledger down"));

    const res = await rateDiscovery("d1", "known");

    expect(res.ok).toBe(true);
    expect(mocks.brainMemory.update).toHaveBeenCalledOnce();
  });

  it("preserves existing metadata instead of clobbering it", async () => {
    mocks.brainMemory.findUnique.mockResolvedValueOnce(
      row({ metadata: { provenance: "correlation-finder", dataPoints: 9 } }),
    );
    mocks.brainMemory.update.mockResolvedValueOnce({});
    await rateDiscovery("d1", "investigate");
    const meta = mocks.brainMemory.update.mock.calls[0][0].data.metadata;
    expect(meta.provenance).toBe("correlation-finder");
    expect(meta.dataPoints).toBe(9);
    expect(meta.discoveryVerdict).toBe("investigate");
  });
});

/**
 * 2026-08-22 · cluster-and-ask-once, restored-row separation, batch verdicts.
 *
 * Measured on prod the same day: 242 unrated rows / 191 distinct contents, and
 * FIVE operator labels all-time. That budget is why the ordering here is
 * typicality (biggest cluster first, Hacohen arXiv:2202.02794) and not
 * uncertainty — at ten-ish labels, uncertainty sampling is the losing strategy.
 */
describe("clustering — one card per question", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brainMemory.count.mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValue([{ unrated: 0n, restored: 0n }]);
    mocks.recordShown.mockResolvedValue("ledger-1");
    mocks.recordDecision.mockResolvedValue(true);
  });

  it("collapses rows that ask the same question into ONE card carrying every id", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "a", content: "[HIGH] Commitment overdue: pull the list" }),
      row({ id: "b", content: "[HIGH] Commitment overdue: pull the list" }),
      row({ id: "c", content: "[HIGH] Commitment overdue: pull the list" }),
    ]);
    const res = await listDiscoveries();
    expect(res.items).toHaveLength(1);
    expect(res.items[0].clusterIds.sort()).toEqual(["a", "b", "c"]);
    // The badge still counts ROWS; the workload is now CARDS. Both reported,
    // because quoting either alone misdescribes the queue.
    expect(res.unratedClusters).toBe(1);
  });

  it("clusters across a severity re-emit and a moving count", () => {
    expect(clusterKey("[HIGH] 9 decisions awaiting review")).toBe(
      clusterKey("[CRITICAL] 10 decisions awaiting review"),
    );
  });

  it("does NOT cluster genuinely different findings", () => {
    expect(clusterKey("[HIGH] Open loop untouched: A")).not.toBe(
      clusterKey("[HIGH] Open loop untouched: B"),
    );
  });

  it("orders by typicality — the biggest cluster first, not the newest row", async () => {
    const t = (n: number) => new Date(`2026-08-${String(n).padStart(2, "0")}T00:00:00Z`);
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "new", content: "a one-off", lastSeen: t(20) }),
      row({ id: "dup1", content: "the common one", lastSeen: t(19) }),
      row({ id: "dup2", content: "the common one", lastSeen: t(18) }),
    ]);
    const res = await listDiscoveries();
    expect(res.items.map((d) => d.content)).toEqual(["the common one", "a one-off"]);
  });

  it("keeps the NEWEST member as the visible card so the wording is current", async () => {
    const t = (n: number) => new Date(`2026-08-${n}T00:00:00Z`);
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "newest", content: "same", lastSeen: t(22) }),
      row({ id: "older", content: "same", lastSeen: t(21) }),
    ]);
    const res = await listDiscoveries();
    expect(res.items[0].id).toBe("newest");
  });
});

describe("restored rows are separated, never deleted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brainMemory.count.mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValue([{ unrated: 0n, restored: 0n }]);
    mocks.recordShown.mockResolvedValue("ledger-1");
  });

  const restored = (over = {}) =>
    row({ metadata: { origin: "orphan-restore-2026-08-16" }, ...over });

  it("withholds restored rows by default and REPORTS how many", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "engine", content: "found tonight" }),
      restored({ id: "r1", content: "recovered one" }),
      restored({ id: "r2", content: "recovered two" }),
    ]);
    mocks.queryRaw.mockResolvedValue([{ unrated: 1n, restored: 2n }]);
    const res = await listDiscoveries();
    expect(res.items.map((d) => d.id)).toEqual(["engine"]);
    // Counted, not silently dropped — 237 invisible rows is the defect.
    expect(res.restoredHidden).toBe(2);
  });

  it("shows them on request, labelled by provenance", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "engine", content: "found tonight" }),
      restored({ id: "r1", content: "recovered one" }),
    ]);
    const res = await listDiscoveries({ includeRestored: true });
    expect(res.items.map((d) => d.provenance).sort()).toEqual(["engine", "restored"]);
    expect(res.restoredHidden).toBe(0);
  });

  it("does not count an already-judged restored row as hidden work", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      restored({ id: "r1", metadata: { origin: "orphan-restore-2026-08-16", discoveryVerdict: "noise" } }),
    ]);
    const res = await listDiscoveries();
    expect(res.restoredHidden).toBe(0);
  });

  it("matches any future recovery run by prefix, not one hardcoded date", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "r", metadata: { origin: "orphan-restore-2027-01-01" } }),
    ]);
    mocks.queryRaw.mockResolvedValue([{ unrated: 0n, restored: 1n }]);
    expect((await listDiscoveries()).restoredHidden).toBe(1);
  });
});

describe("severityRankOf", () => {
  it("reads the tier the recurrence policy compares against", () => {
    expect(severityRankOf("[CRITICAL] x")).toBe(3);
    expect(severityRankOf("[HIGH] x")).toBe(2);
    expect(severityRankOf("[MEDIUM] x")).toBe(1);
    expect(severityRankOf("[LOW] x")).toBe(0);
  });

  it("returns null for the three engines that write no tier", () => {
    expect(severityRankOf("A moves with B")).toBeNull();
    expect(severityRankOf("[BOGUS] x")).toBeNull();
  });
});

describe("rateDiscoveryCluster", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brainMemory.count.mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValue([{ unrated: 0n, restored: 0n }]);
    mocks.recordShown.mockResolvedValue("ledger-1");
    mocks.recordDecision.mockResolvedValue(true);
    mocks.resolveInboxMissionId.mockResolvedValue("inbox-1");
  });

  /**
   * rateDiscoveryCluster issues TWO findMany calls: the id lookup, then the
   * window re-derivation that finds cluster members the paging scan never
   * reached. Both are modelled, because the second one is the review fix.
   */
  const clusterMocks = (candidates: unknown[], windowRows: unknown[]) => {
    mocks.brainMemory.findMany
      .mockResolvedValueOnce(candidates)
      .mockResolvedValueOnce(windowRows);
  };

  it("ledgers ONCE for the whole cluster — the operator read one card", async () => {
    const members = ["a", "b", "c"].map((id) =>
      row({ id, content: "[HIGH] same question", category: "blind_spot" }),
    );
    clusterMocks(members, members);
    mocks.brainMemory.findUnique.mockResolvedValue(members[0]);

    const res = await rateDiscoveryCluster(["a", "b", "c"], "noise");

    expect(res).toEqual({ ok: true, rated: 3, failed: 0 });
    // Three rows suppressed, ONE correction in the corpus. Counting three
    // would inflate the 200-correction gate with judgements never made.
    expect(mocks.recordShown).toHaveBeenCalledTimes(1);
    expect(mocks.recordDecision).toHaveBeenCalledTimes(1);
  });

  it("REACHES cluster members the paging scan never returned", async () => {
    // The review defect: clusterIds only ever held the rows inside the window,
    // so a cluster straddling the early break rated 18 of 40, reported a clean
    // sweep, and the other 22 came back as an unjudged card the next fetch.
    const shown = [row({ id: "a", content: "[HIGH] same question", category: "blind_spot" })];
    const everything = ["a", "b", "c", "d"].map((id) =>
      row({ id, content: "[HIGH] same question", category: "blind_spot" }),
    );
    clusterMocks(shown, everything);
    mocks.brainMemory.findUnique.mockResolvedValue(shown[0]);

    const res = await rateDiscoveryCluster(["a"], "noise");

    expect(res.rated).toBe(4);
  });

  it("does NOT reach rows that merely look similar — over-merge is data loss", async () => {
    const head = row({
      id: "a",
      content: '[HIGH] Open loop untouched: "Order 4 winter tires"',
      category: "blind_spot",
    });
    const other = row({
      id: "b",
      content: '[HIGH] Open loop untouched: "Order 6 winter tires"',
      category: "blind_spot",
    });
    clusterMocks([head], [head, other]);
    mocks.brainMemory.findUnique.mockResolvedValue(head);

    const res = await rateDiscoveryCluster(["a"], "noise");

    expect(res.rated).toBe(1);
  });

  it("skips rows already judged on their own — one verdict must not overwrite another", async () => {
    const head = row({ id: "a", content: "[HIGH] q", category: "blind_spot" });
    const judged = row({
      id: "b",
      content: "[HIGH] q",
      category: "blind_spot",
      metadata: { discoveryVerdict: "investigate" },
    });
    clusterMocks([head], [head, judged]);
    mocks.brainMemory.findUnique.mockResolvedValue(head);

    expect((await rateDiscoveryCluster(["a"], "noise")).rated).toBe(1);
  });

  it("spawns exactly ONE task for an investigate cluster, not one per row", async () => {
    const members = ["a", "b", "c"].map((id) =>
      row({ id, content: "[HIGH] same question", category: "blind_spot" }),
    );
    clusterMocks(members, members);
    mocks.brainMemory.findUnique.mockResolvedValue(members[0]);

    await rateDiscoveryCluster(["a", "b", "c"], "investigate");

    expect(mocks.createTask).toHaveBeenCalledTimes(1);
  });

  it("marks siblings as suppressed-via the card actually read", async () => {
    const head = row({ id: "head", content: "[HIGH] q", category: "blind_spot" });
    const tail = row({ id: "tail", content: "[HIGH] q", category: "blind_spot" });
    clusterMocks([head, tail], [head, tail]);
    mocks.brainMemory.findUnique.mockResolvedValue(head);

    await rateDiscoveryCluster(["head", "tail"], "known");

    const tailWrite = mocks.brainMemory.update.mock.calls.at(-1)![0];
    expect(tailWrite.data.metadata.discoveryVerdictVia).toBe("head");
    // A judged row must outlive the 24h probationary TTL or the suppression
    // evaporates overnight with the row.
    expect(tailWrite.data.expiresAt).toBeNull();
  });

  it("ELECTS a live head when ids[0] was consolidated away", async () => {
    // The review defect: every ledger + task side effect lives in
    // rateDiscovery(head). With a dead ids[0] the function fell through to the
    // sibling loop and returned a clean-looking success having written no
    // ledger row and spawned no task.
    const alive = row({ id: "alive", content: "[HIGH] q", category: "blind_spot" });
    clusterMocks([alive], [alive]); // 'dead' simply is not returned
    mocks.brainMemory.findUnique.mockResolvedValue(alive);

    const res = await rateDiscoveryCluster(["dead", "alive"], "investigate");

    expect(res).toEqual({ ok: true, rated: 1, failed: 1 });
    expect(mocks.recordShown).toHaveBeenCalledTimes(1);
    expect(mocks.createTask).toHaveBeenCalledTimes(1);
  });

  it("reports partial failure instead of claiming the cluster cleared", async () => {
    const alive = row({ id: "ok", content: "[HIGH] q", category: "blind_spot" });
    clusterMocks([alive], [alive]);
    mocks.brainMemory.findUnique.mockResolvedValue(alive);

    const res = await rateDiscoveryCluster(["ok", "gone"], "noise");

    expect(res).toEqual({ ok: true, rated: 1, failed: 1 });
  });

  it("never reports a negative failure count", async () => {
    // `unique.length - live.length` went negative the moment the id query
    // returned more than was asked for, rendering "saved 60 of 3".
    const many = Array.from({ length: 9 }, (_, i) =>
      row({ id: `m-${i}`, content: "[HIGH] q", category: "blind_spot" }),
    );
    clusterMocks(many, many);
    mocks.brainMemory.findUnique.mockResolvedValue(many[0]);

    const res = await rateDiscoveryCluster(["m-0"], "noise");

    expect(res.failed).toBeGreaterThanOrEqual(0);
  });

  it("dedupes ids so offset paging cannot double-rate one row", async () => {
    const head = row({ id: "a", content: "[HIGH] q", category: "blind_spot" });
    clusterMocks([head], [head]);
    mocks.brainMemory.findUnique.mockResolvedValue(head);

    expect((await rateDiscoveryCluster(["a", "a", "a"], "noise")).rated).toBe(1);
  });

  it("refuses an empty cluster rather than reporting a vacuous success", async () => {
    expect(await rateDiscoveryCluster([], "noise")).toEqual({ ok: false, rated: 0, failed: 0 });
  });
});

describe("CANARY · clusterKey and blindSpotIdentity must agree", () => {
  // These two normalisations are coupled by design: a card that grouped rows
  // the stable key would separate rates rows that then diverge, and the reverse
  // hides a spot behind a card it does not belong to. The agreement used to
  // live only in a comment.
  const cases = [
    ['Open loop untouched: "Order 4 winter tires"', 'Open loop untouched: "Order 6 winter tires"', false],
    ["9 decisions awaiting review", "11 decisions awaiting review", true],
    ["3 unresolved drift alerts accumulating", "8 unresolved drift alerts accumulating", true],
    ['Commitment overdue: "Pay invoice 2841"', 'Commitment overdue: "Pay invoice 3190"', false],
    ["general: the SYSTEM CONSTRAINT", "general: the SYSTEM CONSTRAINT", true],
  ] as const;

  const asSpot = (description: string) => ({
    domain: "general",
    description,
    severity: "high" as const,
    evidence: "e",
    daysSinceAttention: 1,
    suggestedAction: "a",
  });

  for (const [a, b, shouldMatch] of cases) {
    it(`${shouldMatch ? "groups" : "separates"}: ${a.slice(0, 34)}`, () => {
      // Both sides evaluated, then compared to each other — naming the two
      // functions in a describe block while only exercising one is how the
      // agreement stayed unpinned in the first place.
      const viaCluster = clusterKey(`[HIGH] ${a}`) === clusterKey(`[CRITICAL] ${b}`);
      const viaKey = blindSpotIdentity(asSpot(a)) === blindSpotIdentity(asSpot(b));
      expect(viaCluster).toBe(shouldMatch);
      expect(viaKey).toBe(shouldMatch);
      expect(viaCluster).toBe(viaKey);
    });
  }
});

/**
 * CANARY · the NULL-comparison trap, third sighting in this feature.
 *
 * 1) getBlindSpotContext: `NOT(metadata #> path = "noise")` kept 1 of 241 rows.
 * 2) the unrated count nearly shipped with `NOT: { discoveryProvenance:
 *    "restored" }`, which is NULL-and-therefore-false for every row written by
 *    a deployment predating the migration.
 * Both forms read like a tightened filter and silently delete the population.
 */
describe("CANARY · the exact count honours the metadata fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brainMemory.count.mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValue([{ unrated: 0n, restored: 0n }]);
  });

  it("counts a row as unrated only when BOTH sources are silent", async () => {
    // A row judged by the old deployment after the backfill has
    // metadata.discoveryVerdict set and the column NULL. readVerdict drops its
    // card; a column-only count still called it unrated, so the badge sat
    // nonzero with no card behind it indefinitely.
    mocks.brainMemory.findMany.mockResolvedValueOnce([]);
    await listDiscoveries();
    const sql = mocks.queryRaw.mock.calls[0][0].join("?");
    expect(sql).toContain("discovery_verdict IS NULL");
    expect(sql).toContain("metadata->>'discoveryVerdict' IS NULL");
    // IS DISTINCT FROM / NOT LIKE, never `NOT (col = x)` — that form is NULL
    // for a NULL column and silently drops the row. Third sighting of the trap
    // in this feature.
    expect(sql).not.toMatch(/NOT\s*\(\s*discovery_provenance\s*=/);
  });

  it("reads restored from EITHER the column or metadata.origin", async () => {
    // A future restore run writes metadata.origin; the column only follows if
    // that script was updated. Counting on the column alone would report
    // `restoredHidden: 0` while withholding hundreds of rows.
    mocks.brainMemory.findMany.mockResolvedValueOnce([]);
    await listDiscoveries();
    const sql = mocks.queryRaw.mock.calls[0][0].join("?");
    expect(sql).toContain("discovery_provenance = 'restored'");
    expect(sql).toContain("orphan-restore%");
  });
});

/**
 * CANARY · the mirror must never outrank the source.
 *
 * During a rollback or a migration-first deploy, the PRIOR app clears
 * `metadata.discoveryVerdict` on a resurface without clearing the newly added
 * column. A column-first read then lets the stale `noise` mirror win forever —
 * the spot stays suppressed even though the source of truth resurfaced it.
 */
describe("CANARY · metadata is the source, the column is only a mirror", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.brainMemory.count.mockResolvedValue(0);
    mocks.queryRaw.mockResolvedValue([{ unrated: 0n, restored: 0n }]);
  });

  it("an explicit metadata null beats a stale column verdict", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "resurfaced", metadata: { discoveryVerdict: null }, discoveryVerdict: "noise" }),
    ]);
    const res = await listDiscoveries();
    // Present-and-null means "resurfaced". It must render as unjudged.
    expect(res.items.map((d) => d.id)).toEqual(["resurfaced"]);
    expect(res.items[0].verdict).toBeNull();
  });

  it("uses the column only when metadata has no key at all", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "col-only", metadata: {}, discoveryVerdict: "known" }),
    ]);
    const res = await listDiscoveries({ includeRated: true });
    expect(res.items[0].verdict).toBe("known");
  });

  it("a present metadata verdict wins over a disagreeing column", async () => {
    mocks.brainMemory.findMany.mockResolvedValueOnce([
      row({ id: "x", metadata: { discoveryVerdict: "known" }, discoveryVerdict: "noise" }),
    ]);
    const res = await listDiscoveries({ includeRated: true });
    expect(res.items[0].verdict).toBe("known");
  });
});
