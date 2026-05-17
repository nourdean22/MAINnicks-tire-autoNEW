import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth-guard";
import { checkAiRateLimit } from "@/lib/rate-limit";
import {
  cacheGet,
  cacheSet,
  heuristicSuggestions,
  recordSuggestionMetric,
  suggestionHashKey,
} from "@/lib/ai/suggestion-cache";
import { extractJsonObject } from "@/lib/ai/extract-structured";
import { logger } from "@/lib/logger";
import { sanitizeError } from "@/lib/utils/sanitize-error";

export const runtime = "nodejs";
export const maxDuration = 10;

const log = logger.withContext({ route: "api.ai.chat.suggestions" });

/**
 * SMART REPLY SUGGESTIONS
 *
 * Given the last user message + the latest assistant reply, return 3
 * terse follow-up chips. Venice with retry + heuristic fallback +
 * 60s module cache. See lib/ai/suggestion-cache.ts for the shared
 * cache/metrics primitives.
 *
 * Response shape:
 *   { suggestions, source, cached, attempts, latencyMs }
 *     source:   "cache" | "venice" | "heuristic" | "error-fallback"
 */

const VENICE_TIMEOUT_MS = 4_000;
const VENICE_RETRY_TIMEOUT_MS = 6_000;
const MAX_VENICE_ATTEMPTS = 2;

/**
 * v10.0.178 · Venice suggestions root-cause fix.
 *
 * Live probe revealed Venice was returning 200 OK with EMPTY content
 * and finish_reason="length". Why: the heretic model reasons inside
 * <think> tags before answering. With max_tokens=180, the model
 * burned the full budget on internal reasoning and emitted nothing
 * visible. strip_thinking_response then yielded "".
 *
 * 34/34 calls in 6h were silently dropping to heuristic fallback —
 * the operator paid 5-8s timeout cost on EVERY chat turn for chips
 * that never came from the model.
 *
 * Three changes here, each addressing a specific failure surface:
 *
 *   1. venice_parameters.disable_thinking: true
 *      Eliminates the <think> burn entirely. Suggestions don't need
 *      reasoning — just three short strings in JSON.
 *
 *   2. max_tokens: 180 → 300
 *      Cushion in case the model ever decides to think anyway. The
 *      response itself is ~30 tokens; 300 is comfortable headroom.
 *
 *   3. Structured logging on every failure mode
 *      The previous `catch { return null }` swallowed ALL errors.
 *      Now: log status code, body excerpt, finish_reason, content
 *      length per failure. Future regressions surface in logs
 *      immediately instead of going silent for days.
 */
type FailReason =
  | "no-api-key"
  | "fetch-error"
  | "non-2xx"
  | "no-content"
  | "no-json-match"
  | "parse-error"
  | "wrong-shape";

