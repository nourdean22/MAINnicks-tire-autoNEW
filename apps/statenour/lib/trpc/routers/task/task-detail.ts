/**
 * Task detail procedures · 2026-10-29 (task upgrades phase 2): notes,
 * photo list and delete, the subtask checklist, the recall line and the voice
 * brain dump. Photo upload and the image itself are plain routes under
 * /api/tasks/[id]/attachments (a Blob cannot ride the JSON batch link).
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { operatorProcedure } from "../../trpc";
import { ServiceError } from "@/lib/utils/service-error";
import {
  TASK_NOTES_MAX_CHARS,
  saveTaskNotes,
  listTaskAttachments,
  deleteTaskAttachment,
} from "@/lib/services/task-attachments";
import { listSubtasks, addSubtask } from "@/lib/services/task-subtasks";

const id = z.string().min(1).max(64);

/** A ServiceError keeps its meaning across the wire instead of becoming a 500. */
async function mapped<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!(err instanceof ServiceError)) throw err;
    const code =
      err.status === 404 ? "NOT_FOUND" : err.status === 400 || err.status === 413 || err.status === 415 ? "BAD_REQUEST" : "INTERNAL_SERVER_ERROR";
    throw new TRPCError({ code, message: err.message });
  }
}

export const taskDetailProcedures = {
  notesSave: operatorProcedure
    .input(z.object({ id, notes: z.string().max(TASK_NOTES_MAX_CHARS) }))
    .mutation(({ input }) => mapped(() => saveTaskNotes(input.id, input.notes))),

  attachments: operatorProcedure
    .input(z.object({ taskId: id }))
    .query(({ input }) => listTaskAttachments(input.taskId)),

  attachmentDelete: operatorProcedure
    .input(z.object({ taskId: id, attachmentId: id }))
    .mutation(({ input }) => mapped(() => deleteTaskAttachment(input.taskId, input.attachmentId))),

  subtasks: operatorProcedure
    .input(z.object({ parentId: id }))
    .query(({ input }) => listSubtasks(input.parentId)),

  subtaskAdd: operatorProcedure
    .input(z.object({ parentId: id, title: z.string().max(500) }))
    .mutation(({ input }) => mapped(() => addSubtask(input.parentId, input.title))),
};
