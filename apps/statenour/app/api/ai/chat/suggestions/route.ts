import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import { buildSuggestions } from "@/lib/services/chat-suggestions";

export const runtime = "nodejs";
export const maxDuration = 10;

/**
 * SMART REPLY SUGGESTIONS
 *
 * Given the last user message + the latest assistant reply, return 3
 * terse follow-up chips. Venice with retry + heuristic fallback +
 * 60s module cache.
 *
 * Phase B.5 · the Venice call + retry loop + cache/heuristic
 * orchestration live in the shared `buildSuggestions` service ·
 * `trpc.chat.suggestions` calls the same function · drift impossible.
 *
 * Response shape:
 *   { suggestions, source, cached, attempts, latencyMs }
 *     source:   "cache" | "venice" | "heuristic" | "too-short"
 *               | "error-fallback"
 */
export async function POST(req: NextRequest) {
  await requireSession(req);
  // v10.0.529.3 D-1 fix · suggestion endpoint hits Venice on cache-miss ·
  // 10/min/IP keeps the LLM cost bounded if something starts hammering it.
  const limit = checkAiRateLimit(req);
  if (limit) return limit;

  const body = await req.json().catch((): Record<string, unknown> => ({}));
  const result = await buildSuggestions({
    userMessage: String((body as { userMessage?: unknown })?.userMessage || ""),
    assistantMessage: String(
      (body as { assistantMessage?: unknown })?.assistantMessage || "",
    ),
  });
  // buildSuggestions never throws · the error-fallback path is part of
  // its result. HTTP 200 always · feedback chips must not break the UI.
  return NextResponse.json(result);
}
