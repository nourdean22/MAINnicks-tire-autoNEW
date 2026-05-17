/**
 * GET /api/skills/suggest · v10.0.524 · #6 semantic skill recall API
 *
 * Returns the top-K Claude skills semantically similar to a query.
 * Thin wrapper over `recallSkills` from lib/skills/skill-recall.ts ·
 * exposes the recall layer so the chat composer (or external
 * automation) can surface "skill suggested" hints without
 * round-tripping through the model.
 *
 * Query params:
 *   ?q=<string>   query (required, ≥3 chars)
 *   ?k=<number>   top-K, default 3, max 10
 *
 * Owner-gated. Cached at the function level via the existing
 * 60s query-embedding cache inside skill-recall.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { recallSkills } from "@/lib/skills/skill-recall";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (query.length < 3) {
      throw new ServiceError("q must be at least 3 chars", 400);
    }
    const k = Math.max(
      1,
      Math.min(10, parseInt(url.searchParams.get("k") ?? "3", 10)),
    );

    const matches = await recallSkills(query, k);
    return {
      query,
      count: matches.length,
      skills: matches.map((s) => ({
        name: s.name,
        description: s.description,
        category: s.category,
        similarity: Number(s.similarity.toFixed(3)),
      })),
    };
  },
  { auth: "owner" },
);
