/**
 * POST /api/tasks/:id/session — log a session event against an active
 * task. Apr 19.
 *
 * Types:
 *   • note    → text note / transcript (string)
 *   • photo   → base64 data URL or image URL
 *   • voice   → transcribed voice note (text) + optional audio URL
 *   • log     → progress log line
 *
 * All session events land in BrainMemory with category="task_session"
 * and a composite key `session:{taskId}:{ts}`. Metadata carries kind,
 * taskTitle, and optional attachment refs so the /tasks detail view
 * can replay the session timeline.
 *
 * GET /api/tasks/:id/session returns all session events for the task
 * ordered oldest-first, so the active-task companion can show a live
 * running log + the full /tasks detail page can render a transcript.
 *
 * Phase B.6b (2026-05-22) · the GET + POST bodies moved to
 * `lib/services/task-session.ts` so this REST handler AND the new
 * `trpc.task.{session,logSessionEvent}` procedures call the same
 * functions · drift impossible.
 */

import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import {
  getTaskSession,
  logSessionEvent,
  type LogSessionEventArgs,
} from "@/lib/services/task-session";

export const POST = apiHandler(
  async (req, { params }) => {
    const { id } = (await params) ?? { id: "" };
    if (!id) throw new ServiceError("task id required", 400);

    const body = await readRequestJson<Omit<LogSessionEventArgs, "taskId">>(
      req,
    );
    return logSessionEvent({ taskId: id, ...body });
  },
  { auth: "owner" },
);

export const GET = apiHandler(
  async (_req, { params }) => {
    const { id } = (await params) ?? { id: "" };
    if (!id) throw new ServiceError("task id required", 400);
    return getTaskSession(id);
  },
  { auth: "owner" },
);
