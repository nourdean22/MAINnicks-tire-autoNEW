/**
 * lib/services/goal-checkin.ts (job 2026-11-02-nour-os-interconnect W2): the one check-in writer
 * (Nick's logGoalCheckIn tool and the goal card both call it), the card's "since last check-in"
 * read, and Nick's drafted check-in (Linear L4/L5).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  goalFindFirst: vi.fn(),
  eventFindFirst: vi.fn(),
  idempotentCreate: vi.fn(),
  updateGoal: vi.fn(),
  relatedActivity: vi.fn(),
  aiChat: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    lifeGoal: { findFirst: h.goalFindFirst },
    goalEvent: { findFirst: h.eventFindFirst },
  },
}));
vi.mock("@/lib/db/idempotency", () => ({
  idempotentCreate: h.idempotentCreate,
  mintIdempotencyKey: (o: Record<string, string>) => `key:${o.goalId}:${o.kind}:${o.day}`,
}));
vi.mock("@/lib/services/goals", () => ({ updateGoal: h.updateGoal }));
vi.mock("@/lib/services/related-activity", () => ({ relatedActivity: h.relatedActivity }));
vi.mock("@/lib/ai/provider", () => ({ aiChat: h.aiChat }));
vi.mock("@/lib/utils/datetime", async (orig) => ({ ...(await orig<object>()), today: () => "2026-11-02" }));

import {
  logGoalCheckIn,
  goalSinceCheckIn,
  draftGoalCheckIn,
  SINCE_LIST_CAP,
  DRAFT_ITEM_CAP,
} from "@/lib/services/goal-checkin";

const GOAL = { id: "goal_A", title: "Save $15k", kind: "metric", unit: "$", currentValue: 4000, targetValue: 15000, horizon: "QUARTER", createdAt: new Date("2026-09-01T12:00:00Z") };
const item = (i: number, kind = "task") => ({
  at: new Date(Date.parse("2026-11-01T12:00:00Z") - i * 3_600_000),
  kind,
  source: "task",
  title: `item ${i}`,
  ref: { table: "Task", id: `t${i}` },
});

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.goalFindFirst.mockResolvedValue(GOAL);
  h.eventFindFirst.mockResolvedValue(null);
  h.idempotentCreate.mockImplementation(async ({ data }) => ({ created: true, row: { payload: data.payload, createdAt: new Date("2026-11-02T15:00:00Z") } }));
  h.relatedActivity.mockResolvedValue({ items: [], failed: [] });
});

describe("logGoalCheckIn (the shared writer)", () => {
  it("matches the goal by id only: an id inside the note is never the target (guard canary)", async () => {
    await logGoalCheckIn({ goalId: "goal_A", health: "on_track", note: "moved goal_B forward, see goal_B", source: "goal-card" });
    expect(h.goalFindFirst).toHaveBeenCalledTimes(1);
    expect(h.goalFindFirst.mock.calls[0][0].where).toEqual({ id: "goal_A", deletedAt: null });
    const data = h.idempotentCreate.mock.calls[0][0].data;
    expect(data.goalId).toBe("goal_A");
    expect(data.source).toBe("goal-card");
  });

  it("sets a metric goal's value (SET, not add) and records it in the payload", async () => {
    const r = await logGoalCheckIn({ goalId: "goal_A", health: "at_risk", value: 5200, note: "two invoices", source: "goal-card" });
    expect(h.updateGoal).toHaveBeenCalledWith({ id: "goal_A", currentValue: 5200 });
    expect(r).toMatchObject({ logged: true, valueSet: true });
    expect(h.idempotentCreate.mock.calls[0][0].data.payload).toMatchObject({ health: "at_risk", value: 5200, day: "2026-11-02" });
  });

  it("a milestone goal ignores the value and says so", async () => {
    h.goalFindFirst.mockResolvedValue({ ...GOAL, kind: "milestone" });
    const r = await logGoalCheckIn({ goalId: "goal_A", health: "on_track", value: 3, note: "x", source: "goal-card" });
    expect(h.updateGoal).not.toHaveBeenCalled();
    expect(r).toMatchObject({ logged: true, valueSet: false });
    expect(r).toHaveProperty("valueIgnored");
  });

  it("a second check-in the same day is a duplicate, not a second row", async () => {
    h.eventFindFirst.mockResolvedValue({ payload: { health: "on_track" }, createdAt: new Date() });
    const r = await logGoalCheckIn({ goalId: "goal_A", health: "off_track", note: "x", source: "goal-card" });
    expect(r).toMatchObject({ logged: false, duplicate: true });
    expect(h.idempotentCreate).not.toHaveBeenCalled();
  });

  it("an unknown id logs nothing", async () => {
    h.goalFindFirst.mockResolvedValue(null);
    const r = await logGoalCheckIn({ goalId: "nope", health: "on_track", note: "x", source: "goal-card" });
    expect(r).toMatchObject({ logged: false });
    expect(h.idempotentCreate).not.toHaveBeenCalled();
  });
});

describe("goalSinceCheckIn (the card's list, Tana T1)", () => {
  it("reads from the last check-in, newest first, capped, and names the failed sources", async () => {
    const lastAt = new Date("2026-10-30T12:00:00Z");
    h.eventFindFirst.mockResolvedValue({ id: "ev1", createdAt: lastAt, payload: { health: "on_track" } });
    h.relatedActivity.mockResolvedValue({
      items: [...Array.from({ length: 12 }, (_, i) => item(i)), { ...item(99, "goal_event"), at: lastAt, ref: { table: "GoalEvent", id: "ev1" } }],
      failed: ["journal"],
    });
    const r = await goalSinceCheckIn("goal_A");
    expect(h.relatedActivity).toHaveBeenCalledWith({ goalId: "goal_A" }, { since: lastAt });
    expect(r.since).toBe(lastAt.toISOString());
    expect(r.items).toHaveLength(SINCE_LIST_CAP);
    expect(r.total).toBe(12); // the check-in itself is not "since" it
    expect(r.items.some((i) => i.title === "item 99")).toBe(false);
    expect(r.failed).toEqual(["journal"]);
  });

  it("with no check-in it reads from the goal's creation", async () => {
    await goalSinceCheckIn("goal_A");
    expect(h.relatedActivity.mock.calls[0][1]).toEqual({ since: GOAL.createdAt });
  });
});

describe("draftGoalCheckIn (Linear L4/L5)", () => {
  beforeEach(() => {
    h.relatedActivity.mockResolvedValue({ items: [item(0), item(1, "journal")], failed: [] });
  });

  it("names the items in one fast call and returns the parsed draft", async () => {
    h.aiChat.mockResolvedValue({ provider: "ollama", content: '{"health":"at_risk","note":"Two tasks closed; journal says the bank call slipped.","value":5200}' });
    const r = await draftGoalCheckIn("goal_A");
    expect(h.aiChat).toHaveBeenCalledTimes(1);
    const [messages, taskType] = h.aiChat.mock.calls[0];
    expect(taskType).toBe("fast");
    const prompt = messages.map((m: { content: string }) => m.content).join("\n");
    expect(prompt).toContain("item 0");
    expect(prompt).toContain("item 1");
    expect(prompt).toMatch(/never claim/i);
    // stored titles reach the prompt fenced as data (statenour-verify: every assembler names its fence)
    expect(messages[1].content).toMatch(/<tool_data[^>]*>[\s\S]*item 0[\s\S]*<\/tool_data/);
    expect(r).toMatchObject({ health: "at_risk", note: "Two tasks closed; journal says the bank call slipped.", valueSuggestion: 5200 });
  });

  it("caps the items it names", async () => {
    h.relatedActivity.mockResolvedValue({ items: Array.from({ length: 30 }, (_, i) => item(i)), failed: [] });
    h.aiChat.mockResolvedValue({ provider: "ollama", content: '{"health":"on_track","note":"ok"}' });
    await draftGoalCheckIn("goal_A");
    const prompt = h.aiChat.mock.calls[0][0].map((m: { content: string }) => m.content).join("\n");
    expect(prompt).toContain(`item ${DRAFT_ITEM_CAP - 1}`);
    expect(prompt).not.toContain(`item ${DRAFT_ITEM_CAP}\n`);
  });

  it("omits the number when it did not move (L5)", async () => {
    h.aiChat.mockResolvedValue({ provider: "ollama", content: '{"health":"on_track","note":"steady","value":4000}' });
    const r = await draftGoalCheckIn("goal_A");
    expect(r).not.toHaveProperty("valueSuggestion");
  });

  it("a non-metric goal never gets a number", async () => {
    h.goalFindFirst.mockResolvedValue({ ...GOAL, kind: "milestone" });
    h.aiChat.mockResolvedValue({ provider: "ollama", content: '{"health":"on_track","note":"steady","value":9}' });
    expect(await draftGoalCheckIn("goal_A")).not.toHaveProperty("valueSuggestion");
  });

  it("a provider sentinel returns unavailable, never a blank draft", async () => {
    h.aiChat.mockResolvedValue({ provider: "none", content: "" });
    expect(await draftGoalCheckIn("goal_A")).toMatchObject({ unavailable: true });
  });

  it("the sentinel check stands on its own: an emergency answer is never a draft, even if it parses", async () => {
    // Pinned apart from the parse layer (positive-control-first, mutation survived 2026-11-02).
    h.aiChat.mockResolvedValue({ provider: "emergency", content: '{"health":"on_track","note":"canned"}' });
    expect(await draftGoalCheckIn("goal_A")).toMatchObject({ unavailable: true });
  });

  it("an unparseable or off-list health returns unavailable", async () => {
    h.aiChat.mockResolvedValue({ provider: "ollama", content: '{"health":"great","note":"x"}' });
    expect(await draftGoalCheckIn("goal_A")).toMatchObject({ unavailable: true });
  });

  it("nothing logged since the last check-in: no model call, says so", async () => {
    h.relatedActivity.mockResolvedValue({ items: [], failed: [] });
    const r = await draftGoalCheckIn("goal_A");
    expect(h.aiChat).not.toHaveBeenCalled();
    expect(r).toMatchObject({ unavailable: true });
  });
});
