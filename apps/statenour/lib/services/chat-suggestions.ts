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

const log = logger.withContext({ route: "lib.services.chat-suggestions" });

const VENICE_TIMEOUT_MS = 4_000;
const VENICE_RETRY_TIMEOUT_MS = 6_000;
const MAX_VENICE_ATTEMPTS = 2;

/**
 * Venice failure-mode taxonomy · structured logging on every miss so a
 * future regression surfaces in logs immediately (the v10.0.178 fix
 * that root-caused 34/34 silent drops to heuristic fallback).
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
  timeoutMs: number,
): Promise<string[] | null> {
  const apiKey = (process.env.VENICE_API_KEY || "").trim();
  if (!apiKey) {
    log.warn("venice_suggestions_skip", {
      reason: "no-api-key" satisfies FailReason,
    });
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
              'You are a reply-suggestion generator for Nick (Nour\'s Chief of Staff AI). Given Nour\'s last message and Nick\'s reply, propose 3 short follow-ups Nour might send next. Each ≤ 48 characters. First-person from Nour. Vary: one deeper, one action, one lateral. Return JSON only: {"suggestions":["...","...","..."]}. No prose, no markdown.',
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
    choices?: Array<{
      message?: { content?: string };
      finish_reason?: string;
    }>;
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

  // Shared 3-pass extractor · free trailing-comma + single-quoted-key
  // repair so a wobbly Venice response still produces 3 suggestions.
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
  assistantMsg: string,
): Promise<{ result: string[] | null; attempts: number }> {
  let out = await veniceSuggestionsOnce(
    userMsg,
    assistantMsg,
    VENICE_TIMEOUT_MS,
  );
  if (out) return { result: out, attempts: 1 };
  if (MAX_VENICE_ATTEMPTS >= 2) {
    await new Promise((r) => setTimeout(r, 150));
    out = await veniceSuggestionsOnce(
      userMsg,
      assistantMsg,
      VENICE_RETRY_TIMEOUT_MS,
    );
    if (out) return { result: out, attempts: 2 };
  }
  return { result: null, attempts: MAX_VENICE_ATTEMPTS };
}

export interface SuggestionsArgs {
  userMessage: string;
  assistantMessage: string;
}

export interface SuggestionsResult {
  suggestions: string[];
  /** "cache" | "venice" | "heuristic" | "too-short" | "error-fallback" */
  source: string;
  cached: boolean;
  attempts: number;
  latencyMs: number;
}

/**
 * Build smart-reply suggestions · cache → Venice (×2) → heuristic.
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

    const { result: venice, attempts } = await veniceSuggestions(
      userMsg,
      assistantMsg,
    );
    const suggestions = venice ?? heuristicSuggestions(assistantMsg);
    cacheSet(key, suggestions);

    const source = venice ? "venice" : "heuristic";
    const latencyMs = Date.now() - t0;
    recordSuggestionMetric(source, latencyMs, !venice && attempts > 0);

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
