/**
 * lib/ai/style-adapter.ts · v10.0.529.34 · Arc B Feature 7
 *
 * Operator-style mimicry across non-chat AI surfaces (reflect
 * pushback · coach-goal · teach · track-story · narrator voices ·
 * etc) so the operator's preferred style propagates across the OS.
 *
 * NOTE (2026-07-09): the chat pipeline does NOT apply this addendum.
 * An earlier version of this header claimed lib/ai/system-prompt.ts
 * appended it every chat turn — that wiring did not survive the
 * Prompt V2 cutover (2026-06-29); no chat-path import of
 * preference-inference exists today. The ~8 non-chat call-sites of
 * applyOperatorStyle are the only live consumers.
 *
 * Design (kaizen · YAGNI):
 *   · ONE function · applyOperatorStyle(systemPrompt) → systemPrompt+
 *   · Cached vector with 5-minute TTL · the operator doesn't change
 *     preferences mid-conversation often enough to justify per-call
 *     DB reads · the chat pipeline reloads on every turn but that's
 *     ~1/min worst-case · these non-chat surfaces fire even less.
 *   · Defensive · if anything throws or the vector is neutral, the
 *     base prompt is returned untouched · style is supplementary,
 *     never load-critical.
 *   · Pure addition · existing surfaces work unchanged when this
 *     helper isn't wired in.
 *
 * Why a separate helper rather than chat's inline import:
 *   The chat pipeline imports + calls inline. That works for one
 *   site. With ~15 AI surfaces, the cache + retry + defensive
 *   bailout pattern is worth centralizing · also lets us add
 *   measurement (count addendum-applied calls per surface) without
 *   touching the callers.
 */

import {
  loadPreferenceVector,
  buildSystemPromptAddendum,
  type PreferenceVector,
} from "@/lib/brain/preference-inference";
import { logger as rootLogger } from "@/lib/logger";

const log = rootLogger.withSurface("ai/style-adapter");

const CACHE_TTL_MS = 5 * 60 * 1000;

interface VectorCache {
  vec: PreferenceVector;
  addendum: string;
  loadedAt: number;
}

let cache: VectorCache | null = null;

/**
 * Internal · returns the current addendum + caches for 5 minutes.
 * Failures (DB down · embedding provider unavailable · etc) return
 * "" so the caller falls back to the base prompt unchanged.
 */
async function getCachedAddendum(): Promise<string> {
  if (cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) {
    return cache.addendum;
  }
  try {
    const vec = await loadPreferenceVector();
    const addendum = buildSystemPromptAddendum(vec);
    cache = { vec, addendum, loadedAt: Date.now() };
    return addendum;
  } catch (err) {
    log.warn("load_failed", {
      err: err instanceof Error ? err.message.slice(0, 200) : String(err),
    });
    return "";
  }
}

/**
 * Append the operator's 8-axis style addendum to a base system prompt.
 * Returns the prompt UNCHANGED when:
 *   · The vector is neutral (|v| < 0.15 across every axis · addendum is "")
 *   · Loading the vector throws
 *   · The base prompt is empty / whitespace
 *
 * Idempotent · safe to call multiple times in the same handler ·
 * the cache absorbs the duplicate reads.
 */
export async function applyOperatorStyle(systemPrompt: string): Promise<string> {
  if (!systemPrompt || systemPrompt.trim().length === 0) {
    return systemPrompt;
  }
  const addendum = await getCachedAddendum();
  if (!addendum) return systemPrompt;
  return `${systemPrompt}\n\n${addendum}`;
}

/**
 * Force a cache invalidation · called by the preference-vector POST
 * route after a manual override so the NEXT non-chat surface picks
 * up the change immediately instead of waiting up to 5 minutes.
 * No-op when there's no cache to clear.
 */
export function invalidateStyleCache(): void {
  cache = null;
}
