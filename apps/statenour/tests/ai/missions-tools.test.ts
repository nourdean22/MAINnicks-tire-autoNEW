/**
 * tests/ai/missions-tools.test.ts — WP-3 missions coverage (2026-07-29).
 *
 * Pins the honesty contracts of the three new tools, not just their
 * happy paths: no invented percentages, no invented deadline health,
 * and a status change that reports a no-op as a no-op instead of
 * claiming work it did not do.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMissionFindFirst = vi.fn();
const mockMissionUpdate = vi.fn();
const mockTaskGroupBy = vi.fn(() => Promise.resolve([]));
const mockTaskFindMany = vi.fn(() => Promise.resolve([]));
const mockMemoryFindMany = vi.fn(() => Promise.resolve([]));
const mockAuditCreate = vi.fn(() => Promise.resolve({}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    mission: {
      findFirst: (a: unknown) => mockMissionFindFirst(a),
      update: (a: unknown) => mockMissionUpdate(a),
    },
    task: {
      groupBy: (a: unknown) => mockTaskGroupBy(a),
      findMany: (a: unknown) => mockTaskFindMany(a),
    },
    brainMemory: { findMany: (a: unknown) => mockMemoryFindMany(a) },
    auditEvent: { create: (a: unknown) => mockAuditCreate(a) },
  },
}));
vi.mock("@/lib/services/tasks", () => ({ createTaskAndEnrich: vi.fn() }));

import { missionsTools } from "@/lib/ai/tools/missions";

type Exec = (args: unknown) => Promise<Record<string, unknown>>;
const run = (name: keyof typeof missionsTools, args: unknown) =>
  (missionsTools[name] as unknown as { execute: Exec }).execute(args) as Promise<
    Record<string, unknown>
  >;

beforeEach(() => vi.clearAllMocks());

describe("getMissionDetail", () => {
  const mission = {
    id: "m1",
    title: "Ship the pricing page",
    domain: "BUSINESS",
    status: "ACTIVE",
    priority: 3,
    deadline: null,
    successMetric: "live by Friday",
    weeklyReviewNote: null,
    systemKind: null,
  };

  it("requires an identifier rather than silently listing everything", async () => {
    const r = await run("getMissionDetail", {});
    expect(r.status).toBe("no_data_found");
    expect(mockMissionFindFirst).not.toHaveBeenCalled();
  });

  it("a missing mission is no_data_found, never an empty-looking success", async () => {
    mockMissionFindFirst.mockResolvedValueOnce(null);
    expect((await run("getMissionDetail", { missionId: "nope" })).status).toBe("no_data_found");
  });

  it("computes progress from real task counts", async () => {
    mockMissionFindFirst.mockResolvedValueOnce(mission);
    mockTaskGroupBy.mockResolvedValueOnce([
      { status: "DONE", _count: { _all: 3 } },
      { status: "READY", _count: { _all: 1 } },
    ] as never);
    const r = (await run("getMissionDetail", { missionId: "m1" })) as {
      progress: { total: number; done: number; open: number; percentComplete: number | null };
    };
    expect(r.progress).toEqual({ total: 4, done: 3, open: 1, percentComplete: 75 });
  });

  it("a mission with NO tasks reports null percent — 0/0 is not 0%", async () => {
    mockMissionFindFirst.mockResolvedValueOnce(mission);
    mockTaskGroupBy.mockResolvedValueOnce([] as never);
    const r = (await run("getMissionDetail", { missionId: "m1" })) as {
      progress: { percentComplete: number | null; total: number };
    };
    expect(r.progress.total).toBe(0);
    expect(r.progress.percentComplete).toBeNull();
  });

  it("no deadline reports 'none' — absence is never rendered as on-track", async () => {
    mockMissionFindFirst.mockResolvedValueOnce(mission);
    expect((await run("getMissionDetail", { missionId: "m1" })).deadlineState).toBe("none");
  });

  it("a past deadline reports overdue, a future one upcoming", async () => {
    mockMissionFindFirst.mockResolvedValueOnce({
      ...mission,
      deadline: new Date(Date.now() - 86_400_000),
    });
    expect((await run("getMissionDetail", { missionId: "m1" })).deadlineState).toBe("overdue");
    mockMissionFindFirst.mockResolvedValueOnce({
      ...mission,
      deadline: new Date(Date.now() + 86_400_000),
    });
    expect((await run("getMissionDetail", { missionId: "m1" })).deadlineState).toBe("upcoming");
  });
});

describe("getMissionRetros", () => {
  it("reads the mission_retro category and surfaces close-time context", async () => {
    mockMemoryFindMany.mockResolvedValueOnce([
      {
        content: "Shipped late; scope crept in week 2.",
        createdAt: new Date("2026-07-01T00:00:00Z"),
        metadata: { missionTitle: "Pricing page", taskCount: 9, openCount: 2 },
      },
    ] as never);
    const r = (await run("getMissionRetros", { limit: 5 })) as unknown as Array<
      Record<string, unknown>
    >;
    expect(mockMemoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ category: "mission_retro" }) }),
    );
    expect(r[0].missionTitle).toBe("Pricing page");
    expect(r[0].openAtClose).toBe(2);
  });

  it("missing metadata degrades to nulls, never invented values", async () => {
    mockMemoryFindMany.mockResolvedValueOnce([
      { content: "lesson", createdAt: new Date(), metadata: null },
    ] as never);
    const r = (await run("getMissionRetros", { limit: 1 })) as unknown as Array<
      Record<string, unknown>
    >;
    expect(r[0].missionTitle).toBeNull();
    expect(r[0].tasksAtClose).toBeNull();
  });
});

describe("updateMissionStatus", () => {
  it("an unknown mission is no_data_found and writes nothing", async () => {
    mockMissionFindFirst.mockResolvedValueOnce(null);
    expect((await run("updateMissionStatus", { missionId: "x", status: "COMPLETE" })).status).toBe(
      "no_data_found",
    );
    expect(mockMissionUpdate).not.toHaveBeenCalled();
  });

  it("setting the SAME status reports changed:false — no claimed work", async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: "m1", title: "T", status: "PAUSED" });
    const r = await run("updateMissionStatus", { missionId: "m1", status: "PAUSED" });
    expect(r.changed).toBe(false);
    expect(mockMissionUpdate).not.toHaveBeenCalled();
  });

  it("a real transition updates, records both ends, and writes an audit row", async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: "m1", title: "T", status: "ACTIVE" });
    mockMissionUpdate.mockResolvedValueOnce({ id: "m1", title: "T", status: "COMPLETE" });
    const r = await run("updateMissionStatus", { missionId: "m1", status: "COMPLETE", note: "shipped" });
    expect(r).toMatchObject({ changed: true, previousStatus: "ACTIVE", status: "COMPLETE" });
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ eventType: "mission_status_changed" }),
      }),
    );
  });

  it("an audit-write failure does not fail the status change (loud, not fatal)", async () => {
    mockMissionFindFirst.mockResolvedValueOnce({ id: "m1", title: "T", status: "ACTIVE" });
    mockMissionUpdate.mockResolvedValueOnce({ id: "m1", title: "T", status: "KILLED" });
    mockAuditCreate.mockRejectedValueOnce(new Error("audit down"));
    expect((await run("updateMissionStatus", { missionId: "m1", status: "KILLED" })).changed).toBe(
      true,
    );
  });
});
