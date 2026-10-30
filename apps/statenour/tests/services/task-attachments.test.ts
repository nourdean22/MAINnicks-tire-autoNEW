/**
 * Task notes + photo attachments service (2026-10-29, task upgrades phase 2).
 *
 * Covers the server half of the contract the client cannot be trusted with:
 * the 512 KB cap, the magic-byte mime check (no PNG, no HEIC), the
 * (taskId, sha256) dedupe including the unique-violation race, soft delete,
 * and that list reads never load the image bytes. Fixtures only: no real
 * task text or photos.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const { task, taskAttachment, emitTaskEvent } = vi.hoisted(() => ({
  task: { findFirst: vi.fn(), update: vi.fn() },
  taskAttachment: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  emitTaskEvent: vi.fn(async () => undefined),
}));

const runtime = vi.hoisted(() => ({ demo: false }));
vi.mock("@/lib/runtime", () => ({
  get isDemoMode() {
    return runtime.demo;
  },
}));
const demoTasks = vi.hoisted(() => [{ id: "demo-1", notes: null as string | null }]);
vi.mock("@/lib/demo-store", () => ({ getDemoState: () => ({ tasks: demoTasks }) }));
vi.mock("@/lib/prisma", () => ({ prisma: { task, taskAttachment } }));
vi.mock("@/lib/brain/task-events", () => ({ emitTaskEvent: (a: unknown) => emitTaskEvent(a as never) }));

import {
  TASK_PHOTO_MAX_BYTES,
  TASK_NOTES_MAX_CHARS,
  sniffImageMime,
  saveTaskNotes,
  listTaskAttachments,
  addTaskAttachment,
  deleteTaskAttachment,
  readTaskAttachmentImage,
} from "@/lib/services/task-attachments";

const jpeg = (size = 64) => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};
const webp = (size = 64) => {
  const b = new Uint8Array(size);
  b.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  return b;
};
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
// An iPhone HEIC starts with a box size then "ftypheic".
const heic = () => new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);

const META = {
  id: "att1",
  taskId: "t1",
  kind: "photo",
  mimeType: "image/jpeg",
  byteSize: 64,
  width: 1600,
  height: 1200,
  sha256: "x",
  caption: null,
  createdAt: new Date("2026-10-29T12:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  runtime.demo = false;
  task.findFirst.mockResolvedValue({ id: "t1" });
});

describe("sniffImageMime", () => {
  it("accepts JPEG and WebP by their first bytes", () => {
    expect(sniffImageMime(jpeg())).toBe("image/jpeg");
    expect(sniffImageMime(webp())).toBe("image/webp");
  });
  it("rejects PNG, HEIC, empty and short input", () => {
    expect(sniffImageMime(png())).toBeNull();
    expect(sniffImageMime(heic())).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe("addTaskAttachment", () => {
  it("rejects one byte over the 512 KB cap before touching the database", async () => {
    await expect(addTaskAttachment({ taskId: "t1", bytes: jpeg(TASK_PHOTO_MAX_BYTES + 1) })).rejects.toMatchObject({
      status: 413,
    });
    expect(taskAttachment.create).not.toHaveBeenCalled();
    expect(task.findFirst).not.toHaveBeenCalled();
  });

  it("accepts exactly the cap", async () => {
    taskAttachment.findUnique.mockResolvedValue(null);
    taskAttachment.create.mockResolvedValue(META);
    await expect(addTaskAttachment({ taskId: "t1", bytes: jpeg(TASK_PHOTO_MAX_BYTES) })).resolves.toMatchObject({
      attachment: { id: "att1" },
    });
  });

  it("rejects a declared-image file whose bytes are not JPEG or WebP (415)", async () => {
    await expect(addTaskAttachment({ taskId: "t1", bytes: png() })).rejects.toMatchObject({ status: 415 });
    await expect(addTaskAttachment({ taskId: "t1", bytes: heic() })).rejects.toMatchObject({ status: 415 });
    expect(taskAttachment.create).not.toHaveBeenCalled();
  });

  it("404s on a missing or soft-deleted task", async () => {
    task.findFirst.mockResolvedValue(null);
    await expect(addTaskAttachment({ taskId: "gone", bytes: jpeg() })).rejects.toMatchObject({ status: 404 });
    expect(task.findFirst.mock.calls[0][0].where).toMatchObject({ id: "gone", deletedAt: null });
  });

  it("stores the sniffed mime, the byte size and the sha256, and returns metadata without bytes", async () => {
    taskAttachment.findUnique.mockResolvedValue(null);
    taskAttachment.create.mockResolvedValue(META);
    const res = await addTaskAttachment({ taskId: "t1", bytes: webp(100), width: 1600, height: 900 });
    const arg = taskAttachment.create.mock.calls[0][0];
    expect(arg.data).toMatchObject({ taskId: "t1", mimeType: "image/webp", byteSize: 100, width: 1600, height: 900 });
    expect(arg.data.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(arg.select.data).toBeUndefined();
    expect(res.created).toBe(true);
    expect(emitTaskEvent).toHaveBeenCalledWith(expect.objectContaining({ taskId: "t1", kind: "attachment_added" }));
  });

  it("returns the existing row for the same bytes instead of a second copy", async () => {
    taskAttachment.findUnique.mockResolvedValue({ ...META, deletedAt: null });
    const res = await addTaskAttachment({ taskId: "t1", bytes: jpeg() });
    expect(res).toMatchObject({ created: false, attachment: { id: "att1" } });
    expect(taskAttachment.create).not.toHaveBeenCalled();
  });

  it("restores a soft-deleted duplicate", async () => {
    taskAttachment.findUnique.mockResolvedValue({ ...META, deletedAt: new Date() });
    taskAttachment.update.mockResolvedValue(META);
    const res = await addTaskAttachment({ taskId: "t1", bytes: jpeg() });
    expect(taskAttachment.update.mock.calls[0][0]).toMatchObject({ where: { id: "att1" }, data: { deletedAt: null } });
    expect(res.attachment.id).toBe("att1");
  });

  it("a (task_id, sha256) unique-violation race returns the row the other request wrote", async () => {
    taskAttachment.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ ...META, deletedAt: null });
    taskAttachment.create.mockRejectedValue(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
    const res = await addTaskAttachment({ taskId: "t1", bytes: jpeg() });
    expect(res).toMatchObject({ created: false, attachment: { id: "att1" } });
  });

  it("a non-unique create failure still throws", async () => {
    taskAttachment.findUnique.mockResolvedValue(null);
    taskAttachment.create.mockRejectedValue(Object.assign(new Error("db down"), { code: "P1001" }));
    await expect(addTaskAttachment({ taskId: "t1", bytes: jpeg() })).rejects.toThrow("db down");
  });
});

describe("list, read and delete", () => {
  it("list reads select metadata only, live rows, oldest first", async () => {
    taskAttachment.findMany.mockResolvedValue([META]);
    await listTaskAttachments("t1");
    const arg = taskAttachment.findMany.mock.calls[0][0];
    // A soft-deleted task keeps its rows but serves none of them.
    expect(arg.where).toEqual({ taskId: "t1", deletedAt: null, task: { deletedAt: null } });
    expect(arg.select).toBeDefined();
    expect(arg.select.data).toBeUndefined();
  });

  it("the image read is scoped to the task and to live rows", async () => {
    taskAttachment.findFirst.mockResolvedValue(null);
    await expect(readTaskAttachmentImage("t1", "att1")).resolves.toBeNull();
    expect(taskAttachment.findFirst.mock.calls[0][0].where).toEqual({
      id: "att1",
      taskId: "t1",
      deletedAt: null,
      task: { deletedAt: null },
    });
  });

  it("delete is a soft delete and 404s when nothing live matched", async () => {
    taskAttachment.updateMany.mockResolvedValueOnce({ count: 1 });
    await deleteTaskAttachment("t1", "att1");
    expect(taskAttachment.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: "att1", taskId: "t1", deletedAt: null },
      data: { deletedAt: expect.any(Date) },
    });
    taskAttachment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(deleteTaskAttachment("t1", "att1")).rejects.toMatchObject({ status: 404 });
  });
});

describe("saveTaskNotes", () => {
  it("saves the text and returns the saved stamp", async () => {
    task.update.mockResolvedValue({ notes: "line one\nline two", updatedAt: new Date("2026-10-29T12:00:00Z") });
    const res = await saveTaskNotes("t1", "line one\nline two");
    expect(task.update.mock.calls[0][0]).toMatchObject({ where: { id: "t1" }, data: { notes: "line one\nline two" } });
    expect(res).toEqual({ notes: "line one\nline two", savedAt: "2026-10-29T12:00:00.000Z" });
  });

  it("whitespace-only clears to null", async () => {
    task.update.mockResolvedValue({ notes: null, updatedAt: new Date() });
    await saveTaskNotes("t1", "  \n ");
    expect(task.update.mock.calls[0][0].data).toEqual({ notes: null });
  });

  it("rejects text over the cap and a missing task", async () => {
    await expect(saveTaskNotes("t1", "x".repeat(TASK_NOTES_MAX_CHARS + 1))).rejects.toMatchObject({ status: 400 });
    task.findFirst.mockResolvedValue(null);
    await expect(saveTaskNotes("gone", "x")).rejects.toMatchObject({ status: 404 });
    expect(task.update).not.toHaveBeenCalled();
  });
});

describe("demo mode (no DATABASE_URL)", () => {
  it("reads are empty and photo writes refuse with a reason, without touching Prisma", async () => {
    runtime.demo = true;
    await expect(listTaskAttachments("t1")).resolves.toEqual([]);
    await expect(readTaskAttachmentImage("t1", "a1")).resolves.toBeNull();
    await expect(addTaskAttachment({ taskId: "t1", bytes: jpeg() })).rejects.toMatchObject({ status: 503 });
    await expect(deleteTaskAttachment("t1", "a1")).rejects.toMatchObject({ status: 503 });
    expect(taskAttachment.findMany).not.toHaveBeenCalled();
    expect(taskAttachment.findFirst).not.toHaveBeenCalled();
  });

  it("notes save into the demo store the inspector reads", async () => {
    runtime.demo = true;
    const res = await saveTaskNotes("demo-1", "kept in memory");
    expect(res.notes).toBe("kept in memory");
    expect(demoTasks[0].notes).toBe("kept in memory");
    expect(task.update).not.toHaveBeenCalled();
    await expect(saveTaskNotes("missing", "x")).rejects.toMatchObject({ status: 404 });
  });
});

// Open item (b): a list or summary read must never load `data` (up to 512 KB a
// row). Source scan of every taskAttachment read and every Task include.
describe("no read outside the image route loads attachment bytes", () => {
  const root = resolve(__dirname, "../..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(join(root, "lib"));
  walk(join(root, "app"));
  walk(join(root, "components"));

  it("every taskAttachment find* carries a select, and only readTaskAttachmentImage selects data", () => {
    const offenders: string[] = [];
    let reads = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/taskAttachment\.(findMany|findFirst|findUnique|findFirstOrThrow|findUniqueOrThrow)\(/g)) {
        reads++;
        const call = src.slice(m.index!, m.index! + 600);
        const fnStart = src.lastIndexOf("export async function", m.index);
        const inImageRead = /^export async function readTaskAttachmentImage\b/.test(src.slice(fnStart));
        if (!/select:/.test(call)) offenders.push(`${f}: ${m[0]} without select`);
        else if (/data:\s*true/.test(call) && !inImageRead) offenders.push(`${f}: ${m[0]} selects data`);
      }
      // Task.attachments included wholesale (chat messages have their own `attachments`).
      for (const m of src.matchAll(/\.task\.\w+\(/g)) {
        if (/attachments:\s*true/.test(src.slice(m.index!, m.index! + 600))) {
          offenders.push(`${f}: a task read includes attachments: true`);
        }
      }
    }
    expect(reads).toBeGreaterThan(0); // the scan saw the service, so a zero is not a pass
    expect(offenders).toEqual([]);
  });
});
