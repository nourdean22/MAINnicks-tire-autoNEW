import { createTask, listTasks } from "@/lib/services/tasks";
import { resolveInboxMissionId } from "@/lib/services/missions";
import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { logger as rootLogger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";

const log = rootLogger.withSurface("api/tasks");

export const dynamic = "force-dynamic";

// v10.0.37 — owner-gated. Pre-fix unauthed; the entire task list
// (including DOING/INBOX/DONE titles, mission ids, autoPriority
// reasoning) was readable by anyone.
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  return listTasks({
    status: url.searchParams.get("status") || undefined,
    sort: url.searchParams.get("sort") || undefined,
    missionId: url.searchParams.get("missionId") || undefined,
    // Phase B (2026-05-18) · goalId filter from /goals cross-link
    goalId: url.searchParams.get("goalId") || undefined,
  });
}, { auth: "owner" });

// v10.0.253 · narrow the POST payload type · the only fields read are
// title / missionId / priority for the Telegram notify, and createTask
// owns the strict-validation. Pre-fix used `Record<string, any>` which
// silently allowed any keys without surfacing typing problems.
type CreateTaskPayload = {
  title?: string;
  missionId?: string;
  priority?: string;
  [key: string]: unknown;
};

// v10.0.118 audit fix · POST was unauthenticated. v10.0.37 added
// auth to GET only. An unauthenticated caller could create tasks
// at will (and trigger Telegram notifications with attacker-supplied
// content). Now owner-gated to match GET.
export const POST = apiHandler(async (req) => {
  const payload = (await readRequestJson(req)) as CreateTaskPayload;

  // v10.0.529.99 · Wave 43 · default missing missionId to the resolved
  // Inbox. Pre-Wave-43 the chat long-press onCreateTask + omni-capture
  // /task fast-path POSTed without missionId and silently failed the
  // taskCreateSchema validation (required field). Operator saw a haptic
  // error toast and lost the capture. Now we backfill server-side so
  // every client that omits missionId still lands in the Inbox cleanly.
  if (!payload.missionId || typeof payload.missionId !== "string") {
    try {
      payload.missionId = await resolveInboxMissionId();
    } catch (err) {
      log.warn("missionId_default_failed", {
        title: payload.title?.slice(0, 60),
        error: sanitizeError(err),
      });
    }
  }

  const result = await createTask(payload);

  // Notify via Telegram when a task is created. v10.0.253 · errors
  // were silently swallowed pre-fix · if Telegram broke (token rotated,
  // chat deleted, network issue) we'd never know. Now logged via the
  // structured-logger surface so /system/errors picks it up.
  try {
    const { sendTelegram } = await import("@/lib/services/telegram");
    await sendTelegram(
      `📋 NEW TASK CREATED\n\n` +
      `${payload.title || "Untitled"}\n` +
      `Mission: ${payload.missionId || "Inbox"}\n` +
      `Priority: ${payload.priority || "normal"}`
    );
  } catch (err) {
    log.warn("telegram_notify_failed", {
      action: "task_created",
      title: payload.title?.slice(0, 60),
      error: sanitizeError(err),
    });
  }

  return result;
}, { auth: "owner" });
