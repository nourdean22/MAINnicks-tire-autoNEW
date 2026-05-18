import { apiHandler } from "@/lib/utils/http";
import { searchChat } from "@/lib/services/chat-search";

/**
 * GET /api/chat/search?q=<query>&limit=20
 *
 * Phase Z (2026-05-18 PM) · heavy lifting moved to
 * `lib/services/chat-search.ts` so both this REST endpoint AND the
 * `trpc.chat.search` procedure call the same `searchChat()` function
 * · drift between the two consumers is structurally impossible.
 *
 * Stays mounted for back-compat with any non-tRPC consumer (curl,
 * Telegram bot, external probes).
 */
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const q = url.searchParams.get("q") || "";
  const limit = Number(url.searchParams.get("limit") || 20);
  return searchChat({ q, limit });
}, { auth: "owner" });
