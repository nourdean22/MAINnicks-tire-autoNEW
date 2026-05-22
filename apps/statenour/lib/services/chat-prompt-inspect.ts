/**
 * lib/services/chat-prompt-inspect.ts · Phase B.5 (2026-05-22 ·
 * legacy-modernizer REST→tRPC chat slice)
 *
 * System-prompt inspector service · extracted from
 * `app/api/ai/inspect-prompt/route.ts` so the legacy REST endpoint AND
 * the new `trpc.chat.inspectPrompt` query both call this single
 * function · drift between the two consumers is structurally
 * impossible. Same shared-service pattern as Z / DD / EE / GG.
 *
 * Builds (or reads from cache) the exact system prompt that would be
 * sent to the AI on the next message · returns cache status, length,
 * word count, token estimate, truncation analysis, head/tail preview
 * AND the full effective prompt text.
 *
 * BEHAVIOUR RESHAPE · the legacy GET supported `?raw=1` to return the
 * full prompt as a `text/plain` Response. tRPC cannot return a raw
 * text body, so this service ALWAYS computes the full prompt and
 * returns it as the `prompt` field. The REST route keeps its
 * `?raw=1` text/plain behaviour by reading `result.prompt` off this
 * same service result · the tRPC procedure returns the structured
 * object whole + the client reads `result.prompt`.
 */

import { buildSystemPrompt } from "@/lib/ai/system-prompt";
import {
  getCachedPrompt,
  setCachedPrompt,
  invalidatePromptCache,
} from "@/lib/ai/system-prompt-cache";
import { getActiveProviderInfo } from "@/lib/ai/provider";

// Rough heuristic: 4 chars per token for English text. Not exact but
// good enough for a UI readout.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface InspectPromptArgs {
  /** Bypass the cache and rebuild from scratch. */
  fresh?: boolean;
}

export interface InspectPromptResult {
  provider: string;
  modelId: string;
  fromCache: boolean;
  buildMs: number;
  length: number;
  effectiveLength: number;
  wordCount: number;
  tokenEstimate: number;
  maxSystemChars: number;
  truncated: boolean;
  truncatedAt: number | null;
  /** First 2000 chars of the effective prompt. */
  preview: string;
  /** Last 1000 chars of the effective prompt. */
  tail: string;
  /**
   * The FULL effective (post-truncation) prompt text. The tRPC
   * procedure returns this whole result; the PromptInspector reads
   * `result.prompt` for the "download full" action (replacing the
   * legacy `?raw=1` text/plain fetch). The REST route slices `preview`
   * / `tail` off it for its JSON shape + serves it verbatim on
   * `?raw=1`.
   */
  prompt: string;
}

/**
 * Build the system-prompt inspection payload. Throws on a build
 * failure — the REST route maps that to a 500, the tRPC procedure
 * lets it surface as an INTERNAL_SERVER_ERROR.
 */
export async function inspectPrompt(
  args: InspectPromptArgs = {},
): Promise<InspectPromptResult> {
  const { provider, modelId } = getActiveProviderInfo();

  if (args.fresh) invalidatePromptCache();

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

  // Venice context window — keep in sync with route.ts MAX_SYSTEM_CHARS.
  const maxSystemChars = provider === "anthropic" ? 120_000 : 65_000;
  const truncated = prompt.length > maxSystemChars;
  const truncatedAt = truncated ? maxSystemChars : null;
  const effectivePrompt = truncated
    ? prompt.slice(0, maxSystemChars)
    : prompt;

  return {
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
    preview: effectivePrompt.slice(0, 2000),
    tail: effectivePrompt.slice(-1000),
    prompt: effectivePrompt,
  };
}
