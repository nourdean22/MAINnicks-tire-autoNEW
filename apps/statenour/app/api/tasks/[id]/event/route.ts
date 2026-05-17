/**
 * POST /api/tasks/[id]/event — emit a TaskEvent from the client.
 *
 * Apr 26 · The NOW-mode review actions ("kill", "stale_flagged" tap-
 * through, "nudged" notifications) need to record explicit semantic
 * intent that's distinct from what updateTask would derive from a
 * status diff. Example: tapping the kill button on a stale chip is
 * an "I deliberately decided not to do this" signal, which the
 * avoidance detector reads. Using only the implicit "abandoned" event
 * from updateTask would lose that intent.
 *
 * Accepts a narrow set of `kind` values from the client side. Other
 * kinds are server-emitted only.
 */

import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { emitTaskEvent, type TaskEventKind } from "@/lib/brain/task-events";
import { ServiceError } from "@/lib/utils/service-error";

export const dynamic = "force-dynamic";

const CLIENT_ALLOWED: TaskEventKind[] = [
  "killed",
  "nudged",
  "stale_flagged",
  "linked",
  "unlinked",
];

export const POST = apiHandler(async (req, { params }) => {
  const { id } = await params!;
  const body = (await readRequestJson(req)) as {
    kind?: TaskEventKind;
    source?: string;
    payload?: Record<string, unknown>;
  };

  if (!body.kind || !CLIENT_ALLOWED.includes(body.kind)) {
    throw new ServiceError(
      `kind must be one of: ${CLIENT_ALLOWED.join(", ")}`,
      400,
    );
  }

  await emitTaskEvent({
    taskId: id,
    kind: body.kind,
    source: body.source ?? "client",
    payload: body.payload,
  });

  return { ok: true };
// v10.0.119 audit-pattern follow-up · was unauthenticated. Anyone
// could spam TaskEvent rows for any task id. Owner-gated.
}, { auth: "owner" });
