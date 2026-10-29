/**
 * Recall line service (2026-10-29, task upgrades phase 2). Fixtures only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  relationshipLedger: { findFirst: vi.fn() },
  createTask: vi.fn(),
  resolveInboxMissionId: vi.fn(async () => "inbox-1"),
  tracedAiChat: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: { task: m.task, relationshipLedger: m.relationshipLedger } }));
vi.mock("@/lib/services/tasks", () => ({ createTask: m.createTask }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: m.resolveInboxMissionId }));
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: m.tracedAiChat }));

import { getTaskRecallLine } from "@/lib/services/task-recall-line";

beforeEach(() => {
  vi.clearAllMocks();
  m.createTask.mockImplementation(async (p: { title: string }) => ({ id: `new-${p.title}`, title: p.title, status: "READY" }));
});


describe("recall line", () => {
  it("no person on the task: nothing to show, and no ledger read", async () => {
    m.task.findFirst.mockResolvedValue({ personId: null, person: null });
    await expect(getTaskRecallLine("t1")).resolves.toEqual({ state: "none" });
    expect(m.relationshipLedger.findFirst).not.toHaveBeenCalled();
  });

  it("shows the newest ledger note for the task's person, with its date and source", async () => {
    m.task.findFirst.mockResolvedValue({ personId: "pp1", person: { name: "Fixture Person" } });
    m.relationshipLedger.findFirst.mockResolvedValue({
      note: "Asked for the quote by Friday",
      source: "chat",
      createdAt: new Date("2026-10-27T15:00:00Z"),
    });
    const res = await getTaskRecallLine("t1");
    expect(m.relationshipLedger.findFirst.mock.calls[0][0]).toMatchObject({
      where: { personId: "pp1" },
      orderBy: { createdAt: "desc" },
    });
    expect(res).toEqual({
      state: "line",
      personName: "Fixture Person",
      note: "Asked for the quote by Friday",
      source: "chat",
      at: "2026-10-27T15:00:00.000Z",
    });
  });

  it("a person with no ledger rows says so instead of inventing a line", async () => {
    m.task.findFirst.mockResolvedValue({ personId: "pp1", person: { name: "Fixture Person" } });
    m.relationshipLedger.findFirst.mockResolvedValue(null);
    await expect(getTaskRecallLine("t1")).resolves.toEqual({ state: "empty", personName: "Fixture Person" });
  });

  it("a failed read throws (the panel renders it as failed, never as empty)", async () => {
    m.task.findFirst.mockResolvedValue({ personId: "pp1", person: { name: "Fixture Person" } });
    m.relationshipLedger.findFirst.mockRejectedValue(new Error("db down"));
    await expect(getTaskRecallLine("t1")).rejects.toThrow("db down");
  });
});
