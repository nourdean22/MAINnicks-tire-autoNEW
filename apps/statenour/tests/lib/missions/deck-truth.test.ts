/**
 * Deck data truth (job 2026-10-23-bdnick-pro-rebuild, wave 1).
 *
 * Prod read 2026-10-23: 102 of 116 open tasks sat in missions that are not
 * ACTIVE (KILLED, COMPLETE anchors, a soft-deleted inbox), and the hero,
 * DECIDE and the capacity line were all built from them. These pins hold the
 * deck to one rule: a section only shows work whose mission is live, and the
 * rest becomes one counted line with its rows, never silently dropped.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mission: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
  taskEvent: { findMany: vi.fn(), findFirst: vi.fn() },
  captureInboxItem: { findMany: vi.fn(), count: vi.fn() },
  personalDailyLog: { findFirst: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({ prisma: mocks }));
vi.mock("@/lib/services/task-rescue", () => ({
  buildTaskRescue: vi.fn(async () => ({ findings: [], scannedCount: 0 })),
}));
vi.mock("@/lib/services/outcome-ledger", () => ({ recordShownBounded: vi.fn(async () => "led") }));

import { buildMissionsDeck } from "@/lib/missions/deck";
import { buildTaskRescue } from "@/lib/services/task-rescue";

const NOW = new Date("2026-10-23T15:00:00Z");
const DAY = 86_400_000;

const base = { priority: 5, roiScore: 50, neglectCost: 50, deadline: null, canonicalDomain: null, domain: "PERSONAL" };
const live = { ...base, id: "m-live", title: "Project A", status: "ACTIVE", systemKind: null };
const inbox = { ...base, id: "m-inbox2", title: "Inbox", status: "ACTIVE", systemKind: null };
const killed = { ...base, id: "m-killed", title: "Project K", status: "KILLED", systemKind: null };
const completeAnchor = { ...base, id: "m-anchor-done", title: "Anchor C", status: "COMPLETE", systemKind: "GENERAL" };
const paused = { ...base, id: "m-paused", title: "Project P", status: "PAUSED", systemKind: null };

function task(o: Record<string, unknown>) {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    title: "task",
    nextPhysicalAction: null,
    status: "READY",
    effort: "M30",
    energyRequired: "MEDIUM",
    roiScore: 50,
    frictionScore: 20,
    dueDate: null,
    lastTouchedAt: new Date(NOW.getTime() - DAY),
    lastCompletedAt: null,
    loopKind: "ONCE",
    manualPriorityOverride: null,
    waitingOn: null,
    startedAt: null,
    snoozedUntil: null,
    missionId: "m-live",
    pendingClassification: null,
    createdAt: new Date(NOW.getTime() - 5 * DAY),
    updatedAt: new Date(NOW.getTime() - DAY),
    ...o,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mission.findMany.mockResolvedValue([live, inbox, killed, completeAnchor, paused]);
  mocks.taskEvent.findMany.mockResolvedValue([]);
  mocks.taskEvent.findFirst.mockResolvedValue(null);
  mocks.captureInboxItem.findMany.mockResolvedValue([]);
  mocks.captureInboxItem.count.mockResolvedValue(0);
  mocks.personalDailyLog.findFirst.mockResolvedValue(null);
  vi.mocked(buildTaskRescue).mockResolvedValue({ findings: [], scannedCount: 0 } as never);
});

describe("deck · tasks in closed missions never drive a section", () => {
  it("only dead-mission open tasks: no next move, nothing to decide, and one counted closed line with every row", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-k1", missionId: "m-killed", dueDate: new Date(NOW.getTime() - 30 * DAY) }),
      task({ id: "t-k2", missionId: "m-killed", status: "DOING" }),
      task({ id: "t-a1", missionId: "m-anchor-done" }),
      task({ id: "t-p1", missionId: "m-paused", status: "WAITING" }),
      task({ id: "t-gone", missionId: "m-soft-deleted" }), // mission row filtered out by activeOnly
    ]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.nextMove).toBeNull();
    expect(deck.triage.totalCount).toBe(0);
    expect(deck.triage.rows).toHaveLength(0);
    expect(deck.capacity.chosenCount).toBe(0);
    expect(deck.waiting).toHaveLength(0);
    expect(deck.closed.count).toBe(5);
    expect(deck.closed.rows.map((r) => r.id).sort()).toEqual(["t-a1", "t-gone", "t-k1", "t-k2", "t-p1"]);
    expect(deck.closed.rows.find((r) => r.id === "t-gone")?.missionState).toBe("DELETED");
    expect(deck.closed.rows.find((r) => r.id === "t-k1")?.missionState).toBe("KILLED");
  });

  it("a live task still wins the hero when dead-mission tasks outscore it", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-dead", missionId: "m-killed", dueDate: new Date(NOW.getTime() - 30 * DAY) }),
      task({ id: "t-live", missionId: "m-live" }),
    ]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.nextMove?.task.id).toBe("t-live");
    expect(deck.nextMove?.alternates.map((a) => a.id)).not.toContain("t-dead");
    expect(deck.closed.count).toBe(1);
  });

  it("habits stay in Rhythms whatever their mission state, and are not counted as closed work", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-habit", missionId: "m-anchor-done", loopKind: "DAILY" }),
    ]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.rhythms.map((r) => r.id)).toEqual(["t-habit"]);
    expect(deck.closed.count).toBe(0);
  });
});

describe("deck · DECIDE counts what it shows", () => {
  it("a task that is both pending-classify and unfiled counts once", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-both", missionId: "m-inbox2", pendingClassification: { missionId: null, confidence: null } }),
    ]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.triage.totalCount).toBe(1);
    expect(deck.triage.rows).toHaveLength(1);
  });

  it("13 unfiled tasks + 1 rescue finding: the rescue row still gets a slot", async () => {
    const unfiled = Array.from({ length: 13 }, (_, i) => task({ id: `t-u${i}`, missionId: "m-inbox2" }));
    mocks.task.findMany.mockResolvedValue([...unfiled, task({ id: "t-stale", missionId: "m-live" }), task({ id: "t-hero", missionId: "m-live", dueDate: new Date(NOW.getTime() + DAY) })]);
    vi.mocked(buildTaskRescue).mockResolvedValue({
      findings: [{ taskId: "t-stale", title: "stale one", issue: "stale", reason: "untouched 30 days" }],
      scannedCount: 15,
    } as never);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.triage.rows.some((r) => r.kind === "rescue" && r.taskId === "t-stale")).toBe(true);
    expect(deck.triage.rows.length).toBeLessThanOrEqual(12);
    expect(deck.triage.totalCount).toBe(14);
  });

  it("a rescue finding about a dead-mission task is not queued", async () => {
    mocks.task.findMany.mockResolvedValue([task({ id: "t-dead", missionId: "m-killed" })]);
    vi.mocked(buildTaskRescue).mockResolvedValue({
      findings: [{ taskId: "t-dead", title: "dead", issue: "stale", reason: "x" }],
      scannedCount: 1,
    } as never);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.triage.rows).toHaveLength(0);
    expect(deck.triage.totalCount).toBe(0);
  });

  it("a classify row with no proposal never says a mission was proposed; a proposal into a closed mission is no proposal", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-none", missionId: "m-inbox2", pendingClassification: { missionId: null, confidence: null } }),
      task({ id: "t-deadprop", missionId: "m-inbox2", pendingClassification: { missionId: "m-killed", confidence: 0.55 } }),
      task({ id: "t-real", missionId: "m-inbox2", pendingClassification: { missionId: "m-live", confidence: 0.55 } }),
    ]);
    const deck = await buildMissionsDeck(NOW);
    const row = (id: string) => deck.triage.rows.find((r) => r.taskId === id);
    expect(row("t-none")?.detail ?? "").not.toMatch(/propos|suggest/i);
    expect(row("t-deadprop")?.detail ?? "").not.toMatch(/propos|suggest/i);
    expect(row("t-real")?.kind).toBe("classify");
    expect(row("t-real")?.detail ?? "").toMatch(/suggest/i);
    expect(row("t-none")?.kind).toBe("unattached");
  });
});

describe("deck · waiting, slots, one ordering brain", () => {
  it("a WAITING task with neither a snooze nor a waitingOn shows in the Waiting rail", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-limbo", status: "WAITING" }),
      task({ id: "t-snoozed", status: "WAITING", snoozedUntil: new Date(NOW.getTime() + DAY) }),
    ]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.waiting.map((w) => w.id)).toEqual(["t-limbo"]);
    expect(deck.waiting[0].waitingOn).toBe("");
  });

  it("no slot field while the WIP cap is a no-op", async () => {
    mocks.task.findMany.mockResolvedValue([]);
    const deck = await buildMissionsDeck(NOW);
    expect("missionSlotsOpen" in deck).toBe(false);
  });

  it("the deck ships one ranked order of live open tasks, led by the hero pick", async () => {
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-low", roiScore: 10 }),
      task({ id: "t-high", roiScore: 95, dueDate: new Date(NOW.getTime() + DAY) }),
      task({ id: "t-dead", missionId: "m-killed", roiScore: 99 }),
    ]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.taskOrder[0]).toBe(deck.nextMove?.task.id);
    expect(deck.taskOrder).toEqual(["t-high", "t-low"]);
  });
});

describe("deck · Codex round (PR 3257)", () => {
  it("only blocked or shop-lane open tasks: no next move and an empty Focus order", async () => {
    const shop = { ...base, id: "m-shop", title: "Shop", status: "ACTIVE", systemKind: "GENERAL", canonicalDomain: "business", domain: "BUSINESS" };
    mocks.mission.findMany.mockResolvedValue([live, shop]);
    mocks.task.findMany.mockResolvedValue([
      task({ id: "t-blocked", missionId: "m-live", waitingOn: "Supplier" }),
      task({ id: "t-shop", missionId: "m-shop" }),
    ]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.nextMove).toBeNull();
    expect(deck.focusOrder).toEqual([]);
  });

  it("a blocked unfiled task is one attention slot: counted and listed once (Waiting), not also in DECIDE", async () => {
    mocks.task.findMany.mockResolvedValue([task({ id: "t-both", missionId: "m-inbox2", waitingOn: "Supplier" })]);
    const deck = await buildMissionsDeck(NOW);
    expect(deck.waiting.map((w) => w.id)).toEqual(["t-both"]);
    expect(deck.triage.rows.map((r) => r.taskId)).not.toContain("t-both");
    expect(deck.triage.totalCount + deck.waiting.length).toBe(1);
  });
});
