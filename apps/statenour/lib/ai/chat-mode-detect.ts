/**
 * Chat mode detection — PURE CLIENT-SAFE.
 *
 * Extracted from lib/ai/chat-mode.ts so client components (ModePill,
 * chat page) can import the classifier without pulling in the
 * server-side pruneTools path, which transitively requires
 * ./tool-embeddings → ./tools → googleapis → child_process and
 * explodes Turbopack's client bundling.
 *
 * This file MUST stay zero-dependency — no prisma, no ai sdk, no
 * node builtins. Pure regex + string ops.
 */

export type ChatMode = "standard" | "deep";

/**
 * Decide which mode a chat request should run in based on the latest
 * user message. Two modes:
 *   - standard : default. Tools pruned, ~1200 token budget.
 *   - deep     : long brain dumps + explicit strategy/analysis/plan.
 */
export function detectChatMode(
  userContent: string,
  _messageCount: number
): ChatMode {
  const text = userContent.trim().toLowerCase();
  const len = text.length;

  // Long brain dumps always get deep mode
  if (len > 280) return "deep";

  // Explicit strategy / pattern / analysis keywords
  if (
    /\b(plan|strategy|strategic|analyze|analyse|blind ?spot|drift|forecast|pattern|pipeline|week ahead|month ahead|review|reflect|deep dive|situation|battle|enemy|enemies|power move|tools?|capabilities|functions?|what can you do)\b/.test(
      text
    )
  ) {
    return "deep";
  }

  // Action requests that need agentic tool chaining
  if (
    /\b(generate|create|make|build|draft|write me|prepare|run the|ingest|capture|log this|store this|track this|remember this)\b/.test(
      text
    )
  ) {
    return "deep";
  }

  return "standard";
}
