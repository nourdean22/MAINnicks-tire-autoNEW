/**
 * Blind pairwise review (2026-10-08): pairing never repeats a compared pair,
 * sides are not a function of recency, and agreement counts only picks the
 * judge could have been right or wrong about.
 */
import { describe, expect, it, vi } from "vitest";

const audit = vi.hoisted(() => ({ written: true, calls: [] as Array<Record<string, unknown>> }));
vi.mock("./auditTrail", () => ({
  logAdminAction: async (data: Record<string, unknown>) => { audit.calls.push(data); return audit.written; },
}));

import { judgeAgreement, nextBlindPair, pickRecordFromAuditChanges, recordPairPick, PairPickError, type PairCandidate } from "./pairwiseReview";

const c = (id: number, judgeTotal = 70): PairCandidate => ({ id, imageUrl: `https://cdn.example/${id}.jpg`, caption: `post ${id}`, judgeTotal });

describe("nextBlindPair", () => {
  it("pairs the newest two unseen posts and carries no score", () => {
    const pair = nextBlindPair([c(30), c(29), c(28)], new Set());
    expect(pair?.key).toBe("29-30");
    expect(new Set([pair?.a.id, pair?.b.id])).toEqual(new Set([30, 29]));
    expect(JSON.stringify(pair)).not.toContain("judge");
  });
  it("skips pairs already picked, whichever side they were shown on", () => {
    const pair = nextBlindPair([c(30), c(29), c(28)], new Set(["29-30"]));
    expect(pair?.key).toBe("28-30");
  });
  it("null when every pair in the window is compared, or fewer than two posts exist", () => {
    expect(nextBlindPair([c(2), c(1)], new Set(["1-2"]))).toBeNull();
    expect(nextBlindPair([c(1)], new Set())).toBeNull();
  });
  it("the newer post is not always side A", () => {
    const sides = new Set<string>();
    for (let id = 2; id < 40; id++) {
      const p = nextBlindPair([c(id), c(id - 1)], new Set())!;
      sides.add(p.a.id === id ? "newer-left" : "newer-right");
    }
    expect(sides).toEqual(new Set(["newer-left", "newer-right"]));
  });
});

describe("judgeAgreement", () => {
  it("counts agreement only where the judge took a side and so did the operator", () => {
    const r = judgeAgreement([
      { aId: 1, bId: 2, pick: "a", aJudge: 80, bJudge: 60 },   // agreed
      { aId: 3, bId: 4, pick: "b", aJudge: 80, bJudge: 60 },   // disagreed
      { aId: 5, bId: 6, pick: "tie", aJudge: 80, bJudge: 60 }, // tie: not scored
      { aId: 7, bId: 8, pick: "a", aJudge: 70, bJudge: 70 },   // judge indifferent: not scored
      { aId: 9, bId: 10, pick: "a", aJudge: null, bJudge: 60 }, // no snapshot: not scored
    ]);
    expect(r).toEqual({ picks: 5, scored: 2, agreed: 1, disagreed: 1, ties: 1, rate: 0.5 });
  });
  it("no scored pick is a null rate, never 0 or 1", () => {
    expect(judgeAgreement([]).rate).toBeNull();
    expect(judgeAgreement([{ aId: 1, bId: 2, pick: "tie", aJudge: 1, bJudge: 2 }]).rate).toBeNull();
  });
});

describe("pickRecordFromAuditChanges", () => {
  it("reads the shape logAdminAction writes and refuses anything else", () => {
    expect(pickRecordFromAuditChanges({ metadata: { old: null, new: { aId: 1, bId: 2, pick: "b", aJudge: 55, bJudge: 72 } } }))
      .toEqual({ aId: 1, bId: 2, pick: "b", aJudge: 55, bJudge: 72 });
    // TiDB can hand a json() column back as a string (no driver mapping in drizzle's MySqlJson).
    expect(pickRecordFromAuditChanges(JSON.stringify({ metadata: { old: null, new: { aId: 1, bId: 2, pick: "b", aJudge: 55, bJudge: 72 } } })))
      .toEqual({ aId: 1, bId: 2, pick: "b", aJudge: 55, bJudge: 72 });
    expect(pickRecordFromAuditChanges("{not json")).toBeNull();
    expect(pickRecordFromAuditChanges({ metadata: { old: null, new: { aId: 1, bId: 2, pick: "maybe" } } })).toBeNull();
    expect(pickRecordFromAuditChanges({ detail: { old: null, new: "x" } })).toBeNull();
    expect(pickRecordFromAuditChanges(null)).toBeNull();
  });
});

describe("recordPairPick — the audit row is the only record, so a swallowed write is a failure, not a success", () => {
  const judged = (id: number, total: number) => ({ id, imageUrl: `https://cdn.example/${id}.jpg`, caption: `post ${id}`, scores: JSON.stringify({ shadowJudge: { total, rejected: false, note: "" } }) });
  // Two reads in order: the picks already on record (audit_log), then the candidates.
  const fakeDb = (rows: unknown[], picks: unknown[] = []) => {
    const answers = [picks, rows];
    return { select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => answers.shift() ?? [] }) }) }) }) };
  };

  it("re-reads both judge totals server-side and records them with the pick", async () => {
    audit.written = true; audit.calls.length = 0;
    const d = fakeDb([judged(2, 72), judged(1, 55)]);
    await expect(recordPairPick(d as never, { aId: 1, bId: 2, pick: "b", actor: "nour@example.com" }))
      .resolves.toEqual({ aId: 1, bId: 2, pick: "b", aJudge: 55, bJudge: 72 });
    expect(audit.calls[0]).toMatchObject({ action: "content.pairwise_pick", entityType: "content_pair", entityId: "1-2", actorType: "human_user", metadata: { aId: 1, bId: 2, pick: "b", aJudge: 55, bJudge: 72 } });
  });

  it("a failed audit insert rejects with write_failed instead of returning the record", async () => {
    audit.written = false; audit.calls.length = 0;
    const d = fakeDb([judged(2, 72), judged(1, 55)]);
    await expect(recordPairPick(d as never, { aId: 1, bId: 2, pick: "a", actor: "x" })).rejects.toMatchObject({ kind: "write_failed" });
    expect(audit.calls).toHaveLength(1);
  });

  it("a pair already on record returns that pick and writes nothing — a double tap cannot count twice", async () => {
    audit.written = true; audit.calls.length = 0;
    const onRecord = [{ entityId: "1-2", changes: { metadata: { old: null, new: { aId: 1, bId: 2, pick: "a", aJudge: 55, bJudge: 72 } } } }];
    await expect(recordPairPick(fakeDb([judged(2, 72), judged(1, 55)], onRecord) as never, { aId: 2, bId: 1, pick: "b", actor: "x" }))
      .resolves.toEqual({ aId: 1, bId: 2, pick: "a", aJudge: 55, bJudge: 72 });
    expect(audit.calls).toHaveLength(0);
  });

  it("a pair that is not two current judged posts is refused before any write", async () => {
    audit.written = true; audit.calls.length = 0;
    await expect(recordPairPick(fakeDb([judged(1, 55)]) as never, { aId: 1, bId: 9, pick: "a", actor: "x" })).rejects.toBeInstanceOf(PairPickError);
    expect(audit.calls).toHaveLength(0);
  });
});
