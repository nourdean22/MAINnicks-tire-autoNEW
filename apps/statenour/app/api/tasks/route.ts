/**
 * GET /api/tasks — owner-only · filtered task list
 * POST /api/tasks — owner-only · create task with inbox-default + Telegram notify
 *
 * Phase PP (2026-05-19 AM) · GET migrated to `trpc.task.list` · this
 * REST handler stays mounted for back-compat (calls the same
 * `listTasks` service · drift impossible).
 *
 * Phase SS (2026-05-19 AM) · POST migrated to `trpc.task.create` ·
 * the inbox-default + create + Telegram notify logic moved to
 * `lib/services/task-actions.createTaskFromAPI` so both the REST
 * handler AND the new tRPC mutation call the same function.
 */
import { listTasks } from "@/lib/services/tasks";
import { createTaskFromAPI } from "@/lib/services/task-actions";
import { apiHandler, readRequestJson } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  return listTasks({
    status: url.searchParams.get("status") || undefined,
    sort: url.searchParams.get("sort") || undefined,
    missionId: url.searchParams.get("missionId") || undefined,
    goalId: url.searchParams.get("goalId") || undefined,
  });
}, { auth: "owner" });

export const POST = apiHandler(async (req) => {
  const payload = (await readRequestJson(req)) as Record<string, unknown>;
  return createTaskFromAPI(payload);
}, { auth: "owner" });
