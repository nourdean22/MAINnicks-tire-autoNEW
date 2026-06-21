/**
 * lib/services/chat-suggestions.ts · Phase B.5 (2026-05-22 ·
 * legacy-modernizer REST→tRPC chat slice)
 *
 * Smart-reply suggestion service · extracted from
 * `app/api/ai/chat/suggestions/route.ts` so the legacy REST endpoint
 * AND the new `trpc.chat.suggestions` query both call this single
 * function · drift between the two consumers is structurally
 * impossible. Same shared-service pattern as Z / DD / EE / GG.
 *
 * Given the last user message + the latest assistant reply, returns 3
 * terse follow-up chips. Venice with retry + heuristic fallback + 60s
 * module cache. The low-level cache / heuristic / metric primitives
 * stay in `lib/ai/suggestion-cache.ts` (shared with the chat-route
 * onFinish warm path + the stats endpoint) · this module owns the
 * Venice call + the retry loop + the orchestration the route used to
 * inline.
 *
 * Read-shaped · NO DB write (the SystemMetric write inside
 * recordSuggestionMetric is fire-and-forget telemetry, not the
 * request's purpose), so the tRPC procedure models it as a `.query()`.
 */

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
import { aiChat } from "@/lib/ai/provider";

const log = logger.withContext({ route: "lib.services.chat-suggestions" });

const AI_TIMEOUT_MS = 4_000;
const AI_RETRY_TIMEOUT_MS = 6_000;
const MAX_AI_ATTEMPTS = 2;

/**
 * AI failure-mode taxonomy · structured logging on every miss so a
 * future regression surfaces in logs immediately.
 */
type FailReason =
  | "no-api-key"
  | "fetch-error"
  | "non-2xx"
  | "no-content"
  | "no-json-match"
  | "parse-error"
  | "wrong-shape";

async function aiSuggestionsOnce(
  userMsg: string,
  assistantMsg: string,
  timeoutMs: number,
): Promise<string[] | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await aiChat(
      [
        {
          role: "system",
          content:
            'You are a reply-suggestion generator for Nick (Nour\'s Chief of Staff AI). Given Nour\'s last message and Nick\'s reply, propose 3 short follow-ups Nour might send next. Each ≤ 48 characters. First-person from Nour. Vary: one deeper, one action, one lateral. Return JSON only: {"suggestions":["...","...","..."]}. No prose, no markdown.',
        },
        {
          role: "user",
          content: `NOUR SAID:\n${userMsg.slice(-500)}\n\nNICK REPLIED:\n${assistantMsg.slice(-800)}\n\nReturn the JSON.`,
        },
      ],
      "fast",
      { signal: ctrl.signal }
    );
    clearTimeout(t);

    const raw = response.content.trim();
    if (!raw) {
      log.warn("ai_suggestions_fail", {
        reason: "no-content" satisfies FailReason,
      });
      return null;
    }

    const extracted = extractJsonObject<{ suggestions?: unknown }>(raw);
    if (!extracted.ok) {
      log.warn("ai_suggestions_fail", {
        reason: "parse-error" satisfies FailReason,
        message: extracted.error,
        rawPrefix: extracted.raw.slice(0, 120),
      });
      return null;
    }
    if (extracted.via !== "direct") {
      log.info("ai_suggestions_repaired", { via: extracted.via });
    }
    const parsed = extracted.value;

    if (!Array.isArray(parsed.suggestions)) {
      log.warn("ai_suggestions_fail", {
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
  } catch (err) {
    clearTimeout(t);
    log.warn("ai_suggestions_fail", {
      reason: "fetch-error" satisfies FailReason,
      message: sanitizeError(err),
      timeoutMs,
    });
    return null;
  }
}

async function aiSuggestions(
  userMsg: string,
  assistantMsg: string,
): Promise<{ result: string[] | null; attempts: number }> {
  let out = await aiSuggestionsOnce(
    userMsg,
    assistantMsg,
    AI_TIMEOUT_MS,
  );
  if (out) return { result: out, attempts: 1 };
  if (MAX_AI_ATTEMPTS >= 2) {
    await new Promise((r) => setTimeout(r, 150));
    out = await aiSuggestionsOnce(
      userMsg,
      assistantMsg,
      AI_RETRY_TIMEOUT_MS,
    );
    if (out) return { result: out, attempts: 2 };
  }
  return { result: null, attempts: MAX_AI_ATTEMPTS };
}

export interface SuggestionsArgs {
  userMessage: string;
  assistantMessage: string;
}

export interface SuggestionsResult {
  suggestions: string[];
  /** "cache" | "ai" | "heuristic" | "too-short" | "error-fallback" */
  source: string;
  cached: boolean;
  attempts: number;
  latencyMs: number;
}

/**
 * Build smart-reply suggestions · cache → AI (×2) → heuristic.
 * Never throws — an internal failure resolves to the error-fallback
 * triplet (the legacy route returned HTTP 200 on the catch path so
 * the chip UI never breaks).
 */
export async function buildSuggestions(
  args: SuggestionsArgs,
): Promise<SuggestionsResult> {
  const t0 = Date.now();
  try {
    const userMsg = (args.userMessage || "").trim();
    const assistantMsg = (args.assistantMessage || "").trim();

    if (!assistantMsg || assistantMsg.length < 20) {
      return {
        suggestions: [],
        source: "too-short",
        cached: false,
        attempts: 0,
        latencyMs: Date.now() - t0,
      };
    }

    const key = suggestionHashKey(userMsg, assistantMsg);
    const cached = cacheGet(key);
    if (cached) {
      const latencyMs = Date.now() - t0;
      recordSuggestionMetric("cache", latencyMs, false);
      return {
        suggestions: cached,
        source: "cache",
        cached: true,
        attempts: 0,
        latencyMs,
      };
    }

    const { result: ai, attempts } = await aiSuggestions(
      userMsg,
      assistantMsg,
    );
    const suggestions = ai ?? heuristicSuggestions(assistantMsg);
    cacheSet(key, suggestions);

    const source = ai ? "ai" : "heuristic";
    const latencyMs = Date.now() - t0;
    recordSuggestionMetric(source, latencyMs, !ai && attempts > 0);

    return { suggestions, source, cached: false, attempts, latencyMs };
  } catch {
    const latencyMs = Date.now() - t0;
    recordSuggestionMetric("error-fallback", latencyMs, false);
    return {
      suggestions: ["Go deeper", "What's the next action?", "Zoom out"],
      source: "error-fallback",
      cached: false,
      attempts: 0,
      latencyMs,
    };
  }
}
