/**
 * app/api/ai/chat/text-only-step.ts: the prepareStep result for the last allowed
 * step of a chat turn, shared by the streaming config (build-stream-config.ts) and
 * the buffered pre-flush lane (alternate-paths.ts) so the two cannot drift.
 *
 * 2026-10-26 · tool_choice "none" is only a request. Ollama's OpenAI-compat surface
 * ignores it: an ollama/minimax-m3 turn called tools on its last step and ended
 * "tool-calls" with no prose. So the last step also sends NO tools (activeTools: []),
 * which no provider can ignore. Anthropic, Gemini and OpenAI honour "none" natively
 * and keep their tool definitions (Anthropic rejects tool history without them).
 *
 * 2026-10-28 · the strip sends NO toolChoice: ai@6.0.314+ throws ToolChoiceViolationError
 * when a model calls a tool on a "none" step instead of looping to the extra text-only
 * step, and these providers do exactly that. With no tools active a stray call parses as
 * an invalid call and the loop moves on.
 */
export function textOnlyStep(provider: string | null | undefined) {
  return provider === "anthropic" || provider === "gemini" || provider === "openai"
    ? { toolChoice: "none" as const }
    : { activeTools: [] as string[] };
}
