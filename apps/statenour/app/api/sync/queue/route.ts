import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { listDrafts, approveDraft, rejectDraft, markScheduled } from "@/lib/content/drafts";

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
      const updated = await prisma.socialPublishQueue.update({
        where: { id },
        data: {
          status: "published",
          publishedAt: new Date(),
        },
      });
      return { ok: true, published: true, item: updated };
    }

    if (action === "delete") {
      await prisma.socialPublishQueue.update({
        where: { id },
        data: {
          deletedAt: new Date(),
        },
      });
      return { ok: true, deleted: true };
    }

    return { ok: false, error: "Invalid action" };
  },
  { auth: "sync" }
);
