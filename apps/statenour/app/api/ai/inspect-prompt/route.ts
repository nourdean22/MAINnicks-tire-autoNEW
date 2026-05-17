/**
 * GET /api/ai/inspect-prompt
 *
 * Returns the exact system prompt that would be sent to the AI on
 * the next message, including cache status, word count, and rough
 * token estimate. Used by the PromptInspector modal in the chat UI
 * and the Settings page.
 *
 * This is power + transparency — Nour should never have to guess
 * what Nick is actually seeing. If the prompt is stale, you can
 * invalidate the cache from the same panel. If it's truncated, you
 * can see the full length before truncation and decide if the 50K
 * limit is biting.
 *
 * Query params:
 *   fresh=1    — bypass cache and rebuild from scratch (debug)
 *   raw=1      — return just the prompt text (for downloading)
 */

import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import {
  getCachedPrompt,
  setCachedPrompt,
  invalidatePromptCache,
} from "@/lib/ai/system-prompt-cache";
import { getActiveProviderInfo } from "@/lib/ai/provider";
import { recordError } from "@/lib/errors/record-error";

import { requireSession } from "@/lib/auth-guard";
export const dynamic = "force-dynamic";

// Rough heuristic: 4 chars per token for English text.
// Not exact but good enough for a UI readout.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function GET(req: Request) {
  // v10.0.183 · the GET path leaked the assembled system prompt
  // (which can include brain memories + private context). Auth was
  // present in POST further down but missing here.
  await requireSession(req);
  const url = new URL(req.url);
  const fresh = url.searchParams.get("fresh") === "1";
  const raw = url.searchParams.get("raw") === "1";

  try {
    const { provider, modelId } = getActiveProviderInfo();

    if (fresh) invalidatePromptCache();

    let prompt: string;
    let fromCache: boolean;
    const buildStart = Date.now();

    const cached = getCachedPrompt(provider, "full");
    if (cached) {
      prompt = cached;
      fromCache = true;
    } else {
      prompt = await buildSystemPrompt();
      setCachedPrompt(provider, "full", prompt);
      fromCache = false;
    }

    const buildMs = Date.now() - buildStart;

    // Venice context window — keep in sync with route.ts MAX_SYSTEM_CHARS
    const maxSystemChars = provider === "anthropic" ? 120_000 : 65_000;
    const truncated = prompt.length > maxSystemChars;
    const truncatedAt = truncated ? maxSystemChars : null;
    const effectivePrompt = truncated ? prompt.slice(0, maxSystemChars) : prompt;

    if (raw) {
      return new Response(effectivePrompt, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return Response.json({
      provider,
      modelId,
      fromCache,
      buildMs,
      length: prompt.length,
      effectiveLength: effectivePrompt.length,
      wordCount: prompt.split(/\s+/).filter(Boolean).length,
      tokenEstimate: estimateTokens(effectivePrompt),
      maxSystemChars,
      truncated,
      truncatedAt,
      // Send a preview — the full prompt can be many KB. UI fetches
      // ?raw=1 when it wants the complete text.
      preview: effectivePrompt.slice(0, 2000),
      tail: effectivePrompt.slice(-1000),
    });
  } catch (err) {
    recordError("chat:prompt-build", err);
    return Response.json(
      {
        error: err instanceof Error ? err.message : "Failed to build prompt",
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ai/inspect-prompt — invalidate cache and return a fresh build.
 */
export async function POST(req: Request) {
  await requireSession(req);
  invalidatePromptCache();
  try {
    const { provider } = getActiveProviderInfo();
    const buildStart = Date.now();
    const prompt = await buildSystemPrompt();
    setCachedPrompt(provider, "full", prompt);
    return Response.json({
      ok: true,
      length: prompt.length,
      buildMs: Date.now() - buildStart,
    });
  } catch (err) {
    recordError("chat:prompt-build", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Build failed" },
      { status: 500 }
    );
  }
}
