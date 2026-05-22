/**
 * POST /api/ai/chat/wisdom-suggest · v10.0.526 · Arc B Feature 2
 *
 * At-write-time wisdom suggestion endpoint. Takes the operator's
 * current draft text and returns 1-2 wisdoms most semantically
 * relevant. Owner-gated, 800ms target wire time.
 *
 * hooks-lib REST→tRPC slice (2026-05-22) · the feed logic (the 60s
 * in-memory cache + the < 25-char / slash-command short-circuits + the
 * dismissed-id read-time filter) moved verbatim to
 * `lib/services/wisdom-suggest-feed.buildWisdomSuggestFeed` so the
 * legacy REST consumer AND the new `chat.wisdomSuggest` tRPC procedure
 * can't drift (one cache shared across both transports).
 * `useWisdomSuggest` now reads tRPC; this route stays mounted as the
 * coexistence / rollback path.
 *
 * Input:  { draft: string, dismissedIds?: string[] }
 * Output: { suggestions: [{ id, text, source, similarity }] }
 */

import { apiHandler, readRequestJson } from "@/lib/utils/http";
import { buildWisdomSuggestFeed } from "@/lib/services/wisdom-suggest-feed";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SuggestBody {
  draft?: string;
  dismissedIds?: string[];
}

export const POST = apiHandler(
  async (req) => {
    const body = await readRequestJson<SuggestBody>(req);
    return buildWisdomSuggestFeed({
      draft: typeof body.draft === "string" ? body.draft : "",
      dismissedIds: Array.isArray(body.dismissedIds)
        ? body.dismissedIds
        : undefined,
    });
  },
  { auth: "owner" },
);
