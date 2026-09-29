/**
 * Which "keep thinking out of a short answer" setting a Claude model accepts.
 *
 * Callers with a small max_tokens (the SMS drafter's 110) used to send
 * `thinking: { type: "disabled" }` to every model. Per the claude-api skill's
 * "Thinking & Effort" table (models cached 2026-09-25), that setting is a
 * 400 on Claude Opus 5.5, Claude Sonnet 5.5, Claude Fable 5 / 5.1 and
 * Claude Mythos 5 / 5.1, so an ANTHROPIC_MODEL flip to one of them would
 * fail every call. Their
 * replacements:
 *   - Claude Sonnet 5.5: `thinking: { type: "between_tools" }` turns thinking
 *     off (accepted at the default effort, `high`, or below).
 *   - Opus 5.5 / Fable / Mythos: thinking cannot be turned off. Omit the
 *     parameter and ask for `effort: "low"`, the documented way to keep the
 *     thinking share small. A capped answer can still be cut off; the SMS
 *     drafter then holds the draft instead of sending it (#2767).
 * Only ids known to accept `disabled` get it; an unknown id takes the
 * can't-disable branch, which no current model rejects.
 * statenour carries the same rule in apps/statenour/lib/ai/claude5-compat.ts
 * (the apps share no AI code).
 */

const ACCEPTS_THINKING_DISABLED = new Set([
  "claude-sonnet-5",
  "claude-opus-5", // accepted at effort high or below; no effort is sent with it
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-opus-4-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5",
  "claude-haiku-4-5",
]);

/** Lowercased alias: a dated snapshot suffix ("-20251001" / "@20251001") or "-latest" removed. */
function claudeModelKey(modelId: string): string {
  return modelId.trim().toLowerCase().replace(/[-@]\d{8}$/, "").replace(/-latest$/, "");
}

/** Request-body fields to spread into a Messages API call that wants a short, thinking-free answer. */
export function claudeThinkingOffParams(
  modelId: string,
): { thinking: { type: "disabled" | "between_tools" } } | { output_config: { effort: "low" } } {
  const key = claudeModelKey(modelId);
  if (ACCEPTS_THINKING_DISABLED.has(key)) return { thinking: { type: "disabled" } };
  if (key === "claude-sonnet-5-5") return { thinking: { type: "between_tools" } };
  return { output_config: { effort: "low" } };
}
