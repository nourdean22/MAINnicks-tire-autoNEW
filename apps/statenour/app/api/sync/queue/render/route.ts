import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

/** How long a worker may hold a claimed render before it becomes reclaimable. */
export const RENDER_LEASE_MINUTES = 30;

/** Give up after this many attempts rather than looping a poison item forever. */
export const MAX_RENDER_ATTEMPTS = 3;

/**
 * GET /api/sync/queue/render
 *
 * Atomically claims the next reel render and LEASES it.
 * Auth: Bearer STATENOUR_SYNC_KEY
 *
 * WHY A LEASE: this used to set status="rendering" and nothing else. If the
 * worker died after that write — crash, redeploy, OOM — the row stayed
 * "rendering" forever. Never re-claimed, never published, and invisible,
 * because a stuck row is indistinguishable from one being actively worked.
 * Generated content simply left the publication path.
 *
 * WHY RECLAIM IS SAFE, which is the subtle part: "rendering" is OVERLOADED.
 * lib/inngest/functions/social-publish.ts and lib/services/social-actions.ts
 * both set the SAME status to mean "publishing underway". Reclaiming any stale
 * "rendering" row would steal rows mid-publish.
 *
 * The lease columns are the discriminator. Those other paths never write a
 * lease, so their rows keep renderLeaseExpiresAt = NULL — and the reclaim
 * branch requires a non-null, EXPIRED lease. A publish-path row can therefore
 * never be picked up here, regardless of how long it sits.
 */
export const GET = apiHandler(
  async () => {
    const now = new Date();

    // Retire anything that burned through its attempts BEFORE claiming, so an
    // exhausted item cannot just vanish behind the `renderAttempts < MAX`
    // filter. A silently-excluded row is an invisible parking space — the same
    // defect this lease exists to remove, one level up.
    //
    // It lands on "rejected" rather than a new "render_failed" status on
    // purpose: a status no admin surface renders is invisible anyway. "rejected"
    // is already surfaced, and rejectionReason carries the real class.
    await prisma.socialPublishQueue.updateMany({
      where: {
        kind: "reel",
        deletedAt: null,
        status: "rendering",
        renderLeaseExpiresAt: { not: null, lt: now },
        renderAttempts: { gte: MAX_RENDER_ATTEMPTS },
      },
      data: {
        status: "rejected",
        rejectionReason: `render abandoned after ${MAX_RENDER_ATTEMPTS} claimed attempts — worker never reported completion (lease expired each time)`,
        rejectedAt: now,
        rejectedBy: "system:render-lease",
        renderLeaseExpiresAt: null,
      },
    });

    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.socialPublishQueue.findFirst({
        where: {
          kind: "reel",
          imageUrl: null,
          deletedAt: null,
          renderAttempts: { lt: MAX_RENDER_ATTEMPTS },
          OR: [
            // Fresh work.
            { status: "approved" },
            // Abandoned work: leased by THIS lane and the lease ran out.
            // `renderLeaseExpiresAt: { not: null, lt: now }` is what keeps the
            // publish path's NULL-lease rows out — do not relax it to a bare
            // `status: "rendering"`.
            {
              status: "rendering",
              renderLeaseExpiresAt: { not: null, lt: now },
            },
          ],
        },
        // Oldest first, so a reclaimed item does not starve behind new work.
        orderBy: { createdAt: "asc" },
      });

      if (!item) {
        return null;
      }

      return tx.socialPublishQueue.update({
        where: { id: item.id },
        data: {
          status: "rendering",
          renderClaimedAt: now,
          renderLeaseExpiresAt: new Date(now.getTime() + RENDER_LEASE_MINUTES * 60_000),
          // Counts CLAIMS, not failures — a worker that dies silently never
          // reports one, so failures alone could never bound the retry loop.
          renderAttempts: { increment: 1 },
        },
      });
    });

    return {
      ok: true,
      item: updated
        ? {
            id: updated.id,
            content: updated.content,
            kind: updated.kind,
            sourceMetadata: updated.sourceMetadata,
            attempt: updated.renderAttempts,
            leaseExpiresAt: updated.renderLeaseExpiresAt,
          }
        : null,
    };
  },
  { auth: "sync" }
);
