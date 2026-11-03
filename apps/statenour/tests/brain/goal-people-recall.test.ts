/**
 * lib/brain/goal-people-recall.ts (job 2026-11-02-nour-os-interconnect W6): recall knows goals and people.
 *  - goal lines (id + health + pace) only when the turn touches a goal, capped at GOAL_RECALL_LINES;
 *  - a goal behind pace or off track earns ONE maxim from his books (maximForGoalMoment), which takes a wisdom slot;
 *  - each recalled person carries their newest journal line and last contact.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  activeGoalsWithHealth: vi.fn(),
  dumpFindMany: vi.fn(),
  ledgerFindMany: vi.fn(),
  warn: vi.fn(),
}));
vi.mock("@/lib/services/goal-health", () => ({ activeGoalsWithHealth: h.activeGoalsWithHealth }));
vi.mock("@/lib/prisma", () => ({
  prisma: { brainDump: { findMany: h.dumpFindMany }, relationshipLedger: { findMany: h.ledgerFindMany } },
}));
vi.mock("@/lib/logger", async (orig) => {
  const m = await orig<typeof import("@/lib/logger")>();
  return { ...m, logger: { ...m.logger, withSurface: (s: string) => ({ ...m.logger.withSurface(s), warn: h.warn }) } };
});

import {
  GOAL_RECALL_LINES,
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
  ...o,
});
const POOL: Maxim[] = [
  { id: "p:t1", text: "Move before the window shuts.", source: "Gracián", ref: "t1", tags: ["timing"] },
  { id: "p:d1", text: "Decide, then stop re-deciding.", source: "Munger", ref: "d1", tags: ["decisions"] },
];
const DAY = "2026-11-02";

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
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
  it("a failed goals read adds nothing and is logged, never thrown", async () => {
    h.activeGoalsWithHealth.mockRejectedValue(new Error("db down"));
    await expect(readGoalRecall(["goals"], "my goals")).resolves.toEqual({ lines: [], maxim: null });
    expect(h.warn).toHaveBeenCalledWith("goal_recall_failed", expect.objectContaining({ err: "db down" }));
  });
  it("returns the touched goal's line from the shared goals read", async () => {
    h.activeGoalsWithHealth.mockResolvedValue({ goals: [goal({})], failed: [] });
    const r = await readGoalRecall(["revenue"], "revenue so far");
    expect(r.lines[1]).toContain("[id:g1]");
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
  it("each person carries their newest journal line and last contact, read by id", async () => {
    h.dumpFindMany.mockResolvedValue([
      { personIds: ["p1", "p2"], summary: "Talked with Sam about the lease", rawThoughts: "x", createdAt: new Date("2026-11-01T15:00:00Z") },
      { personIds: ["p1"], summary: "older line", rawThoughts: "y", createdAt: new Date("2026-10-20T15:00:00Z") },
    ]);
    h.ledgerFindMany.mockResolvedValue([
      { personId: "p1", note: "status flip", metadata: { kind: "status_flip" }, createdAt: new Date("2026-11-02T10:00:00Z") },
      { personId: "p1", note: "coffee, he wants in", metadata: null, createdAt: new Date("2026-10-30T10:00:00Z") },
    ]);
    const facts = await readPeopleFacts(["p1", "p2"]);
    expect(h.dumpFindMany.mock.calls[0][0].where).toMatchObject({ personIds: { hasSome: ["p1", "p2"] }, deletedAt: null });
    expect(h.ledgerFindMany.mock.calls[0][0].where).toEqual({ personId: { in: ["p1", "p2"] } });
    expect(personFactSuffix(facts, "p1")).toBe(" · last contact 2026-10-30: coffee, he wants in · journal 2026-11-01: Talked with Sam about the lease");
    expect(personFactSuffix(facts, "p2")).toBe(" · journal 2026-11-01: Talked with Sam about the lease");
  });

  it("a failed read says so on the line instead of reading as 'nothing logged'", async () => {
    h.dumpFindMany.mockRejectedValue(new Error("db down"));
    h.ledgerFindMany.mockResolvedValue([]);
    const facts = await readPeopleFacts(["p1"]);
    expect(personFactSuffix(facts, "p1")).toBe(" · journal unread");
    expect(h.warn).toHaveBeenCalledWith("people_facts_read_failed", expect.objectContaining({ source: "journal" }));
  });

  it("no people means no reads", async () => {
    await readPeopleFacts([]);
    expect(h.dumpFindMany).not.toHaveBeenCalled();
    expect(h.ledgerFindMany).not.toHaveBeenCalled();
  });
});
