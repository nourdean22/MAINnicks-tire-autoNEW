/**
 * lib/brain/goal-people-recall.ts (job 2026-11-02-nour-os-interconnect W6): recall knows goals and people.
 *  - goal lines (id + health + pace) only when the turn touches a goal, capped at GOAL_RECALL_LINES;
 *  - a goal behind pace or off track earns ONE maxim from his books (maximForGoalMoment), which takes a wisdom slot;
 *  - each recalled person carries their newest journal line and last contact.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  activeGoalsWithHealth: vi.fn(),
  activeGoalTitles: vi.fn(async () => []),
  skippedIds: vi.fn(async () => new Set<string>()),
  dumpFindFirst: vi.fn(),
  ledgerFindMany: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/lib/services/goal-health", () => ({ activeGoalsWithHealth: h.activeGoalsWithHealth, activeGoalTitles: h.activeGoalTitles }));
vi.mock("@/lib/services/home-maxim", () => ({ skippedIds: h.skippedIds }));
vi.mock("@/lib/prisma", () => ({
  prisma: { brainDump: { findFirst: h.dumpFindFirst }, relationshipLedger: { findMany: h.ledgerFindMany } },
}));
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: h.warn }) } };
});

import {
  GOAL_RECALL_LINES,
  GOAL_READ_FAILED_LINE,
  goalRecallBlock,
  readGoalRecall,
  personFactSuffix,
  readPeopleFacts,
} from "@/lib/brain/goal-people-recall";
import { selectWisdomSlots, RECALL_ADDENDUM_HEADINGS } from "@/lib/brain/contextual-recall";
import type { ActiveGoalHealth } from "@/lib/services/goal-health";
import type { Maxim } from "@/lib/wisdom/maxims";

const goal = (o: Partial<ActiveGoalHealth>): ActiveGoalHealth => ({
  id: "g1",
  title: "Revenue this month",
  kind: "metric",
  horizon: "MONTH",
  unit: "$",
  currentValue: 4000,
  targetValue: 15000,
  status: "active",
  due: { at: null, source: null, label: "" },
  pace: "behind · need 500/day to catch up",
  paceKind: "behind",
  health: { state: "at_risk", at: "2026-11-01T12:00:00.000Z" },
  openTasks: 1,
  domain: "BUSINESS",
  metric: "revenue",
  deadline: null,
  createdAt: "2026-10-01T12:00:00.000Z",
  tasksDone: 0,
  tasksTotal: 1,
  progress: 27,
  ...o,
});
const POOL: Maxim[] = [
  { id: "p:t1", text: "Move before the window shuts.", source: "Gracián", ref: "t1", tags: ["timing"] },
  { id: "p:d1", text: "Decide, then stop re-deciding.", source: "Munger", ref: "d1", tags: ["decisions"] },
];
const DAY = "2026-11-02";

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.activeGoalTitles.mockResolvedValue([]);
  h.skippedIds.mockResolvedValue(new Set<string>());
});

describe("goalRecallBlock", () => {
  it("adds nothing when the turn touches no goal", () => {
    const r = goalRecallBlock([goal({})], ["supplier invoice"], "call the supplier about the invoice", POOL, DAY);
    expect(r).toEqual({ lines: [], maxim: null });
  });

  it("a turn naming a goal gets that goal's line with its id, health and pace, plus one maxim for its state", () => {
    const r = goalRecallBlock([goal({}), goal({ id: "g2", title: "Lift 3x a week", paceKind: null, pace: null })], ["revenue"], "how is revenue going", POOL, DAY);
    expect(r.lines[0]).toBe(RECALL_ADDENDUM_HEADINGS.goals);
    expect(r.lines[1]).toBe("- Revenue this month [id:g1] · health at_risk since 2026-11-01 · behind · need 500/day to catch up");
    expect(r.lines.some((l) => l.includes("Lift"))).toBe(false);
    expect(r.maxim).toMatchObject({ id: "p:t1", state: "behind_pace" });
    expect(r.lines.at(-1)).toBe('- Maxim for "Revenue this month" (behind pace): Move before the window shuts. (Gracián)');
  });

  it("a title matches only on a whole word of 4+ letters: work is not workout, the Target store is not a target", () => {
    const g = [goal({ title: "Daily workout" }), goal({ id: "g2", title: "Career move" }), goal({ id: "g3", title: "Revenue this month" })];
    expect(goalRecallBlock(g, ["work"], "work stuff today", POOL, DAY).lines).toEqual([]);
    expect(goalRecallBlock(g, ["car"], "fix the car", POOL, DAY).lines).toEqual([]);
    expect(goalRecallBlock(g, ["target"], "I'm going to Target", POOL, DAY).lines).toEqual([]);
    const hit = goalRecallBlock(g, ["revenue so far"], "revenue so far", POOL, DAY);
    expect(hit.lines.filter((l) => l.includes("[id:"))).toEqual([expect.stringContaining("Revenue this month")]);
  });

  it("goal phrases are read from the raw message, so on track and check in can match", () => {
    expect(goalRecallBlock([goal({})], ["track"], "am I on track this week", POOL, DAY).lines.length).toBeGreaterThan(0);
    expect(goalRecallBlock([goal({})], ["check"], "let's check in", POOL, DAY).lines.length).toBeGreaterThan(0);
    expect(goalRecallBlock([goal({})], ["check"], "time for a check-in", POOL, DAY).lines.length).toBeGreaterThan(0);
  });

  it("W8a (audit C3): checking in WITH or ON a person is not a goal turn", () => {
    for (const q of ["check in with mom", "I should check in on dad today", "let's check-in with the crew"]) {
      expect(goalRecallBlock([goal({})], ["check"], q, POOL, DAY)).toEqual({ lines: [], maxim: null });
    }
    // The guard is the preposition, not the word after it: "check in on my goals" still has "goals".
    expect(goalRecallBlock([goal({})], ["check"], "check in on my goals", POOL, DAY).lines.length).toBeGreaterThan(0);
  });

  it("W8a (audit C6): a maxim Nour skipped on Home never comes back through recall", () => {
    const r = goalRecallBlock([goal({})], ["revenue"], "revenue", POOL, DAY, new Set(["p:t1"]));
    expect(r.maxim).toBeNull();
    expect(r.lines.some((l) => l.startsWith("- Maxim"))).toBe(false);
    const other = goalRecallBlock([goal({})], ["revenue"], "revenue", POOL, DAY, new Set(["p:d1"]));
    expect(other.maxim).toMatchObject({ id: "p:t1" });
  });

  it("W8a (audit C16): the 3 most urgent goals show: off track, then behind pace, then due soonest, never horizon order", () => {
    const goals = [
      goal({ id: "g-ok", title: "Goal ok", paceKind: null, health: { state: "on_track", at: null }, due: { at: "2026-12-30T00:00:00.000Z", source: "horizon", label: "" } }),
      goal({ id: "g-soon", title: "Goal soon", paceKind: null, health: { state: "on_track", at: null }, due: { at: "2026-11-05T00:00:00.000Z", source: "horizon", label: "" } }),
      goal({ id: "g-behind", title: "Goal behind", paceKind: "behind", health: { state: "at_risk", at: null } }),
      goal({ id: "g-off", title: "Goal off", paceKind: null, health: { state: "off_track", at: null } }),
      goal({ id: "g-late", title: "Goal late", paceKind: null, health: { state: "on_track", at: null }, due: { at: "2027-01-01T00:00:00.000Z", source: "horizon", label: "" } }),
    ];
    const lines = goalRecallBlock(goals, ["goals"], "my goals", POOL, DAY).lines.filter((l) => l.startsWith("- Goal "));
    expect(lines.map((l) => l.match(/\[id:(g-\w+)\]/)![1])).toEqual(["g-off", "g-behind", "g-soon"]);
  });

  it("everyday words like behind, pace or progress do not pull goals into an unrelated turn", () => {
    for (const q of ["I'm behind on emails", "slow pace at the shop today", "any progress on the brake job"]) {
      expect(goalRecallBlock([goal({})], ["emails"], q, POOL, DAY)).toEqual({ lines: [], maxim: null });
    }
  });

  it("the cap holds at its edge: exactly 3 goals all show, a 4th does not", () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => goal({ id: `g${i}`, title: `Goal ${i}`, paceKind: null, health: { state: "on_track", at: null } }));
    expect(GOAL_RECALL_LINES).toBe(3);
    const three = goalRecallBlock(n(3), ["goals"], "my goals", POOL, DAY).lines.filter((l) => l.startsWith("- Goal "));
    expect(three).toHaveLength(3);
    const four = goalRecallBlock(n(4), ["goals"], "my goals", POOL, DAY).lines.filter((l) => l.startsWith("- Goal "));
    expect(four).toHaveLength(3);
    expect(four.some((l) => l.includes("[id:g3]"))).toBe(false);
  });

  it("goal words reach every active goal, capped at the named line cap", () => {
    const many = Array.from({ length: GOAL_RECALL_LINES + 3 }, (_, i) => goal({ id: `g${i}`, title: `Goal ${i}`, paceKind: null, health: { state: "on_track", at: null } }));
    const r = goalRecallBlock(many, ["goals"], "am I on track with my goals", POOL, DAY);
    expect(r.lines.filter((l) => l.startsWith("- Goal "))).toHaveLength(GOAL_RECALL_LINES);
    expect(r.maxim).toBeNull();
  });

  it("only behind pace or off track earns the maxim in recall; off track wins over behind", () => {
    // A focus maxim exists, so only the state rule can keep an at-risk goal from earning one in recall.
    const withFocus = [...POOL, { id: "p:f1", text: "One thing first.", source: "Naval", ref: "f1", tags: ["focus"] }];
    const atRisk = goalRecallBlock([goal({ paceKind: null })], ["revenue"], "revenue", withFocus, DAY);
    expect(atRisk.maxim).toBeNull();
    expect(atRisk.lines.some((l) => l.startsWith("- Maxim"))).toBe(false);
    const both = goalRecallBlock(
      [goal({}), goal({ id: "g2", title: "Revenue quarter", health: { state: "off_track", at: null }, paceKind: null })],
      ["revenue"], "revenue", POOL, DAY,
    );
    expect(both.maxim).toMatchObject({ id: "p:d1", state: "off_track" });
  });
});

describe("readGoalRecall", () => {
  it("a failed goals read on a goal turn says the goals are unknown, never that there are none", async () => {
    h.activeGoalsWithHealth.mockRejectedValue(new Error("db down"));
    await expect(readGoalRecall(["goals"], "how are my goals")).resolves.toEqual({
      lines: [RECALL_ADDENDUM_HEADINGS.goals, GOAL_READ_FAILED_LINE],
      maxim: null,
      failed: true,
    });
    expect(GOAL_READ_FAILED_LINE).toContain("unknown, not none");
    expect(h.warn).toHaveBeenCalledWith("goal_recall_failed", expect.objectContaining({ err: "db down" }));
  });

  it("a failed goals read on an unrelated turn adds nothing but still reports failed", async () => {
    h.activeGoalTitles.mockRejectedValue(new Error("db down"));
    await expect(readGoalRecall(["invoice"], "send the invoice")).resolves.toEqual({ lines: [], maxim: null, failed: true });
  });
  it("returns the touched goal's line from the shared goals read", async () => {
    h.activeGoalTitles.mockResolvedValue([{ id: "g1", title: "Revenue this month" }]);
    h.activeGoalsWithHealth.mockResolvedValue({ goals: [goal({})], failed: [] });
    const r = await readGoalRecall(["revenue"], "revenue so far");
    expect(r.lines[1]).toContain("[id:g1]");
  });

  it("W8a (audit C17): no goal word and no 4+ letter topic is no read at all", async () => {
    await expect(readGoalRecall(["ok", "go"], "ok go")).resolves.toEqual({ lines: [], maxim: null });
    expect(h.activeGoalTitles).not.toHaveBeenCalled();
    expect(h.activeGoalsWithHealth).not.toHaveBeenCalled();
  });

  it("W8a (audit C17): without a goal word, the health read runs only when a title is touched", async () => {
    h.activeGoalTitles.mockResolvedValue([{ id: "g1", title: "Revenue this month" }]);
    await readGoalRecall(["invoice"], "send the invoice");
    expect(h.activeGoalTitles).toHaveBeenCalledTimes(1);
    expect(h.activeGoalsWithHealth).not.toHaveBeenCalled();
    h.activeGoalsWithHealth.mockResolvedValue({ goals: [goal({})], failed: [] });
    await readGoalRecall(["revenue"], "revenue so far");
    expect(h.activeGoalsWithHealth).toHaveBeenCalledTimes(1);
  });

  it("W8a (audit C6): the recall maxim honours the live Home skip list, read once; a failed skip read shows no maxim", async () => {
    h.activeGoalsWithHealth.mockResolvedValue({ goals: [goal({})], failed: [] });
    const shown = await readGoalRecall(["goals"], "my goals");
    expect(shown.maxim).not.toBeNull();
    h.skippedIds.mockReset().mockResolvedValue(new Set([shown.maxim!.id]));
    const skipped = await readGoalRecall(["goals"], "my goals");
    expect(h.skippedIds).toHaveBeenCalledTimes(1);
    expect(skipped.maxim?.id).not.toBe(shown.maxim!.id);
    h.skippedIds.mockRejectedValue(new Error("db down"));
    const failed = await readGoalRecall(["goals"], "my goals");
    expect(failed.maxim).toBeNull();
    expect(failed.lines.length).toBeGreaterThan(1);
  });
});

describe("selectWisdomSlots goal signal", () => {
  const w = (key: string, hybrid: number) => ({ category: "wisdom", key, source: "wisdom-distiller", hybrid, semantic: 0.9 });
  it("a goal maxim takes one wisdom slot, so wisdom never grows past the slot count", () => {
    const scored = [w("a", 0.9), w("b", 0.8), w("c", 0.7)];
    const now = new Date();
    expect(selectWisdomSlots(scored, 3, { useEmbeddings: true, now })).toHaveLength(3);
    expect(selectWisdomSlots(scored, 3, { useEmbeddings: true, now, goalMaximSlots: 1 }).map((m) => m.key)).toEqual(["a", "b"]);
    expect(selectWisdomSlots(scored, 1, { useEmbeddings: true, now, goalMaximSlots: 1 })).toEqual([]);
  });
});

describe("people facts", () => {
  it("each person carries their OWN newest journal line and last contact, one person at a time", async () => {
    const shared = { personIds: ["p1", "p2"], summary: "Talked with Sam about the lease", rawThoughts: "x", createdAt: new Date("2026-11-01T15:00:00Z") };
    let inFlight = 0;
    let peak = 0;
    const track = <T,>(v: T) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise<T>((r) => setTimeout(() => { inFlight--; r(v); }, 1));
    };
    h.dumpFindFirst.mockImplementation(() => track(shared));
    h.ledgerFindMany.mockImplementation(({ where }: { where: { personId: string } }) =>
      track(
        where.personId === "p1"
          ? [
              { personId: "p1", note: "status flip", metadata: { kind: "status_flip" }, createdAt: new Date("2026-11-02T10:00:00Z") },
              { personId: "p1", note: "coffee, he wants in", metadata: null, createdAt: new Date("2026-10-30T10:00:00Z") },
            ]
          : [],
      ),
    );
    const facts = await readPeopleFacts(["p1", "p2"]);
    expect(h.dumpFindFirst.mock.calls.map((c) => c[0].where)).toEqual([
      { personIds: { has: "p1" }, deletedAt: null },
      { personIds: { has: "p2" }, deletedAt: null },
    ]);
    expect(h.ledgerFindMany.mock.calls.map((c) => c[0].where)).toEqual([{ personId: "p1" }, { personId: "p2" }]);
    expect(peak).toBe(1);
    expect(personFactSuffix(facts, "p1")).toBe(" · last contact 2026-10-30: coffee, he wants in · journal 2026-11-01: Talked with Sam about the lease");
    expect(personFactSuffix(facts, "p2")).toBe(" · journal 2026-11-01: Talked with Sam about the lease");
  });

  it("a failed read says so on the line instead of reading as 'nothing logged'", async () => {
    h.dumpFindFirst.mockRejectedValue(new Error("db down"));
    h.ledgerFindMany.mockResolvedValue([]);
    const facts = await readPeopleFacts(["p1"]);
    expect(personFactSuffix(facts, "p1")).toBe(" · journal unread");
    expect(h.warn).toHaveBeenCalledWith("people_facts_read_failed", expect.objectContaining({ source: "journal" }));
  });

  it("a failed contact read says last contact unread, not that there was none", async () => {
    h.dumpFindFirst.mockResolvedValue(null);
    h.ledgerFindMany.mockRejectedValue(new Error("db down"));
    const facts = await readPeopleFacts(["p1"]);
    expect(personFactSuffix(facts, "p1")).toBe(" · last contact unread");
    expect(h.warn).toHaveBeenCalledWith("people_facts_read_failed", expect.objectContaining({ source: "contact" }));
  });

  it("no people means no reads", async () => {
    await readPeopleFacts([]);
    expect(h.dumpFindFirst).not.toHaveBeenCalled();
    expect(h.ledgerFindMany).not.toHaveBeenCalled();
  });
});
