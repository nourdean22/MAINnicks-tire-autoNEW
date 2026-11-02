/**
 * relatedActivity: the one read over the event tables NOUR OS already writes (job
 * 2026-11-02-nour-os-interconnect W1, research doc section 5). Goal, mission and person pages and
 * Nick's getRelated read it. A failed table read is named in `failed`, never hidden as empty.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  goalEvent: vi.fn(),
  taskEvent: vi.fn(),
  task: vi.fn(),
  brainDump: vi.fn(),
  reflection: vi.fn(),
  situationLog: vi.fn(),
  decisionReplay: vi.fn(),
  relationshipLedger: vi.fn(),
  chatConversation: vi.fn(),
  personProfile: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: Object.fromEntries(Object.entries(h).map(([k, fn]) => [k, { findMany: fn }])),
}));

import { relatedActivity, RELATED_MAX_DAYS, RELATED_MAX_ITEMS } from "@/lib/services/related-activity";

const NOW = Date.parse("2026-11-02T18:00:00.000Z");
const at = (h: number) => new Date(NOW - h * 3_600_000);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  for (const fn of Object.values(h)) fn.mockReset().mockResolvedValue([]);
});

describe("relatedActivity · goal", () => {
  it("unions every goal-keyed table, newest first, with a ref back to each row", async () => {
    h.goalEvent.mockResolvedValue([{ id: "ge1", kind: "check_in", payload: { health: "at_risk", note: "slow week" }, createdAt: at(1) }]);
    h.taskEvent.mockResolvedValue([{ id: "te1", kind: "completed", createdAt: at(3), task: { title: "Call the bank" } }]);
    h.task.mockResolvedValue([{ id: "t1", title: "Draft offer", status: "DOING", goalId: null, updatedAt: at(2) }]);
    h.brainDump.mockResolvedValue([{ id: "b1", summary: "thinking about revenue", rawThoughts: "x", createdAt: at(5) }]);
    h.reflection.mockResolvedValue([{ id: "r1", insight: "momentum on Mondays", createdAt: at(6) }]);
    h.situationLog.mockResolvedValue([{ id: "s1", situation: "vendor pushed price", createdAt: at(7) }]);
    h.decisionReplay.mockResolvedValue([{ id: "d1", title: "Hire a second tech", createdAt: at(4) }]);

    const r = await relatedActivity({ goalId: "g1" });

    expect(r.failed).toEqual([]);
    expect(r.items.map((i) => i.kind)).toEqual(["goal_event", "task", "task_event", "decision", "journal", "reflection", "situation"]);
    expect(r.items[0]).toMatchObject({ title: "check-in: at_risk - slow week", ref: { table: "GoalEvent", id: "ge1" } });
    expect(r.items[1]).toMatchObject({ title: "Draft offer (DOING)", source: "task via mission", ref: { table: "Task", id: "t1" } });
    expect(r.items[2].title).toBe("Call the bank: completed");
    // Person and chat tables are never read for a goal key.
    expect(h.relationshipLedger).not.toHaveBeenCalled();
    expect(h.chatConversation).not.toHaveBeenCalled();
  });

  it("a task inherits the goal from its mission when its own goalId is empty (Linear L1, read time)", async () => {
    await relatedActivity({ goalId: "g1" });
    const where = h.task.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ goalId: "g1" }, { goalId: null, mission: { lifeGoalId: "g1" } }]);
    expect(where.deletedAt).toBeNull();
  });

  it("a failed table read is named in failed and the other tables still answer", async () => {
    h.reflection.mockRejectedValue(new Error("relation does not exist"));
    h.goalEvent.mockResolvedValue([{ id: "ge1", kind: "updated", payload: null, createdAt: at(1) }]);
    const r = await relatedActivity({ goalId: "g1" });
    expect(r.failed).toEqual(["reflection"]);
    expect(r.items.map((i) => i.ref.id)).toEqual(["ge1"]);
  });

  it("every read is bounded by since and the cap", async () => {
    await relatedActivity({ goalId: "g1" }, { since: at(24), limit: 5 });
    for (const fn of [h.goalEvent, h.taskEvent, h.brainDump, h.reflection, h.situationLog, h.decisionReplay]) {
      const args = fn.mock.calls[0][0];
      expect(args.take).toBe(5);
      expect(args.where.createdAt).toEqual({ gte: at(24) });
    }
    expect(h.task.mock.calls[0][0].where.updatedAt).toEqual({ gte: at(24) });
  });
});

describe("relatedActivity · caps are set once here", () => {
  it("limit never exceeds the cap and since never reaches past the window", async () => {
    h.goalEvent.mockResolvedValue(
      Array.from({ length: 80 }, (_, i) => ({ id: `ge${i}`, kind: "updated", payload: null, createdAt: at(i) })),
    );
    const r = await relatedActivity({ goalId: "g1" }, { since: new Date(NOW - 400 * 86_400_000), limit: 500 });
    expect(RELATED_MAX_ITEMS).toBe(50);
    expect(RELATED_MAX_DAYS).toBe(90);
    expect(h.goalEvent.mock.calls[0][0].take).toBe(50);
    expect(h.goalEvent.mock.calls[0][0].where.createdAt.gte).toEqual(new Date(NOW - 90 * 86_400_000));
    expect(r.items).toHaveLength(50);
  });

  it("with no key it refuses instead of reading everything", async () => {
    await expect(relatedActivity({})).rejects.toThrow(/goalId, missionId or personId/);
    expect(h.goalEvent).not.toHaveBeenCalled();
  });
});

describe("relatedActivity · mission", () => {
  it("reads tasks, journal tables and chats by missionId", async () => {
    h.task.mockResolvedValue([{ id: "t1", title: "Lift quote", status: "READY", goalId: "g1", updatedAt: at(1) }]);
    h.chatConversation.mockResolvedValue([{ id: "c1", title: null, updatedAt: at(2) }]);
    const r = await relatedActivity({ missionId: "m1" });
    expect(h.task.mock.calls[0][0].where).toMatchObject({ missionId: "m1", deletedAt: null });
    expect(h.brainDump.mock.calls[0][0].where).toMatchObject({ missionId: "m1", deletedAt: null });
    expect(h.chatConversation.mock.calls[0][0].where).toMatchObject({ missionId: "m1" });
    expect(h.goalEvent).not.toHaveBeenCalled();
    expect(r.items.map((i) => [i.kind, i.title])).toEqual([
      ["task", "Lift quote (READY)"],
      ["chat", "untitled chat"],
    ]);
  });

  it("goal and mission keys together never list the same task twice", async () => {
    h.task.mockResolvedValue([{ id: "t1", title: "Lift quote", status: "READY", goalId: "g1", updatedAt: at(1) }]);
    const r = await relatedActivity({ goalId: "g1", missionId: "m1" });
    expect(r.items.filter((i) => i.ref.id === "t1")).toHaveLength(1);
  });
});

describe("relatedActivity · person (ids only, never phone or email)", () => {
  it("reads the ledger and person-linked tasks, and never the person profile", async () => {
    h.relationshipLedger.mockResolvedValue([{ id: "l1", note: "lunch, talked about the move", source: "manual", createdAt: at(3) }]);
    const r = await relatedActivity({ personId: "p1" });
    expect(h.relationshipLedger.mock.calls[0][0].where).toMatchObject({ personId: "p1" });
    expect(h.task.mock.calls[0][0].where).toMatchObject({ personId: "p1", deletedAt: null });
    expect(h.personProfile).not.toHaveBeenCalled();
    const selects = JSON.stringify([h.relationshipLedger.mock.calls[0][0].select, h.task.mock.calls[0][0].select]);
    expect(selects).not.toMatch(/phone|email|person"/i);
    expect(r.items[0]).toMatchObject({ kind: "contact", source: "manual", ref: { table: "RelationshipLedger", id: "l1" } });
  });

  it("a chat mention or a status flip is not listed as a contact", async () => {
    h.relationshipLedger.mockResolvedValue([
      { id: "l1", note: "called him", source: "manual", createdAt: at(1), metadata: null },
      { id: "l2", note: "named in chat", source: "chat", createdAt: at(2), metadata: { synthetic: true } },
      { id: "l3", note: "status cooling", source: "manual", createdAt: at(3), metadata: { kind: "status_flip" } },
    ]);
    const r = await relatedActivity({ personId: "p1" });
    expect(r.items.map((i) => i.ref.id)).toEqual(["l1"]);
  });
});
