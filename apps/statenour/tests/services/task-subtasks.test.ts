/**
 * Subtask checklist service (2026-10-29, task upgrades phase 2). Fixtures only.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  task: { findFirst: vi.fn(), findMany: vi.fn() },
  relationshipLedger: { findFirst: vi.fn() },
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

import { listSubtasks, addSubtask } from "@/lib/services/task-subtasks";

beforeEach(() => {
  vi.clearAllMocks();
  runtime.demo = false;
  m.createTask.mockImplementation(async (p: { title: string }) => ({ id: `new-${p.title}`, title: p.title, status: "READY" }));
});


describe("subtasks", () => {
  it("demo mode: no list read, and adding says it needs the database", async () => {
    runtime.demo = true;
    await expect(listSubtasks("p1")).resolves.toEqual([]);
    await expect(addSubtask("p1", "x")).rejects.toMatchObject({ status: 503 });
    expect(m.task.findMany).not.toHaveBeenCalled();
  });

  it("lists live, non-archived children oldest first with three fields", async () => {
    m.task.findMany.mockResolvedValue([]);
    await listSubtasks("p1");
    const arg = m.task.findMany.mock.calls[0][0];
    expect(arg.where).toEqual({ parentTaskId: "p1", deletedAt: null, status: { not: "ARCHIVED" } });
    expect(arg.select).toEqual({ id: true, title: true, status: true });
    expect(arg.orderBy).toEqual({ createdAt: "asc" });
  });

  it("adds a child under the parent's mission, through the house create path", async () => {
    m.task.findFirst.mockResolvedValue({ id: "p1", missionId: "m1", parentTaskId: null });
    const res = await addSubtask("p1", "  Call the parts counter  ");
    expect(m.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Call the parts counter", missionId: "m1", parentTaskId: "p1", status: "READY" }),
    );
    expect(res).toEqual({ id: "new-Call the parts counter", title: "Call the parts counter", status: "READY" });
  });

  it("refuses a grandchild (one level only), a blank title and a missing parent", async () => {
    m.task.findFirst.mockResolvedValue({ id: "c1", missionId: "m1", parentTaskId: "p1" });
    await expect(addSubtask("c1", "x")).rejects.toMatchObject({ status: 400 });
    await expect(addSubtask("p1", "   ")).rejects.toMatchObject({ status: 400 });
    m.task.findFirst.mockResolvedValue(null);
    await expect(addSubtask("gone", "x")).rejects.toMatchObject({ status: 404 });
    expect(m.createTask).not.toHaveBeenCalled();
  });
});
