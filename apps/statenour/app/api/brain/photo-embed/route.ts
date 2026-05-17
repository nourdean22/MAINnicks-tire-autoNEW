/**
 * POST /api/brain/photo-embed · v10.0.92 · 2026-05-02.
 *
 * Body: { photoId, imageUrl, describePrompt?, description? }
 *
 * Embeds a photo into the multi-modal brain. Idempotent — second
 * call with same photoId reuses existing.
 *
 * GET /api/brain/photo-embed?q=text — searches photos by query.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { embedPhoto, searchPhotos } from "@/lib/brain/photo-embedding";

export const POST = apiHandler(
  async (req) => {
    const body = (await req.json()) as {
      photoId?: string;
      imageUrl?: string;
      describePrompt?: string;
      description?: string;
    };
    if (!body.photoId?.trim()) throw new ServiceError("photoId required", 400);
    if (!body.imageUrl?.trim() && !body.description?.trim()) {
      throw new ServiceError(
        "imageUrl or description required",
        400,
      );
    }
    const report = await embedPhoto({
      photoId: body.photoId,
      imageUrl: body.imageUrl ?? "",
      describePrompt: body.describePrompt,
      description: body.description,
    });
    return report;
  },
  { auth: "owner" },
);

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    if (!q) throw new ServiceError("q required", 400);
    const limit = parseInt(url.searchParams.get("limit") ?? "10", 10) || 10;
    const results = await searchPhotos({ query: q, limit });
    return {
      query: q,
      count: results.length,
      results,
    };
  },
  { auth: "owner" },
);
