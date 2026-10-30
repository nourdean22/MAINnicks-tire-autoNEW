/**
 * Recall line service (2026-10-29, task upgrades phase 2). Fixtures only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  relationshipLedger: { findMany: vi.fn() },
  createTask: vi.fn(),
  resolveInboxMissionId: vi.fn(async () => "inbox-1"),
  tracedAiChat: vi.fn(),
}));
const runtime = vi.hoisted(() => ({ demo: false }));
vi.mock("@/lib/runtime", () => ({
  get isDemoMode() {
    return runtime.demo;
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: { task: m.task, relationshipLedger: m.relationshipLedger } }));
vi.mock("@/lib/services/tasks", () => ({ createTask: m.createTask }));
vi.mock("@/lib/services/missions", () => ({ resolveInboxMissionId: m.resolveInboxMissionId }));
vi.mock("@/lib/ai/traced-aichat", () => ({ tracedAiChat: m.tracedAiChat }));

import { getTaskRecallLine } from "@/lib/services/task-recall-line";

beforeEach(() => {
  vi.clearAllMocks();
  runtime.demo = false;
  m.createTask.mockImplementation(async (p: { title: string }) => ({ id: `new-${p.title}`, title: p.title, status: "READY" }));
});


describe("recall line", () => {
  it("no person on the task: nothing to show, and no ledger read", async () => {
    m.task.findFirst.mockResolvedValue({ personId: null, person: null });
    await expect(getTaskRecallLine("t1")).resolves.toEqual({ state: "none" });
    expect(m.relationshipLedger.findMany).not.toHaveBeenCalled();
  });

  it("shows the newest CONTACT ledger note for the task's person, with its date and source", async () => {
    m.task.findFirst.mockResolvedValue({ personId: "pp1", person: { name: "Fixture Person" } });
    m.relationshipLedger.findMany.mockResolvedValue([
      // Newer, but not contact: a synthetic mention and a status flip are skipped.
      { note: "mentioned in chat", source: "chat", createdAt: new Date("2026-10-29T15:00:00Z"), metadata: { synthetic: true } },
      { note: "status flip", source: "manual", createdAt: new Date("2026-10-28T15:00:00Z"), metadata: { kind: "status_flip" } },
      { note: "Asked for the quote by Friday", source: "chat", createdAt: new Date("2026-10-27T15:00:00Z"), metadata: null },
    ]);
    const res = await getTaskRecallLine("t1");
    expect(m.relationshipLedger.findMany.mock.calls[0][0]).toMatchObject({
      where: { personId: "pp1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    expect(res).toEqual({
      state: "line",
      personName: "Fixture Person",
      note: "Asked for the quote by Friday",
      source: "chat",
      at: "2026-10-27T15:00:00.000Z",
    });
  });

  it("pages past a full page of non-contact rows to the older contact row", async () => {
    m.task.findFirst.mockResolvedValue({ personId: "pp1", person: { name: "Fixture Person" } });
    const noise = Array.from({ length: 20 }, (_, i) => ({
      note: `mention ${i}`,
      source: "chat",
      createdAt: new Date("2026-10-29T15:00:00Z"),
      metadata: { synthetic: true },
    }));
    m.relationshipLedger.findMany
      .mockResolvedValueOnce(noise)
      .mockResolvedValueOnce([{ note: "Older real contact", source: "telegram", createdAt: new Date("2026-10-01T15:00:00Z"), metadata: null }]);
    const res = await getTaskRecallLine("t1");
    expect(res).toMatchObject({ state: "line", note: "Older real contact" });
    expect(m.relationshipLedger.findMany.mock.calls[1][0]).toMatchObject({ skip: 20, take: 20 });
  });

  it("demo mode shows nothing and reads nothing", async () => {
    runtime.demo = true;
    await expect(getTaskRecallLine("t1")).resolves.toEqual({ state: "none" });
    expect(m.task.findFirst).not.toHaveBeenCalled();
  });

  it("a person with no ledger rows says so instead of inventing a line", async () => {
    m.task.findFirst.mockResolvedValue({ personId: "pp1", person: { name: "Fixture Person" } });
    m.relationshipLedger.findMany.mockResolvedValue([]);
    await expect(getTaskRecallLine("t1")).resolves.toEqual({ state: "empty", personName: "Fixture Person" });
  });

  it("a failed read throws (the panel renders it as failed, never as empty)", async () => {
    m.task.findFirst.mockResolvedValue({ personId: "pp1", person: { name: "Fixture Person" } });
    m.relationshipLedger.findMany.mockRejectedValue(new Error("db down"));
    await expect(getTaskRecallLine("t1")).rejects.toThrow("db down");
  });
});
