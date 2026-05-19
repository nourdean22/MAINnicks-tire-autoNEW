/**
 * lib/trpc/routers/chat.ts · Phase Z (2026-05-18 PM)
 *
 * Chat domain procedures · 4th domain router after `nick` (reasoning),
 * `operator` (forward-looking state), and `system` (telemetry).
 *
 * Replaces (coexistence · legacy REST stays mounted):
 *   · GET /api/chat/search → search
 *
 * Both call the same `searchChat()` service · drift impossible.
 *
 * NOTE · the chat streaming endpoint (POST /api/ai/chat) is
 * INTENTIONALLY EXCLUDED from tRPC migration per
 * `docs/migrations/J-trpc-migration.md` · SSE subscriptions need
 * WebSocket infra (separate phase scope). The chat fork/edit
 * mutations stay on REST per coexistence pattern · separate scope.
 */

import { z } from "zod";
import { router, operatorProcedure } from "../trpc";
import { searchChat } from "@/lib/services/chat-search";
import { readChatBranches } from "@/lib/services/chat-branches";

export const chatRouter = router({
  /**
   * Phase Z (2026-05-18 PM) · owner-only · full-text + ILIKE-fallback
   * search across all ChatMessage rows. Debounced from the client
   * via React Query's staleTime + per-input refetch · replaces the
   * manual debounce + setState in the legacy chat-history-search
   * component (Cmd+F overlay).
   */
  search: operatorProcedure
    .input(
      z.object({
        q: z.string().max(500),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ input }) => searchChat({ q: input.q, limit: input.limit })),

  /**
   * Phase DD (2026-05-18 PM) · owner-only · per-message sibling
   * cycle reader. Powers the MessageBranchSwitcher "‹ alt 2 of 3 ›"
   * controls on regenerated assistant messages.
   *
   * Delegates to `lib/services/chat-branches.ts` shared service ·
   * legacy REST endpoint at /api/ai/chat/branches/[parentMessageId]
   * calls the same function · drift impossible.
   *
   * Edge cases · parentMessageId not found returns empty siblings
   * array (NOT a tRPC error · caller might race the regen write).
   */
  branches: operatorProcedure
    .input(z.object({ parentMessageId: z.string().min(1).max(64) }))
    .query(async ({ input }) =>
      readChatBranches({ parentMessageId: input.parentMessageId }),
    ),
});