async function veniceSuggestionsOnce(
  userMsg: string,
  assistantMsg: string,
  timeoutMs: number
): Promise<string[] | null> {
  const apiKey = (process.env.VENICE_API_KEY || "").trim();
  if (!apiKey) {
    log.warn("venice_suggestions_skip", { reason: "no-api-key" satisfies FailReason });
    return null;
  }
  const model =
    (process.env.VENICE_MODEL || "").trim() ||
    "olafangensan-glm-4.7-flash-heretic";

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch("https://api.venice.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are a reply-suggestion generator for Nick (Nour's Chief of Staff AI). Given Nour's last message and Nick's reply, propose 3 short follow-ups Nour might send next. Each ≤ 48 characters. First-person from Nour. Vary: one deeper, one action, one lateral. Return JSON only: {\"suggestions\":[\"...\",\"...\",\"...\"]}. No prose, no markdown.",
          },
          {
            role: "user",
            content: `NOUR SAID:\n${userMsg.slice(-500)}\n\nNICK REPLIED:\n${assistantMsg.slice(-800)}\n\nReturn the JSON.`,
          },
        ],
        temperature: 0.6,
        max_tokens: 300,
        venice_parameters: {
          include_venice_system_prompt: false,
          strip_thinking_response: true,
          disable_thinking: true,
          enable_web_search: "off",
        },
      }),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(t);
    log.warn("venice_suggestions_fail", {
      reason: "fetch-error" satisfies FailReason,
      message: sanitizeError(err),
      timeoutMs,
    });
    return null;
  }
  clearTimeout(t);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    log.warn("venice_suggestions_fail", {
      reason: "non-2xx" satisfies FailReason,
      status: res.status,
      bodyPrefix: body.slice(0, 200),
    });
    return null;
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  };
  const choice = data?.choices?.[0];
  const raw = (choice?.message?.content || "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

  if (!raw) {
    log.warn("venice_suggestions_fail", {
      reason: "no-content" satisfies FailReason,
      finishReason: choice?.finish_reason ?? "unknown",
    });
    return null;
  }

  // v10.0.228 · use the shared 3-pass extractor instead of inline
  // regex+JSON.parse. Adds free trailing-comma + single-quoted-key
  // repair so a wobbly Venice response still produces 3 suggestions.
  // Pre-fix this code branched into 3 distinct fail-reason warnings
  // (no-json-match / parse-error / wrong-shape); now collapsed to
  // one parse-error log + one wrong-shape log post-extract.
  const extracted = extractJsonObject<{ suggestions?: unknown }>(raw);
  if (!extracted.ok) {
    log.warn("venice_suggestions_fail", {
      reason: "parse-error" satisfies FailReason,
      message: extracted.error,
      rawPrefix: extracted.raw.slice(0, 120),
    });
    return null;
  }
  if (extracted.via !== "direct") {
    log.info("venice_suggestions_repaired", { via: extracted.via });
  }
  const parsed = extracted.value;

  if (!Array.isArray(parsed.suggestions)) {
    log.warn("venice_suggestions_fail", {
      reason: "wrong-shape" satisfies FailReason,
      keys: parsed && typeof parsed === "object" ? Object.keys(parsed) : [],
    });
    return null;
  }

  const clean = parsed.suggestions
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim().replace(/^[-•*]\s*/, "").slice(0, 60))
    .filter((s) => s.length > 0)
    .slice(0, 3);
  return clean.length === 3 ? clean : null;
}

async function veniceSuggestions(
  userMsg: string,
  assistantMsg: string
): Promise<{ result: string[] | null; attempts: number }> {
  let out = await veniceSuggestionsOnce(userMsg, assistantMsg, VENICE_TIMEOUT_MS);
  if (out) return { result: out, attempts: 1 };
  if (MAX_VENICE_ATTEMPTS >= 2) {
    await new Promise((r) => setTimeout(r, 150));
    out = await veniceSuggestionsOnce(userMsg, assistantMsg, VENICE_RETRY_TIMEOUT_MS);
    if (out) return { result: out, attempts: 2 };
  }
  return { result: null, attempts: MAX_VENICE_ATTEMPTS };
}

export async function POST(req: NextRequest) {
  await requireSession(req);
  // v10.0.529.3 D-1 fix · suggestion endpoint hits Venice on cache-miss ·
  // 10/min/IP keeps the LLM cost bounded if something starts hammering it.
  const limit = checkAiRateLimit(req);
  if (limit) return limit;
  const t0 = Date.now();
  try {
    const body = await req.json();
    const userMsg = String(body?.userMessage || "").trim();
    const assistantMsg = String(body?.assistantMessage || "").trim();

    if (!assistantMsg || assistantMsg.length < 20) {
      return NextResponse.json({ suggestions: [], source: "too-short" });
    }

    const key = suggestionHashKey(userMsg, assistantMsg);
    const cached = cacheGet(key);
    if (cached) {
      const latencyMs = Date.now() - t0;
      recordSuggestionMetric("cache", latencyMs, false);
      return NextResponse.json({
        suggestions: cached,
        source: "cache",
        cached: true,
        attempts: 0,
        latencyMs,
      });
    }

    const { result: venice, attempts } = await veniceSuggestions(userMsg, assistantMsg);
    const suggestions = venice ?? heuristicSuggestions(assistantMsg);
    cacheSet(key, suggestions);

    const source = venice ? "venice" : "heuristic";
    const latencyMs = Date.now() - t0;
    recordSuggestionMetric(source, latencyMs, !venice && attempts > 0);

    return NextResponse.json({
      suggestions,
      source,
      cached: false,
      attempts,
      latencyMs,
    });
  } catch (err) {
    const latencyMs = Date.now() - t0;
    recordSuggestionMetric("error-fallback", latencyMs, false);
    return NextResponse.json(
      {
        suggestions: ["Go deeper", "What's the next action?", "Zoom out"],
        source: "error-fallback",
        cached: false,
        attempts: 0,
        latencyMs,
        error: err instanceof Error ? err.message : "unknown",
      },
      { status: 200 }
    );
  }
}
