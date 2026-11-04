/**
 * Legacy shim contract tests · v10.0.55.
 *
 * Locks the shape contract — brain modules import these and project
 * fields like `r.overallScore`, `h.habitKey`, etc. If the shim shape
 * drifts, this test fails before consumers see runtime errors.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock prisma BEFORE importing the shim
vi.mock("@/lib/prisma", () => ({
  prisma: {
    brainMemory: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
    },
    taskEvent: {
      findMany: vi.fn(async () => []),
    },
  },
}));

vi.mock("@/lib/nickstire/query", () => ({
  queryNick: vi.fn(),
}));

import {
  recentScoreSnapshots,
  recentDailyHabits,
  recentShopJobs,
  recentShopLeads,
  recentShopQuotes,
} from "@/lib/brain/legacy-shims";
import { prisma } from "@/lib/prisma";
import { queryNick } from "@/lib/nickstire/query";

describe("recentScoreSnapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses identity_snapshot JSON content into legacy score shape", async () => {
    (prisma.brainMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        content: JSON.stringify({
          score: 7,
          discipline: 6,
          energy: 8,
          focus: 7,
          workoutDone: true,
          journalDone: false,
          mood: "focused",
        }),
        updatedAt: new Date("2026-04-30T12:00:00Z"),
      },
    ]);

    const out = await recentScoreSnapshots(14);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      date: "2026-04-30",
      overallScore: 7,
      disciplineScore: 6,
      energyLevel: 8,
      focusQuality: 7,
      workoutDone: true,
      journalDone: false,
      mood: "focused",
    });
  });

  it("skips malformed snapshot rows without crashing", async () => {
    (prisma.brainMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { content: "not json", updatedAt: new Date() },
      { content: JSON.stringify({ score: 5 }), updatedAt: new Date("2026-04-29") },
    ]);
    const out = await recentScoreSnapshots(14);
    expect(out).toHaveLength(1);
    expect(out[0].overallScore).toBe(5);
  });

  it("returns empty on prisma failure (catch-handled)", async () => {
    (prisma.brainMemory.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db down"),
    );
    const out = await recentScoreSnapshots(14);
    expect(out).toEqual([]);
  });

  it("missing fields fall back to null/false", async () => {
    (prisma.brainMemory.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { content: "{}", updatedAt: new Date("2026-04-28T00:00:00Z") },
    ]);
    const out = await recentScoreSnapshots(7);
    expect(out[0]).toMatchObject({
      overallScore: null,
      disciplineScore: null,
      workoutDone: false,
      mood: null,
    });
  });
});

describe("recentDailyHabits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("synthesizes one row per day per DAILY task", async () => {
    (prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "t-workout",
        title: "workout",
        streakCount: 3,
        lastCompletedAt: new Date(),
      },
      {
        id: "t-journal",
        title: "journal",
        streakCount: 0,
        lastCompletedAt: null,
      },
    ]);

    const out = await recentDailyHabits(7);
    // 2 tasks × 7 days = 14 rows
    expect(out).toHaveLength(14);
    const workoutRows = out.filter((r) => r.habitKey === "workout");
    expect(workoutRows.filter((r) => r.completed).length).toBe(3);
    const journalRows = out.filter((r) => r.habitKey === "journal");
    expect(journalRows.every((r) => r.completed === false)).toBe(true);
  });

  // 2026-11-03 · the rows used to be the streak counted back from lastCompletedAt, so a day
  // backfilled before it (the dated check-off Nick can now write) never showed as done.
  it("reads the event ledger: a day backfilled two days before lastCompletedAt is done that day", async () => {
    const { toDateString } = await import("@/lib/utils/datetime");
    const dayAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
    (prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "h1", title: "journal", loopKind: "DAILY", streakCount: 1, lastCompletedAt: dayAgo(0) },
    ]);
    (prisma.taskEvent.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { taskId: "h1", kind: "completed", createdAt: dayAgo(2), payload: { backfilled: true } },
      { taskId: "h1", kind: "completed", createdAt: dayAgo(0), payload: {} },
    ]);
    const out = await recentDailyHabits(7);
    const doneOn = out.filter((r) => r.completed).map((r) => r.date);
    expect(doneOn).toEqual([toDateString(dayAgo(0)), toDateString(dayAgo(2))]);
  });

  it("returns empty when the ledger read fails, never a week of not-done rows", async () => {
    (prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "h1", title: "journal", loopKind: "DAILY", streakCount: 3, lastCompletedAt: new Date() },
    ]);
    (prisma.taskEvent.findMany as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("db down"));
    expect(await recentDailyHabits(7)).toEqual([]);
  });

  it("returns empty when no DAILY tasks exist", async () => {
    (prisma.task.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const out = await recentDailyHabits(14);
    expect(out).toEqual([]);
  });

  it("returns empty on prisma failure", async () => {
    (prisma.task.findMany as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("db down"),
    );
    const out = await recentDailyHabits(14);
    expect(out).toEqual([]);
  });
});

describe("recentShopJobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries recent_invoices and maps to legacy shop job format", async () => {
    const mockInvoices = [
      { id: "inv-1", totalAmount: 15000, invoiceDate: "2026-06-10T12:00:00Z" },
      { id: "inv-2", totalAmount: 25050, invoiceDate: "2026-06-09T10:00:00Z" },
    ];
    vi.mocked(queryNick).mockResolvedValue({
      data: { invoices: mockInvoices },
      query: "recent_invoices",
      timestamp: "2026-06-11T12:00:00Z",
    } as any);

    const jobs = await recentShopJobs(15);
    expect(queryNick).toHaveBeenCalledWith("recent_invoices", { days: 15 });
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toEqual({
      serviceCategory: "General",
      totalRevenue: 150,
      jobDate: new Date("2026-06-10T12:00:00Z"),
      createdAt: new Date("2026-06-10T12:00:00Z"),
    });
    expect(jobs[1].totalRevenue).toBe(250.5);
  });

  it("returns empty array on queryNick error", async () => {
    vi.mocked(queryNick).mockResolvedValue({
      error: "bridge offline",
    });

    const jobs = await recentShopJobs();
    expect(jobs).toEqual([]);
  });
});

describe("recentShopLeads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries recent_leads and maps to legacy shop lead format", async () => {
    const mockLeads = [
      { id: "lead-1", fullName: "John Doe", createdAt: "2026-06-10T12:00:00Z", status: "contacted", urgencyScore: 5, source: "chat" },
      { id: "lead-2", fullName: "Jane Smith", createdAt: "2026-06-09T10:00:00Z", status: "new", urgencyScore: 2, source: "popup" },
    ];
    vi.mocked(queryNick).mockResolvedValue({
      data: { leads: mockLeads },
      query: "recent_leads",
      timestamp: "2026-06-11T12:00:00Z",
    } as any);

    const leads = await recentShopLeads(20);
    expect(queryNick).toHaveBeenCalledWith("recent_leads", { days: 20 });
    expect(leads).toHaveLength(2);
    expect(leads[0]).toEqual({
      status: "contacted",
      urgency: "urgent",
      createdAt: new Date("2026-06-10T12:00:00Z"),
      source: "chat",
    });
    expect(leads[1]).toEqual({
      status: "new",
      urgency: "normal",
      createdAt: new Date("2026-06-09T10:00:00Z"),
      source: "popup",
    });
  });

  it("returns empty array on queryNick error", async () => {
    vi.mocked(queryNick).mockResolvedValue({
      error: "bridge timeout",
    });

    const leads = await recentShopLeads();
    expect(leads).toEqual([]);
  });
});

describe("recentShopQuotes", () => {
  it("returns empty", async () => {
    expect(await recentShopQuotes()).toEqual([]);
  });
});
