/**
 * GET/POST /api/brain/recall · v10.0.91 · 2026-05-02.
 *
 * Conversational memory recall. Given a query (text or pre-computed
 * embedding), returns the top-N memories most relevant to inject
 * as chat context.
 *
 * Auth: owner only.
 */

import { apiHandler } from "@/lib/utils/http";
import { ServiceError } from "@/lib/utils/service-error";
import {
  recallMemoriesForQuery,
  formatRecallForPrompt,
} from "@/lib/brain/memory-recall";

export const GET = apiHandler(
  async (req) => {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim();
    if (!q) throw new ServiceError("q query param required", 400);
    const limit = parseInt(url.searchParams.get("limit") ?? "8", 10) || 8;
    const includePrompt = url.searchParams.get("includePrompt") === "1";
    // 2026-10-01 · `preview=1` is sent ONLY by the /brain recall preview
    // panel: inspecting what Nick would recall must not bump lastSeen (a
    // 14-day ranking boost in real chat recall) or write the recall-quality
    // metric. The chat-island inspector omits it and keeps the default.
    const preview = url.searchParams.get("preview") === "1";

    const report = await recallMemoriesForQuery(
      q,
      preview ? { limit, sideEffects: false } : { limit },
    );
    return {
      ...report,
      promptBlock: includePrompt ? formatRecallForPrompt(report.hits) : undefined,
    };
  },
  { auth: "owner" },
);

export const POST = apiHandler(
  async (req) => {
    const body = (await req.json()) as {
      q?: string;
      limit?: number;
      embedding?: number[];
      includePrompt?: boolean;
    };
    if (!body.q?.trim()) throw new ServiceError("q required", 400);
    const report = await recallMemoriesForQuery(body.q, {
      limit: body.limit,
      embedding: body.embedding,
    });
    return {
      ...report,
      promptBlock: body.includePrompt
        ? formatRecallForPrompt(report.hits)
        : undefined,
    };
  },
  { auth: "owner" },
);
