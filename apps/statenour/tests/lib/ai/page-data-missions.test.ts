/**
 * tests/lib/ai/page-data-missions.test.ts · audit HIGH #5 · 2026-07-16.
 *
 * The /missions page (what bdnick.info/tasks redirects to) mounts
 * NickSidePane with page="missions". buildPageData had no "missions"
 * case, so it returned "" and the side-pane route substituted
 * "(no structured data available)" — Nick advised blind on the
 * operator's primary execution surface.
 *
 * These lock the contract the pane's own presets depend on:
 *   · "Which mission should I push today?"  → per-mission open counts
 *   · "Which mission is stalling?"          → stall age surfaced
 *   · "What's the next move…?"              → top action per mission
 *   · "Summarize my week so far."           → completions this week
 *
 * Plus the two data-integrity rules the audit established: system
 * anchors/Inbox are excluded (isUserProject, same predicate the UI
 * filters with) and soft-deleted rows never leak into AI grounding.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  mission: { findMany: vi.fn() },
  task: { findMany: vi.fn() },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: mocks.mission,
    task: mocks.task,
    // Unused by the "missions" case but imported at module scope.
    masteryScore: { findMany: vi.fn() },
    lifeGoal: { findMany: vi.fn() },
    auditEvent: { findFirst: vi.fn() },
    commitment: { findMany: vi.fn(), count: vi.fn() },
    brainMemory: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    journalThread: { findMany: vi.fn(), count: vi.fn() },
    journalThreadEntry: { count: vi.fn() },
    systemSnapshot: { findFirst: vi.fn() },
    bodyTracking: { findMany: vi.fn() },
    financialSnapshot: { findFirst: vi.fn() },
    masteryDecision: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/nickstire/revenue", () => ({ readNickRevenue: vi.fn(() => ({ hasToday: false })) }));
vi.mock("@/lib/brain/legacy-shims", () => ({
  recentScoreSnapshots: vi.fn(async () => []),
  recentDailyHabits: vi.fn(async () => []),
}));

import { buildPageData } from "@/lib/ai/page-data";

const NOW = new Date("2026-07-16T15:00:00Z");

function mission(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    title: "POWER ATLAS",
    domain: "BUSINESS",
    deadline: null,
    systemKind: null,
    ...over,
  };
}

function task(over: Record<string, unknown> = {}) {
  return {
    title: "ship the thing",
    status: "READY",
    missionId: "m1",
    autoPriority: 50,
    manualPriorityOverride: null,
    dueDate: null,
    lastTouchedAt: NOW,
    loopKind: "ONCE",
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

describe("buildPageData · missions", () => {
  it("returns real grounding (never the empty string that became '(no structured data available)')", async () => {
    mocks.mission.findMany.mockResolvedValue([mission()]);
    mocks.task.findMany.mockResolvedValue([task()]);

    const out = await buildPageData("missions");

    expect(out).not.toBe("");
    expect(out).toContain("POWER ATLAS");
    expect(out).toContain("1 active missions");
  });

  it("surfaces per-mission open counts and the top next action (preset: which to push / next move)", async () => {
    mocks.mission.findMany.mockResolvedValue([mission()]);
    mocks.task.findMany.mockResolvedValue([
      task({ title: "low priority chore", autoPriority: 10 }),
      task({ title: "THE URGENT ONE", autoPriority: 95 }),
    ]);

    const out = await buildPageData("missions");

    expect(out).toContain("2 open");
    // Higher effective priority wins — scoreTaskPriority is higher = more urgent.
    expect(out).toContain('next: "THE URGENT ONE"');
    expect(out).not.toContain('next: "low priority chore"');
  });

  it("honors manualPriorityOverride over autoPriority when picking the next action", async () => {
    mocks.mission.findMany.mockResolvedValue([mission()]);
    mocks.task.findMany.mockResolvedValue([
      task({ title: "auto favourite", autoPriority: 90 }),
      task({ title: "OPERATOR PICK", autoPriority: 5, manualPriorityOverride: 99 }),
    ]);

    const out = await buildPageData("missions");

    expect(out).toContain('next: "OPERATOR PICK"');
  });

  it("flags a stalled mission with its untouched age (preset: which mission is stalling)", async () => {
    mocks.mission.findMany.mockResolvedValue([mission()]);
    mocks.task.findMany.mockResolvedValue([
      task({ lastTouchedAt: new Date("2026-07-04T15:00:00Z") }), // 12d cold
    ]);

    const out = await buildPageData("missions");

    expect(out).toContain("STALLED 12d untouched");
  });

  it("does not flag a freshly touched mission as stalled", async () => {
    mocks.mission.findMany.mockResolvedValue([mission()]);
    mocks.task.findMany.mockResolvedValue([task({ lastTouchedAt: NOW })]);

    const out = await buildPageData("missions");

    expect(out).not.toContain("STALLED");
  });

  it("counts completions this week and marks an overdue deadline (presets: week summary / push today)", async () => {
    mocks.mission.findMany.mockResolvedValue([
      mission({ deadline: new Date("2026-07-10T15:00:00Z") }), // 6d past
    ]);
    mocks.task.findMany.mockResolvedValue([
      task({ status: "READY" }),
      task({ title: "shipped a", status: "DONE" }),
      task({ title: "shipped b", status: "DONE" }),
    ]);

    const out = await buildPageData("missions");

    expect(out).toContain("1 open · 2 done this week");
    expect(out).toContain("2 completed in last 7d");
    expect(out).toContain("deadline OVERDUE 6d");
  });

  it("excludes Inbox + GENERAL anchors from the mission list, and buckets their open tasks as unattached", async () => {
    mocks.mission.findMany.mockResolvedValue([
      mission(),
      mission({ id: "m-inbox", title: "Inbox" }),
      // systemKind marker is GENERAL_ANCHOR_KIND ("GENERAL") — the flag, not
      // the title, is what isUserProject keys on.
      mission({ id: "m-anchor", title: "GENERAL BUSINESS", systemKind: "GENERAL" }),
    ]);
    mocks.task.findMany.mockResolvedValue([
      task(),
      task({ title: "loose inbox item", missionId: "m-inbox" }),
      task({ title: "anchor item", missionId: "m-anchor" }),
    ]);

    const out = await buildPageData("missions");

    expect(out).toContain("1 active missions");
    expect(out).not.toContain('"Inbox"');
    expect(out).not.toContain('"GENERAL BUSINESS"');
    expect(out).toContain("Unattached/inbox (2)");
    expect(out).toContain("loose inbox item");
  });

  it("never reads soft-deleted rows, and keys 'done this week' off lastCompletedAt not updatedAt", async () => {
    mocks.mission.findMany.mockResolvedValue([mission()]);
    mocks.task.findMany.mockResolvedValue([task()]);

    await buildPageData("missions");

    expect(mocks.mission.findMany.mock.calls[0][0].where).toMatchObject({
      status: "ACTIVE",
      deletedAt: null,
    });
    const taskWhere = mocks.task.findMany.mock.calls[0][0].where;
    expect(taskWhere.deletedAt).toBeNull();
    const doneBranch = taskWhere.OR.find((b: Record<string, unknown>) => b.status === "DONE");
    expect(doneBranch.lastCompletedAt).toBeDefined();
    expect(doneBranch.updatedAt).toBeUndefined();
  });
});
