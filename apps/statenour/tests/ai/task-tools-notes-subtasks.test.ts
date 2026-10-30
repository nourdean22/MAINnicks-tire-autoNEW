/**
 * W3 (2026-10-30) · Nick can use the task notes, photos and subtasks PR 3360 added.
 *
 * Before: getTasks selected none of them, updateTask had no notes field, createTask had no
 * parentTaskId. Notes stay out of the bulk list (tests/services/task-notes-reads.test.ts): the new
 * getTaskDetails reads ONE task, and photo bytes never leave the database. Notes are Nour's own
 * writing, so an edit appends by default and never overwrites existing notes by accident.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  findMany: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  create: vi.fn(async (data: Record<string, unknown>) => ({ id: "new1", ...data })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { task: { findMany: h.findMany, findFirst: h.findFirst, findUnique: h.findFirst, update: h.update } },
}));
vi.mock("@/lib/services/tasks", () => ({
  createTaskAndEnrich: h.create,
  liftGoalOnTaskComplete: vi.fn(),
}));

import { tasksTools } from "@/lib/ai/tools/tasks";

const run = (name: keyof typeof tasksTools, input: unknown) =>
  (tasksTools[name] as unknown as { execute: (i: unknown, o?: unknown) => Promise<any> }).execute(input, {});

beforeEach(() => {
  for (const f of [h.findMany, h.findFirst, h.update, h.create]) f.mockReset();
  h.create.mockImplementation(async (data: Record<string, unknown>) => ({ id: "new1", ...data }));
});

describe("getTasks", () => {
  it("lists parent ids and photo counts, never notes", async () => {
    h.findMany.mockResolvedValueOnce([]);
    await run("getTasks", {});
    const select = h.findMany.mock.calls[0][0].select;
    expect(select.parentTaskId).toBe(true);
    expect(select._count.select.attachments.where).toEqual({ deletedAt: null });
    expect(select.notes).toBeUndefined();
  });
});

describe("getTaskDetails", () => {
  const row = {
    id: "t1", title: "Brake job follow-up", status: "READY", loopKind: "ONCE", dueDate: null,
    notes: "call back after 4", parent: { id: "p1", title: "Shop follow-ups" },
    children: [{ id: "c1", title: "order pads", status: "INBOX" }],
    attachments: [{ caption: "worn rotor", createdAt: new Date() }, { caption: null, createdAt: new Date() }],
    _count: { attachments: 35 },
  };

  it("reads one live task's notes, photos (true count + captions), parent and subtasks; never photo bytes", async () => {
    h.findFirst.mockResolvedValueOnce(row);
    const out = await run("getTaskDetails", { taskId: "t1" });
    expect(out).toMatchObject({
      found: true, notes: "call back after 4", parent: { id: "p1" },
      subtasks: [{ id: "c1" }], photos: { count: 35, captions: ["worn rotor"] },
    });
    const q = h.findFirst.mock.calls[0][0];
    expect(q.where).toEqual({ id: "t1", deletedAt: null });
    expect(q.select.attachments.select).toEqual({ caption: true, createdAt: true });
  });

  it("asks which one when a title matches several open tasks", async () => {
    h.findMany.mockResolvedValueOnce([{ ...row, title: "Brake job A" }, { ...row, id: "t2", title: "Brake job B" }]);
    const out = await run("getTaskDetails", { titleQuery: "brake" });
    expect(out.found).toBe(false);
    expect(out.reason).toContain("Brake job A | Brake job B");
  });

  it("finds a finished task by title when no open one matches", async () => {
    h.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([{ ...row, status: "DONE" }]);
    const out = await run("getTaskDetails", { titleQuery: "brake job" });
    expect(out).toMatchObject({ found: true, status: "DONE" });
    expect(h.findMany.mock.calls[1][0].where.status).toBe("DONE");
  });

  it("CONTROL: an unknown task, or an empty title, says not found", async () => {
    h.findFirst.mockResolvedValueOnce(null);
    expect(await run("getTaskDetails", { taskId: "nope" })).toEqual({ found: false, reason: "task not found" });
    expect(await run("getTaskDetails", { titleQuery: "   " })).toEqual({ found: false, reason: "task not found" });
    expect(h.findMany).not.toHaveBeenCalled();
  });
});

describe("updateTask notes never overwrite Nour's notes by accident", () => {
  const ok = { id: "t1", title: "x", loopKind: "ONCE", goalId: null, dueDate: null };

  it("appendNotes adds to the end and keeps what was there", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "t1", title: "x" }).mockResolvedValueOnce({ notes: "call back after 4" });
    h.update.mockResolvedValueOnce(ok);
    const out = await run("updateTask", { taskId: "t1", appendNotes: "parts ordered" });
    expect(h.update.mock.calls[0][0].data.notes).toBe("call back after 4\nparts ordered");
    expect(out.fieldsChanged).toContain("notes");
  });

  it("a replace of existing notes is refused unless replaceNotes, and nothing is written", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "t1", title: "x" }).mockResolvedValueOnce({ notes: "call back after 4" });
    const out = await run("updateTask", { taskId: "t1", notes: "parts ordered" });
    expect(out.success).toBe(false);
    expect(out.reason).toContain("appendNotes");
    expect(h.update).not.toHaveBeenCalled();
  });

  it("replaceNotes overwrites; notes on an empty task are just set", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "t1", title: "x" }).mockResolvedValueOnce({ notes: "old" });
    h.update.mockResolvedValueOnce(ok);
    await run("updateTask", { taskId: "t1", notes: null, replaceNotes: true });
    expect(h.update.mock.calls[0][0].data.notes).toBeNull();

    h.findFirst.mockResolvedValueOnce({ id: "t1", title: "x" }).mockResolvedValueOnce({ notes: null });
    h.update.mockResolvedValueOnce(ok);
    await run("updateTask", { taskId: "t1", notes: "first note" });
    expect(h.update.mock.calls[1][0].data.notes).toBe("first note");
  });

  it("CONTROL: an edit with no notes field leaves notes alone; a deleted task is not found", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "t1", title: "x" });
    h.update.mockResolvedValueOnce(ok);
    await run("updateTask", { taskId: "t1", title: "y" });
    expect("notes" in h.update.mock.calls[0][0].data).toBe(false);
    expect(h.findFirst.mock.calls[0][0].where).toEqual({ id: "t1", deletedAt: null });
  });
});

describe("createTask parentTaskId", () => {
  const base = { title: "order pads", nextPhysicalAction: "call the supplier", effort: "M30", context: "SHOP", loopKind: "ONCE" };

  it("files a subtask under an existing parent and reports it from the saved task", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "p1" });
    const out = await run("createTask", { ...base, parentTaskId: "p1" });
    expect(h.create.mock.calls[0][0].parentTaskId).toBe("p1");
    expect(out.parentLinked).toBe(true);
  });

  it("a parent id that does not exist is dropped and said, never FK-thrown", async () => {
    h.findFirst.mockResolvedValueOnce(null);
    const out = await run("createTask", { ...base, parentTaskId: "ghost" });
    expect(h.create.mock.calls[0][0].parentTaskId).toBeNull();
    expect(out).toMatchObject({ parentLinked: false, parentNote: expect.stringContaining("not found") });
  });

  it("an existing duplicate returned without a parent is reported as not linked", async () => {
    h.findFirst.mockResolvedValueOnce({ id: "p1" });
    h.create.mockResolvedValueOnce({ id: "dup", parentTaskId: null });
    const out = await run("createTask", { ...base, parentTaskId: "p1" });
    expect(out.parentLinked).toBe(false);
  });
});
