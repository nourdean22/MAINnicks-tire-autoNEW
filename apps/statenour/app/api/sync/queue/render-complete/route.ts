import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";

/**
 * POST /api/sync/queue/render-complete
 * Receives the compiled video URL from the worker, updates the imageUrl,
 * and resets status to "approved" (or "scheduled" if scheduledFor was set).
 * Auth: Bearer STATENOUR_SYNC_KEY
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

    // Update item and revert status back to approved so it can be scheduled/published
    const updated = await prisma.socialPublishQueue.update({
      where: { id },
      data: {
        imageUrl: videoUrl,
        status: existing.scheduledFor ? "scheduled" : "approved",
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

    return {
      ok: true,
      item: {
        id: updated.id,
        imageUrl: updated.imageUrl,
        status: updated.status,
      },
    };
  },
  { auth: "sync" }
);
