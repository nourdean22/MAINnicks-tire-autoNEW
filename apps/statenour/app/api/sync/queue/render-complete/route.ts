import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";

/**
 * POST /api/sync/queue/render-complete
 * Receives the compiled video URL from the worker, updates the imageUrl,
 * and resets status to "approved" (or "scheduled" if scheduledFor was set).
 * Auth: Bearer STATENOUR_SYNC_KEY
 *
 * Only a row the render lane LEASED can be completed (GET /api/sync/queue/render
 * writes status "rendering" + a non-null renderLeaseExpiresAt). Anything else is
 * a 409 and stays untouched: an unconditional update let the bridge key flip a
 * published or rejected row back to approved (a duplicate post one dispatch
 * away), a pending bridge draft to scheduled, and the publish worker's in-flight
 * "rendering" row (NULL lease) back into the claim set. Audit 2026-10-10.
 */
export const POST = apiHandler(
  async (req) => {
    const body = await req.json();
    const { id, videoUrl } = body;

    if (!id || !videoUrl) {
      return { ok: false, error: "Missing id or videoUrl" };
    }

    const existing = await prisma.socialPublishQueue.findUnique({
      where: { id },
    });

    if (!existing) {
      return { ok: false, error: "Queue item not found" };
    }

    // Compare-and-set on the lease state, pinned to the scheduledFor the status
    // choice below read. Revert status to approved so it can be scheduled/published.
    const status = existing.scheduledFor ? "scheduled" : "approved";
    const completed = await prisma.socialPublishQueue.updateMany({
      where: {
        id,
        deletedAt: null,
        status: "rendering",
        renderLeaseExpiresAt: { not: null },
        scheduledFor: existing.scheduledFor,
      },
      data: {
        imageUrl: videoUrl,
        status,
        // Release the render lease. Not strictly required for correctness —
        // the claim query excludes rows with a non-null imageUrl, so a
        // completed row can never be reclaimed anyway — but leaving a stale
        // expiry behind means "has an expired lease" stops meaning "abandoned",
        // which is the one signal the reclaim logic reads. Keep the lease held
        // only while a render is actually in flight.
        renderLeaseExpiresAt: null,
        lastRenderError: null,
      },
    });
    if (completed.count !== 1) {
      throw new ServiceError(
        `Queue item is "${existing.status}" and not leased by the render lane; nothing was changed.`,
        409,
      );
    }

    return {
      ok: true,
      item: { id, imageUrl: videoUrl, status },
    };
  },
  { auth: "sync" }
);
