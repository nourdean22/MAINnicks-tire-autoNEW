import { prisma } from "@/lib/prisma";
import { apiHandler } from "@/lib/utils/http";

export const dynamic = "force-dynamic";

/**
 * GET /api/sync/queue/render
 * Atomically pulls the next pending video render from the social publish queue
 * and sets its status to "rendering" to prevent double-processing.
 * Auth: Bearer STATENOUR_SYNC_KEY
 */
export const GET = apiHandler(
  async () => {
    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.socialPublishQueue.findFirst({
        where: {
          status: "approved",
          kind: "reel",
          imageUrl: null,
          deletedAt: null,
        },
        orderBy: { createdAt: "asc" },
      });

      if (!item) {
        return null;
      }

      // Transition to rendering state
      return tx.socialPublishQueue.update({
        where: { id: item.id },
        data: {
          status: "rendering",
        },
      });
    });

    return {
      ok: true,
      item: updated ? {
        id: updated.id,
        content: updated.content,
        kind: updated.kind,
        sourceMetadata: updated.sourceMetadata,
      } : null,
    };
  },
  { auth: "sync" }
);
