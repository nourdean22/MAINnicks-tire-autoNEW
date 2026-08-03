import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { listDrafts, approveDraft, rejectDraft, markScheduled } from "@/lib/content/drafts";

import type { PublishDispatchRefusal } from "@/lib/services/social-actions";

/** Transport mapping for the dispatcher's refusals. */
const REFUSAL_STATUS: Record<PublishDispatchRefusal, number> = {
  not_found: 404,
  unclaimable: 409,
  no_platforms: 400,
  not_ready: 409,
  invalid_input: 400,
};

export const dynamic = "force-dynamic";

/**
 * GET /api/sync/queue
 * Returns queue items from the social publish queue.
 * Auth: Bearer STATENOUR_SYNC_KEY
 */
export const GET = apiHandler(
  async (req) => {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status") || "all";
    const limit = parseInt(searchParams.get("limit") || "100", 10);

    const drafts = await listDrafts({ status: status as any, limit });
    return { ok: true, drafts };
  },
  { auth: "sync" }
);

/**
 * POST /api/sync/queue
 * Processes queue item mutations (approve, reject, schedule, publish, delete).
 * Auth: Bearer STATENOUR_SYNC_KEY
 */
export const POST = apiHandler(
  async (req) => {
    const body = await req.json();
    const { id, action, reason, scheduledFor } = body;

    if (!id || !action) {
      return { ok: false, error: "Missing id or action" };
    }

    if (action === "approve") {
      const draft = await approveDraft(id);
      return { ok: true, draft };
    }

    if (action === "reject") {
      await rejectDraft(id, reason);
      return { ok: true, rejected: true };
    }

    if (action === "schedule") {
      if (!scheduledFor) {
        return { ok: false, error: "Missing scheduledFor" };
      }
      await markScheduled(id, scheduledFor);
      return { ok: true, scheduled: true };
    }

    if (action === "publish") {
      // No terminal status is written here — see dispatchQueuedPublish. Let
      // dispatch failures propagate: the previous try/catch logged to the
      // console and still returned ok:true, so the caller could not tell a
      // failed publish from a successful one.
      const { dispatchQueuedPublish, PublishDispatchError } = await import(
        "@/lib/services/social-actions"
      );
      const requestHost = req.headers.get("host") || undefined;
      try {
        const item = await dispatchQueuedPublish(id, requestHost);
        // "dispatched", not "published" — the outcome lands on THIS row when
        // the worker finishes.
        return { ok: true, dispatched: true, item };
      } catch (err) {
        if (err instanceof PublishDispatchError) {
          throw new ServiceError(err.message, REFUSAL_STATUS[err.reason]);
        }
        throw err;
      }
    }

    if (action === "delete") {
      // Same guard as reject: soft-deleting a row the publish worker holds in
      // "rendering" hides a post that may already have gone live — the worker's
      // finalize does not filter deletedAt, so it still stamps published +
      // publishUrls onto a row listDrafts can no longer show. DELETE renders as
      // a button right beside REJECT, so this is the same tap away.
      const deleted = await prisma.socialPublishQueue.updateMany({
        where: { id, deletedAt: null, status: { notIn: ["rendering", "published"] } },
        data: { deletedAt: new Date() },
      });
      if (deleted.count !== 1) {
        throw new ServiceError(
          "Cannot delete a queue item that is rendering, published, or already deleted — a worker owns it.",
          409,
        );
      }
      return { ok: true, deleted: true };
    }

    return { ok: false, error: "Invalid action" };
  },
  { auth: "sync" }
);
