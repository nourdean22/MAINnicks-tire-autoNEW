/**
 * GET /api/system/brain-bus-events · v10.0.21 · Apr 30.
 *
 * Owner-gated tail of the durable brain-bus. Pairs with the
 * /system/brain-bus dashboard's 2s-poll loop.
 *
 * Query params:
 *   ?sinceId  cursor — only return rows newer than this id
 *   ?limit    1-200 (default 50)
 *   ?topic    filter by exact topic
 */

import { apiHandler } from "@/lib/utils/http";
import { tailEvents } from "@/lib/db/brain-bus-tail";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const sinceId = url.searchParams.get("sinceId") || undefined;
    const topic = url.searchParams.get("topic") || undefined;
    const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
    const limit = Number.isFinite(limitParam)
      ? Math.max(1, Math.min(limitParam, 200))
      : 50;

    const result = await tailEvents({ sinceId, limit, topic });

    return {
      generatedAt: new Date().toISOString(),
      cursor: result.cursor,
      windowCounts: result.windowCounts,
      events: result.events.map((e) => ({
        ...e,
        createdAt: e.createdAt.toISOString(),
        processedAt: e.processedAt?.toISOString() ?? null,
        availableAt: e.availableAt.toISOString(),
      })),
    };
  },
  { auth: "owner" }, // v9.1.14 sensitive-GET gate
);
