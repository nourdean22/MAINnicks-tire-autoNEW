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
  setCachedPrompt,
  invalidatePromptCache,
} from "@/lib/ai/system-prompt-cache";
import { getActiveProviderInfo } from "@/lib/ai/provider";
import { recordError } from "@/lib/errors/record-error";
import { inspectPrompt } from "@/lib/services/chat-prompt-inspect";

import { requireSession } from "@/lib/auth-guard";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // v10.0.183 · the GET path leaked the assembled system prompt
  // (which can include brain memories + private context). Auth was
  // present in POST further down but missing here.
  await requireSession(req);
  const url = new URL(req.url);
  const fresh = url.searchParams.get("fresh") === "1";
  const raw = url.searchParams.get("raw") === "1";

  try {
    // Phase B.5 · the prompt build + cache + truncation analysis live
    // in the shared `inspectPrompt` service · `trpc.chat.inspectPrompt`
    // calls the same function · drift impossible. The service result
    // carries the full effective prompt as `.prompt` · this route
    // still serves it as text/plain on `?raw=1` and as a preview-only
    // JSON shape otherwise (back-compat with pre-B.5 REST consumers).
    const r = await inspectPrompt({ fresh });

    if (raw) {
      return new Response(r.prompt, {
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }

    return Response.json({
      provider: r.provider,
      modelId: r.modelId,
      fromCache: r.fromCache,
      buildMs: r.buildMs,
      length: r.length,
      effectiveLength: r.effectiveLength,
      wordCount: r.wordCount,
      tokenEstimate: r.tokenEstimate,
      maxSystemChars: r.maxSystemChars,
      truncated: r.truncated,
      truncatedAt: r.truncatedAt,
      // Preview-only — the full prompt can be many KB. Legacy UI
      // fetches ?raw=1 when it wants the complete text.
      preview: r.preview,
      tail: r.tail,
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
