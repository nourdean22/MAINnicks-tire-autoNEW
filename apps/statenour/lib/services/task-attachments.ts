/**
 * Task notes + photo attachments · 2026-10-29 (task upgrades phase 2).
 *
 * Schema: Task.notes and TaskAttachment (migration
 * 20261029180000_task_notes_attachments). The image bytes live in Postgres:
 * statenour has no bucket, and a new vendor is spend.
 *
 * The client resizes to 1600 px and re-encodes to WebP or JPEG (which drops
 * EXIF and GPS); nothing here trusts that. This service re-checks the size
 * cap and the format from the first bytes, so a renamed PNG or an iPhone
 * HEIC is refused whatever its declared type says.
 *
 * READ RULE: `data` is up to 512 KB a row. Every read here selects
 * ATTACHMENT_META except readTaskAttachmentImage, the one read behind the
 * owner-gated image route. tests/services/task-attachments.test.ts scans the
 * tree for any other read that loads it.
 */

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";
import { emitTaskEvent } from "@/lib/brain/task-events";

import { TASK_NOTES_MAX_CHARS, TASK_PHOTO_MAX_BYTES } from "@/lib/services/task-attachments-limits";

export { TASK_NOTES_MAX_CHARS, TASK_PHOTO_MAX_BYTES };

export type TaskPhotoMime = "image/jpeg" | "image/webp";

const ATTACHMENT_META = {
  id: true,
  taskId: true,
  kind: true,
  mimeType: true,
  byteSize: true,
  width: true,
  height: true,
  sha256: true,
  caption: true,
  createdAt: true,
} as const;

/** JPEG: FF D8 FF. WebP: "RIFF" ???? "WEBP". Anything else is refused. */
export function sniffImageMime(bytes: Uint8Array): TaskPhotoMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

async function requireLiveTask(taskId: string): Promise<void> {
  const task = await prisma.task.findFirst({ where: { id: taskId, deletedAt: null }, select: { id: true } });
  if (!task) throw new ServiceError("Task not found.", 404);
}

export async function saveTaskNotes(taskId: string, notes: string): Promise<{ notes: string | null; savedAt: string }> {
  if (notes.length > TASK_NOTES_MAX_CHARS) {
    throw new ServiceError(`Notes are capped at ${TASK_NOTES_MAX_CHARS} characters.`, 400);
  }
  await requireLiveTask(taskId);
  // Notes skip updateTask on purpose: no re-score and no entity_audits copy
  // of private free text on every autosave.
  const saved = await prisma.task.update({
    where: { id: taskId },
    data: { notes: notes.trim() ? notes : null },
    select: { notes: true, updatedAt: true },
  });
  return { notes: saved.notes, savedAt: saved.updatedAt.toISOString() };
}

export async function listTaskAttachments(taskId: string) {
  return prisma.taskAttachment.findMany({
    where: { taskId, deletedAt: null },
    orderBy: { createdAt: "asc" },
    select: ATTACHMENT_META,
  });
}

export type TaskAttachmentMeta = Awaited<ReturnType<typeof listTaskAttachments>>[number];

function pixelSize(n: number | undefined): number | null {
  return typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 10_000 ? n : null;
}

function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

/**
 * Store one photo. The same bytes on the same task are one row: a retried or
 * double-tapped upload returns the existing row (restoring it if it was
 * soft-deleted), and two concurrent uploads that both miss the lookup settle
 * on the row the winner wrote (the P2002 branch).
 */
export async function addTaskAttachment(input: {
  taskId: string;
  bytes: Uint8Array;
  width?: number;
  height?: number;
}): Promise<{ attachment: TaskAttachmentMeta; created: boolean }> {
  const { taskId, bytes } = input;
  if (bytes.length === 0) throw new ServiceError("Empty file.", 400);
  if (bytes.length > TASK_PHOTO_MAX_BYTES) {
    throw new ServiceError(`Photo is over ${TASK_PHOTO_MAX_BYTES / 1024} KB after resize.`, 413);
  }
  const mimeType = sniffImageMime(bytes);
  if (!mimeType) throw new ServiceError("Only JPEG or WebP photos are accepted.", 415);

  await requireLiveTask(taskId);
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  const findExisting = () =>
    prisma.taskAttachment.findUnique({
      where: { taskId_sha256: { taskId, sha256 } },
      select: { ...ATTACHMENT_META, deletedAt: true },
    });
  const settle = async (row: NonNullable<Awaited<ReturnType<typeof findExisting>>>) => {
    const { deletedAt, ...meta } = row;
    if (!deletedAt) return { attachment: meta, created: false };
    const restored = await prisma.taskAttachment.update({
      where: { id: row.id },
      data: { deletedAt: null },
      select: ATTACHMENT_META,
    });
    return { attachment: restored, created: false };
  };

  const existing = await findExisting();
  if (existing) return settle(existing);

  try {
    const attachment = await prisma.taskAttachment.create({
      data: {
        taskId,
        kind: "photo",
        mimeType,
        byteSize: bytes.length,
        width: pixelSize(input.width),
        height: pixelSize(input.height),
        sha256,
        data: Buffer.from(bytes),
      },
      select: ATTACHMENT_META,
    });
    await emitTaskEvent({ taskId, kind: "attachment_added", source: "page", payload: { attachmentId: attachment.id } });
    return { attachment, created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await findExisting();
    if (!winner) throw err;
    return settle(winner);
  }
}

export async function deleteTaskAttachment(taskId: string, attachmentId: string): Promise<{ ok: true }> {
  const res = await prisma.taskAttachment.updateMany({
    where: { id: attachmentId, taskId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (res.count === 0) throw new ServiceError("Photo not found.", 404);
  await emitTaskEvent({ taskId, kind: "attachment_removed", source: "page", payload: { attachmentId } });
  return { ok: true };
}

/** The ONLY read that loads `data`. Caller: the owner-gated image route. */
export async function readTaskAttachmentImage(taskId: string, attachmentId: string) {
  return prisma.taskAttachment.findFirst({
    where: { id: attachmentId, taskId, deletedAt: null },
    select: { data: true, mimeType: true, sha256: true },
  });
}
