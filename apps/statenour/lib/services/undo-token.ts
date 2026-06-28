/**
 * lib/services/undo-token.ts · cross-domain residuals slice
 * (2026-05-22 · legacy-modernizer REST→tRPC · chat cross-domain
 * residuals).
 *
 * One-shot undo for chat-driven mutating tools · lifted verbatim from
 * app/api/undo/[token]/route.ts so the legacy REST endpoint AND the new
 * `task.undo` tRPC procedure call the SAME function · drift between
 * consumers structurally impossible.
 *
 * After every undo-able tool execute() captures the pre-mutation state
 * into a BrainMemory row (category="undo_token", expiresAt=now+30s).
 * Tapping the ToolResultCard's undo affordance reverts it.
 *
 * Idempotent · a second consume of the same token finds the consumedAt
 * marker and returns `{ ok, alreadyUndone }` without re-running the
 * revert. Errors are signalled via `ServiceError` (400 malformed · 404
 * not-found-or-expired) so the tRPC procedure can map them to
 * BAD_REQUEST / NOT_FOUND — both transports reject identically.
 *
 * Returns an explicit, shallow `UndoResult` — the BrainMemory `content`
 * is a JSON string the service itself parses · no Prisma Json column
 * reaches the AppRouter · the TS2589 firewall is satisfied trivially.
 */

import { prisma } from "@/lib/prisma";
import { ServiceError } from "@/lib/utils/service-error";

/** Result of consuming an undo token. */
export interface UndoResult {
  ok: true;
  /** true when the token was already consumed by a prior call. */
  alreadyUndone?: boolean;
  /** true when this call performed the revert. */
  undone?: boolean;
  toolName?: "snoozeTask" | "archiveGoal" | "person.create";
  entityId?: string;
}

interface UndoPayload {
  toolName: "snoozeTask" | "archiveGoal" | "person.create";
  taskId?: string;
  goalId?: string;
  personId?: string;
  originalStatus?: string;
}

/**
 * Consume a single-use undo token · revert the captured mutation. The
 * REST route and the tRPC `task.undo` procedure both call this.
 *
 * @throws ServiceError(400) · malformed token / payload
 * @throws ServiceError(404) · token not found OR expired
 */
export async function consumeUndoToken(token: string): Promise<UndoResult> {
  if (!token || typeof token !== "string" || token.length < 8) {
    throw new ServiceError("invalid token", 400);
  }

  const row = await prisma.brainMemory.findFirst({
    where: { category: "undo_token", key: token },
    select: { id: true, content: true, expiresAt: true, deletedAt: true },
  });

  if (!row) {
    throw new ServiceError("token not found", 404);
  }

  // Already consumed · idempotent return.
  if (row.deletedAt) {
    return { ok: true, alreadyUndone: true };
  }

  // Expired (>30s old · cron / next reads clean these up).
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) {
    throw new ServiceError("token expired", 404);
  }

  let payload: UndoPayload;
  try {
    payload = JSON.parse(row.content) as UndoPayload;
  } catch {
    throw new ServiceError("malformed token payload", 400);
  }

  // Dispatch revert by toolName · each branch is small + idempotent.
  switch (payload.toolName) {
    case "snoozeTask": {
      if (!payload.taskId) {
        throw new ServiceError("missing taskId", 400);
      }
      await prisma.task.update({
        where: { id: payload.taskId },
        data: {
          status: payload.originalStatus as
            | "INBOX"
            | "READY"
            | "DOING"
            | "WAITING"
            | "DONE",
          snoozedUntil: null,
          lastTouchedAt: new Date(),
        },
      });
      break;
    }
    case "archiveGoal": {
      if (!payload.goalId) {
        throw new ServiceError("missing goalId", 400);
      }
      if (!payload.originalStatus) {
        throw new ServiceError("missing originalStatus", 400);
      }
      await prisma.lifeGoal.update({
        where: { id: payload.goalId },
        data: {
          status: payload.originalStatus,
          deletedAt: null,
          updatedAt: new Date(),
        },
      });
      break;
    }
    case "person.create": {
      if (!payload.personId) {
        throw new ServiceError("missing personId", 400);
      }
      await prisma.personProfile.delete({
        where: { id: payload.personId },
      });
      break;
    }
    default: {
      throw new ServiceError(
        `unsupported toolName: ${String(payload.toolName)}`,
        400,
      );
    }
  }

  // Mark token consumed · subsequent calls hit the alreadyUndone branch.
  await prisma.brainMemory
    .update({ where: { id: row.id }, data: { deletedAt: new Date() } })
    .catch(() => null);

  return {
    ok: true,
    undone: true,
    toolName: payload.toolName,
    entityId: payload.taskId ?? payload.goalId ?? payload.personId,
  };
}
