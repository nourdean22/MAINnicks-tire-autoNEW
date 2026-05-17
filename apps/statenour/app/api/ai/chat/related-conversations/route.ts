/**
 * GET /api/ai/chat/related-conversations · v10.0.524 · #1
 *
 * Returns the top-K past conversations semantically similar to a
 * query. Used by:
 *   · the chat history sidebar's semantic-search box
 *   · the future "Related: 3 prior threads" surface
 *   · external automation that wants to find which conversation
 *     to resume
 *
 * Query params:
 *   ?q=<string>           the search query (required, ≥4 chars)
 *   ?k=<number>           top-K, default 5, max 10
 *   ?exclude=<convId>     conversation to exclude from results
 *
 * Owner-gated. Read-only.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import { findRelatedConversations } from "@/lib/brain/conversation-recall";

export const dynamic = "force-dynamic";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    if (query.length < 4) {
      throw new ServiceError("q must be at least 4 chars", 400);
    }
    const k = Math.max(
      1,
      Math.min(10, parseInt(url.searchParams.get("k") ?? "5", 10)),
    );
    const exclude = url.searchParams.get("exclude") ?? undefined;

    const matches = await findRelatedConversations(query, k, exclude);
    return {
      query,
      count: matches.length,
      matches,
    };
  },
  { auth: "owner" },
);
